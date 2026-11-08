/**
 * Element facts derived from recorded nodes (no DOM needed).
 *
 * Which elements are interactive is decided in the browser (`tracker.ts`,
 * README "Which elements count") and recorded per element, because the rules
 * need live DOM state. The tracker additionally records the visible elements
 * matching `RECORDED_CANDIDATES`, flagged as not interactive, so later
 * report-time rules can use them without re-recording.
 */
import { isBoundary, type SelectorNode } from './selector';

/**
 * Recorded in addition to the interactive elements: things that are often
 * meant to be clickable but aren't by the default rules. Broader is more
 * future-proof but makes recordings bigger.
 */
export const RECORDED_CANDIDATES = ['a', 'label', 'details', '[onclick]', '[data-uicov-id]'];

const IMPLICIT_ROLES: Record<string, string> = {
  a: 'link',
  button: 'button',
  select: 'combobox',
  textarea: 'textbox',
  summary: 'button',
};
const INPUT_ROLES: Record<string, string> = {
  checkbox: 'checkbox',
  radio: 'radio',
  range: 'slider',
  submit: 'button',
  button: 'button',
  reset: 'button',
  image: 'button',
  search: 'searchbox',
  number: 'spinbutton',
  file: 'button',
};

/** `input.type` as the browser reports it (lowercase). */
export const inputType = (attrs: Record<string, string>) => (attrs.type ?? '').toLowerCase();

/** `HTMLElement.isContentEditable` from the `contenteditable` attributes on the node and its ancestors. */
export function isContentEditable(node: SelectorNode | undefined): boolean {
  // Editing hosts don't extend into shadow trees or frames.
  for (let n = node; n && !isBoundary(n); n = n.parent) {
    const v = n.attrs.contenteditable;
    if (v === undefined) continue;
    const s = v.trim().toLowerCase();
    if (s === '' || s === 'true' || s === 'plaintext-only') return true;
    if (s === 'false') return false;
    // Invalid value: inherit.
  }
  return false;
}

/** Role shown in labels: the first token of `role`, else the implicit role of the tag. */
export function roleOf(node: SelectorNode): string {
  const explicit = (node.attrs.role || '').trim().split(/\s+/)[0];
  if (explicit) return explicit;
  if (node.tag === 'input') return INPUT_ROLES[inputType(node.attrs)] || 'textbox';
  if (isContentEditable(node)) return 'textbox';
  return IMPLICIT_ROLES[node.tag] || node.tag;
}
