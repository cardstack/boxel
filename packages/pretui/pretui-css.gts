// Pretui — kit-wide CSS policy: the caller-value guard and the stacking scale.
//
// Two things live here because both are *authorities*: there must be exactly
// one of each in the kit, and every component defers to it rather than
// re-deciding locally.
//
// ─────────────────────────────────────────────────────────────────────────
// 1. `cssValue` — the guard for caller-supplied strings that reach CSS
// ─────────────────────────────────────────────────────────────────────────
//
// Law 2 routes a hue through nearly every component, and a hue arrives as a
// caller string. Interpolating that string into an inline style and handing
// it to `htmlSafe` lets `red; background: url(https://evil/x)` inject
// arbitrary declarations — `htmlSafe` means "I have already made this safe",
// and nothing had.
//
// The guard is an ALLOWLIST, not a sanitiser: it validates and returns the
// value unchanged, or returns `undefined` for anything it does not fully
// understand. It never strips-and-continues, because strip-and-continue is
// how a value that looked harmless after cleaning turns out not to be.
// Callers build the declaration from the validated value, so the property
// name is always an authored literal and only the value is ever in doubt.
//
// Numeric interpolations clamped through `Math` are already safe and do not
// need this — a `number` cannot carry a semicolon. Strings always do.
//
// ─────────────────────────────────────────────────────────────────────────
// 2. `--pretui-z-*` — the stacking scale
// ─────────────────────────────────────────────────────────────────────────
//
// Seven components in the kit float above the page — Popup, Popover, Dialog,
// Drawer, Tooltip, Menu, Toast — and before this scale each picked its own
// integer, so they could not be ordered among themselves, and a host
// application could not slot its own chrome between them.
//
// The order, and why it is this order:
//
//   base    0    in-flow content. Nothing needs to say this; it is the floor.
//   raised  1    layering INSIDE one component's own box — a sliding
//                highlight under its labels, a floating label over its
//                field. Never competes with anything outside the component.
//   sticky  10   sticky rows, columns and toolbars pinned inside a scroll
//                container. Above content because it must cover it while
//                scrolling; far below every floating surface, because a
//                menu opened FROM a sticky toolbar has to clear it.
//   sticky-header 11
//                the one place two sticky planes cross: a pinned header cell
//                over a pinned first column. It is deliberately adjacent to
//                `sticky` rather than a tier of its own.
//   scrim   50   the invisible outside-click catcher that belongs to a
//                floating surface. Always one step BELOW the surface it
//                dismisses and above everything the surface covers — a scrim
//                that outranks its own panel eats the panel's clicks.
//   dropdown 60  Menu, Select's listbox, Combobox, CommandPalette. Anchored
//                to a trigger, dismissed by an outside click, and always
//                subordinate to a panel that may contain it.
//   overlay 70   Popup and Popover — a deliberate floating panel. Above
//                dropdown because a Popover can contain a Select, and the
//                containing panel must never paint under its own content.
//   tooltip 80   a tooltip describes whatever is under the pointer, and that
//                may be an item inside a dropdown or a popover. It is small,
//                transient and non-interactive, so nothing is lost by it
//                being the highest non-modal tier.
//   dialog  90   Dialog and Drawer. FALLBACK ONLY: both use native
//                `<dialog>` + `showModal()`, which promotes them to the top
//                layer, above every z-index on the page regardless of value.
//                The token exists so a non-modal or polyfilled variant lands
//                in the right place, and so the intended rank is written
//                down rather than implied by the platform.
//   toast   100  the last word. A toast reports something that just happened
//                and must stay readable over whatever is open, including a
//                modal — so it is the only tier deliberately above `dialog`.
//
// The numbers are gapped so a host can interleave its own chrome (a global
// nav at 65, an assistant panel at 85) without editing Pretui.
//
// **Consumption rule.** Every component writes
// `z-index: var(--pretui-z-<tier>, <the number above>)`. The literal fallback
// is not optional and is not a guess — it is this table, restated, so a
// season that has never defined these tokens renders in exactly the same
// order. A season redefines a token to move a whole tier at once.

import { htmlSafe } from '@ember/template';

// ── The caller-value guard ───────────────────────────────────────────────

/**
 * Every character a caller value may contain. Notably absent, and each for a
 * reason a comment should record:
 *
 *   `;` `:`   would end the declaration and start another one — the whole
 *             injection. Callers supply a VALUE, never a declaration.
 *   `{` `}`   would close the style attribute's implied block context.
 *   `<` `>`   `</style>` and friends.
 *   `"` `'`   quoted strings are only needed by `url()` and `content()`,
 *             neither of which is allowed.
 *   `\`       CSS escapes (`\3b` is a semicolon) would defeat every rule above.
 *   `@` `!`   at-rules and `!important`, both forbidden by kit law anyway.
 *
 * `*` and `/` survive because `calc()` needs them; the comment sequences they
 * can form are rejected separately.
 */
const ALLOWED_CHARS = /^[A-Za-z0-9_\-#%.,()+*/ ]+$/;

/**
 * Functions a caller value may call. Anything not on this list — `url`,
 * `image-set`, `element`, `attr`, `expression`, `-moz-binding` — is rejected
 * outright rather than pattern-matched, so a function invented after this
 * code was written is denied by default.
 */
const ALLOWED_FUNCTIONS = new Set([
  // indirection
  'var',
  'env',
  // math
  'calc',
  'min',
  'max',
  'clamp',
  'round',
  'abs',
  // colour
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
  'color',
  'color-mix',
  // gradients — added 2026-08-13 after the colour work measured the gap.
  // Their ARGUMENTS are still validated by the same character and function
  // allowlist, so admitting the names widens nothing: `url()` and `attr()`
  // remain rejected wherever they appear, at any nesting depth.
  'linear-gradient',
  'radial-gradient',
  'conic-gradient',
  'repeating-linear-gradient',
  'repeating-radial-gradient',
  'repeating-conic-gradient',
  'light-dark',
  // easing — `@ease`/`@easing` knobs are caller strings too, and these take
  // nothing but numbers and keywords, so they add no injection surface
  'cubic-bezier',
  'steps',
  'linear',
]);

/** `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` — nothing else may follow a `#`. */
const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** A `(` must be the tail of a function name, never a bare grouping paren. */
const CALL = /([A-Za-z][A-Za-z0-9-]*)?\(/g;

/** Anything starting `#` up to the next separator. */
const HEXISH = /#[^\s,()]*/g;

/** Longer than any legitimate colour, length or gradient stop list. */
// 256 was chosen for hand-authored values and was wrong for GENERATED ones: a
// 32-step channel track measures 1069 chars and a 20-step track 629, so an
// 8-stop gradient already exceeded the old cap and was silently dropped. The
// cap exists to bound the parser's work, not to police intent — 4096 keeps
// that bound while admitting every gradient the kit actually emits.
const MAX_VALUE_LENGTH = 4096;

/** Deeper than `color-mix(in oklch, var(--a, oklch(…)) 40%, var(--b))`. */
const MAX_DEPTH = 5;

/**
 * Validate a caller-supplied CSS value against a conservative allowlist.
 *
 * Returns the trimmed value when every character, function call, hex literal
 * and paren in it is understood, and `undefined` otherwise. There is no
 * middle outcome: a value is passed through intact or dropped whole.
 *
 * @param raw anything a caller handed us — typed `unknown` because at a
 *   component boundary an `@arg` declared `string` can still arrive as
 *   `null`, a number, or an object.
 */
export function cssValue(raw: unknown): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  let value = raw.trim();
  if (value.length === 0 || value.length > MAX_VALUE_LENGTH) {
    return undefined;
  }
  if (!ALLOWED_CHARS.test(value)) {
    return undefined;
  }
  // A comment can hide a semicolon from a human reader but not from the
  // parser, so neither delimiter may appear.
  if (value.includes('/*') || value.includes('*/')) {
    return undefined;
  }
  // Balanced and shallow. An unbalanced `var(--x` would swallow whatever the
  // stylesheet says next.
  let depth = 0;
  for (let i = 0; i < value.length; i++) {
    let ch = value[i];
    if (ch === '(') {
      depth++;
      if (depth > MAX_DEPTH) {
        return undefined;
      }
    } else if (ch === ')') {
      depth--;
      if (depth < 0) {
        return undefined;
      }
    }
  }
  if (depth !== 0) {
    return undefined;
  }
  // Every call is a known function; no anonymous groups.
  CALL.lastIndex = 0;
  let call = CALL.exec(value);
  while (call !== null) {
    let name = call[1];
    if (name === undefined || !ALLOWED_FUNCTIONS.has(name.toLowerCase())) {
      return undefined;
    }
    call = CALL.exec(value);
  }
  // Every `#` introduces a well-formed hex colour.
  HEXISH.lastIndex = 0;
  let hex = HEXISH.exec(value);
  while (hex !== null) {
    if (!HEX.test(hex[0])) {
      return undefined;
    }
    hex = HEXISH.exec(value);
  }
  return value;
}

/**
 * A property name we are willing to write: a custom property, or a plain
 * lowercase CSS identifier. Callers never supply this — it is an authored
 * literal at every call site — but validating it keeps the contract total.
 */
const PROPERTY = /^(?:--[A-Za-z0-9_-]+|[a-z][a-z0-9-]*)$/;
const NUMERIC = /^-?(?:\d+\.?\d*|\.\d+)$/;

/**
 * Build one `property: value` declaration from a validated caller value.
 * Returns `undefined` when the value fails `cssValue`, so a rejected value
 * falls through to whatever the stylesheet's own fallback is — the caller
 * loses their override, never the component's rendering.
 */

export function cssDeclaration(
  property: string,
  raw: unknown,
): string | undefined {
  let value = cssValue(raw);
  if (value === undefined || !PROPERTY.test(property)) {
    return undefined;
  }
  return property + ': ' + value;
}

/**
 * The numeric counterpart to `cssValue`. A component that interpolates a
 * caller-supplied NUMBER into a style attribute — a size, an intensity, a
 * thickness — cannot use `cssValue`, which only accepts strings, and an
 * unguarded `${value}` puts whatever the caller passed into the declaration.
 * Glint rejects a string at a typed call site, but a field-fed value is
 * untyped, so the guard belongs here rather than in the type.
 *
 * Accepts a finite number, or a string that is nothing but a number.
 * Everything else is rejected, so the caller's declaration is dropped whole
 * rather than partially applied.
 *
 * An in-range value passes; an OUT-OF-RANGE one clamps rather than being
 * rejected, which is the one place this guard's contract differs from
 * `cssValue`'s pass-or-reject. That is deliberate: a clamp keeps the
 * direction of the caller's intent where a reject would substitute the
 * component's own default and lose it — `@rest={{2}}` on Spotlight means "as
 * opaque as it goes", and 1 delivers that where 0.34 does not. The bounds are
 * a sanity range, not a type: they exist so a hostile `1e9` cannot lay out a
 * page, not to validate the argument.
 */
export function cssNumber(
  raw: unknown,
  min: number,
  max: number,
): number | undefined {
  let n: number;
  if (typeof raw === 'number') {
    n = raw;
  } else if (typeof raw === 'string' && NUMERIC.test(raw.trim())) {
    n = Number(raw);
  } else {
    return undefined;
  }
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
}

/**
 * The one-line swap for a `style=` binding: a validated single-declaration
 * SafeString, or `undefined`.
 */
export function cssStyle(property: string, raw: unknown) {
  let decl = cssDeclaration(property, raw);
  return decl === undefined ? undefined : htmlSafe(decl);
}

/**
 * Join several declarations — typically a mix of `cssDeclaration` results and
 * authored numeric strings — into one SafeString, dropping the rejected ones.
 * Returns `undefined` when nothing survived, so the attribute is omitted
 * rather than rendered empty.
 */
export function cssStyleFrom(parts: (string | undefined)[]) {
  let kept = parts.filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  );
  return kept.length > 0 ? htmlSafe(kept.join('; ')) : undefined;
}

// ── The stacking scale ───────────────────────────────────────────────────

/** Named tiers in the Pretui stacking scale, in painting order. */
export type PretuiZLayer =
  | 'base'
  | 'raised'
  | 'sticky'
  | 'sticky-header'
  | 'scrim'
  | 'dropdown'
  | 'overlay'
  | 'tooltip'
  | 'dialog'
  | 'toast';

/**
 * The canonical value of every tier. This is the same table as the header
 * comment and as every `var(--pretui-z-*, N)` fallback in the kit; it is
 * exported so a host that must interleave its own chrome can read the tiers
 * rather than copy the numbers.
 */
export const PRETUI_Z: Readonly<Record<PretuiZLayer, number>> = Object.freeze({
  base: 0,
  raised: 1,
  sticky: 10,
  'sticky-header': 11,
  scrim: 50,
  dropdown: 60,
  overlay: 70,
  tooltip: 80,
  dialog: 90,
  toast: 100,
});

/** The custom-property name for a tier. */
export function zVarName(layer: PretuiZLayer): string {
  return '--pretui-z-' + layer;
}

/**
 * The scale as CSS custom properties, for a season or host stylesheet that
 * wants to declare them explicitly. Declaring them changes nothing on its
 * own — every consumer already falls back to these exact numbers — but it
 * gives one place to shift a whole tier.
 */
export const PRETUI_Z_SCALE_CSS: string = (
  Object.keys(PRETUI_Z) as PretuiZLayer[]
)
  .map((layer) => zVarName(layer) + ': ' + PRETUI_Z[layer] + ';')
  .join('\n  ');
