/**
 * Resolved coverage data: raw recordings (`model/raw.ts`) after identity,
 * interactivity and filtering rules were applied (`model/resolve.ts`). This is
 * also the `ui-coverage` attachment format before 0.2 (no `formatVersion`).
 */

/** An interactive element found on the page during an inventory pass. */
export interface InventoryElement {
  /**
   * Stable identity used to match interactions to elements across tests,
   * from attributes (`[data-testid="x"]`, `#id`, `[name="email"]`) or the
   * element's position (`main > form > button`). Never from visible text.
   * Inside a frame or shadow root, prefixed by the host's key and ` >> `
   * (`iframe[data-testid="pay"] >> #card`, `my-widget >> button`).
   */
  key: string;
  /** Human-readable label (role + accessible name). Display only. */
  label: string;
  /** Raw identifying attributes. Only in pre-0.2 recordings. */
  attrs?: Record<string, string>;
  /** Role as computed in the page (the first word of `label`). */
  role?: string;
  /** Accessible name as computed in the page ('' if none). */
  name?: string;
  /**
   * Where `name` came from: `aria-labelledby`, `aria-label`, `label`,
   * `placeholder`, `title`, `alt`, `value`, `text` or `name` (the name
   * attribute, which is not an accessible name). '' if there is no name.
   */
  nameFrom?: string;
  /**
   * Keys of the `<iframe>` elements the element is inside, outermost first
   * (each is a prefix of `key`). Absent in the top document.
   */
  frames?: string[];
  /**
   * For `<a href>` / `<area href>`: the destination as the browser resolved it,
   * set only when a `<base>` element made it differ from the `href` attribute
   * resolved against the page URL. Absent otherwise (read `attrs.href`).
   */
  href?: string;
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
  role?: string;
  name?: string;
  nameFrom?: string;
  frames?: string[];
  /** Same as `InventoryElement.href`. */
  href?: string;
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

/** Resolved data of one recording (one browser context in one test attempt). */
export interface TestCoverageData {
  interactions: Interaction[];
  snapshots: Snapshot[];
  /** True when the test ran under Playwright component testing (`@playwright/experimental-ct-*`). */
  componentTest?: boolean;
  /**
   * View name for all of this test's data, overriding the URL. Not recorded:
   * the reporter sets it (to the spec file) when grouping views by file.
   */
  view?: string;
}

export const ATTACHMENT_NAME = 'ui-coverage';
/** Screenshot attachments are named `${SCREENSHOT_ATTACHMENT_PREFIX}${n}`. */
export const SCREENSHOT_ATTACHMENT_PREFIX = 'ui-coverage-screenshot-';
