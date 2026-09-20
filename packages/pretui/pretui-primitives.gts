// Shared control vocabulary: the two-axis treatment grid and the React-dialect
// alias resolvers. @tone picks the hue (sets --pretui-tone/--pretui-tone-on),
// @appearance picks the recipe that reads those vars, @size sets host font-size
// only (everything inside is em), and @variant is sugar over the two axes.
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

// React-dialect alias layer. Agents trained on shadcn / Radix / Mantine / MUI /
// React Aria emit other names for the same knobs; components accept those and
// resolve them in a getter, never a wrapper. The canonical name is the taught one.
// @checked, @pressed and @value stay three props; React Aria's single isSelected
// is deliberately not copied. Values notify through HTML-shaped @onChange and
// layers through Radix's @onOpenChange, with on<Noun>Change accepted as aliases;
// emit() always fires the canonical handler first.

/** First value the caller actually supplied. Canonical name goes first. */
export function firstDefined<T>(...values: (T | undefined)[]): T | undefined {
  for (let v of values) {
    if (v !== undefined) {
      return v;
    }
  }
  return undefined;
}

/** Fire every notify handler supplied, canonical first; two handlers fire both rather than dropping one. */
export function emit<A extends unknown[]>(
  handlers: readonly (((...args: A) => void) | undefined)[],
  ...args: A
): void {
  for (let h of handlers) {
    h?.(...args);
  }
}

// Other kits' spellings for the middle steps of the house scale xs|s|m|l|xl.
// Null-prototype so a typed 'constructor' misses the table instead of hitting Object.prototype.
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

// House tone is 'danger', not shadcn's 'destructive'; the table lands the alias. Null-prototype as SIZE_ALIASES.
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

/** Narrow a tone to the subset a component paints; an unsupported tone falls back rather than emitting a data-tone no stylesheet matches. */
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
 * Value-notify aliases for any control; `T` is what it emits. `@onChange` maps
 * to the input event, matching React's per-keystroke meaning; blur semantics
 * remain reachable with `{{on 'change'}}` through `...attributes`.
 */
export interface ControlNotifyArgs<T = string> {
  onChange?: (value: T) => void;
  onValueChange?: (value: T) => void;
}

/** The notify pair plus the boolean aliases a text-shaped control accepts; spread it only where all four booleans are wired. */
export interface ControlAliasArgs<T = string> extends ControlNotifyArgs<T> {
  /** alias — React Aria / Base UI spelling of @disabled */
  isDisabled?: boolean;
  /** alias — React Aria / Base UI spelling of @required */
  isRequired?: boolean;
  /** aliases — React Aria / HTML spellings of @readonly */
  isReadOnly?: boolean;
  readOnly?: boolean;
}
