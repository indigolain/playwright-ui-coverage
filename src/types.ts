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
   * Absolute path to the fullPage screenshot for this state. Absent for
   * inventories captured at interaction time (page may be navigating).
   */
  screenshot?: string;
}

/** Payload attached to each test result (attachment name: "ui-coverage"). */
export interface TestCoverageData {
  interactions: Interaction[];
  snapshots: Snapshot[];
}

export const ATTACHMENT_NAME = 'ui-coverage';
