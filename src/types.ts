/** An interactive element found on the page during an inventory pass. */
export interface InventoryElement {
  /**
   * Stable identity used to match interactions to elements across tests,
   * from attributes (`[data-testid="x"]`, `#id`, `[name="email"]`) or the
   * element's position (`main > form > button`). Never from visible text.
   */
  key: string;
  /** Human-readable label (role + accessible name). Display only. */
  label: string;
  /** Raw identifying attributes (`id`, `name`, `data-*`, …), to recompute identity later. */
  attrs?: Record<string, string>;
  tag: string;
  /** Document coordinates in CSS pixels (match a fullPage screenshot). */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Inventory {
  url: string;
  dpr: number;
  elements: InventoryElement[];
}

/** A user-like interaction captured in the page. */
export interface Interaction {
  key: string;
  label: string;
  /** Same as `InventoryElement.attrs`. */
  attrs?: Record<string, string>;
  event: string;
  url: string;
}

export interface Snapshot extends Inventory {
  /**
   * Name of the test attachment that holds the fullPage screenshot for this
   * state (e.g. "ui-coverage-screenshot-0"). The reporter resolves it to a
   * local file via `result.attachments`, which also works after
   * `merge-reports`. Absent for inventories captured at interaction time
   * (page may be navigating).
   */
  screenshot?: string;
  /**
   * Height in CSS px of the screenshot when it was cropped (`maxScreenshotHeight`).
   * Elements below it are counted but not visible in the image.
   */
  screenshotHeight?: number;
}

/** Payload attached to each test result (attachment name: "ui-coverage"). */
export interface TestCoverageData {
  interactions: Interaction[];
  snapshots: Snapshot[];
}

export const ATTACHMENT_NAME = 'ui-coverage';
/** Screenshot attachments are named `${SCREENSHOT_ATTACHMENT_PREFIX}${n}`. */
export const SCREENSHOT_ATTACHMENT_PREFIX = 'ui-coverage-screenshot-';
