// Pretui — shared control vocabulary: the two-axis treatment grid and the
// React-dialect alias resolvers. Per-component modules under components/
// import these directly; nothing here imports a component, so there is no
// cycle.

// Vocabulary (Appendix E): the two-axis treatment grid. @tone picks the hue
// (sets --pretui-tone/--pretui-tone-on); @appearance picks the recipe (written
// once, reads those vars). @size sets host font-size only — everything inside
// is em, so m stays pixel-identical to the pre-scale cut (2.24em = 28px at
// 12.5px). @variant is legacy sugar over the axes.
export type PretuiTone =
  | 'neutral'
  | 'primary'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger'
  | 'attention';
export type PretuiAppearance =
  | 'accent'
  | 'filled'
  | 'outlined'
  | 'filled-outlined'
  | 'plain';
export type PretuiSize = 'xs' | 's' | 'm' | 'l' | 'xl';

export const PRETUI_TONES = [
  'neutral',
  'primary',
  'info',
  'success',
  'warning',
  'danger',
  'attention',
] as const;
export const PRETUI_APPEARANCES = [
  'accent',
  'filled',
  'outlined',
  'filled-outlined',
  'plain',
] as const;
export const PRETUI_SIZES = ['xs', 's', 'm', 'l', 'xl'] as const;

// ── React-dialect alias layer ────────────────────────────────────────────
// (react-ecosystem-gap.md, "Enhancement pass" step 1.)
//
// An agent trained on shadcn / Radix / Mantine / MUI / React Aria emits a
// different vocabulary for the same knobs. Every control, overlay and
// feedback component ACCEPTS those names and resolves them in a getter. The
// canonical name is unchanged and is still the only one the `<:api>` tables,
// the usage pages and the Freestyle knobs teach: the alias is accepted, not
// taught. No existing caller moves.
//
// Three rules kept the layer cheap:
//   · resolution is a getter, never a wrapper component and never a new
//     function identity per render (which would re-install `{{on}}`
//     listeners every re-render);
//   · `...attributes` still carries `name` / `id` / `aria-*` — no native
//     attribute is ever promoted to an `@arg` just to pass it through;
//   · a widget keeps its own selection noun. `@checked`, `@pressed` and
//     `@value` stay three props; React Aria's single `isSelected` is the one
//     thing deliberately not copied.
//
// **Callback grammar is Scheme A** — values notify through the HTML-shaped
// `@onChange`, layers through Radix's `@onOpenChange` — with the Radix
// `on<Noun>Change` spellings accepted as aliases. Every notify goes through
// `emit()` with the canonical handler FIRST, so flipping the house name to
// all-B later is a rename inside each signature plus a re-ordering of one
// array literal: no call site, template or consumer changes.

/** First value the caller actually supplied. Canonical name goes first. */
export function firstDefined<T>(...values: (T | undefined)[]): T | undefined {
  for (let v of values) {
    if (v !== undefined) {
      return v;
    }
  }
  return undefined;
}

/**
 * Fire every notify handler the caller supplied — canonical name first,
 * aliases after. A caller normally passes exactly one; passing two fires
 * both rather than silently dropping one, which is the failure mode an
 * alias layer must not have.
 */
export function emit<A extends unknown[]>(
  handlers: readonly (((...args: A) => void) | undefined)[],
  ...args: A
): void {
  for (let h of handlers) {
    h?.(...args);
  }
}

// Size: the house enum stays `xs|s|m|l|xl` (Appendix E.2) — em-scaled, and
// not up for renegotiation. These are the spellings other kits use for the
// same three middle steps.
// Null-prototype: an alias table is indexed with whatever a card author typed,
// and a plain object answers `constructor` / `toString` with an inherited
// function, which then defeats the `?? fallback` and reaches `data-size`.
const SIZE_ALIASES: Record<string, PretuiSize> = Object.assign(
  Object.create(null) as Record<string, PretuiSize>,
  {
    xs: 'xs',
    s: 's',
    m: 'm',
    l: 'l',
    xl: 'xl',
    sm: 's',
    md: 'm',
    lg: 'l',
    default: 'm',
    small: 's',
    medium: 'm',
    large: 'l',
  } as const,
);
/** Every `@size` an agent might type, narrowed to the house scale. */
export type PretuiSizeArg =
  | PretuiSize
  | 'sm'
  | 'md'
  | 'lg'
  | 'default'
  | 'small'
  | 'medium'
  | 'large';

export function resolveSize(
  size: string | undefined,
  fallback: PretuiSize = 'm',
): PretuiSize {
  return (size ? SIZE_ALIASES[size] : undefined) ?? fallback;
}

// Tone: `danger`, not `destructive` — HTML/role language rather than
// shadcn's. The alias table is how an agent's `destructive` still lands.
// Null-prototype for the same reason as SIZE_ALIASES. Here the allow-list in
// resolveTone would already reject an inherited function, so this is defence
// in depth rather than a fix.
const TONE_ALIASES: Record<string, string> = Object.assign(
  Object.create(null) as Record<string, string>,
  {
    destructive: 'danger',
    error: 'danger',
    critical: 'danger',
    negative: 'danger',
    brand: 'primary',
    positive: 'success',
    notice: 'warning',
    caution: 'warning',
  } as const,
);
/** Every `@tone` an agent might type, before narrowing. */
export type PretuiToneArg =
  | PretuiTone
  | 'destructive'
  | 'error'
  | 'critical'
  | 'negative'
  | 'brand'
  | 'positive'
  | 'notice'
  | 'caution';

/**
 * Narrow a tone to the subset a given component actually paints. Alerts and
 * Cues carry four/five of the seven; an unsupported tone falls back rather
 * than emitting a `data-tone` no stylesheet matches.
 */
export function resolveTone<T extends string>(
  tone: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (!tone) {
    return fallback;
  }
  let canonical = TONE_ALIASES[tone] ?? tone;
  return (allowed as readonly string[]).includes(canonical)
    ? (canonical as T)
    : fallback;
}

/**
 * The value-notify aliases an agent reaches for first, on any control
 * whatever its value type — `T` is what the control emits.
 *
 * `@onChange` maps to the INPUT event, not to blur: React's `onChange` fires
 * per keystroke, so that is what an agent writing it means. A caller who
 * genuinely wants blur semantics still has `{{on 'change'}}` through
 * `...attributes`.
 */
export interface ControlNotifyArgs<T = string> {
  onChange?: (value: T) => void;
  onValueChange?: (value: T) => void;
}

/**
 * The notify pair plus the boolean aliases a text-shaped control accepts.
 *
 * Spread this only where the component wires all four booleans — one that
 * accepts `@isReadOnly` and ignores it is worse than one that never offered
 * it. Other controls take `ControlNotifyArgs<T>` and declare their own.
 */
export interface ControlAliasArgs<T = string> extends ControlNotifyArgs<T> {
  /** alias — React Aria / Base UI spelling of @disabled */
  isDisabled?: boolean;
  /** alias — React Aria / Base UI spelling of @required */
  isRequired?: boolean;
  /** aliases — React Aria / HTML spellings of @readonly */
  isReadOnly?: boolean;
  readOnly?: boolean;
}
