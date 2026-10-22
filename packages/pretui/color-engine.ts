// Pretui — the colour engine.
//
// The one place in the kit that knows what a colour IS. Everything visual
// (ColorPicker, GradientEditor, Swatch, ColorPalette, ColorField) reads its
// numbers from here and, critically, gets its CSS strings from here.
//
// Three jobs, in order of how much trouble they save:
//
//  1. **The injection guard.** A colour surface interpolates caller strings
//     into inline styles constantly, and `@value` of `red; background:
//     url(…)` would inject declarations. Nothing in this kit may pass a
//     caller string to a style attribute. `cssFor()` PARSES the caller's
//     text with the colour engine and RE-SERIALIZES a string this module
//     constructed from numbers — the caller's characters never survive the
//     round trip. Every attack shape was measured against colorjs.io's
//     parser and every one throws (`red; background: url(...)`,
//     `red}\n.x{color:blue`, `url(...)`, `expression(...)`, `#fff;--y:1`,
//     backtick-interpolation), so the parse gate alone is sufficient; the
//     charset assertion on the OUTPUT is belt and braces.
//
//  2. **Gamut, made visible.** `clampTo()` never silently rewrites a colour.
//     It returns the mapped colour AND whether mapping happened AND how far
//     it moved (ΔE OK), so the UI can say "outside sRGB — clamped to #ff5843"
//     instead of quietly lying. This is the whole reason OKLCH matters: you
//     can *ask for* a colour a display cannot show, and the honest answer is
//     "here is the nearest one", not a silently different swatch.
//
//  3. **Pure functions, no DOM, no timers.** Every export here is a pure
//     function of its arguments — unit-testable without a browser, safe
//     anywhere in the realm module graph, and free of `Date.now()` /
//     `Math.random()` (indexing determinism). Stop ids come from a caller-
//     supplied monotonic counter, never a random source.
//
// Better than the inspiration (hdr-color-input v0.4.3, MIT, Adam Argyle):
// upstream runs its area paint in a Worker built from an object URL and
// carries preact/signals for reactivity. Neither survives contact with a
// Boxel realm — an unowned Worker is exactly the lifetime hazard the realm's
// no-unowned-timers law exists to prevent, and a second reactive system
// beside Glimmer's `@tracked` is a liability. The paint is a bounded
// synchronous pass in an `ember-modifier` instead (see `paintArea`), which
// has no lifetime to leak, and reactivity is `@tracked`. Upstream also
// clamps silently; this module reports.
//
// Colour maths is VENDORED, not ported: see `color/README.md`.

/* eslint-disable @typescript-eslint/no-explicit-any -- the vendored bundle
   ships no type declarations; its surface is re-declared as `Engine` below
   and every use goes through that one narrow cast. */
import * as Vendor from './color/index.js';

// ── The vendored surface, narrowly declared ──────────────────────────────
// Only what this module actually calls. Declaring it here (rather than
// shipping a .d.ts beside a minified bundle) keeps the contract readable and
// keeps the realm free of a declaration file the loader would have to skip.

/** A colour as the vendored engine models it: a space, three coordinates,
 *  and alpha. Coordinates may be NaN for an undefined hue — that is legal
 *  and meaningful (an achromatic colour has no hue). */
export interface PlainColor {
  /** Present on colours the engine RETURNS (`to`, `toGamut`). */
  space?: any;
  /** Present on colours the engine PARSES. See `parseColor`. */
  spaceId?: string;
  coords: [number, number, number];
  alpha: number;
}

interface Engine {
  ColorSpace: { registry: Record<string, any> };
  parse: (text: string) => PlainColor;
  to: (color: PlainColor, space: any) => PlainColor;
  serialize: (color: PlainColor, options?: Record<string, unknown>) => string;
  inGamut: (color: PlainColor, space: any) => boolean;
  toGamut: (color: PlainColor, options?: Record<string, unknown>) => PlainColor;
  deltaE: (a: PlainColor, b: PlainColor, method?: string) => number;
  contrastWCAG21: (a: PlainColor, b: PlainColor) => number;
  getLuminance: (color: PlainColor) => number;
  mix: (
    a: PlainColor,
    b: PlainColor,
    t: number,
    options: { space: any; hue: HueMethod; premultiplied: boolean },
  ) => PlainColor;
}

const engine = Vendor as unknown as Engine;

/** Look a registered space up by its colorjs id. Throws only on a
 *  programmer error (an id this module does not register). */
function spaceObject(id: string): any {
  let found = engine.ColorSpace.registry[id];
  if (!found) {
    throw new Error(`pretui color-engine: space "${id}" is not registered`);
  }
  return found;
}

// ── Spaces and channels ──────────────────────────────────────────────────

/** Channel models a caller may drive the picker in. `p3` and `rec2020` are
 *  RGB spaces with wider primaries; `oklch`/`oklab` are perceptual and
 *  unbounded, which is exactly why they need a gamut to be checked against. */
export type SpaceId =
  | 'srgb'
  | 'p3'
  | 'rec2020'
  | 'oklch'
  | 'oklab'
  | 'hsl'
  | 'hsv';

/** Gamuts a colour can be checked and mapped into. Distinct from SpaceId on
 *  purpose: OKLCH is a *space*, sRGB is also a *gamut*, and conflating the
 *  two is why most pickers cannot tell you that a colour is unshowable. */
export type GamutId = 'srgb' | 'p3' | 'rec2020';

export interface ChannelSpec {
  /** Machine key, matching the space's coordinate name. */
  readonly id: string;
  /** Human label used in the numeric input and in `aria-valuetext`. */
  readonly label: string;
  /** Slider/input minimum, in DISPLAY units (see `scale`). */
  readonly min: number;
  /** Slider/input maximum, in display units. */
  readonly max: number;
  /** One arrow press. Shift multiplies by 10, Alt divides by 10. */
  readonly step: number;
  /** Decimal places the numeric input rounds to. */
  readonly precision: number;
  /** Suffix shown after the number and spoken in `aria-valuetext`. */
  readonly unit: string;
  /** Display value = stored coordinate × scale. sRGB channels are shown
   *  0–255 because that is the number every designer already has in hand,
   *  while the stored coordinate stays 0–1 as CSS defines it. */
  readonly scale: number;
  /** Hue channels wrap at the ends instead of clamping. */
  readonly isHue: boolean;
}

/** How a space projects onto the 2D area picker. Three kinds only:
 *  HSV-style (saturation × value under a hue slider) for the RGB-ish
 *  spaces, chroma × lightness under a hue slider for the LCH-ish ones, and
 *  a × b under a lightness slider for OKLab. */
export interface AreaSpec {
  /** The space the area's geometry is computed in — may differ from the
   *  space whose channels the numeric inputs show. */
  readonly model: SpaceId;
  /** Coordinate index driven by the horizontal axis. */
  readonly x: number;
  /** Coordinate index driven by the vertical axis (top = max). */
  readonly y: number;
  /** Coordinate index driven by the slider beside the area. */
  readonly z: number;
}

export interface SpaceSpec {
  readonly id: SpaceId;
  /** colorjs registry id — identical to `id` for every space here, but kept
   *  separate so a future space can differ without a rename cascade. */
  readonly cssId: string;
  readonly label: string;
  /** Short prose a caller can put beside the space switcher. */
  readonly note: string;
  readonly channels: readonly [ChannelSpec, ChannelSpec, ChannelSpec];
  readonly area: AreaSpec;
  /** The gamut this space is naturally bounded by, or null when the space
   *  is unbounded (OKLCH/OKLab describe colours no display can show). */
  readonly nativeGamut: GamutId | null;
}

function channel(
  id: string,
  label: string,
  min: number,
  max: number,
  step: number,
  precision: number,
  unit = '',
  scale = 1,
  isHue = false,
): ChannelSpec {
  return { id, label, min, max, step, precision, unit, scale, isHue };
}

const HUE = channel('h', 'Hue', 0, 360, 1, 2, '°', 1, true);

const RGB255 = (id: string, label: string) =>
  channel(id, label, 0, 255, 1, 0, '', 255);
const RGB01 = (id: string, label: string) =>
  channel(id, label, 0, 1, 0.001, 4, '', 1);

const AREA_HSV: AreaSpec = { model: 'hsv', x: 1, y: 2, z: 0 };
const AREA_LCH: AreaSpec = { model: 'oklch', x: 1, y: 0, z: 2 };
const AREA_LAB: AreaSpec = { model: 'oklab', x: 1, y: 2, z: 0 };

export const SPACES: readonly SpaceSpec[] = [
  {
    id: 'srgb',
    cssId: 'srgb',
    label: 'sRGB',
    note: 'The web default gamut. Channels shown 0–255.',
    channels: [RGB255('r', 'Red'), RGB255('g', 'Green'), RGB255('b', 'Blue')],
    area: AREA_HSV,
    nativeGamut: 'srgb',
  },
  {
    id: 'hsl',
    cssId: 'hsl',
    label: 'HSL',
    note: 'sRGB in cylindrical coordinates. Lightness is not perceptual.',
    channels: [
      HUE,
      channel('s', 'Saturation', 0, 100, 1, 1, '%'),
      channel('l', 'Lightness', 0, 100, 1, 1, '%'),
    ],
    area: AREA_HSV,
    nativeGamut: 'srgb',
  },
  {
    id: 'hsv',
    cssId: 'hsv',
    label: 'HSV',
    note: 'The classic picker model. Not a CSS colour syntax — output is sRGB.',
    channels: [
      HUE,
      channel('s', 'Saturation', 0, 100, 1, 1, '%'),
      channel('v', 'Value', 0, 100, 1, 1, '%'),
    ],
    area: AREA_HSV,
    nativeGamut: 'srgb',
  },
  {
    id: 'oklch',
    cssId: 'oklch',
    label: 'OKLCH',
    note: 'Perceptual lightness, chroma and hue. Unbounded — check the gamut.',
    channels: [
      channel('l', 'Lightness', 0, 1, 0.001, 4),
      channel('c', 'Chroma', 0, 0.4, 0.001, 4),
      HUE,
    ],
    area: AREA_LCH,
    nativeGamut: null,
  },
  {
    id: 'oklab',
    cssId: 'oklab',
    label: 'OKLab',
    note: 'Perceptual, rectangular. a is green↔red, b is blue↔yellow.',
    channels: [
      channel('l', 'Lightness', 0, 1, 0.001, 4),
      channel('a', 'a (green–red)', -0.4, 0.4, 0.001, 4),
      channel('b', 'b (blue–yellow)', -0.4, 0.4, 0.001, 4),
    ],
    area: AREA_LAB,
    nativeGamut: null,
  },
  {
    id: 'p3',
    cssId: 'p3',
    label: 'Display P3',
    note: 'Wide-gamut RGB. About 25% more colours than sRGB.',
    channels: [RGB01('r', 'Red'), RGB01('g', 'Green'), RGB01('b', 'Blue')],
    area: AREA_LCH,
    nativeGamut: 'p3',
  },
  {
    id: 'rec2020',
    cssId: 'rec2020',
    label: 'Rec. 2020',
    note: 'The HDR/UHD gamut. Wider than P3; few displays cover it.',
    channels: [RGB01('r', 'Red'), RGB01('g', 'Green'), RGB01('b', 'Blue')],
    area: AREA_LCH,
    nativeGamut: 'rec2020',
  },
];

const SPACE_BY_ID = new Map<SpaceId, SpaceSpec>(SPACES.map((s) => [s.id, s]));

/** Never throws for a known id; falls back to sRGB for anything else so a
 *  bad `@space` degrades to a working picker instead of a blank one. */
export function spaceSpec(id: SpaceId | string | undefined): SpaceSpec {
  return SPACE_BY_ID.get(id as SpaceId) ?? SPACE_BY_ID.get('srgb')!;
}

export const GAMUTS: readonly { id: GamutId; label: string }[] = [
  { id: 'srgb', label: 'sRGB' },
  { id: 'p3', label: 'Display P3' },
  { id: 'rec2020', label: 'Rec. 2020' },
];

// ── The colour value ─────────────────────────────────────────────────────

export interface ColorValue {
  readonly space: SpaceId;
  readonly coords: readonly [number, number, number];
  readonly alpha: number;
}

/** Black, opaque, sRGB — the value every fallible path lands on. */
export const BLACK: ColorValue = { space: 'srgb', coords: [0, 0, 0], alpha: 1 };

function toPlain(value: ColorValue): PlainColor {
  return {
    space: spaceObject(spaceSpec(value.space).cssId),
    coords: [value.coords[0], value.coords[1], value.coords[2]],
    alpha: value.alpha,
  };
}

function fromPlain(plain: PlainColor, space: SpaceId): ColorValue {
  let [a, b, c] = plain.coords;
  return {
    space,
    coords: [numeric(a), numeric(b), numeric(c)],
    alpha: numeric(plain.alpha, 1),
  };
}

/** NaN is legal inside colorjs (an undefined hue) but poisonous in a
 *  template — it renders as "NaN" and breaks every comparison. Undefined
 *  hues become 0, which is the same colour. */
function numeric(n: number, fallback = 0): number {
  return Number.isFinite(n) ? n : fallback;
}

// ── Parsing ──────────────────────────────────────────────────────────────

/**
 * Parse any CSS colour string. **Never throws** and never returns the
 * caller's characters — a `ColorValue` is numbers only, which is what makes
 * the re-serialize guard total.
 *
 * Returns null for anything that is not a colour, including every injection
 * shape (`red; background: url(…)`, `red}.x{…`, `url(…)`, `expression(…)`).
 */
export function parseColor(text: string | undefined | null): ColorValue | null {
  if (typeof text !== 'string') {
    return null;
  }
  let trimmed = text.trim();
  if (!trimmed || trimmed.length > 256) {
    return null;
  }
  let plain: PlainColor;
  try {
    // colorjs 0.7's `parse` returns a ColorConstructor — `{ spaceId, coords,
    // alpha }` — NOT a PlainColorObject. Every consumer (`to`, `serialize`,
    // `inGamut`) accepts either shape, but reading the space back off it
    // means checking `spaceId` first. Getting this wrong is silent: the
    // colour parses, `plain.space` reads `undefined`, and every value in the
    // picker becomes null.
    plain = engine.parse(trimmed);
  } catch {
    return null;
  }
  if (!plain || !Array.isArray(plain.coords)) {
    return null;
  }
  let id = (plain.space?.id ?? plain.spaceId ?? 'srgb') as string;
  if (SPACE_BY_ID.has(id as SpaceId)) {
    return fromPlain(plain, id as SpaceId);
  }
  // A syntax this kit does not expose as a channel model (`lab()`, `hwb()`,
  // `color(xyz …)`) still has to produce a working picker: normalize into
  // sRGB rather than refusing the paste.
  try {
    return fromPlain(engine.to(plain, spaceObject('srgb')), 'srgb');
  } catch {
    return null;
  }
}

/** Convert between the kit's spaces. Total: an impossible conversion
 *  returns the input unchanged rather than throwing into a render. */
export function toSpace(value: ColorValue, target: SpaceId): ColorValue {
  if (value.space === target) {
    return value;
  }
  try {
    let plain = engine.to(toPlain(value), spaceObject(spaceSpec(target).cssId));
    let next = fromPlain(plain, target);
    // A conversion that loses the hue (achromatic input) must not spin the
    // hue slider to 0 and destroy the user's hue. Carry it forward.
    let spec = spaceSpec(target);
    let hueIndex = spec.channels.findIndex((c) => c.isHue);
    if (hueIndex >= 0 && !Number.isFinite(plain.coords[hueIndex])) {
      let sourceHue = hueOf(value);
      if (sourceHue !== null) {
        let coords: [number, number, number] = [
          next.coords[0],
          next.coords[1],
          next.coords[2],
        ];
        coords[hueIndex] = sourceHue;
        return { ...next, coords };
      }
    }
    return next;
  } catch {
    return value;
  }
}

/** The hue of a colour in its own space, or null when the space has none. */
export function hueOf(value: ColorValue): number | null {
  let spec = spaceSpec(value.space);
  let index = spec.channels.findIndex((c) => c.isHue);
  if (index < 0) {
    return null;
  }
  let raw = value.coords[index];
  return Number.isFinite(raw) ? raw : null;
}

// ── Channel arithmetic ───────────────────────────────────────────────────

/** Wrap a hue into [0, 360). `-30` becomes `330`, `400` becomes `40`. */
export function wrapHue(deg: number): number {
  let wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

export function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n;
}

/** Round to a fixed number of decimals without `toFixed`'s string detour,
 *  and without `-0`. */
export function round(n: number, decimals: number): number {
  let factor = 10 ** decimals;
  let rounded = Math.round(n * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

/** Set one channel, in DISPLAY units, honouring hue wrap and clamping.
 *  Returns a new value; never mutates. */
export function withChannel(
  value: ColorValue,
  index: number,
  display: number,
): ColorValue {
  let spec = spaceSpec(value.space);
  let ch = spec.channels[index];
  if (!ch || !Number.isFinite(display)) {
    return value;
  }
  let bounded = ch.isHue
    ? wrapHue(display)
    : clamp(display, ch.min, ch.max);
  let coords: [number, number, number] = [
    value.coords[0],
    value.coords[1],
    value.coords[2],
  ];
  coords[index] = bounded / ch.scale;
  return { space: value.space, coords, alpha: value.alpha };
}

/** Read one channel in DISPLAY units, rounded for presentation. */
export function channelDisplay(value: ColorValue, index: number): number {
  let ch = spaceSpec(value.space).channels[index];
  if (!ch) {
    return 0;
  }
  return round(numeric(value.coords[index]) * ch.scale, ch.precision);
}

export function withAlpha(value: ColorValue, alpha: number): ColorValue {
  return {
    space: value.space,
    coords: [value.coords[0], value.coords[1], value.coords[2]],
    alpha: clamp(numeric(alpha, 1), 0, 1),
  };
}

/** Arrow-key step for a channel under the current modifiers. Shift is
 *  coarse (×10), Alt is fine (÷10) — the pair every design tool ships and
 *  most colour pickers omit. Both together cancel, which is the least
 *  surprising resolution. */
export function stepFor(
  ch: ChannelSpec,
  modifiers: { shiftKey?: boolean; altKey?: boolean },
): number {
  let step = ch.step;
  if (modifiers.shiftKey) {
    step *= 10;
  }
  if (modifiers.altKey) {
    step /= 10;
  }
  return step;
}

// ── Gamut ────────────────────────────────────────────────────────────────

export interface ClampResult {
  /** The colour after gamut mapping — identical to the input when it was
   *  already inside. */
  readonly color: ColorValue;
  /** Whether mapping actually moved the colour. */
  readonly clamped: boolean;
  /** How far it moved, in ΔE OK (perceptual). 0 when unclamped. Roughly:
   *  under 0.02 is invisible, over 0.05 is a different colour. */
  readonly distance: number;
  /** The gamut it was mapped into. */
  readonly gamut: GamutId;
}

/** Matches colorjs.io's own in-gamut tolerance. A channel at 1.0000001 is
 *  a rounding artefact, not an unshowable colour. */
const GAMUT_EPSILON = 0.000075;

export function inGamutOf(value: ColorValue, gamut: GamutId): boolean {
  try {
    return engine.inGamut(toPlain(value), spaceObject(gamut));
  } catch {
    return true;
  }
}

/**
 * Map a colour into a gamut and REPORT what happened. The reporting is the
 * point — a user who pushes chroma past what sRGB can show should see that
 * it was clamped and to what, rather than watching the swatch quietly stop
 * following the slider.
 *
 * Uses colorjs.io's CSS gamut-mapping algorithm (chroma reduction in OKLCh
 * with a local-clip fallback), which is the same algorithm browsers use for
 * `color()` values they cannot display — so the clamped colour matches what
 * the display would have shown anyway.
 */
export function clampTo(value: ColorValue, gamut: GamutId): ClampResult {
  if (inGamutOf(value, gamut)) {
    return { color: value, clamped: false, distance: 0, gamut };
  }
  try {
    // `toGamut` MUTATES the colour it is handed. Passing the same object
    // twice (once as the mapping input, once as the ΔE reference) silently
    // reports a distance of 0 for every clamp — the exact number this
    // component exists to show. Two independent plain colours, always.
    let original = toPlain(value);
    let mapped = engine.toGamut(toPlain(value), { space: spaceObject(gamut) });
    let distance = engine.deltaE(original, mapped, 'OK');
    return {
      color: fromPlain(
        engine.to(mapped, spaceObject(spaceSpec(value.space).cssId)),
        value.space,
      ),
      clamped: true,
      distance: round(numeric(distance), 4),
      gamut,
    };
  } catch {
    return { color: value, clamped: false, distance: 0, gamut };
  }
}

// ── Serialization: the injection guard ───────────────────────────────────

/** Characters a CSS colour token can legally contain. Asserted on OUTPUT
 *  only — the input gate is the parser, which rejects everything that is
 *  not a colour. */
const CSS_COLOR_CHARS = /^[a-zA-Z0-9#%.,()/\s+-]+$/;

/** Canonical CSS for a colour, built from numbers this module holds. Never
 *  contains caller characters. */
export function serializeColor(
  value: ColorValue,
  options?: { precision?: number; format?: string },
): string {
  try {
    // HSV is a picker model, not a CSS colour syntax. colorjs serializes it
    // as `color(--hsv …)`, a custom-space form no browser accepts — which
    // would silently invalidate every track gradient and every swatch style
    // the moment a caller chose the HSV model. Anything without real CSS
    // syntax goes out as sRGB.
    let source = CSS_NATIVE_SPACES.has(value.space) ? value : toSpace(value, 'srgb');
    let out = engine.serialize(toPlain(source), {
      precision: options?.precision ?? 4,
      ...(options?.format ? { format: options.format } : {}),
    });
    return CSS_COLOR_CHARS.test(out) && !out.includes('--') ? out : 'transparent';
  } catch {
    return 'transparent';
  }
}

/** Spaces CSS can actually express. `hsv` is deliberately absent. */
const CSS_NATIVE_SPACES = new Set<SpaceId>([
  'srgb',
  'hsl',
  'oklch',
  'oklab',
  'p3',
  'rec2020',
]);

/**
 * Hex for a colour, gamut-mapped into sRGB first. Always 6 or 8 digits
 * (never the 3-digit short form) so the string is a stable width in a
 * monospace input and never reflows the field as the user drags.
 */
export function toHex(value: ColorValue): string {
  let mapped = clampTo(toSpace(value, 'srgb'), 'srgb').color;
  let [r, g, b] = mapped.coords;
  let pair = (n: number) =>
    clamp(Math.round(numeric(n) * 255), 0, 255)
      .toString(16)
      .padStart(2, '0');
  let alpha = clamp(numeric(value.alpha, 1), 0, 1);
  let base = `#${pair(r)}${pair(g)}${pair(b)}`;
  return alpha >= 1 ? base : `${base}${pair(alpha)}`;
}

/**
 * **The guard.** Turn anything a caller supplied into a CSS string that is
 * safe to interpolate into an inline style.
 *
 * A string goes through `parseColor` (which rejects every non-colour) and
 * comes back out as a string this module serialized from numbers. A
 * `ColorValue` skips the parse but takes the same serialize path. Anything
 * unparseable becomes `fallback` — never the caller's text.
 *
 * Every inline style in the colour surfaces uses this. There is no other
 * sanctioned way to get a colour into a style attribute.
 */
export function cssFor(
  value: ColorValue | string | undefined | null,
  fallback = 'transparent',
): string {
  let parsed =
    typeof value === 'string' ? parseColor(value) : (value ?? null);
  if (!parsed) {
    return fallback;
  }
  let out = serializeColor(parsed);
  return out === 'transparent' && parsed.alpha > 0 ? fallback : out;
}

/** Same guard, but forced into sRGB hex — for the `<input type='color'>`
 *  fallback and for anywhere a 7-character string is required. */
export function hexFor(
  value: ColorValue | string | undefined | null,
  fallback = '#000000',
): string {
  let parsed = typeof value === 'string' ? parseColor(value) : (value ?? null);
  if (!parsed) {
    return fallback;
  }
  let hex = toHex(withAlpha(parsed, 1));
  return /^#[0-9a-f]{6}$/.test(hex) ? hex : fallback;
}

// ── Announcement ─────────────────────────────────────────────────────────

/** Human text for one channel, for `aria-valuetext`. "Lightness 62%", never
 *  "0.62" — a screen-reader user gets the same sentence a sighted user
 *  reads off the label. */
export function channelValueText(
  spec: SpaceSpec,
  index: number,
  displayValue: number,
): string {
  let ch = spec.channels[index];
  if (!ch) {
    return String(displayValue);
  }
  if (ch.isHue) {
    let word = hueName(displayValue, hueWheel(spec.id));
    return `${ch.label} ${round(displayValue, 0)} degrees, ${word}`;
  }
  let unit = ch.unit ? ch.unit : '';
  return `${ch.label} ${round(displayValue, ch.precision)}${unit}`;
}

/** Hue words on the **sRGB** wheel (HSL/HSV), where 0=red, 60=yellow,
 *  120=green, 180=cyan, 240=blue, 300=magenta. */
const HUE_NAMES_SRGB: readonly [number, string][] = [
  [15, 'red'],
  [45, 'orange'],
  [70, 'yellow'],
  [100, 'yellow green'],
  [160, 'green'],
  [200, 'cyan'],
  [260, 'blue'],
  [290, 'indigo'],
  [320, 'violet'],
  [350, 'magenta'],
  [360, 'red'],
];

/** Hue words on the **OK** wheel, which is a different scale entirely —
 *  sRGB red sits at 29°, yellow at 110°, green at 142°, cyan at 195°, blue
 *  at 264°, magenta at 328°. Naming an OKLCH hue off the sRGB table calls
 *  pure red "orange", which is exactly the kind of quietly wrong
 *  announcement a screen-reader user has no way to catch. */
const HUE_NAMES_OK: readonly [number, string][] = [
  [42, 'red'],
  [82, 'orange'],
  [126, 'yellow'],
  [168, 'green'],
  [230, 'cyan'],
  [296, 'blue'],
  [345, 'magenta'],
  [360, 'red'],
];

/** A colour word for a hue angle. Colour must never be the only channel —
 *  this is what lets a slider announce something a screen reader can use.
 *  `wheel` picks the scale: OK hues and sRGB hues are NOT interchangeable. */
export function hueName(deg: number, wheel: 'ok' | 'srgb' = 'ok'): string {
  let h = wrapHue(deg);
  for (let [limit, name] of wheel === 'ok' ? HUE_NAMES_OK : HUE_NAMES_SRGB) {
    if (h < limit) {
      return name;
    }
  }
  return 'red';
}

/** Which hue wheel a space's hue channel lives on. */
export function hueWheel(space: SpaceId): 'ok' | 'srgb' {
  return space === 'oklch' ? 'ok' : 'srgb';
}

/**
 * A full spoken description of a colour: the hex (readable text, not colour
 * alone), a colour word, and the gamut verdict. This is what the picker's
 * live region announces and what `Swatch` puts in its accessible name.
 */
export function describeColor(value: ColorValue, gamut: GamutId = 'srgb'): string {
  let lch = toSpace(value, 'oklch');
  let lightness = lch.coords[0];
  let chroma = lch.coords[1];
  let tone =
    lightness > 0.92
      ? 'near white'
      : lightness < 0.12
        ? 'near black'
        : chroma < 0.02
          ? 'grey'
          : `${lightnessWord(lightness)} ${hueName(lch.coords[2])}`;
  let alpha = clamp(numeric(value.alpha, 1), 0, 1);
  let opacity = alpha >= 1 ? '' : `, ${Math.round(alpha * 100)}% opaque`;
  let outside = inGamutOf(value, gamut)
    ? ''
    : `, outside ${gamutLabel(gamut)}`;
  return `${toHex(value)}, ${tone}${opacity}${outside}`;
}

function lightnessWord(l: number): string {
  if (l < 0.3) {
    return 'dark';
  }
  if (l < 0.55) {
    return 'medium';
  }
  if (l < 0.78) {
    return 'light';
  }
  return 'pale';
}

export function gamutLabel(gamut: GamutId): string {
  return GAMUTS.find((g) => g.id === gamut)?.label ?? gamut;
}

// ── Contrast ─────────────────────────────────────────────────────────────

/** WCAG 2.1 contrast ratio between two colours, for the picker's own
 *  readout. Returns 1 (no contrast) rather than throwing. */
export function contrastRatio(a: ColorValue, b: ColorValue): number {
  try {
    return round(numeric(engine.contrastWCAG21(toPlain(a), toPlain(b)), 1), 2);
  } catch {
    return 1;
  }
}

/** Black or white ink, whichever reads better ON the given colour. Used for
 *  the value text drawn over a swatch. */
export function inkOn(value: ColorValue): 'black' | 'white' {
  try {
    return engine.getLuminance(toPlain(toSpace(value, 'srgb'))) > 0.42
      ? 'black'
      : 'white';
  } catch {
    return 'black';
  }
}

// ── Gradients ────────────────────────────────────────────────────────────

/** Interpolation spaces CSS gradients accept. The rectangular ones
 *  (`oklab`, `srgb`, `lab`) never take a hue path; the polar ones do. */
export type InterpolationSpace =
  | 'oklab'
  | 'oklch'
  | 'srgb'
  | 'srgb-linear'
  | 'lab'
  | 'lch'
  | 'hsl'
  | 'hwb';

export type HueMethod = 'shorter' | 'longer' | 'increasing' | 'decreasing';

export const INTERPOLATION_SPACES: readonly {
  id: InterpolationSpace;
  label: string;
  polar: boolean;
  note: string;
}[] = [
  { id: 'oklab', label: 'OKLab', polar: false, note: 'Perceptually even. The right default for two arbitrary colours.' },
  { id: 'oklch', label: 'OKLCH', polar: true, note: 'Perceptual, travels around the hue wheel. Vivid mid-tones.' },
  { id: 'srgb', label: 'sRGB', polar: false, note: 'The legacy default. Muddy greys through the middle.' },
  { id: 'srgb-linear', label: 'sRGB linear', polar: false, note: 'Physically correct light mixing. Brighter middles.' },
  { id: 'lab', label: 'CIE Lab', polar: false, note: 'Perceptual, older model. Slight hue drift in blues.' },
  { id: 'lch', label: 'CIE LCH', polar: true, note: 'Polar Lab. Strong hue travel, some lightness wobble.' },
  { id: 'hsl', label: 'HSL', polar: true, note: 'Cheap and cheerful. Not perceptual at all.' },
  { id: 'hwb', label: 'HWB', polar: true, note: 'Hue with white/black mixing.' },
];

export const HUE_METHODS: readonly { id: HueMethod; label: string }[] = [
  { id: 'shorter', label: 'Shorter' },
  { id: 'longer', label: 'Longer' },
  { id: 'increasing', label: 'Increasing' },
  { id: 'decreasing', label: 'Decreasing' },
];

export type GradientKind = 'linear' | 'radial' | 'conic';

export interface GradientStop {
  /** Stable identity for `{{#each key=}}` and for selection. Assigned by
   *  `nextStopId` — a monotonic counter, never `Math.random()`. */
  readonly id: string;
  /** 0–100, along the gradient line. */
  readonly position: number;
  /** A CSS colour string. Always passed through `cssFor` before it reaches
   *  a style attribute. */
  readonly color: string;
}

export interface GradientSpec {
  readonly kind: GradientKind;
  /** Degrees. Linear: the gradient line's direction. Conic: the start
   *  angle. Ignored for radial. */
  readonly angle: number;
  /** Percent from the left/top. Radial and conic only. */
  readonly centerX: number;
  readonly centerY: number;
  readonly interpolation: InterpolationSpace;
  readonly hueMethod: HueMethod;
  readonly stops: readonly GradientStop[];
}

/** Deterministic stop ids. The caller owns the counter (one per editor
 *  instance), which keeps ids stable across re-renders and keeps this
 *  module free of module-level mutable state. */
export function nextStopId(counter: { value: number }): string {
  counter.value += 1;
  return `stop-${counter.value}`;
}

export const DEFAULT_GRADIENT: GradientSpec = {
  kind: 'linear',
  angle: 90,
  centerX: 50,
  centerY: 50,
  interpolation: 'oklab',
  hueMethod: 'shorter',
  stops: [
    { id: 'stop-1', position: 0, color: '#7c3aed' },
    { id: 'stop-2', position: 100, color: '#06b6d4' },
  ],
};

/** Stops in paint order. Sorting here rather than on mutation means a stop
 *  dragged past its neighbour keeps its identity (and its selection) — the
 *  thing every gradient editor that sorts eagerly gets wrong. */
export function sortedStops(spec: GradientSpec): GradientStop[] {
  return [...spec.stops].sort((a, b) => a.position - b.position);
}

/**
 * **Safe** CSS for a gradient. Every stop colour goes through `cssFor`, so a
 * poisoned stop becomes `transparent` rather than a declaration. Every
 * number is clamped and rounded here, so no caller number can escape either
 * (`NaN` would serialize as the literal text "NaN" and break the rule).
 */
export function gradientCss(spec: GradientSpec): string {
  let stops = sortedStops(spec);
  if (stops.length === 0) {
    return 'none';
  }
  let interp = INTERPOLATION_SPACES.find((s) => s.id === spec.interpolation);
  let space = interp ? interp.id : 'oklab';
  let hue = interp?.polar
    ? ` ${HUE_METHODS.find((m) => m.id === spec.hueMethod)?.id ?? 'shorter'} hue`
    : '';
  let inClause = `in ${space}${hue}`;

  let list = stops
    .map(
      (stop) =>
        `${cssFor(stop.color)} ${round(clamp(numeric(stop.position), 0, 100), 2)}%`,
    )
    .join(', ');

  let x = round(clamp(numeric(spec.centerX, 50), 0, 100), 2);
  let y = round(clamp(numeric(spec.centerY, 50), 0, 100), 2);
  let angle = round(wrapHue(numeric(spec.angle)), 2);

  // CSS Images 4 puts the geometry and the interpolation method in the SAME
  // first argument, combined with `||` — `linear-gradient(90deg in oklab,
  // …)`. Emitting them as two comma-separated arguments (which reads
  // naturally and is what a first draft produces) is a parse error, and a
  // parse error in a `background` declaration is INVISIBLE: the browser
  // drops the declaration and the element simply has no gradient.
  if (spec.kind === 'radial') {
    return `radial-gradient(circle at ${x}% ${y}% ${inClause}, ${list})`;
  }
  if (spec.kind === 'conic') {
    // Upstream (figui3) emits `from <angle>` but never `at <x> <y>`, so its
    // conic centre is not editable. Both are emitted here.
    return `conic-gradient(from ${angle}deg at ${x}% ${y}% ${inClause}, ${list})`;
  }
  return `linear-gradient(${angle}deg ${inClause}, ${list})`;
}

/**
 * The colour the gradient already shows at `position` (0–100), interpolated
 * in the gradient's OWN interpolation space and honouring its hue path.
 *
 * This is what a newly inserted stop should be. Upstream (figui3) inserts a
 * hard-coded `#888888` from the "+" button, so adding a stop visibly breaks
 * the ramp and the user has to repair it; sampling means insertion is a
 * no-op on the rendered gradient until the user actually changes something,
 * which is the behaviour every design tool's users expect.
 */
export function sampleGradientAt(
  spec: GradientSpec,
  position: number,
): ColorValue {
  let stops = sortedStops(spec);
  if (stops.length === 0) {
    return BLACK;
  }
  let at = clamp(numeric(position), 0, 100);
  let lower = stops[0]!;
  let upper = stops[stops.length - 1]!;
  for (let i = 0; i < stops.length - 1; i++) {
    if (stops[i]!.position <= at && at <= stops[i + 1]!.position) {
      lower = stops[i]!;
      upper = stops[i + 1]!;
      break;
    }
  }
  if (at <= stops[0]!.position) {
    return parseColor(stops[0]!.color) ?? BLACK;
  }
  if (at >= stops[stops.length - 1]!.position) {
    return parseColor(stops[stops.length - 1]!.color) ?? BLACK;
  }

  let span = upper.position - lower.position;
  let t = span === 0 ? 0 : (at - lower.position) / span;
  let a = parseColor(lower.color) ?? BLACK;
  let b = parseColor(upper.color) ?? BLACK;
  return mixIn(a, b, t, spec.interpolation, spec.hueMethod);
}

/**
 * Interpolate two colours the way a CSS gradient does in `space`: the
 * requested hue path, a powerless hue taking the other stop's, and alpha
 * premultiplied.
 */
export function mixIn(
  from: ColorValue,
  to: ColorValue,
  t: number,
  space: InterpolationSpace,
  hueMethod: HueMethod = 'shorter',
): ColorValue {
  let amount = clamp(numeric(t), 0, 1);
  try {
    // through sRGB so the engine sees an achromatic stop's hue as missing
    let mixed = engine.mix(
      toPlain(toSpace(from, 'srgb')),
      toPlain(toSpace(to, 'srgb')),
      amount,
      { space: spaceObject(space), hue: hueMethod, premultiplied: true },
    );
    let out = engine.to(mixed, spaceObject(spaceSpec(from.space).cssId));
    return fromPlain(out, from.space);
  } catch {
    return from;
  }
}

/** The signed hue travel from `a` to `b` under a CSS hue-interpolation
 *  method. Implements CSS Color 4 §12.4 exactly. */
export function hueDelta(a: number, b: number, method: HueMethod): number {
  let from = wrapHue(a);
  let to = wrapHue(b);
  let diff = to - from;
  if (method === 'increasing') {
    return diff < 0 ? diff + 360 : diff;
  }
  if (method === 'decreasing') {
    return diff > 0 ? diff - 360 : diff;
  }
  if (method === 'longer') {
    if (diff > 0 && diff < 180) {
      return diff - 360;
    }
    if (diff > -180 && diff <= 0) {
      return diff + 360;
    }
    return diff;
  }
  // 'shorter'
  if (diff > 180) {
    return diff - 360;
  }
  if (diff < -180) {
    return diff + 360;
  }
  return diff;
}

/** A flat CSS value for a solid fill, or the gradient — one call site for
 *  "paint this fill". */
export function fillCss(
  fill: { kind: 'solid'; color: string } | { kind: 'gradient'; gradient: GradientSpec },
): string {
  return fill.kind === 'solid' ? cssFor(fill.color) : gradientCss(fill.gradient);
}

// ── Track gradients for sliders ──────────────────────────────────────────

/**
 * A `linear-gradient` showing what one channel does across its range, with
 * every other channel held. Built by sampling real conversions rather than
 * faking it with hard-coded hues, so an OKLCH chroma track actually shows
 * OKLCH chroma — including the point where it leaves the gamut.
 *
 * `steps` is deliberately modest: the browser interpolates between them in
 * sRGB, which is close enough over a 1/steps slice and costs 1/40th of the
 * conversions a per-pixel paint would.
 */
export function channelTrackCss(
  value: ColorValue,
  index: number,
  gamut: GamutId,
  steps = 24,
): string {
  let spec = spaceSpec(value.space);
  let ch = spec.channels[index];
  if (!ch) {
    return 'transparent';
  }
  let parts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    let t = i / steps;
    let display = ch.min + (ch.max - ch.min) * t;
    let sample = clampTo(withAlpha(withChannel(value, index, display), 1), gamut).color;
    parts.push(`${cssFor(sample)} ${round(t * 100, 2)}%`);
  }
  return `linear-gradient(to right, ${parts.join(', ')})`;
}

/** The alpha track: the colour fading over the checkerboard the CSS puts
 *  behind it. */
export function alphaTrackCss(value: ColorValue, gamut: GamutId): string {
  let solid = clampTo(withAlpha(value, 1), gamut).color;
  return `linear-gradient(to right, ${cssFor(withAlpha(solid, 0))}, ${cssFor(solid)})`;
}

// ── The area picker ──────────────────────────────────────────────────────

export interface AreaPaint {
  /** Pixel data, `size × size`, RGBA. */
  readonly data: Uint8ClampedArray;
  readonly size: number;
}

/**
 * Paint the 2D area for a space at a fixed third channel.
 *
 * **No worker, no object URL.** Upstream (hdr-color-input) offloads this to
 * a Worker constructed from a blob URL; in a realm that is an unowned
 * lifetime — the exact hazard the no-unowned-timers law exists for — and it
 * would require inlining the whole colour bundle as a string. A bounded
 * synchronous pass at `size × size` (default 96² = 9216 conversions, ~15ms)
 * inside an `ember-modifier` has no lifetime to leak and no teardown to
 * forget. The canvas is then scaled up by CSS.
 *
 * **Gamut is drawn, not hidden.** Pixels outside `gamut` are painted with
 * their gamut-mapped colour at reduced alpha, so the unreachable region
 * reads as a faded zone with a visible boundary. Most pickers clamp these
 * pixels silently and leave a flat band that lies about what is selectable.
 */
export function paintArea(
  base: ColorValue,
  gamut: GamutId,
  size = 96,
): AreaPaint {
  let spec = spaceSpec(base.space);
  let area = spec.area;
  let model = spaceSpec(area.model);
  let source = toSpace(base, area.model);
  let xCh = model.channels[area.x]!;
  let yCh = model.channels[area.y]!;
  let held = source.coords[area.z];

  let data = new Uint8ClampedArray(size * size * 4);
  let srgb = spaceObject('srgb');
  let gamutSpace = spaceObject(gamut);
  let modelSpace = spaceObject(model.cssId);

  for (let row = 0; row < size; row++) {
    // Top row is the channel maximum — screen coordinates run downward.
    let yValue =
      yCh.max - ((yCh.max - yCh.min) * row) / (size - 1);
    for (let col = 0; col < size; col++) {
      let xValue = xCh.min + ((xCh.max - xCh.min) * col) / (size - 1);
      let coords: [number, number, number] = [0, 0, 0];
      coords[area.x] = xValue / xCh.scale;
      coords[area.y] = yValue / yCh.scale;
      coords[area.z] = held;

      let plain: PlainColor = { space: modelSpace, coords, alpha: 1 };
      let outside = false;
      let rgb: PlainColor;
      try {
        // CLIP, not the CSS gamut-mapping algorithm. `toGamut` runs a
        // binary chroma search per call; at 9216 pixels that measured
        // ~260ms for OKLCH, which is a visible stall on every hue drag.
        // Clipping is ~8ms and is honest here because the out-of-gamut
        // region is drawn faded rather than pretending to be selectable —
        // the pixel only has to say "roughly this colour, unreachable",
        // and the exact mapped value comes from `clampTo` at commit time.
        let target = engine.to(plain, gamutSpace);
        for (let i = 0; i < 3; i++) {
          let v = numeric(target.coords[i]);
          if (v < -GAMUT_EPSILON || v > 1 + GAMUT_EPSILON) {
            outside = true;
          }
          target.coords[i] = clamp(v, 0, 1);
        }
        rgb = gamut === 'srgb' ? target : engine.to(target, srgb);
      } catch {
        rgb = { space: srgb, coords: [0, 0, 0], alpha: 1 };
        outside = true;
      }

      let offset = (row * size + col) * 4;
      data[offset] = clamp(numeric(rgb.coords[0]) * 255, 0, 255);
      data[offset + 1] = clamp(numeric(rgb.coords[1]) * 255, 0, 255);
      data[offset + 2] = clamp(numeric(rgb.coords[2]) * 255, 0, 255);
      data[offset + 3] = outside ? 92 : 255;
    }
  }
  return { data, size };
}

/** Where the thumb sits on the area, as 0–1 fractions (x from left, y from
 *  top). Pure geometry — the inverse of `areaColorAt`. */
export function areaPosition(value: ColorValue): { x: number; y: number } {
  let spec = spaceSpec(value.space);
  let area = spec.area;
  let model = spaceSpec(area.model);
  let source = toSpace(value, area.model);
  let xCh = model.channels[area.x]!;
  let yCh = model.channels[area.y]!;
  let xValue = numeric(source.coords[area.x]) * xCh.scale;
  let yValue = numeric(source.coords[area.y]) * yCh.scale;
  return {
    x: clamp((xValue - xCh.min) / (xCh.max - xCh.min), 0, 1),
    y: clamp(1 - (yValue - yCh.min) / (yCh.max - yCh.min), 0, 1),
  };
}

/** The colour at a fraction of the area, keeping the held channel and the
 *  alpha of `base`. The inverse of `areaPosition`. */
export function areaColorAt(
  base: ColorValue,
  fx: number,
  fy: number,
): ColorValue {
  let spec = spaceSpec(base.space);
  let area = spec.area;
  let model = spaceSpec(area.model);
  let source = toSpace(base, area.model);
  let xCh = model.channels[area.x]!;
  let yCh = model.channels[area.y]!;

  let next = withChannel(
    source,
    area.x,
    xCh.min + (xCh.max - xCh.min) * clamp(fx, 0, 1),
  );
  next = withChannel(
    next,
    area.y,
    yCh.min + (yCh.max - yCh.min) * (1 - clamp(fy, 0, 1)),
  );
  return withAlpha(toSpace(next, base.space), base.alpha);
}

/** The held (slider) channel of the area, in DISPLAY units, plus its spec —
 *  what the slider beside the area drives. */
export function areaHeldChannel(value: ColorValue): {
  spec: ChannelSpec;
  index: number;
  model: SpaceId;
  display: number;
} {
  let area = spaceSpec(value.space).area;
  let model = spaceSpec(area.model);
  let source = toSpace(value, area.model);
  let ch = model.channels[area.z]!;
  return {
    spec: ch,
    index: area.z,
    model: area.model,
    display: round(numeric(source.coords[area.z]) * ch.scale, ch.precision),
  };
}

/** Drive the area's held channel. Round-trips through the area model, so an
 *  OKLCH hue slider under an sRGB picker still moves the hue. */
export function withHeldChannel(
  value: ColorValue,
  display: number,
): ColorValue {
  let area = spaceSpec(value.space).area;
  let source = toSpace(value, area.model);
  let next = withChannel(source, area.z, display);
  return withAlpha(toSpace(next, value.space), value.alpha);
}
