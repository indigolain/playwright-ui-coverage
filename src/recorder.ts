import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Frame, Page, TestInfo } from '@playwright/test';
import { tracker } from './tracker';
import { interactionArgs } from './interactions';
import { recordedRules, type UiCoverageOptions } from './options';
import { RECORDED_CANDIDATES } from './model/elements';
import {
  RECORDING_FORMAT_VERSION,
  type RawCoverageData,
  type RawElement,
  type RawElementRef,
  type RawFrameHost,
  type RawInteraction,
  type RawInteractionEvent,
  type RawInventory,
  type RawNode,
  type RawSnapshot,
} from './model/raw';
import { compileRules, Resolver } from './model/resolve';
import { DOCUMENT_TAG } from './model/selector';
import type { UiCoverageRules } from './model/rules';
import { ATTACHMENT_NAME, SCREENSHOT_ATTACHMENT_PREFIX } from './types';

/**
 * Runs `fn` as an "internal" Playwright call when possible, so our evaluate /
 * screenshot calls don't show up as steps in the user's report or trace.
 * Falls back to a plain call if the private API isn't there.
 */
function internal<T>(owner: unknown, fn: () => Promise<T>): Promise<T> {
  const wrap = (owner as any)?._wrapApiCall;
  return typeof wrap === 'function' ? wrap.call(owner, fn, { internal: true }) : fn();
}

const recorders = new WeakMap<BrowserContext, ContextRecorder>();
/** Screenshot counter per test, so several contexts in one test don't collide. */
const shotCounters = new WeakMap<TestInfo, number>();

/**
 * Whether the test runs under Playwright component testing: the CT packages'
 * `defineConfig` adds this key to the config (it's how they register their
 * Vite plugin), so it's there in every worker.
 */
const isComponentTest = (testInfo: TestInfo) => '@playwright/experimental-ct-core' in (testInfo.config as object);

const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where a child frame's document is in its page: the node chain from the
 * page's `<html>` to the frame's `#document` pseudo-node, and where its
 * viewport is in the page's document coordinates.
 */
interface FrameMap {
  /** Local node list; the root (the page's `<html>`) has no parent. */
  nodes: RawNode[];
  /** Index in `nodes` of the frame's `#document` node. */
  doc: number;
  /** Page document position of the frame viewport's top-left corner. */
  x: number;
  y: number;
  /** The part of the frame's viewport that is visible in the page (clipped by ancestor frames). */
  clip: Box;
}

/**
 * Elements of out-of-process frames outside the viewport: in an inventory,
 * but a screenshot taken now wouldn't show them. Kept out of the recorded data.
 */
const UNPAINTED = new WeakSet<object>();
/** Marks `copy` unpainted if `source` is (or if `force`). Returns `copy`. */
function markUnpainted<T extends object>(copy: T, source: object | undefined, force = false): T {
  if (force || (source && UNPAINTED.has(source))) UNPAINTED.add(copy);
  return copy;
}

const intersect = (a: Box, b: Box): Box => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return { x, y, w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x), h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y) };
};

/**
 * Appends a child frame's inventory (or event) nodes to `nodes`, under the
 * frame's host chain. Returns the offset of the frame's own nodes.
 */
function appendFrameNodes(nodes: RawNode[], map: FrameMap, local: RawNode[]): number {
  const base = nodes.length;
  for (const n of map.nodes) nodes.push(n.parent === undefined ? n : { ...n, parent: n.parent + base });
  const doc = base + map.doc;
  const offset = nodes.length;
  for (const n of local) nodes.push({ ...n, parent: n.parent === undefined ? doc : n.parent + offset });
  return offset;
}

/**
 * Whether the frame's origin differs from its parent's: such frames may run
 * in another process (site isolation), and browsers then only paint them in
 * screenshots where they are inside the viewport.
 */
function isCrossOrigin(frame: Frame): boolean {
  const origin = (u: string) => {
    try {
      const o = new URL(u).origin;
      return o === 'null' ? '' : o; // about:blank, srcdoc, data: run with their parent
    } catch {
      return '';
    }
  };
  const own = origin(frame.url());
  const parent = frame.parentFrame();
  return !!own && !!parent && !!origin(parent.url()) && own !== origin(parent.url());
}

/** A frame's element box mapped into the page and clipped to the frame's visible viewport (zero-size when scrolled out). */
function mapBox(e: RawElement, inv: RawInventory, map: FrameMap): Box {
  const box = { x: map.x + e.x - (inv.scrollX ?? 0), y: map.y + e.y - (inv.scrollY ?? 0), w: e.w, h: e.h };
  const c = intersect(box, map.clip);
  return { x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.w), h: Math.round(c.h) };
}

/**
 * Records UI coverage for one browser context (every page and popup in it)
 * and attaches the raw result to the test when finished.
 */
export class ContextRecorder {
  /** Node table shared by every snapshot and interaction of this context. */
  private nodes: RawNode[] = [];
  private nodeIds = new Map<string, number>();
  private interactions: RawInteraction[] = [];
  private snapshots: RawSnapshot[] = [];
  /** Identity rules from `use.uiCoverage` (deprecated there), recorded with the data. */
  private rules: UiCoverageRules;
  /**
   * Resolves keys with the recording-time rules. Only used to decide when a
   * new snapshot / screenshot is worth taking; the report recomputes keys
   * with its own rules.
   */
  private resolver: Resolver;
  /** Keys already captured in any inventory, per URL. */
  private seenKeys = new Map<string, Set<string>>();
  /** Keys already visible in a screenshot, per URL. */
  private shotKeys = new Map<string, Set<string>>();
  private chain: Promise<void> = Promise.resolve();
  private timers = new Map<Page, NodeJS.Timeout>();
  /** Last known map of each child frame, for events that arrive after the frame is gone. */
  private frameMaps = new WeakMap<Frame, FrameMap>();
  /** Interactions from child frames being stitched (async). */
  private pending = new Set<Promise<void>>();
  /** Screenshot files, attached to the test (by name) in finish(). */
  private shots: { name: string; path: string }[] = [];
  private finished = false;

  private constructor(
    private context: BrowserContext,
    private testInfo: TestInfo,
    private options: UiCoverageOptions,
  ) {
    this.rules = recordedRules(options);
    this.resolver = new Resolver({ nodes: this.nodes }, compileRules(this.rules));
  }

  /** Starts recording `context`. Returns undefined if it is already being recorded. */
  static async attach(
    context: BrowserContext,
    testInfo: TestInfo,
    options: UiCoverageOptions,
  ): Promise<ContextRecorder | undefined> {
    if (recorders.has(context)) return undefined;
    const recorder = new ContextRecorder(context, testInfo, options);
    recorders.set(context, recorder);
    await recorder.install();
    return recorder;
  }

  static for(context: BrowserContext): ContextRecorder | undefined {
    return recorders.get(context);
  }

  private async install() {
    await internal(this.context, async () => {
      await this.context.exposeBinding(
        '__uicovRecord',
        ({ page, frame }, event: RawInteractionEvent, inventory?: RawInventory) => {
          if (page && frame && frame !== page.mainFrame()) {
            const work = this.recordFromFrame(page, frame, event, inventory).catch(() => {});
            this.pending.add(work);
            void work.finally(() => this.pending.delete(work));
            return;
          }
          const map = this.intern(event.nodes);
          this.interactions.push({ event: event.event, url: event.url, element: this.remap(event.element, map) });
          if (inventory) {
            const snap = this.toSnapshot(inventory);
            if (this.addNew(this.seenKeys, snap)) this.snapshots.push(snap);
          }
          if (page) this.schedule(page);
        },
      );
      await this.context.addInitScript(tracker, {
        ignoreSelectors: this.options.ignoreSelectors ?? [],
        extraCandidates: RECORDED_CANDIDATES.join(','),
        ...interactionArgs(this.options),
      });
    });
    this.context.on('page', (page) => this.watch(page));
    this.context.pages().forEach((page) => this.watch(page));
  }

  /** Adds an in-page node list to the shared table; returns local → shared indices. */
  private intern(local: RawNode[]): number[] {
    const map: number[] = [];
    for (const n of local) {
      const node: RawNode = { ...n };
      if (n.parent !== undefined) node.parent = map[n.parent];
      const id = JSON.stringify([node.tag, node.parent, node.nth, node.of, node.attrs]);
      let idx = this.nodeIds.get(id);
      if (idx === undefined) {
        idx = this.nodes.length;
        this.nodes.push(node);
        this.nodeIds.set(id, idx);
      }
      map.push(idx);
    }
    return map;
  }

  /**
   * An interaction in a child frame: its nodes go under the frame's host chain
   * (so it resolves to the same element as the frame's inventory entry) and it
   * counts for the page's URL.
   */
  private async recordFromFrame(page: Page, frame: Frame, event: RawInteractionEvent, inventory?: RawInventory) {
    const url = page.url();
    const fm = (await this.frameMap(frame)) ?? this.frameMaps.get(frame);
    if (!fm) return;
    const nodes: RawNode[] = [];
    const offset = appendFrameNodes(nodes, fm, event.nodes);
    const map = this.intern(nodes);
    this.interactions.push({ event: event.event, url, element: { ...event.element, node: map[event.element.node + offset] } });
    if (inventory) {
      const combined: RawInventory = { url, dpr: inventory.dpr, nodes: [], elements: [] };
      this.addFrameInventory(combined, inventory, fm);
      const snap = this.toSnapshot(combined);
      if (this.addNew(this.seenKeys, snap)) this.snapshots.push(snap);
    }
    this.schedule(page);
  }

  /**
   * Maps a child frame into its page, through its ancestors' frame elements.
   * Undefined for the main frame, or when the frame is gone or has no tracker.
   */
  private frameMap(frame: Frame, memo = new Map<Frame, Promise<FrameMap | undefined>>()): Promise<FrameMap | undefined> {
    let p = memo.get(frame);
    if (!p) {
      p = this.computeFrameMap(frame, memo).catch(() => undefined);
      memo.set(frame, p);
    }
    return p;
  }

  private async computeFrameMap(frame: Frame, memo: Map<Frame, Promise<FrameMap | undefined>>) {
    const parent = frame.parentFrame();
    if (!parent) return undefined;
    const parentMap = parent.parentFrame() ? await this.frameMap(parent, memo) : undefined;
    if (parent.parentFrame() && !parentMap) return undefined;
    const host = await internal(frame, async () => {
      const handle = await frame.frameElement();
      try {
        return await handle.evaluate((el) => (window as any).__uicovFrameHost?.(el) as RawFrameHost | undefined);
      } finally {
        await handle.dispose();
      }
    });
    if (!host) return undefined;
    const nodes: RawNode[] = parentMap ? [...parentMap.nodes] : [];
    const base = nodes.length;
    for (const n of host.nodes)
      nodes.push({ ...n, ...(n.parent === undefined ? (parentMap ? { parent: parentMap.doc } : {}) : { parent: n.parent + base }) });
    nodes.push({ tag: DOCUMENT_TAG, parent: host.node + base });
    // The host box is in its document's coordinates: through that document's
    // viewport (its scroll offset) into the page.
    const x = parentMap ? parentMap.x + host.x - host.scrollX : host.x;
    const y = parentMap ? parentMap.y + host.y - host.scrollY : host.y;
    const viewport = { x, y, w: host.w, h: host.h };
    const fm: FrameMap = { nodes, doc: nodes.length - 1, x, y, clip: parentMap ? intersect(parentMap.clip, viewport) : viewport };
    this.frameMaps.set(frame, fm);
    return fm;
  }

  /**
   * Adds a child frame's inventory to a page inventory (nodes under the
   * frame's host chain, boxes in page coordinates). With `painted`, boxes
   * outside it become zero-size: out-of-process frames are only painted in
   * screenshots inside the viewport, so they would point at a blank area.
   */
  private addFrameInventory(into: RawInventory, inv: RawInventory, fm: FrameMap, painted?: Box) {
    const offset = appendFrameNodes(into.nodes, fm, inv.nodes);
    for (const e of inv.elements) {
      const box = mapBox(e, inv, fm);
      const shown = intersect(box, painted ?? box);
      // Not (fully) in the painted area: no box, and a screenshot now doesn't show it.
      const unpainted = box.w > 0 && box.h > 0 && shown.w * shown.h < box.w * box.h;
      const el = { ...e, node: e.node + offset, ...(unpainted ? { ...box, w: 0, h: 0 } : box) };
      into.elements.push(markUnpainted(el, undefined, unpainted));
    }
  }

  /** Inventory of the page: the main frame's, plus every child frame's (see `FrameMap`). */
  private async pageInventory(page: Page): Promise<RawInventory | undefined> {
    const evaluate = (frame: Frame) =>
      internal(frame, () => frame.evaluate(() => (window as any).__uicovInventory?.() as RawInventory | undefined));
    const main = await evaluate(page.mainFrame());
    if (!main) return undefined;
    const frames = page.frames().filter((f) => f !== page.mainFrame());
    if (!frames.length) return main;
    const out: RawInventory = { url: main.url, dpr: main.dpr, nodes: [...main.nodes], elements: [...main.elements] };
    const memo = new Map<Frame, Promise<FrameMap | undefined>>();
    const parts = await Promise.all(
      frames.map((f) => Promise.all([evaluate(f).catch(() => undefined), this.frameMap(f, memo)])),
    );
    // The main frame's viewport in page coordinates.
    const viewport =
      main.viewportWidth !== undefined && main.viewportHeight !== undefined
        ? { x: main.scrollX ?? 0, y: main.scrollY ?? 0, w: main.viewportWidth, h: main.viewportHeight }
        : undefined;
    frames.forEach((f, i) => {
      const [inv, fm] = parts[i];
      if (inv && fm) this.addFrameInventory(out, inv, fm, isCrossOrigin(f) ? viewport : undefined);
    });
    return out;
  }

  private remap<T extends RawElementRef>(ref: T, map: number[]): T {
    return markUnpainted({ ...ref, node: map[ref.node] }, ref);
  }

  private toSnapshot(inv: RawInventory): RawSnapshot {
    const map = this.intern(inv.nodes);
    return { url: inv.url, dpr: inv.dpr, elements: inv.elements.map((e) => this.remap(e, map)) };
  }

  private watch(page: Page) {
    page.on('load', () => void this.enqueue(page));
    // A child frame (re)loaded: snapshot (the page's load event may be long past),
    // and remember where it is in case it's gone by the time its events arrive.
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame() || this.finished) return;
      void this.frameMap(frame);
      this.schedule(page);
    });
    page.on('close', () => {
      clearTimeout(this.timers.get(page));
      this.timers.delete(page);
    });
  }

  /** Throttled: snapshot `snapshotDelay` ms after the first interaction of a burst. */
  private schedule(page: Page) {
    if (this.finished || this.timers.has(page)) return;
    this.timers.set(
      page,
      setTimeout(() => {
        this.timers.delete(page);
        void this.enqueue(page);
      }, this.options.snapshotDelay),
    );
  }

  private enqueue(page: Page) {
    this.chain = this.chain.then(() => this.snapshot(page)).catch(() => {});
    return this.chain;
  }

  private async snapshot(page: Page) {
    const inventory = () => this.pageInventory(page);
    const sameLayout = (a: RawInventory, b: RawInventory) =>
      a.url === b.url && JSON.stringify([a.nodes, a.elements]) === JSON.stringify([b.nodes, b.elements]);

    // The test keeps running while we snapshot, so the page can change between
    // the inventory and the screenshot. Re-check after the screenshot and retry.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (page.isClosed()) return;
      const before = await inventory();
      if (!before) return;
      const beforeSnap = this.toSnapshot(before);
      if (!this.wantsScreenshot(beforeSnap)) {
        // Record the elements without an image.
        if (this.addNew(this.seenKeys, beforeSnap)) this.snapshots.push(beforeSnap);
        return;
      }

      const { image, height } = await this.capture(page);
      const afterRaw = await inventory();
      if (!afterRaw) return;
      const after = this.toSnapshot(afterRaw);
      if (!sameLayout(before, afterRaw)) {
        if (attempt === 2) {
          // Couldn't get a stable frame: keep the elements, skip the image.
          if (this.addNew(this.seenKeys, after)) this.snapshots.push(after);
        }
        continue;
      }

      this.addNew(this.shotKeys, after);
      this.addNew(this.seenKeys, after);
      const index = shotCounters.get(this.testInfo) ?? 0;
      shotCounters.set(this.testInfo, index + 1);
      const file = this.testInfo.outputPath(`ui-coverage-${index}.${this.options.format === 'jpeg' ? 'jpg' : 'png'}`);
      await fs.promises.writeFile(file, image);
      // The JSON refers to the screenshot by attachment name, not by path, so it
      // still resolves after the blob reporter / merge-reports move the files.
      const name = `${SCREENSHOT_ATTACHMENT_PREFIX}${index}`;
      this.shots.push({ name, path: file });
      this.snapshots.push(height ? { ...after, screenshot: name, screenshotHeight: height } : { ...after, screenshot: name });
      return;
    }
  }

  /** 'on': when this state shows elements no screenshot has shown yet; 'first-only': once per URL. */
  private wantsScreenshot(snap: RawSnapshot): boolean {
    const mode = this.options.screenshots;
    if (mode === 'off') return false;
    if (mode === 'first-only') return !this.shotKeys.has(snap.url.split('#')[0]);
    return this.hasNew(this.shotKeys, snap);
  }

  /** Full-page screenshot in the configured format, cropped to `maxScreenshotHeight`. */
  private capture(page: Page): Promise<{ image: Buffer; height?: number }> {
    const { format, quality, maxScreenshotHeight: cap } = this.options;
    return internal(page, async () => {
      let clip: { x: number; y: number; width: number; height: number } | undefined;
      if (cap > 0) {
        const size = await page.evaluate(() => {
          const d = document.documentElement;
          const b = document.body;
          return {
            w: Math.max(d.scrollWidth, b ? b.scrollWidth : 0),
            h: Math.max(d.scrollHeight, b ? b.scrollHeight : 0),
          };
        });
        // aggregate() ignores elements below the crop; the report clips boxes to the image.
        if (size.h > cap) clip = { x: 0, y: 0, width: size.w, height: cap };
      }
      const image = await page.screenshot({
        fullPage: true,
        animations: 'disabled',
        type: format,
        quality: format === 'jpeg' ? Math.min(100, Math.max(0, Math.round(quality))) : undefined,
        clip,
        // Full-page captures can stall if the page navigates mid-capture; give up
        // (this state just gets no image) instead of holding up the test.
        timeout: 5000,
      });
      return { image, height: clip?.height };
    });
  }

  /**
   * Keys (under the recording-time rules) of the elements that count in
   * `snap`. For screenshots (`painted`), not the ones a screenshot of it wouldn't show.
   */
  private keysOf(snap: RawSnapshot, painted = false): string[] {
    const keys: string[] = [];
    for (const e of snap.elements) {
      if (e.candidateOnly || (painted && UNPAINTED.has(e))) continue;
      const node = this.resolver.node(e);
      if (node) keys.push(this.resolver.key(node));
    }
    return keys;
  }

  private hasNew(seen: Map<string, Set<string>>, snap: RawSnapshot): boolean {
    const set = seen.get(snap.url.split('#')[0]);
    return !set || this.keysOf(snap, seen === this.shotKeys).some((k) => !set.has(k));
  }

  /** Adds the snapshot's keys to `seen`; returns true if any were new. */
  private addNew(seen: Map<string, Set<string>>, snap: RawSnapshot): boolean {
    const urlKey = snap.url.split('#')[0];
    const set = seen.get(urlKey) ?? new Set<string>();
    seen.set(urlKey, set);
    let added = false;
    for (const k of this.keysOf(snap, seen === this.shotKeys)) {
      if (!set.has(k)) {
        set.add(k);
        added = true;
      }
    }
    return added;
  }

  /** Drops nodes that no kept snapshot or interaction refers to (directly or as an ancestor). */
  private compact(): RawNode[] {
    const keep = new Array<boolean>(this.nodes.length).fill(false);
    const mark = (i: number | undefined) => {
      while (i !== undefined && !keep[i]) {
        keep[i] = true;
        i = this.nodes[i].parent;
      }
    };
    for (const s of this.snapshots) s.elements.forEach((e) => mark(e.node));
    for (const i of this.interactions) mark(i.element.node);
    const map: number[] = [];
    const out: RawNode[] = [];
    this.nodes.forEach((n, i) => {
      if (!keep[i]) return;
      map[i] = out.length;
      out.push(n.parent === undefined ? n : { ...n, parent: map[n.parent] });
    });
    for (const s of this.snapshots) s.elements = s.elements.map((e) => markUnpainted({ ...e, node: map[e.node] }, e));
    for (const i of this.interactions) i.element = { ...i.element, node: map[i.element.node] };
    return out;
  }

  /** Takes a final snapshot of every open page and attaches the data to the test. */
  async finish() {
    if (this.finished) return;
    this.finished = true;
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();
    await Promise.all(this.pending);
    await this.chain;
    for (const page of this.context.pages()) await this.enqueue(page); // final state (open modals, etc.)
    await Promise.all(this.pending);
    recorders.delete(this.context);
    if (this.interactions.length === 0 && this.snapshots.length === 0) return;
    const data: RawCoverageData = {
      formatVersion: RECORDING_FORMAT_VERSION,
      nodes: this.compact(),
      ...(Object.keys(this.rules).length ? { rules: this.rules } : {}),
      snapshots: this.snapshots,
      interactions: this.interactions,
      ...(isComponentTest(this.testInfo) && { componentTest: true }),
    };
    // Push directly (like Playwright does for videos) rather than testInfo.attach(),
    // which would add an "Attach" step to the user's report. Screenshots go in as
    // file attachments so the blob reporter carries them to merge-reports.
    const contentType = (file: string) =>
      IMAGE_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    this.testInfo.attachments.push(
      ...this.shots.map((s) => ({ name: s.name, path: s.path, contentType: contentType(s.path) })),
      {
        name: ATTACHMENT_NAME,
        body: Buffer.from(JSON.stringify(data)),
        contentType: 'application/json',
      },
    );
  }
}
