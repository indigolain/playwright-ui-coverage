/** An interactive element found on the page during an inventory pass. */
export interface InventoryElement {
  /** Stable identity used to match interactions to elements across tests. */
  key: string;
  /** Human-readable label (role + accessible name). */
  label: string;
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
}

/** Payload attached to each test result (attachment name: "ui-coverage"). */
export interface TestCoverageData {
  interactions: Interaction[];
  snapshots: Snapshot[];
}

export const ATTACHMENT_NAME = 'ui-coverage';
/** Screenshot attachments are named `${SCREENSHOT_ATTACHMENT_PREFIX}${n}`. */
export const SCREENSHOT_ATTACHMENT_PREFIX = 'ui-coverage-screenshot-';
