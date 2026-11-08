// More cases for both modules run in scripts/check-locators.mjs (against dist/);
// these cover the main paths and the in-place summary helpers.
import { describe, expect, it } from 'vitest';
import { addA11yHints, duplicateNameHints, elementHints, type A11yInput } from '../src/a11y';
import type { CoverageSummary, ElementCoverage } from '../src/aggregate';
import {
  addSuggestedLocators,
  cssFromKey,
  playwrightRole,
  suggestedLocator,
  testSkeleton,
  variantCount,
  type LocatorInput,
} from '../src/locators';

const el = (o: Partial<LocatorInput>): LocatorInput => ({ key: '#x', label: 'button', tag: 'button', instances: 1, attrs: {}, ...o });

describe('suggestedLocator', () => {
  it('prefers the test id', () => {
    expect(suggestedLocator(el({ attrs: { 'data-testid': 'save' }, role: 'button', name: 'Save', nameFrom: 'text' }))).toBe(
      "await page.getByTestId('save').click();",
    );
    expect(
      suggestedLocator(el({ attrs: { 'data-testid': 'a', 'data-qa': 'b' }, role: 'button', name: 'Save', nameFrom: 'text' }), {
        testIdAttribute: 'data-qa',
      }),
    ).toBe("await page.getByTestId('b').click();");
  });

  it('groups: scoped test ids for form-split keys, no per-member test id, wrapper markup groups', () => {
    const named = { role: 'button', name: 'Submit', nameFrom: 'text' };
    expect(suggestedLocator(el({ key: '#signup [data-testid="submit"]', attrs: { 'data-testid': 'submit' }, ...named }))).toBe(
      "await page.locator('#signup').getByTestId('submit').click();",
    );
    expect(
      suggestedLocator(
        el({
          key: 'main > ul > li > button',
          instances: 3,
          attrs: { 'data-testid': 'add-1' },
          group: { reason: 'repeated', members: 3 },
          role: 'button',
          name: 'Add',
          nameFrom: 'text',
        }),
      ),
    ).toMatch(/^await page\.getByRole\('button', \{ name: 'Add' \}\)\.first\(\)\.click\(\);/);
    const markup = { key: '[data-uicov-group="stars"]', group: { name: 'stars', reason: 'markup' as const, members: 5 } };
    expect(cssFromKey(el({ ...markup, attrs: {} }))).toBe('[data-uicov-group="stars"] button');
    expect(cssFromKey(el({ ...markup, attrs: { 'data-uicov-group': 'stars' } }))).toBe('[data-uicov-group="stars"]');
  });

  it('reads the test id back from the key for data without attrs', () => {
    expect(suggestedLocator({ key: '[data-testid="go"]', label: 'link "Go"', tag: 'a', instances: 1 })).toBe(
      "await page.getByTestId('go').click();",
    );
  });

  it('uses getByRole with the name: exact for attribute names, substring for text', () => {
    expect(suggestedLocator(el({ role: 'button', name: 'Save', nameFrom: 'text' }))).toBe(
      "await page.getByRole('button', { name: 'Save' }).click();",
    );
    expect(suggestedLocator(el({ tag: 'textarea', role: 'textbox', name: 'Bio', nameFrom: 'label' }))).toBe(
      "await page.getByRole('textbox', { name: 'Bio', exact: true }).fill('…');",
    );
  });

  it('escapes quotes and backslashes', () => {
    expect(suggestedLocator(el({ role: 'button', name: "Don't \\ save", nameFrom: 'text' }))).toBe(
      "await page.getByRole('button', { name: 'Don\\'t \\\\ save' }).click();",
    );
  });

  it('uses a whole-string regex when the name is part of another name', () => {
    const ctx = { namesByRole: new Map([['button', ['save', 'save draft']]]) };
    expect(suggestedLocator(el({ role: 'button', name: 'Save', nameFrom: 'text' }), {}, ctx)).toBe(
      "await page.getByRole('button', { name: /^Save$/i }).click();",
    );
  });

  it('falls back to the key for varying, duplicate or missing names', () => {
    expect(suggestedLocator(el({ key: 'main > div > button', role: 'button', name: '', nameFrom: '' }))).toBe(
      "await page.locator('body > main > div > button').click();",
    );
    expect(suggestedLocator(el({ key: '#like', label: 'button "Like (3)" (+2 variants)', role: 'button', name: 'Like (3)', nameFrom: 'text' }))).toMatch(
      /^await page\.locator\('#like'\)\.click\(\); \/\/ accessible name varies/,
    );
    const ctx = { namesByRole: new Map([['link', ['details', 'details']]]) };
    expect(suggestedLocator(el({ key: '#d', tag: 'a', role: 'link', name: 'Details', nameFrom: 'text' }), {}, ctx)).toMatch(
      /^await page\.locator\('#d'\)\.click\(\); \/\/ another link on this page has the same name/,
    );
  });

  it('adds .first() for repeated elements', () => {
    expect(suggestedLocator(el({ instances: 3, role: 'button', name: 'Delete', nameFrom: 'text' }))).toMatch(
      /\.first\(\)\.click\(\); \/\/ 3 matching elements/,
    );
  });

  it('picks the action from the element type', () => {
    const action = (o: Partial<LocatorInput>) => suggestedLocator(el(o)).replace(/^.*\)\.(\w+\(.*\));.*$/, '$1');
    expect(action({ tag: 'input', attrs: { type: 'email' }, role: 'textbox', name: 'E', nameFrom: 'label' })).toBe("fill('user@example.com')");
    expect(action({ tag: 'input', attrs: { type: 'checkbox' }, role: 'checkbox', name: 'C', nameFrom: 'label' })).toBe('check()');
    expect(action({ tag: 'select', role: 'combobox', name: 'S', nameFrom: 'label' })).toBe("selectOption('…')");
    expect(action({ tag: 'input', attrs: { type: 'file' }, role: 'textbox', name: 'F', nameFrom: 'label' })).toBe("setInputFiles('path/to/file')");
    expect(action({ tag: 'input', attrs: { type: 'range' }, role: 'slider', name: 'R', nameFrom: 'label' })).toBe("fill('50')");
  });
});

describe('locator helpers', () => {
  it('playwrightRole maps to the role getByRole sees', () => {
    expect(playwrightRole(el({ tag: 'input', attrs: { type: 'number' }, role: 'textbox' }))).toBe('spinbutton');
    expect(playwrightRole(el({ attrs: { role: 'switch' }, role: 'switch' }))).toBe('switch');
    expect(playwrightRole(el({ attrs: { role: 'presentation' } }))).toBe('');
    expect(playwrightRole(el({ tag: 'summary', role: 'button' }))).toBe('');
  });

  it('variantCount reads the "(+N variants)" suffix', () => {
    expect(variantCount('link "Ada" (+2 variants)')).toBe(3);
    expect(variantCount('link "Ada"')).toBe(1);
  });

  it('cssFromKey anchors positional keys and quotes data-uicov-id values', () => {
    expect(cssFromKey(el({ key: 'main > a' }))).toBe('body > main > a');
    expect(cssFromKey(el({ key: '#save' }))).toBe('#save');
    expect(cssFromKey(el({ key: 'like', attrs: { 'data-uicov-id': 'like' } }))).toBe('[data-uicov-id="like"]');
  });

  it('testSkeleton is self-contained and marks route params', () => {
    const out = testSkeleton('/users/:id', ["await page.getByRole('button', { name: 'Edit' }).click();"]);
    expect(out).toContain("await page.goto('/users/:id' /* TODO");
    expect(out).toMatch(/click\(\);\n  \/\/ TODO: assert the result\n\}\);\n$/);
    expect(new Function(`return (${testSkeleton.toString()})`)()('/', [])).toBe(testSkeleton('/', []));
  });
});

const a11y = (o: Partial<A11yInput>): A11yInput => ({ key: '#x', label: 'button', tag: 'button', instances: 1, attrs: {}, ...o });
const rules = (o: Partial<A11yInput>) => elementHints(a11y(o)).map((h) => h.rule);

describe('elementHints', () => {
  it('flags missing names and placeholder-only names', () => {
    expect(rules({ role: 'button', name: '', nameFrom: '' })).toEqual(['no-name']);
    expect(rules({ tag: 'input', role: 'textbox', name: 'q', nameFrom: 'name' })).toEqual(['no-name']);
    expect(rules({ tag: 'input', role: 'textbox', name: 'Search', nameFrom: 'placeholder' })).toEqual(['placeholder-only']);
    expect(rules({ role: 'button', name: 'Save', nameFrom: 'text' })).toEqual([]);
  });

  it('flags roles without focus and focusable elements without a role', () => {
    expect(rules({ tag: 'span', attrs: { role: 'button' }, role: 'button', name: 'Share', nameFrom: 'text' })).toEqual(['not-focusable']);
    expect(rules({ tag: 'span', attrs: { role: 'button', tabindex: '0' }, role: 'button', name: 'Share', nameFrom: 'text' })).toEqual([]);
    expect(rules({ tag: 'div', attrs: { tabindex: '0' }, role: 'div', name: 'Card', nameFrom: 'text' })).toEqual(['no-role']);
    expect(rules({ tag: 'div', attrs: {}, role: 'div', name: 'Log', nameFrom: 'text' })).toEqual([]);
  });

  it('says nothing for data recorded before nameFrom existed', () => {
    expect(rules({ role: 'button', name: '' })).toEqual([]);
  });
});

describe('duplicateNameHints', () => {
  it('flags links with the same name and different targets', () => {
    const link = (key: string, href: string, name: string) => a11y({ key, tag: 'a', role: 'link', name, nameFrom: 'text', attrs: { href } });
    const links = [link('#a', '/a', 'Read more'), link('#b', '/b', 'read more'), link('#c', '/a', 'Home'), link('#d', '/a', 'Home')];
    const dupes = duplicateNameHints(links);
    expect([...dupes.keys()].map((e) => e.key)).toEqual(['#a', '#b']);
    expect(dupes.get(links[0])![0].message).toMatch(/^1 other link named "Read more" goes somewhere else/);
  });
});

describe('summary helpers', () => {
  const element = (o: Partial<ElementCoverage>): ElementCoverage =>
    ({ key: '#x', label: 'button', tag: 'button', instances: 1, tested: false, testedBy: [], testedByFailing: [], interactionCounts: {}, attrs: {}, ...o }) as ElementCoverage;
  const summary = () =>
    ({
      routes: [
        {
          route: '/',
          elements: [
            element({ key: '#save', role: 'button', name: 'Save', nameFrom: 'text' }),
            element({ key: '#draft', role: 'button', name: 'Save draft', nameFrom: 'text' }),
            element({ key: '#icon', role: 'button', name: '', nameFrom: '' }),
          ],
        },
        { route: '/b', elements: [element({ key: '#ok', role: 'button', name: 'OK', nameFrom: 'text' })] },
      ],
    }) as unknown as CoverageSummary;

  it('addSuggestedLocators compares names within a route', () => {
    const s = summary();
    addSuggestedLocators(s);
    expect(s.routes[0].elements.map((e) => e.suggestedLocator)).toEqual([
      "await page.getByRole('button', { name: /^Save$/i }).click();",
      "await page.getByRole('button', { name: 'Save draft' }).click();",
      "await page.locator('#icon').click();",
    ]);
  });

  it('addA11yHints sets hints and counts per route and overall', () => {
    const s = summary();
    addA11yHints(s);
    expect(s.routes.map((r) => r.a11yHints)).toEqual([1, 0]);
    expect(s.a11yHints).toBe(1);
    expect(s.routes[0].elements[2].a11yHints?.map((h) => h.rule)).toEqual(['no-name']);
    expect('a11yHints' in s.routes[0].elements[0]).toBe(false);
  });
});
