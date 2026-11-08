/**
 * A small CSS selector engine that runs in Node on recorded DOM structure
 * (an element, its attributes, its same-tag sibling position and its
 * ancestors). It lets selector-based rules change at report time without
 * re-running tests.
 *
 * Supported:
 *   - type `button`, universal `*`, `#id`, `.class`
 *   - attributes `[a]`, `[a=v]`, `[a~=v]`, `[a|=v]`, `[a^=v]`, `[a$=v]`, `[a*=v]`, with ` i` / ` s` flags
 *   - descendant (` `) and child (`>`) combinators, selector lists (`,`)
 *   - `:not()`, `:is()`, `:where()` (with selector lists),
 *     `:nth-of-type()`, `:nth-last-of-type()`, `:first-of-type`, `:last-of-type`, `:only-of-type`, `:root`
 *
 * Not supported (throws `SelectorError`): sibling combinators (`+`, `~`),
 * `:has()`, `:nth-child()` and friends, state pseudo-classes (`:checked`,
 * `:hover`, `:disabled`…), pseudo-elements. Those need parts of the DOM or
 * live state that aren't recorded.
 */

/** What the engine needs to know about an element. */
export interface SelectorNode {
  tag: string;
  attrs: Record<string, string>;
  /** 1-based position among same-tag siblings. */
  nth: number;
  /** Number of same-tag siblings including this one. */
  of: number;
  parent?: SelectorNode;
}

export class SelectorError extends Error {}

type AttrOp = '' | '=' | '~=' | '|=' | '^=' | '$=' | '*=';
type Simple =
  | { kind: 'tag'; tag: string }
  | { kind: 'attr'; name: string; op: AttrOp; value: string; ci?: boolean }
  | { kind: 'not' | 'is'; list: Complex[] }
  | { kind: 'nth'; a: number; b: number; fromEnd: boolean }
  | { kind: 'root' };
type Compound = Simple[];
/** Compounds left to right; `combinators[i]` joins `compounds[i - 1]` and `compounds[i]`. */
interface Complex {
  compounds: Compound[];
  combinators: (' ' | '>')[];
}

export interface CompiledSelector {
  source: string;
  /** Does `node` itself match? */
  matches(node: SelectorNode): boolean;
  /** Does `node` or one of its ancestors match (like `Element.closest`)? */
  closest(node: SelectorNode): boolean;
}

// Attributes whose values HTML matches case-insensitively in selectors.
const CASE_INSENSITIVE_VALUES = new Set(
  (
    'accept accept-charset align alink axis bgcolor charset checked clear codetype color compact declare defer ' +
    'dir direction disabled enctype face frame hreflang http-equiv lang language link media method multiple ' +
    'nohref noresize noshade nowrap readonly rel rev rules scope scrolling selected shape target text type ' +
    'valign valuetype vlink'
  ).split(' '),
);

class Parser {
  private i = 0;
  constructor(private s: string) {}

  fail(msg: string): never {
    throw new SelectorError(`${msg} at position ${this.i}`);
  }
  private peek(n = 0) {
    return this.s[this.i + n] ?? '';
  }
  private ws() {
    let any = false;
    while (/\s/.test(this.peek())) {
      this.i++;
      any = true;
    }
    return any;
  }
  private ident(): string {
    let out = '';
    for (;;) {
      const c = this.peek();
      if (c === '\\') {
        this.i++;
        const hex = /^[0-9a-fA-F]{1,6}/.exec(this.s.slice(this.i));
        if (hex) {
          out += String.fromCodePoint(parseInt(hex[0], 16));
          this.i += hex[0].length;
          if (/\s/.test(this.peek())) this.i++;
        } else if (this.i < this.s.length) out += this.s[this.i++];
      } else if (c && /[\w -￿-]/.test(c)) {
        out += c;
        this.i++;
      } else break;
    }
    return out;
  }
  private string(): string {
    const q = this.s[this.i++];
    let out = '';
    while (this.i < this.s.length && this.peek() !== q) {
      if (this.peek() === '\\') {
        this.i++;
        const hex = /^[0-9a-fA-F]{1,6}/.exec(this.s.slice(this.i));
        if (hex) {
          out += String.fromCodePoint(parseInt(hex[0], 16));
          this.i += hex[0].length;
          if (/\s/.test(this.peek())) this.i++;
          continue;
        }
      }
      out += this.s[this.i++];
    }
    if (this.peek() !== q) this.fail('unterminated string');
    this.i++;
    return out;
  }

  list(close?: string): Complex[] {
    const out: Complex[] = [];
    for (;;) {
      this.ws();
      out.push(this.complex(close));
      this.ws();
      if (this.peek() === ',') {
        this.i++;
        continue;
      }
      if (close ? this.peek() === close : this.i >= this.s.length) return out;
      this.fail(`unexpected "${this.peek()}"`);
    }
  }

  private complex(close?: string): Complex {
    const compounds: Compound[] = [this.compound()];
    const combinators: (' ' | '>')[] = [];
    for (;;) {
      const hadWs = this.ws();
      const c = this.peek();
      if (c === '' || c === ',' || (close && c === close)) break;
      if (c === '+' || c === '~') this.fail(`sibling combinator "${c}" is not supported`);
      let comb: ' ' | '>' = ' ';
      if (c === '>') {
        this.i++;
        this.ws();
        comb = '>';
      } else if (!hadWs) this.fail(`unexpected "${c}"`);
      combinators.push(comb);
      compounds.push(this.compound());
    }
    return { compounds, combinators };
  }

  private compound(): Compound {
    const out: Compound = [];
    const c0 = this.peek();
    if (c0 === '*') this.i++;
    else if (c0 && c0 !== '#' && c0 !== '.' && c0 !== '[' && c0 !== ':') {
      const tag = this.ident();
      if (!tag) this.fail(`unexpected "${c0}"`);
      out.push({ kind: 'tag', tag: tag.toLowerCase() });
    }
    for (;;) {
      const c = this.peek();
      if (c === '#') {
        this.i++;
        const id = this.ident();
        if (!id) this.fail('expected an id after "#"');
        out.push({ kind: 'attr', name: 'id', op: '=', value: id });
      } else if (c === '.') {
        this.i++;
        const cls = this.ident();
        if (!cls) this.fail('expected a class name after "."');
        out.push({ kind: 'attr', name: 'class', op: '~=', value: cls });
      } else if (c === '[') {
        this.i++;
        out.push(this.attr());
      } else if (c === ':') {
        out.push(this.pseudo());
      } else break;
    }
    if (out.length === 0 && c0 !== '*') this.fail('expected a selector');
    return out;
  }

  private attr(): Simple {
    this.ws();
    const name = this.ident().toLowerCase();
    if (!name) this.fail('expected an attribute name');
    this.ws();
    if (this.peek() === ']') {
      this.i++;
      return { kind: 'attr', name, op: '', value: '' };
    }
    const m = /^([~|^$*]?=)/.exec(this.s.slice(this.i));
    if (!m) this.fail('expected an attribute operator');
    this.i += m[1].length;
    this.ws();
    const q = this.peek();
    const value = q === '"' || q === "'" ? this.string() : this.ident();
    this.ws();
    let ci: boolean | undefined;
    const flag = this.peek().toLowerCase();
    if (flag === 'i' || flag === 's') {
      ci = flag === 'i';
      this.i++;
      this.ws();
    }
    if (this.peek() !== ']') this.fail('expected "]"');
    this.i++;
    return { kind: 'attr', name, op: m[1] as AttrOp, value, ci };
  }

  private pseudo(): Simple {
    this.i++;
    if (this.peek() === ':') this.fail('pseudo-elements are not supported');
    const name = this.ident().toLowerCase();
    const args = (): string => {
      if (this.peek() !== '(') this.fail(`":${name}" needs an argument`);
      const start = ++this.i;
      let depth = 1;
      while (this.i < this.s.length && depth) {
        const c = this.s[this.i];
        if (c === '(') depth++;
        else if (c === ')') depth--;
        if (depth) this.i++;
      }
      if (depth) this.fail('missing ")"');
      return this.s.slice(start, this.i++);
    };
    switch (name) {
      case 'not':
      case 'is':
      case 'where':
      case 'matches': {
        if (this.peek() !== '(') this.fail(`":${name}" needs an argument`);
        this.i++;
        const list = this.list(')');
        this.i++; // ')'
        return { kind: name === 'not' ? 'not' : 'is', list };
      }
      case 'nth-of-type':
      case 'nth-last-of-type': {
        const { a, b } = parseNth(args().trim(), (m) => this.fail(m));
        return { kind: 'nth', a, b, fromEnd: name === 'nth-last-of-type' };
      }
      case 'first-of-type':
        return { kind: 'nth', a: 0, b: 1, fromEnd: false };
      case 'last-of-type':
        return { kind: 'nth', a: 0, b: 1, fromEnd: true };
      case 'only-of-type':
        return {
          kind: 'is',
          list: [{ compounds: [[{ kind: 'nth', a: 0, b: 1, fromEnd: false }, { kind: 'nth', a: 0, b: 1, fromEnd: true }]], combinators: [] }],
        };
      case 'root':
        return { kind: 'root' };
      default:
        this.fail(`":${name}" is not supported`);
    }
  }
}

function parseNth(arg: string, fail: (m: string) => never): { a: number; b: number } {
  const s = arg.toLowerCase().replace(/\s+/g, '');
  if (s === 'odd') return { a: 2, b: 1 };
  if (s === 'even') return { a: 2, b: 0 };
  const m = /^([+-]?\d*)n([+-]\d+)?$/.exec(s);
  if (m) {
    const a = m[1] === '' || m[1] === '+' ? 1 : m[1] === '-' ? -1 : parseInt(m[1], 10);
    return { a, b: m[2] ? parseInt(m[2], 10) : 0 };
  }
  if (/^[+-]?\d+$/.test(s)) return { a: 0, b: parseInt(s, 10) };
  return fail(`invalid ":nth-of-type(${arg})" argument`);
}

function matchAttr(node: SelectorNode, s: Extract<Simple, { kind: 'attr' }>): boolean {
  const actual = node.attrs[s.name];
  if (actual === undefined) return false;
  if (s.op === '') return true;
  const ci = s.ci ?? CASE_INSENSITIVE_VALUES.has(s.name);
  const v = ci ? actual.toLowerCase() : actual;
  const want = ci ? s.value.toLowerCase() : s.value;
  switch (s.op) {
    case '=':
      return v === want;
    case '~=':
      return want !== '' && !/\s/.test(want) && v.split(/\s+/).includes(want);
    case '|=':
      return v === want || v.startsWith(want + '-');
    case '^=':
      return want !== '' && v.startsWith(want);
    case '$=':
      return want !== '' && v.endsWith(want);
    case '*=':
      return want !== '' && v.includes(want);
  }
}

function matchNth(node: SelectorNode, s: Extract<Simple, { kind: 'nth' }>): boolean {
  const pos = s.fromEnd ? node.of - node.nth + 1 : node.nth;
  if (s.a === 0) return pos === s.b;
  const k = (pos - s.b) / s.a;
  return Number.isInteger(k) && k >= 0;
}

function matchCompound(node: SelectorNode, c: Compound): boolean {
  for (const s of c) {
    switch (s.kind) {
      case 'tag':
        if (node.tag !== s.tag) return false;
        break;
      case 'attr':
        if (!matchAttr(node, s)) return false;
        break;
      case 'nth':
        if (!matchNth(node, s)) return false;
        break;
      case 'root':
        if (node.parent || node.tag !== 'html') return false;
        break;
      case 'not':
        if (s.list.some((x) => matchComplex(node, x, x.compounds.length - 1))) return false;
        break;
      case 'is':
        if (!s.list.some((x) => matchComplex(node, x, x.compounds.length - 1))) return false;
        break;
    }
  }
  return true;
}

function matchComplex(node: SelectorNode, sel: Complex, i: number): boolean {
  if (!matchCompound(node, sel.compounds[i])) return false;
  if (i === 0) return true;
  if (sel.combinators[i - 1] === '>') return !!node.parent && matchComplex(node.parent, sel, i - 1);
  for (let a = node.parent; a; a = a.parent) if (matchComplex(a, sel, i - 1)) return true;
  return false;
}

/** Parses `source`. Throws `SelectorError` for invalid or unsupported syntax. */
export function compileSelector(source: string): CompiledSelector {
  if (typeof source !== 'string' || !source.trim()) throw new SelectorError('empty selector');
  const list = new Parser(source).list();
  const memo = new WeakMap<SelectorNode, boolean>();
  const matches = (node: SelectorNode) => {
    let r = memo.get(node);
    if (r === undefined) {
      r = list.some((c) => matchComplex(node, c, c.compounds.length - 1));
      memo.set(node, r);
    }
    return r;
  };
  const closestMemo = new WeakMap<SelectorNode, boolean>();
  const closest = (node: SelectorNode): boolean => {
    let r = closestMemo.get(node);
    if (r === undefined) {
      r = matches(node) || (!!node.parent && closest(node.parent));
      closestMemo.set(node, r);
    }
    return r;
  };
  return { source, matches, closest };
}
