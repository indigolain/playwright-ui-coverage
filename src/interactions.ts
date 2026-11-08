/**
 * Interaction types (node side). The in-page listeners live in `tracker.ts`;
 * this module validates the options and builds the arguments it receives.
 */

/**
 * DOM events the tracker can record. Each is recorded under its own name
 * (`Interaction.event`), so the report can show "click ×3, input ×1".
 *
 * - `click`, `dblclick`, `contextmenu`: pointer activation of an element.
 * - `input`, `change`: typing, picking an option, selecting a file, toggling a checkbox.
 * - `submit`: a form submission, credited to its submit button (`SubmitEvent.submitter`).
 * - `keydown`: keyboard activation only, i.e. Enter or Space pressed on a focused element.
 * - `scroll`: a scroll gesture on a scroll container (bursts of scroll events count once).
 * - `dragstart`, `drop`: the dragged element and the drop target.
 * - `focus`, `blur`: off by default, since tabbing through a form would mark every field tested.
 */
export const INTERACTION_TYPES = [
  'click',
  'dblclick',
  'contextmenu',
  'input',
  'change',
  'submit',
  'keydown',
  'scroll',
  'dragstart',
  'drop',
  'focus',
  'blur',
] as const;

export type InteractionType = (typeof INTERACTION_TYPES)[number];

/** Everything except `focus` and `blur`. */
// Off by default: focus/blur (tabbing through a form would mark every field
// tested) and scroll (Playwright scrolls elements into view before acting, which
// would mark scroll containers tested without the test meaning to scroll them).
export const DEFAULT_INTERACTIONS: InteractionType[] = INTERACTION_TYPES.filter(
  (t) => t !== 'focus' && t !== 'blur' && t !== 'scroll',
);

/** Restricts which events count for the elements matching `selector`. */
export interface AllowedInteraction {
  /** CSS selector matched against the element being credited (`el.matches(selector)`). */
  selector: string;
  /** Events that count for matching elements. Replaces the global `interactions` list for them. */
  events: InteractionType[];
}

/** Arguments passed to the in-page tracker (must be JSON-serializable). */
export interface InteractionArgs {
  interactions: InteractionType[];
  allowedInteractions: AllowedInteraction[];
}

const check = (events: unknown, where: string): InteractionType[] => {
  if (!Array.isArray(events)) throw new Error(`[playwright-ui-coverage] ${where} must be an array of event names`);
  for (const e of events) {
    if (!(INTERACTION_TYPES as readonly string[]).includes(e))
      throw new Error(
        `[playwright-ui-coverage] unknown interaction ${JSON.stringify(e)} in ${where}; ` +
          `supported: ${INTERACTION_TYPES.join(', ')}`,
      );
  }
  return [...new Set(events as InteractionType[])];
};

export function interactionArgs(opts: {
  interactions?: InteractionType[];
  allowedInteractions?: AllowedInteraction[];
}): InteractionArgs {
  const interactions = check(opts.interactions ?? DEFAULT_INTERACTIONS, 'interactions');
  const allowedInteractions = (opts.allowedInteractions ?? []).map((rule, i) => {
    if (!rule || typeof rule.selector !== 'string' || !rule.selector.trim())
      throw new Error(`[playwright-ui-coverage] allowedInteractions[${i}].selector must be a CSS selector`);
    return { selector: rule.selector, events: check(rule.events, `allowedInteractions[${i}].events`) };
  });
  return { interactions, allowedInteractions };
}
