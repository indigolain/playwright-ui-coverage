import fs from 'node:fs';
import type { Page, TestInfo } from '@playwright/test';
import { tracker } from './tracker';
import { ATTACHMENT_NAME, type Interaction, type Inventory, type Snapshot } from './types';

export interface RecorderOptions {
  ignoreSelectors: string[];
  /** ms to wait after a load/interaction before snapshotting (lets UI settle). */
  snapshotDelay: number;
}

/**
 * Per-test recorder: collects interactions from the page and takes
 * inventory + screenshot snapshots whenever new elements show up.
 */
export class Recorder {
  private interactions: Interaction[] = [];
  private snapshots: Snapshot[] = [];
  /** Keys already captured in any inventory, per URL. */
  private seenKeys = new Map<string, Set<string>>();
  /** Keys already visible in a screenshot, per URL. */
  private shotKeys = new Map<string, Set<string>>();
  private chain: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout | undefined;
  private shotIndex = 0;

  constructor(
    private page: Page,
    private testInfo: TestInfo,
    private options: RecorderOptions,
  ) {}

  async install() {
    await this.page.exposeBinding(
      '__uicovRecord',
      (_source, interaction: Interaction, inventory?: Inventory) => {
        this.interactions.push(interaction);
        if (inventory && this.addNew(this.seenKeys, inventory)) this.snapshots.push(inventory);
        this.schedule();
      },
    );
    await this.page.addInitScript(tracker, { ignoreSelectors: this.options.ignoreSelectors });
    this.page.on('load', () => void this.enqueue());
  }

  /** Throttled: snapshot `snapshotDelay` ms after the first interaction of a burst. */
  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.enqueue();
    }, this.options.snapshotDelay);
  }

  private enqueue() {
    this.chain = this.chain.then(() => this.snapshot()).catch(() => {});
    return this.chain;
  }

  private async snapshot() {
    const inventory = () =>
      this.page.evaluate(() => (window as any).__uicovInventory?.() as Inventory | undefined);
    const sameLayout = (a: Inventory, b: Inventory) =>
      a.url === b.url && JSON.stringify(a.elements) === JSON.stringify(b.elements);

    // The test keeps running while we snapshot, so the page can change between
    // the inventory and the screenshot. Re-check after the screenshot and retry.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (this.page.isClosed()) return;
      const before = await inventory();
      if (!before) return;
      // Only screenshot when this state shows elements no screenshot has shown yet.
      if (!this.hasNew(this.shotKeys, before)) return;

      const image = await this.page.screenshot({ fullPage: true, animations: 'disabled' });
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
      const screenshot = this.testInfo.outputPath(`ui-coverage-${this.shotIndex++}.png`);
      await fs.promises.writeFile(screenshot, image);
      this.snapshots.push({ ...after, screenshot });
      return;
    }
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

  async finish() {
    clearTimeout(this.timer);
    this.timer = undefined;
    await this.chain;
    await this.enqueue(); // final state (open modals, etc.)
    await this.testInfo.attach(ATTACHMENT_NAME, {
      body: JSON.stringify({ interactions: this.interactions, snapshots: this.snapshots }),
      contentType: 'application/json',
    });
  }
}
