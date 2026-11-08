/**
 * Suggested Playwright locators (node side, pure). Builds a ready-to-paste
 * line such as `await page.getByRole('button', { name: 'Save' }).click();`
 * from what the tracker recorded for an element.
 *
 * Locator preference: getByTestId → getByRole(role, { name }) → getByLabel →
 * getByPlaceholder → getByTitle → getByText → CSS from the element's key.
 * Elements whose name varied between runs/instances ("(+N variants)") use the
 * key, and repeated elements get `.first()` with a comment.
 */
import type { CoverageSummary, ElementCoverage } from './aggregate';
import { splitHostChain } from './model/selector';

export interface LocatorOptions {
  /** Attribute `page.getByTestId()` reads (Playwright's `use.testIdAttribute`). Default: `data-testid`. */
  testIdAttribute?: string;
}

/** The subset of `ElementCoverage` the suggestion is built from. */
export type LocatorInput = Pick<ElementCoverage, 'key' | 'label' | 'tag' | 'instances'> &
  Partial<Pick<ElementCoverage, 'role' | 'name' | 'nameFrom' | 'attrs' | 'frames'>>;

/** The tracker truncates names to this many characters. */
const MAX_NAME = 60;

/** Roles `getByRole` accepts that make sense for interactive elements. */
const ROLES = new Set([
  'button', 'checkbox', 'combobox', 'gridcell', 'link', 'listbox', 'menuitem', 'menuitemcheckbox',
  'menuitemradio', 'option', 'radio', 'scrollbar', 'searchbox', 'slider', 'spinbutton', 'switch',
  'tab', 'textbox', 'treeitem', 'row', 'cell', 'heading', 'img', 'dialog', 'listitem', 'region',
]);

/** Roles whose accessible name can come from their content (ARIA "name from content"). */
export const NAME_FROM_CONTENT = new Set([
  'button', 'cell', 'checkbox', 'columnheader', 'gridcell', 'heading', 'link', 'menuitem',
  'menuitemcheckbox', 'menuitemradio', 'option', 'radio', 'row', 'rowheader', 'switch', 'tab',
  'tooltip', 'treeitem',
]);

/** Input types Playwright's `fill()` accepts, with a sample value. */
const FILL_VALUES: Record<string, string> = {
  email: 'user@example.com', number: '1', tel: '555-0100', url: 'https://example.com',
  date: '2024-01-01', time: '12:00', 'datetime-local': '2024-01-01T12:00', month: '2024-01',
  week: '2024-W01', color: '#000000', range: '50', password: 'secret',
};

const str = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;

/** Number of label variants, from the "(+N variants)" suffix that `aggregate` adds. */
export const variantCount = (label: string): number => {
  const m = /\(\+(\d+) variants?\)$/.exec(label);
  return m ? Number(m[1]) + 1 : 1;
};

const inputType = (e: LocatorInput) => (e.tag === 'input' ? (e.attrs?.type || 'text').toLowerCase() : '');

/**
 * The role Playwright's `getByRole` would see, or '' when it would differ from
 * ours or is unknown (e.g. `<summary>`, file inputs, number inputs we called textbox).
 */
export function playwrightRole(e: LocatorInput): string {
  const explicit = (e.attrs?.role || '').toLowerCase().split(/\s+/).find((r) => ROLES.has(r));
  if (explicit) return explicit;
  if (e.attrs?.role) return ''; // only unknown tokens (e.g. role="presentation")
  if (e.tag === 'summary') return '';
  const type = inputType(e);
  if (type === 'file') return '';
  if (type === 'number') return 'spinbutton';
  const role = e.role || (e.label || '').split(' ')[0];
  return ROLES.has(role) ? role : '';
}

/** Whether the recorded name is one Playwright's role/label matching would also see. */
export function hasAccessibleName(e: LocatorInput): boolean {
  if (!e.name || !e.nameFrom || e.nameFrom === 'name') return false;
  if (e.nameFrom === 'text') return NAME_FROM_CONTENT.has(e.role || playwrightRole(e));
  return true;
}

/** `key` without the `<frameKey> >> ` prefix (a `data-uicov-id` key has none). */
const withinFrame = (key: string, frameKey: string) =>
  key.startsWith(`${frameKey} >> `) ? key.slice(frameKey.length + 4) : key;

/**
 * A Playwright selector for a key relative to one document (`a >> b` steps
 * into b inside a's shadow root, which Playwright's `>>` chaining does too).
 */
function selectorFromKey(key: string, uicovId?: string): string {
  if (uicovId !== undefined && uicovId.trim() === key) return `[data-uicov-id=${JSON.stringify(key)}]`;
  const parts = splitHostChain(key);
  // A positional key that starts with a plain tag walked up to <body>.
  if (/^[a-z]/i.test(parts[0])) parts[0] = `body > ${parts[0]}`;
  return parts.join(' >> ');
}

/**
 * Selector for the element from its key (the key reads like CSS, except raw
 * `data-uicov-id` values), relative to its frame's document.
 */
export function cssFromKey(e: LocatorInput): string {
  const frames = e.frames ?? [];
  const key = frames.length ? withinFrame(e.key, frames[frames.length - 1]) : e.key;
  return selectorFromKey(key, e.attrs?.['data-uicov-id']);
}

/** `page`, or `page.frameLocator(…)…` for an element inside frames. */
export function frameScope(e: Pick<LocatorInput, 'frames'>): string {
  const frames = e.frames ?? [];
  return frames.reduce(
    (scope, f, i) => `${scope}.frameLocator(${str(selectorFromKey(i ? withinFrame(f, frames[i - 1]) : f))})`,
    'page',
  );
}

function testIdOf(e: LocatorInput, attr: string): string | undefined {
  const v = e.attrs?.[attr];
  if (v && v.trim()) return v;
  if (!e.attrs) {
    // Older data without attrs: read it back from a `[attr="value"]` key.
    const m = /^\[([^=\]]+)=("(?:[^"\\]|\\.)*")\]$/.exec(e.key);
    if (m && m[1].toLowerCase() === attr.toLowerCase()) return JSON.parse(m[2]);
  }
  return undefined;
}

export interface Suggestion {
  /** e.g. `page.getByRole('button', { name: 'Save', exact: true })` */
  locator: string;
  /** e.g. `click()` */
  action: string;
  /** Explanations, e.g. why `.first()` was added. */
  notes: string[];
}

export interface SuggestContext {
  /**
   * Lower-cased accessible names of the elements on the same route (including
   * this one), by Playwright role. Used to make a text name match the whole
   * string when it would also match a longer name ("Save" vs "Save draft").
   */
  namesByRole?: Map<string, string[]>;
}

const regexSource = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

export function suggest(e: LocatorInput, opts: LocatorOptions = {}, ctx: SuggestContext = {}): Suggestion {
  const testIdAttr = (opts.testIdAttribute || 'data-testid').toLowerCase();
  const notes: string[] = [];
  const variants = variantCount(e.label);
  const role = playwrightRole(e);
  const named = hasAccessibleName(e);
  const name = e.name || '';
  // Names are truncated in the page; a truncated name only matches as a substring.
  const truncated = name.length >= MAX_NAME;
  /**
   * Names from attributes match exactly. Text content is matched the way
   * Playwright does by default (case-insensitive substring), because CSS such
   * as `text-transform` changes the text the page reports; if that would also
   * match another element's name, a case-insensitive whole-string regex is used.
   */
  const roleName = () => {
    if (truncated) return str(name);
    if (e.nameFrom !== 'text') return `${str(name)}, exact: true`;
    const lower = name.toLowerCase();
    const others = ctx.namesByRole?.get(role) ?? [];
    const clash = others.filter((n) => n.includes(lower)).length > 1;
    return clash ? `/^${regexSource(name)}$/i` : str(name);
  };
  const textArg = () => (truncated ? str(name) : `${str(name)}, { exact: true }`);
  let locator: string;
  const testId = testIdOf(e, testIdAttr);
  if (testId !== undefined) locator = `page.getByTestId(${str(testId)})`;
  else if (variants > 1) {
    // The name changes between runs or instances (counters, timestamps, row
    // data); the key doesn't, so a name-based locator would likely break.
    locator = `page.locator(${str(cssFromKey(e))})`;
    notes.push("accessible name varies between runs or instances, so this uses the element's key");
  } else if (role && named && (ctx.namesByRole?.get(role) ?? []).filter((n) => n === name.toLowerCase()).length > 1) {
    locator = `page.locator(${str(cssFromKey(e))})`;
    notes.push(`another ${role} on this page has the same name, so this uses the element's key`);
  } else if (role && named && e.nameFrom !== 'placeholder' && e.nameFrom !== 'title')
    locator = `page.getByRole(${str(role)}, { name: ${roleName()} })`;
  else if (named && ['aria-label', 'aria-labelledby', 'label'].includes(e.nameFrom!))
    locator = `page.getByLabel(${textArg()})`;
  else if (named && e.nameFrom === 'placeholder') locator = `page.getByPlaceholder(${textArg()})`;
  else if (named && e.nameFrom === 'title') locator = `page.getByTitle(${textArg()})`;
  else if (named && e.nameFrom === 'text') locator = `page.getByText(${textArg()})`;
  else locator = `page.locator(${str(cssFromKey(e))})`;

  // Inside frames: the same locator, from the frame (getBy* and CSS already pierce open shadow roots).
  if (e.frames?.length) locator = frameScope(e) + locator.slice('page'.length);

  if (e.instances > 1) {
    locator += '.first()';
    notes.push(`${e.instances} matching elements on the page: narrow with .filter({ hasText: … }) or .nth(i)`);
  }

  return { locator, action: actionFor(e, role), notes };
}

function actionFor(e: LocatorInput, role: string): string {
  const type = inputType(e);
  if (type === 'file') return "setInputFiles('path/to/file')";
  if (e.tag === 'select') return "selectOption('…')";
  if (type === 'range') return "fill('50')";
  if (type && FILL_VALUES[type]) return `fill(${str(FILL_VALUES[type])})`;
  switch (role || e.role) {
    case 'checkbox':
    case 'radio':
    case 'switch':
    case 'menuitemcheckbox':
    case 'menuitemradio':
      return 'check()';
    case 'textbox':
    case 'searchbox':
      return "fill('…')";
    case 'spinbutton':
      return "fill('1')";
    case 'slider':
      return "press('ArrowRight')";
    case 'listbox':
      return "selectOption('…')";
  }
  if (e.tag === 'textarea' || (e.tag === 'input' && !['button', 'submit', 'reset', 'image'].includes(type)))
    return "fill('…')";
  return 'click()';
}

/** One line of test code, with notes as a trailing comment. */
export function suggestedLocator(e: LocatorInput, opts?: LocatorOptions, ctx?: SuggestContext): string {
  const s = suggest(e, opts, ctx);
  return `await ${s.locator}.${s.action};` + (s.notes.length ? ` // ${s.notes.join('; ')}` : '');
}

/**
 * A test that visits `route` and interacts with each of its untested elements,
 * with TODO comments for assertions. The report's "Copy test skeleton" button
 * runs this same function (it is serialized into the page, so it must stay
 * self-contained: no references outside its body).
 */
export function testSkeleton(route: string, lines: string[]): string {
  const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
  const target = /\/:[^/]/.test(route) ? `${q(route)} /* TODO: replace :params with real values */` : q(route);
  return [
    `test(${q(`covers untested elements on ${route}`)}, async ({ page }) => {`,
    `  await page.goto(${target});`,
    '  // TODO: a line that navigates away (link, submit) ends this page state: split into more tests or goto() again.',
    ...lines.flatMap((l) => [`  ${l}`, '  // TODO: assert the result']),
    '});',
    '',
  ].join('\n');
}

/** Sets `suggestedLocator` on every element of `summary` (in place). */
export function addSuggestedLocators(summary: CoverageSummary, opts?: LocatorOptions): void {
  for (const r of summary.routes) {
    // Locators search one frame, so names clash only within the same frame.
    const byFrame = new Map<string, Map<string, string[]>>();
    const namesIn = (e: ElementCoverage) => {
      const f = (e.frames ?? []).join('\n');
      if (!byFrame.has(f)) byFrame.set(f, new Map());
      return byFrame.get(f)!;
    };
    for (const e of r.elements) {
      const role = playwrightRole(e);
      if (!role || !hasAccessibleName(e)) continue;
      const namesByRole = namesIn(e);
      if (!namesByRole.has(role)) namesByRole.set(role, []);
      namesByRole.get(role)!.push(e.name!.toLowerCase());
    }
    for (const e of r.elements) e.suggestedLocator = suggestedLocator(e, opts, { namesByRole: namesIn(e) });
  }
}
