/**
 * Raw recording format: what the in-page tracker collects. No identity or
 * filtering is applied; those run in Node (`model/resolve.ts`) when the
 * report is built. Interactivity is recorded as a per-element fact (it needs
 * the live DOM to decide).
 */
import type { ReportConfig } from '../coverage-report';
import type { HtmlReportLink } from '../insights';
import type { UiCoverageRules } from './rules';

/**
 * Version of the `ui-coverage` test attachment payload (`RawCoverageData`).
 * Payloads without `formatVersion` are the pre-0.2 format, where keys and
 * labels were computed in the browser (`TestCoverageData` in `types.ts`).
 * 3 added frame and shadow root boundaries to the node table (`RawNode.tag`);
 * version 2 payloads are read as they are (they have none). 4 added `steps`,
 * `states` and the `t` / `hash` of snapshots; versions 2 and 3 are read as
 * they are (no steps, snapshots in recording order).
 */
export const RECORDING_FORMAT_VERSION = 4;
/** Recording format versions this version reads. */
export const READABLE_RECORDING_FORMAT_VERSIONS: readonly number[] = [2, 3, 4];

/**
 * One DOM element: a recorded candidate or one of its ancestors. Nodes are
 * stored once per test attempt in `RawCoverageData.nodes` and point to their
 * parent, so ancestor chains shared by many elements are stored once.
 *
 * Tree boundaries are pseudo-nodes: an element at the top of an open shadow
 * root has a `#shadow-root` node as parent, whose parent is the shadow host;
 * a frame's `<html>` has a `#document` node as parent, whose parent is the
 * `<iframe>` (or `<frame>`) element in the embedding document.
 */
export interface RawNode {
  /** Lowercase tag name, or `#shadow-root` / `#document` for a tree boundary. */
  tag: string;
  /** Index into `nodes` of the parent node. Absent for the top document's `<html>` (or a detached root). */
  parent?: number;
  /** 1-based position among same-tag siblings (`:nth-of-type`). Absent when `of` is absent. */
  nth?: number;
  /** Number of same-tag siblings including this one. Absent when 1. */
  of?: number;
  /**
   * Attributes, in DOM order. Values are capped (`class` at 1024 characters,
   * others at 256); `style` is left out and event handler attributes (`on*`)
   * are kept with an empty value so selectors like `[onclick]` still match.
   */
  attrs?: Record<string, string>;
}

/** A candidate element's state at one moment (an inventory entry or an interaction target). */
export interface RawElementRef {
  /** Index into `nodes`. */
  node: number;
  /** Accessible name (aria-labelledby, aria-label, label, placeholder, title, alt, text…), capped at 60 chars. */
  name?: string;
  /**
   * Where `name` came from: `aria-labelledby`, `aria-label`, `label`,
   * `placeholder`, `title`, `alt`, `value`, `text` or `name` (the name attribute).
   */
  nameFrom?: string;
  /** Resolved destination of `<a href>` / `<area href>`, only when it differs from `new URL(href, snapshot url)` (a `<base>` element). */
  href?: string;
}

/** A visible recorded element in an inventory, with its box in document CSS pixels. */
export interface RawElement extends RawElementRef {
  /**
   * Recorded as a candidate only (`RECORDED_CANDIDATES`): not interactive by
   * the in-browser rules (docs "Which elements count"), which include markup
   * directives and the recording-time `ignoreSelectors`. Absent: interactive.
   */
  candidateOnly?: true;
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Effective positioning: `fixed` when the element or an ancestor is
   * `position: fixed` (modal dialogs and popovers in the top layer too),
   * `sticky` when the nearest such ancestor is `position: sticky`. Absent:
   * scrolls with the document. The box is where the element was on screen
   * (viewport box + scroll offset), which is also where full-page screenshots
   * paint it, as long as the page doesn't scroll in between.
   */
  pos?: 'fixed' | 'sticky';
}

/** The visible part of the document when an inventory was taken, in document CSS pixels. */
export interface RawViewport {
  /** Scroll offset (`scrollX`/`scrollY`, rounded). */
  x: number;
  y: number;
  /** Layout viewport size without scrollbars (`documentElement.clientWidth/clientHeight`). */
  w: number;
  h: number;
  /** `visualViewport.scale` when it isn't 1 (pinch zoom, or a mobile page without a viewport meta tag). */
  zoom?: number;
}

/** Region of the document a screenshot shows, in document CSS pixels. */
export interface RawClip {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RawSnapshot {
  url: string;
  dpr: number;
  /**
   * Screenshot reference: an attachment name (`ui-coverage-screenshot-<n>`)
   * in the test attachment, a path relative to the data folder in
   * `ui-coverage-report/data/`, or an absolute path once resolved.
   */
  screenshot?: string;
  /** Height in CSS px of the screenshot when it was cropped (`maxScreenshotHeight`). */
  screenshotHeight?: number;
  /**
   * The document region the screenshot shows, when it isn't the full page
   * from the top-left corner: a viewport screenshot of a short-lived state
   * (`captureTransientStates`). Element boxes stay in document coordinates.
   */
  screenshotClip?: RawClip;
  /** Scroll offset and viewport size when the inventory was taken. */
  viewport?: RawViewport;
  /** Visible recorded elements, in document order. */
  elements: RawElement[];
  /** When the inventory (or screenshot) was taken, ms since the epoch. */
  t?: number;
  /** SHA-1 of the screenshot file, to recognize the same state across tests. */
  hash?: string;
}

/**
 * The Playwright call a step was made by, when known (`RawStep.call`): taken
 * from Playwright's client instrumentation while the call was in progress.
 */
export interface RawCall {
  /** Playwright API name: `locator.click`, `page.goto`, `keyboard.press`, … */
  api: string;
  /** The locator, in Playwright syntax: `getByRole('button', { name: 'Save' })`. */
  locator?: string;
  /** A short argument that is safe to show: the key of `press`, the URL of `goto`. Never typed text. */
  arg?: string;
  /** Where the call is in the test code: relative to the project's testDir, `/` separators. */
  file?: string;
  line?: number;
  column?: number;
}

/**
 * One step of a test (recording option `steps`): an interaction the tracker
 * counted (the same events as `interactions`), or a page load.
 */
export interface RawStep {
  /** ms since the epoch, when the recorder received it. */
  t: number;
  /** DOM event type of the interaction (`click`, `input`, …), or `load`. */
  event: string;
  url: string;
  /** The page of the context it happened in: 0 for the first page, in creation order. */
  page?: number;
  /** The element acted on (absent for `load`, or for a frame that was gone). */
  element?: RawElementRef;
  call?: RawCall;
  /** Index into `states`: the page right after this step. Absent when no screenshot was taken. */
  state?: number;
}

export interface RawInteraction {
  /** DOM event type (`click`, `input`, `keydown`, …). */
  event: string;
  url: string;
  /**
   * The element the event was credited to in the browser (e.g. a label's
   * control, a form's submitter). It resolves to the same key as that
   * element's inventory entry, since both point into the same node table.
   */
  element: RawElementRef;
}

/** Payload of the `ui-coverage` attachment (one per browser context per test attempt). */
export interface RawCoverageData {
  /** `RECORDING_FORMAT_VERSION` when written; older readable versions are accepted. */
  formatVersion: number;
  nodes: RawNode[];
  /**
   * Identity rules set in `use.uiCoverage` (deprecated there) when recording;
   * merged with the report-time rules, which win. (`use.uiCoverage.ignoreSelectors`
   * is applied while recording, through `RawElement.candidateOnly`.)
   */
  rules?: UiCoverageRules;
  snapshots: RawSnapshot[];
  interactions: RawInteraction[];
  /** Steps in the order they happened (version 4, recording option `steps`). */
  steps?: RawStep[];
  /**
   * Viewport screenshots of the page after steps (`RawStep.state`), with the
   * elements in view. Not used for coverage: they only feed the state stepper
   * and the per-test walkthrough. Identical consecutive states are stored once.
   */
  states?: RawSnapshot[];
  /** True when the test ran under Playwright component testing. */
  componentTest?: boolean;
}

/**
 * Result of the in-page `__uicovInventory()` (node indices are local to it).
 * Boxes are in the coordinates of the frame's own document; the recorder maps
 * child frames' boxes into the page's.
 */
export interface RawInventory {
  url: string;
  dpr: number;
  viewport?: RawViewport;
  nodes: RawNode[];
  elements: RawElement[];
  /** The document's scroll offset (`scrollX`/`scrollY`), to map a frame's boxes into the page. */
  scrollX?: number;
  scrollY?: number;
  /** The viewport size (`innerWidth`/`innerHeight`). */
  viewportWidth?: number;
  viewportHeight?: number;
}

/**
 * Result of the in-page `__uicovFrameHost(el)` for an `<iframe>` element:
 * its node chain and the box of its content area (where the frame's viewport
 * is), in the coordinates of the document it is in.
 */
export interface RawFrameHost {
  nodes: RawNode[];
  /** Index into `nodes` of the frame element. */
  node: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The embedding document's scroll offset. */
  scrollX: number;
  scrollY: number;
}

/** First argument of the `__uicovRecord` binding (node indices are local to it). */
export interface RawInteractionEvent {
  event: string;
  url: string;
  nodes: RawNode[];
  element: RawElementRef;
  /** When it happened in the page, ms since the epoch (to find the Playwright call that caused it). */
  t?: number;
}

/** Version of `ui-coverage-report/data/ui-coverage-data.json`. */
export const DATA_FORMAT_VERSION = 1;
export const DATA_FILE = 'ui-coverage-data.json';

/** One test attempt as stored in the data folder. */
export interface StoredAttempt {
  /** `TestCase.id`: the same across retries of one test. */
  testId: string;
  /** `TestResult.retry`: 0 for the first attempt. */
  retry: number;
  /** Whether this attempt had the expected outcome. */
  passed: boolean;
  /** Test title path without the project and file (`describe › test`). */
  title: string;
  /** Project name. */
  project?: string;
  /** Trace file name in Playwright's HTML report attachments folder, when the report links to it. */
  trace?: string;
  tags?: string[];
  /** Spec file relative to the project's testDir (`/` separators), for `viewBy: 'file'`. */
  specFile?: string;
  /** The `ui-coverage` attachment: `RawCoverageData`, or the pre-0.2 `TestCoverageData`. */
  data: unknown;
}

/** `ui-coverage-report/data/ui-coverage-data.json`. */
export interface StoredData {
  formatVersion: typeof DATA_FORMAT_VERSION;
  generatedAt: string;
  /** The run's config was a Playwright component testing config (for `viewBy: 'auto'`). */
  componentTestConfig?: boolean;
  /** Playwright's HTML report, `path` relative to the report folder (the data folder's parent). */
  htmlReport?: HtmlReportLink;
  /** `use.testIdAttribute` from the run's config, for suggested locators. */
  testIdAttribute?: string;
  /** The UI coverage config the reporter used (also in `coverage.json`). */
  config?: ConfigTrace;
  attempts: StoredAttempt[];
}

/** Where the config of a report came from (same as `config` in `coverage.json`). */
export type ConfigTrace = ReportConfig;
