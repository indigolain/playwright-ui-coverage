import fs from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Page, TestInfo } from '@playwright/test';
import { tracker } from './tracker';
import { identityArgs } from './identity';
import type { UiCoverageOptions } from './options';
import { ATTACHMENT_NAME, SCREENSHOT_ATTACHMENT_PREFIX, type Interaction, type Inventory, type Snapshot } from './types';

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

const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

/**
 * Records UI coverage for one browser context (every page and popup in it)
 * and attaches the result to the test when finished.
 */
export class ContextRecorder {
  private interactions: Interaction[] = [];
  private snapshots: Snapshot[] = [];
  /** Keys already captured in any inventory, per URL. */
  private seenKeys = new Map<string, Set<string>>();
  /** Keys already visible in a screenshot, per URL. */
  private shotKeys = new Map<string, Set<string>>();
  private chain: Promise<void> = Promise.resolve();
  private timers = new Map<Page, NodeJS.Timeout>();
  /** Screenshot files, attached to the test (by name) in finish(). */
  private shots: { name: string; path: string }[] = [];
  private finished = false;

  private constructor(
    private context: BrowserContext,
    private testInfo: TestInfo,
    private options: UiCoverageOptions,
  ) {}

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
        ({ page }, interaction: Interaction, inventory?: Inventory) => {
          this.interactions.push(interaction);
          if (inventory && this.addNew(this.seenKeys, inventory)) this.snapshots.push(inventory);
          if (page) this.schedule(page);
        },
      );
      await this.context.addInitScript(tracker, {
        ignoreSelectors: this.options.ignoreSelectors,
        ...identityArgs(this.options),
      });
    });
    this.context.on('page', (page) => this.watch(page));
    this.context.pages().forEach((page) => this.watch(page));
  }

  private watch(page: Page) {
    page.on('load', () => void this.enqueue(page));
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
    const inventory = () =>
      internal(page, () =>
        page.evaluate(() => (window as any).__uicovInventory?.() as Inventory | undefined),
      );
    const sameLayout = (a: Inventory, b: Inventory) =>
      a.url === b.url && JSON.stringify(a.elements) === JSON.stringify(b.elements);

    // The test keeps running while we snapshot, so the page can change between
    // the inventory and the screenshot. Re-check after the screenshot and retry.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (page.isClosed()) return;
      const before = await inventory();
      if (!before) return;
      if (!this.wantsScreenshot(before)) {
        // Record the elements without an image.
        if (this.addNew(this.seenKeys, before)) this.snapshots.push(before);
        return;
      }

      const { image, height } = await this.capture(page);
      const after = await inventory();
      if (!after) return;
      if (!sameLayout(before, after)) {
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
  private wantsScreenshot(inventory: Inventory): boolean {
    const mode = this.options.screenshots;
    if (mode === 'off') return false;
    if (mode === 'first-only') return !this.shotKeys.has(inventory.url.split('#')[0]);
    return this.hasNew(this.shotKeys, inventory);
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

  private hasNew(seen: Map<string, Set<string>>, inventory: Inventory): boolean {
    const set = seen.get(inventory.url.split('#')[0]);
    return !set || inventory.elements.some((e) => !set.has(e.key));
  }

  /** Adds the inventory's keys to `seen`; returns true if any were new. */
  private addNew(seen: Map<string, Set<string>>, inventory: Inventory): boolean {
    const urlKey = inventory.url.split('#')[0];
    const set = seen.get(urlKey) ?? new Set<string>();
    seen.set(urlKey, set);
    let added = false;
    for (const e of inventory.elements) {
      if (!set.has(e.key)) {
        set.add(e.key);
        added = true;
      }
    }
    return added;
  }

  /** Takes a final snapshot of every open page and attaches the data to the test. */
  async finish() {
    if (this.finished) return;
    this.finished = true;
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();
    await this.chain;
    for (const page of this.context.pages()) await this.enqueue(page); // final state (open modals, etc.)
    recorders.delete(this.context);
    if (this.interactions.length === 0 && this.snapshots.length === 0) return;
    // Push directly (like Playwright does for videos) rather than testInfo.attach(),
    // which would add an "Attach" step to the user's report. Screenshots go in as
    // file attachments so the blob reporter carries them to merge-reports.
    const contentType = (file: string) =>
      IMAGE_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    this.testInfo.attachments.push(
      ...this.shots.map((s) => ({ name: s.name, path: s.path, contentType: contentType(s.path) })),
      {
        name: ATTACHMENT_NAME,
        body: Buffer.from(JSON.stringify({ interactions: this.interactions, snapshots: this.snapshots })),
        contentType: 'application/json',
      },
    );
  }
}
