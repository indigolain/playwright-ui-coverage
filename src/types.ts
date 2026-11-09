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
  /** Grouping facts from the recorded structure (internal, see `grouping.ts`). */
  grouping?: GroupHints;
  /**
   * Set when an `elements` rule named the element (and so replaced `key`):
   * the key the identity rules give it. Suggested locators use it.
   */
  autoKey?: string;
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
  /** `position: fixed` / `sticky` (itself or an ancestor): drawn where it was on screen. See `RawElement.pos`. */
  pos?: 'fixed' | 'sticky';
}

/** Why elements were merged into one (`group.reason` in coverage.json). */
export type GroupReason = 'markup' | 'config' | 'same-key' | 'row' | 'repeated' | 'label';

/** One level of an element's ancestor chain, for building a repeated group's key. */
export interface GroupLevel {
  /** `tag` or `tag:nth-of-type(n)`. */
  step: string;
  /** Tag only, for when members differ in position. */
  tag: string;
  /** The level's attribute identity (`[data-testid="x"]`, `#id`), if any. */
  anchor?: string;
  /** Combinator before this level: ` > ` or ` >> ` (into a shadow root or frame). */
  sep: string;
}

/**
 * What the report-time rules found out about an element's grouping, from the
 * recorded structure (`model/resolve.ts`). Applied per view by `grouping.ts`,
 * which needs every element of the view (most heuristics need 2 members).
 */
export interface GroupHints {
  /** Opted out (`data-uicov-group=""`, an `elementGroups` entry with `exclude`). */
  none?: true;
  /** Explicit group (markup or `elementGroups`): applies as-is. */
  explicit?: { key: string; name: string; reason: 'markup' | 'config' };
  /** Key of the nearest `<form>` / `role=form` ancestor. */
  form?: string;
  /** Group key for the element's column/position in a table or grid. */
  row?: string;
  /** Signature of the element's shape (tags, classes, role, name) and its ancestor chain. */
  repeated?: { sig: string; levels: GroupLevel[] };
  /** For a counted `<label>`: the key of its control. */
  label?: string;
  /** Set by `grouping.ts` on a label merged into its control: not counted as an instance. */
  joined?: true;
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
  /** Same as `InventoryElement.autoKey`. */
  autoKey?: string;
  grouping?: GroupHints;
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
  /**
   * Document region the screenshot shows when it's a viewport screenshot of a
   * short-lived state (`captureTransientStates`); boxes stay in document coordinates.
   */
  screenshotClip?: { x: number; y: number; width: number; height: number };
  /** When it was taken, ms since the epoch (recording format 4). */
  t?: number;
  /** SHA-1 of the screenshot file: the same state reached by several tests. */
  hash?: string;
}

/** The element a step acted on, resolved like an interaction's. */
export type StepTarget = Pick<Interaction, 'key' | 'label' | 'grouping' | 'frames'>;

/** One step of a test (recording option `steps`): an interaction, or a page load. */
export interface Step {
  /** ms since the epoch. */
  t: number;
  /** DOM event type, or `load`. */
  event: string;
  url: string;
  /** The page of the browser context: 0 for the first, in creation order. */
  page?: number;
  /** The element acted on; absent for loads, and for elements the report-time rules exclude. */
  target?: StepTarget;
  /** The element's accessible name when it has no target (excluded by the rules). */
  name?: string;
  /** The Playwright call, when known (see `RawCall`). */
  call?: import('./model/raw').RawCall;
  /** Index into `TestCoverageData.states`: the page after this step. */
  state?: number;
}

/** Resolved data of one recording (one browser context in one test attempt). */
export interface TestCoverageData {
  interactions: Interaction[];
  snapshots: Snapshot[];
  /** Steps in the order they happened (recording option `steps`). */
  steps?: Step[];
  /** Screenshots of the page after steps (`Step.state`). Not counted for coverage. */
  states?: Snapshot[];
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
