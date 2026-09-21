// Shared control vocabulary. @tone picks the hue (sets --pretui-tone/--pretui-tone-on),
// @appearance picks the recipe that reads those vars, @size sets host font-size only
// (everything inside is em), and @variant is sugar over the two axes.
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

// Alias layer: a component accepts other vocabularies' names for the same knob and
// resolves them in a getter; the canonical name stays the taught one. Values notify
// through @onChange and layers through @onOpenChange, with on<Noun>Change as aliases.

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

// Alias spellings for the middle steps of the house scale xs|s|m|l|xl.
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
/** Every `@size` spelling accepted, narrowed to the house scale. */
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

// House tone is 'danger'; 'destructive' lands through the table. Null-prototype as SIZE_ALIASES.
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
/** Every `@tone` spelling accepted, before narrowing. */
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
 * Value-notify aliases for any control; `T` is what it emits. `@onChange` maps to
 * the input event; blur semantics stay reachable with `{{on 'change'}}` through `...attributes`.
 */
export interface ControlNotifyArgs<T = string> {
  onChange?: (value: T) => void;
  onValueChange?: (value: T) => void;
}

/** The notify pair plus the boolean aliases a text-shaped control accepts; spread it only where all four booleans are wired. */
export interface ControlAliasArgs<T = string> extends ControlNotifyArgs<T> {
  /** alias of @disabled */
  isDisabled?: boolean;
  /** alias of @required */
  isRequired?: boolean;
  /** aliases of @readonly */
  isReadOnly?: boolean;
  readOnly?: boolean;
}
