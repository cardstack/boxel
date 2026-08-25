import { computeMediaCacheKey } from './media-cache.ts';

import type { ScreenshotCaptureSpec } from './index.ts';

// The capture spec: every way a screenshot capture can be parameterized,
// shared by the POST /_screenshot-card body and the GET `_screenshot/` URL
// DSL so the two surfaces validate identically and one capture satisfies
// both. The spec's canonical form is what keys the MediaCache ledger, so
// everything here is deliberately strict: two requests that mean the same
// capture must canonicalize to the same string, and a parameter the engine
// cannot honor is refused by name rather than ignored (ignoring would fold
// different intents onto one cache key and serve the wrong image).

export const CAPTURE_FORMATS = ['isolated', 'embedded'] as const;
export type CaptureFormat = (typeof CAPTURE_FORMATS)[number];
export const DEFAULT_CAPTURE_FORMAT: CaptureFormat = 'isolated';

export function isCaptureFormat(value: unknown): value is CaptureFormat {
  return (CAPTURE_FORMATS as readonly unknown[]).includes(value);
}

// The engine's default capture geometry — Puppeteer's launch viewport (no
// `defaultViewport` override), the size every canonical capture renders at.
// Pinned here because the canonical form elides default-valued fields: a
// request spelling these values explicitly must hash identically to one that
// omits them, which only works if both sides agree on what the defaults are.
export const DEFAULT_CAPTURE_VIEWPORT = {
  width: 800,
  height: 600,
  deviceScaleFactor: 1,
} as const;

// The full capture identity: the render format plus the per-capture geometry
// overrides. This is what canonicalizes into the MediaCache ledger key, so a
// custom-geometry capture persists and serves exactly like a format-only one.
export interface CaptureSpec extends ScreenshotCaptureSpec {
  format: CaptureFormat;
}

// The geometry overrides a spec carries beyond the engine defaults — the
// portion of the identity the prerenderer must be told about (`format` rides
// separately on the job args). Null when the spec is all-defaults, matching
// the `ScreenshotCardArgs.captureSpec: ... | null` contract.
export function captureSpecOverrides(
  spec: CaptureSpec,
): ScreenshotCaptureSpec | null {
  let overrides = canonicalOverrides(spec);
  return Object.keys(overrides).length > 0 ? overrides : null;
}

// ---------------------------------------------------------------------------
// ScreenshotCaptureSpec bounds + strict parse — one enforcement point for
// every surface that accepts a spec off the wire (the realm-server's POST
// /_screenshot-card body, the GET `_screenshot/` URL DSL via
// `parseCaptureSpecParams`, and the prerender server's /prerender-screenshot
// route), and the home of the caps the capture path itself enforces for the
// extents only it can know (a fullPage capture's document size).
// ---------------------------------------------------------------------------

// Chromium caps a single texture at 16384px; a viewport wider than 4096px is
// well past any real card layout and mostly a way to force a huge capture.
export const SCREENSHOT_MAX_VIEWPORT_WIDTH = 4096;
export const SCREENSHOT_MAX_VIEWPORT_HEIGHT = 16384;
// A 3× scale already covers retina/hi-dpi; higher just multiplies pixel cost.
export const SCREENSHOT_MAX_DEVICE_SCALE_FACTOR = 3;
// The Chromium single-texture cap the viewport bounds are derived from,
// enforced on *physical* pixels: CSS dimension × deviceScaleFactor. The CSS
// caps alone would admit e.g. a 16384-tall viewport at 3× (~49k physical px).
// A fullPage capture's extent (the document's scroll size) is unknowable at
// parse time, so the capture path checks it against this cap itself.
export const SCREENSHOT_MAX_PHYSICAL_EDGE_PX = 16384;

// Result of validating a raw `captureSpec` value. On success `captureSpec`
// is the normalized spec — null when the value was absent or carried no
// overrides (default-valued fields are elided), so `null` exactly means
// "the canonical capture"; on failure `error` names the offending field.
export type ScreenshotCaptureSpecParse =
  | { captureSpec: ScreenshotCaptureSpec | null; error?: undefined }
  | { captureSpec?: undefined; error: string };

const CAPTURE_SPEC_FIELDS = new Set([
  'viewport',
  'deviceScaleFactor',
  'fullPage',
  'clip',
]);
const CAPTURE_SPEC_VIEWPORT_FIELDS = new Set(['width', 'height']);
const CAPTURE_SPEC_CLIP_FIELDS = new Set(['x', 'y', 'width', 'height']);

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseScreenshotCaptureSpec(
  raw: unknown,
): ScreenshotCaptureSpecParse {
  if (raw === undefined || raw === null) {
    return { captureSpec: null };
  }
  if (!isPlainObject(raw)) {
    return { error: 'captureSpec must be an object' };
  }

  // Strict per the capture-spec contract: an unrecognized field is refused by
  // name rather than dropped — silently dropping a typo'd `fullpage: true`
  // would classify the request as canonical and serve (or persist) the wrong
  // image.
  for (let key of Object.keys(raw)) {
    if (!CAPTURE_SPEC_FIELDS.has(key)) {
      return { error: `captureSpec.${key} is not a supported field` };
    }
  }

  let spec: ScreenshotCaptureSpec = {};

  if (raw.viewport !== undefined) {
    let viewport = raw.viewport;
    if (!isPlainObject(viewport)) {
      return {
        error:
          'captureSpec.viewport must have positive integer width and height',
      };
    }
    for (let key of Object.keys(viewport)) {
      if (!CAPTURE_SPEC_VIEWPORT_FIELDS.has(key)) {
        return {
          error: `captureSpec.viewport.${key} is not a supported field`,
        };
      }
    }
    if (
      !isPositiveInteger(viewport.width) ||
      !isPositiveInteger(viewport.height)
    ) {
      return {
        error:
          'captureSpec.viewport must have positive integer width and height',
      };
    }
    if (viewport.width > SCREENSHOT_MAX_VIEWPORT_WIDTH) {
      return {
        error: `captureSpec.viewport.width must be <= ${SCREENSHOT_MAX_VIEWPORT_WIDTH}`,
      };
    }
    if (viewport.height > SCREENSHOT_MAX_VIEWPORT_HEIGHT) {
      return {
        error: `captureSpec.viewport.height must be <= ${SCREENSHOT_MAX_VIEWPORT_HEIGHT}`,
      };
    }
    spec.viewport = { width: viewport.width, height: viewport.height };
  }

  if (raw.deviceScaleFactor !== undefined) {
    let scale = raw.deviceScaleFactor;
    if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) {
      return {
        error: 'captureSpec.deviceScaleFactor must be a positive number',
      };
    }
    if (scale > SCREENSHOT_MAX_DEVICE_SCALE_FACTOR) {
      return {
        error: `captureSpec.deviceScaleFactor must be <= ${SCREENSHOT_MAX_DEVICE_SCALE_FACTOR}`,
      };
    }
    spec.deviceScaleFactor = scale;
  }

  if (raw.fullPage !== undefined) {
    if (typeof raw.fullPage !== 'boolean') {
      return { error: 'captureSpec.fullPage must be a boolean' };
    }
    spec.fullPage = raw.fullPage;
  }

  if (raw.clip !== undefined) {
    let clip = raw.clip;
    if (!isPlainObject(clip)) {
      return {
        error:
          'captureSpec.clip must have non-negative x/y and positive integer width/height',
      };
    }
    for (let key of Object.keys(clip)) {
      if (!CAPTURE_SPEC_CLIP_FIELDS.has(key)) {
        return { error: `captureSpec.clip.${key} is not a supported field` };
      }
    }
    if (
      typeof clip.x !== 'number' ||
      typeof clip.y !== 'number' ||
      !Number.isFinite(clip.x) ||
      !Number.isFinite(clip.y) ||
      clip.x < 0 ||
      clip.y < 0 ||
      !isPositiveInteger(clip.width) ||
      !isPositiveInteger(clip.height)
    ) {
      return {
        error:
          'captureSpec.clip must have non-negative x/y and positive integer width/height',
      };
    }
    // The clip's extent is bounded by the same caps as the viewport whether
    // or not one was sent: Puppeteer captures beyond the viewport by default
    // (`captureBeyondViewport`), so an unbounded clip would be a way around
    // the viewport cost caps.
    if (clip.x + clip.width > SCREENSHOT_MAX_VIEWPORT_WIDTH) {
      return {
        error: `captureSpec.clip x + width must be <= ${SCREENSHOT_MAX_VIEWPORT_WIDTH}`,
      };
    }
    if (clip.y + clip.height > SCREENSHOT_MAX_VIEWPORT_HEIGHT) {
      return {
        error: `captureSpec.clip y + height must be <= ${SCREENSHOT_MAX_VIEWPORT_HEIGHT}`,
      };
    }
    spec.clip = {
      x: clip.x,
      y: clip.y,
      width: clip.width,
      height: clip.height,
    };
  }

  if (spec.fullPage && spec.clip) {
    return {
      error: 'captureSpec cannot set both fullPage and clip',
    };
  }

  // Tighter containment when the caller declared a viewport: the layout was
  // requested at that size, so a clip past its edge is caller error — the
  // region would be unstyled overflow or blank area past the document edge.
  // Checked before default-elision so an explicitly-declared default-sized
  // viewport still constrains its clip.
  if (spec.clip && spec.viewport) {
    if (spec.clip.x + spec.clip.width > spec.viewport.width) {
      return {
        error: 'captureSpec.clip exceeds captureSpec.viewport.width',
      };
    }
    if (spec.clip.y + spec.clip.height > spec.viewport.height) {
      return {
        error: 'captureSpec.clip exceeds captureSpec.viewport.height',
      };
    }
  }

  // The CSS caps compose with the scale factor: what Chromium renders is
  // physical pixels, and each capture edge must stay under the texture cap.
  // fullPage's extent (the document scroll size) isn't knowable here; the
  // capture path enforces the same cap on it at capture time.
  let effectiveScale = spec.deviceScaleFactor ?? 1;
  if (spec.viewport) {
    if (
      spec.viewport.width * effectiveScale >
      SCREENSHOT_MAX_PHYSICAL_EDGE_PX
    ) {
      return {
        error: `captureSpec.viewport.width × deviceScaleFactor must be <= ${SCREENSHOT_MAX_PHYSICAL_EDGE_PX} physical pixels`,
      };
    }
    if (
      spec.viewport.height * effectiveScale >
      SCREENSHOT_MAX_PHYSICAL_EDGE_PX
    ) {
      return {
        error: `captureSpec.viewport.height × deviceScaleFactor must be <= ${SCREENSHOT_MAX_PHYSICAL_EDGE_PX} physical pixels`,
      };
    }
  }
  if (spec.clip) {
    if (spec.clip.width * effectiveScale > SCREENSHOT_MAX_PHYSICAL_EDGE_PX) {
      return {
        error: `captureSpec.clip.width × deviceScaleFactor must be <= ${SCREENSHOT_MAX_PHYSICAL_EDGE_PX} physical pixels`,
      };
    }
    if (spec.clip.height * effectiveScale > SCREENSHOT_MAX_PHYSICAL_EDGE_PX) {
      return {
        error: `captureSpec.clip.height × deviceScaleFactor must be <= ${SCREENSHOT_MAX_PHYSICAL_EDGE_PX} physical pixels`,
      };
    }
  }

  // A spec whose every field matched an engine default normalizes to null:
  // it means the canonical capture, and null is what consumers key that
  // classification on.
  let normalized = canonicalOverrides(spec);
  return {
    captureSpec: Object.keys(normalized).length > 0 ? normalized : null,
  };
}

// The default-elision rule, applied everywhere a spec is normalized: a field
// spelling out an engine default (the 800×600 viewport, scale 1, fullPage
// false) is dropped, so equal capture intents canonicalize — and hash —
// identically however they were spelled.
function canonicalOverrides(
  spec: ScreenshotCaptureSpec,
): ScreenshotCaptureSpec {
  let out: ScreenshotCaptureSpec = {};
  if (
    spec.viewport &&
    !(
      spec.viewport.width === DEFAULT_CAPTURE_VIEWPORT.width &&
      spec.viewport.height === DEFAULT_CAPTURE_VIEWPORT.height
    )
  ) {
    out.viewport = { width: spec.viewport.width, height: spec.viewport.height };
  }
  if (
    spec.deviceScaleFactor != null &&
    spec.deviceScaleFactor !== DEFAULT_CAPTURE_VIEWPORT.deviceScaleFactor
  ) {
    out.deviceScaleFactor = spec.deviceScaleFactor;
  }
  if (spec.fullPage) {
    out.fullPage = true;
  }
  if (spec.clip) {
    out.clip = {
      x: spec.clip.x,
      y: spec.clip.y,
      width: spec.clip.width,
      height: spec.clip.height,
    };
  }
  return out;
}

// The DSL's parameter surface grows with the capture engine; these names are
// reserved for the engine capabilities the project's URL grammar assigns
// them, and refused (never ignored) while the engine lacks them.
const RESERVED_CAPTURE_PARAMS = new Set(['envelope', 'target']);
const CAPTURE_PARAMS = new Set([
  'format',
  'viewport',
  'dsf',
  'fullPage',
  'clip',
]);

export type CaptureSpecParseResult =
  | { spec: CaptureSpec }
  | { error: { field: string; message: string } };

// The URL grammar for the geometry params — each is the flat spelling of the
// POST body's field, so the two surfaces express one identity:
//   viewport=1280x800      ⇔ captureSpec.viewport {width, height}
//   dsf=2                  ⇔ captureSpec.deviceScaleFactor
//   fullPage=true          ⇔ captureSpec.fullPage
//   clip=0,0,400x300       ⇔ captureSpec.clip {x, y, width, height}
const VIEWPORT_PARAM_PATTERN = /^(\d+)x(\d+)$/;

// Maps a shared-validator error (spelled in POST-body field terms) onto the
// GET param that carried the offending value, keeping one error wording
// across both surfaces while still naming the field in the caller's own
// grammar.
function captureParamForSpecError(message: string): string {
  // clip before viewport: the containment errors name both fields, and the
  // clip is the value that broke the constraint.
  if (message.includes('captureSpec.clip')) {
    return 'clip';
  }
  if (message.includes('captureSpec.viewport')) {
    return 'viewport';
  }
  if (message.includes('captureSpec.deviceScaleFactor')) {
    return 'dsf';
  }
  if (message.includes('fullPage')) {
    return 'fullPage';
  }
  return 'clip';
}

// Parses the flat, unprefixed query params of a `_screenshot/` request into
// a spec. Strict on principle (see the module comment): unknown and
// reserved params, repeated params, and out-of-range values are each a 400
// naming the offending field. Bounds validation is the same
// `parseScreenshotCaptureSpec` the POST body runs, so the two surfaces
// accept and refuse identical geometry with identical wording. `name=`
// addresses a declared screenshot, a different addressing form entirely —
// the route splits it off before calling this.
export function parseCaptureSpecParams(
  searchParams: URLSearchParams,
): CaptureSpecParseResult {
  for (let key of new Set(searchParams.keys())) {
    if (CAPTURE_PARAMS.has(key)) {
      if (searchParams.getAll(key).length > 1) {
        return {
          error: { field: key, message: `${key} may only be given once` },
        };
      }
      continue;
    }
    let message = RESERVED_CAPTURE_PARAMS.has(key)
      ? `parameter "${key}" is not supported by this capture engine`
      : `unsupported parameter "${key}"`;
    return { error: { field: key, message } };
  }
  let format = searchParams.get('format') ?? DEFAULT_CAPTURE_FORMAT;
  if (!isCaptureFormat(format)) {
    // Same wording as the POST /_screenshot-card validation.
    return {
      error: {
        field: 'format',
        message: 'format must be "isolated" or "embedded"',
      },
    };
  }

  // Translate the URL grammar into the POST body's shape, then run the one
  // shared validator over it. Grammar failures (a malformed value) are named
  // here; bounds failures come back from the validator in its own wording.
  let raw: Record<string, unknown> = {};
  let viewport = searchParams.get('viewport');
  if (viewport !== null) {
    let match = VIEWPORT_PARAM_PATTERN.exec(viewport);
    if (!match) {
      return {
        error: {
          field: 'viewport',
          message:
            'viewport must be "<width>x<height>" with positive integers (e.g. viewport=1280x800)',
        },
      };
    }
    raw.viewport = { width: Number(match[1]), height: Number(match[2]) };
  }
  let dsf = searchParams.get('dsf');
  if (dsf !== null) {
    let scale = Number(dsf);
    if (dsf.trim() === '' || !Number.isFinite(scale)) {
      return {
        error: {
          field: 'dsf',
          message: 'dsf must be a positive number (e.g. dsf=2)',
        },
      };
    }
    raw.deviceScaleFactor = scale;
  }
  let fullPage = searchParams.get('fullPage');
  if (fullPage !== null) {
    if (fullPage !== 'true' && fullPage !== 'false') {
      return {
        error: {
          field: 'fullPage',
          message: 'fullPage must be "true" or "false"',
        },
      };
    }
    raw.fullPage = fullPage === 'true';
  }
  let clip = searchParams.get('clip');
  if (clip !== null) {
    // x and y parse as `Number` rather than by pattern: the POST body admits
    // any non-negative finite value, whose canonical `String` form can be
    // scientific notation — the served URL must reparse whatever the shared
    // validator admitted. Width and height are positive integers, so their
    // spelling is always plain digits.
    let clipError = {
      error: {
        field: 'clip',
        message:
          'clip must be "<x>,<y>,<width>x<height>" with non-negative x/y and positive integer width/height (e.g. clip=0,0,400x300)',
      },
    };
    let parts = clip.split(',');
    if (parts.length !== 3) {
      return clipError;
    }
    let [xPart, yPart, extentPart] = parts;
    let extentMatch = /^(\d+)x(\d+)$/.exec(extentPart);
    let x = Number(xPart);
    let y = Number(yPart);
    if (
      xPart.trim() === '' ||
      yPart.trim() === '' ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !extentMatch
    ) {
      return clipError;
    }
    raw.clip = {
      x,
      y,
      width: Number(extentMatch[1]),
      height: Number(extentMatch[2]),
    };
  }

  let parsed = parseScreenshotCaptureSpec(raw);
  if (parsed.error) {
    return {
      error: {
        field: captureParamForSpecError(parsed.error),
        message: parsed.error,
      },
    };
  }
  return { spec: { format, ...(parsed.captureSpec ?? {}) } };
}

// The canonical serialization: keys sorted (nested objects included),
// default-valued fields elided — so the all-defaults spec is `{}` however it
// was spelled, and any two requests meaning the same capture hash
// identically.
export function canonicalCaptureSpecString(spec: CaptureSpec): string {
  let canonical: Record<string, unknown> = {};
  if (spec.format !== DEFAULT_CAPTURE_FORMAT) {
    canonical.format = spec.format;
  }
  let overrides = canonicalOverrides(spec);
  if (overrides.viewport) {
    canonical.viewport = sortKeys(overrides.viewport);
  }
  if (overrides.deviceScaleFactor != null) {
    canonical.deviceScaleFactor = overrides.deviceScaleFactor;
  }
  if (overrides.fullPage) {
    canonical.fullPage = true;
  }
  if (overrides.clip) {
    canonical.clip = sortKeys(overrides.clip);
  }
  return JSON.stringify(sortKeys(canonical));
}

function sortKeys<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)),
  ) as T;
}

// The ledger key component for a spec: the hash of its canonical form (the
// same sha256-hex the store uses for content addresses, though this one
// keys intent rather than bytes).
export async function captureSpecHash(spec: CaptureSpec): Promise<string> {
  return await computeMediaCacheKey(
    new TextEncoder().encode(canonicalCaptureSpecString(spec)),
  );
}

// The spec's canonical query string — '' for the all-defaults spec — so a
// served URL round-trips through `parseCaptureSpecParams` back to the same
// canonical form. Numbers serialize through `String`, which is already the
// shortest round-trip form (`2`, not `2.0`), matching how `Number` reparses
// them.
export function canonicalCaptureSpecQuery(spec: CaptureSpec): string {
  let searchParams = new URLSearchParams();
  if (spec.format !== DEFAULT_CAPTURE_FORMAT) {
    searchParams.set('format', spec.format);
  }
  let overrides = canonicalOverrides(spec);
  if (overrides.viewport) {
    searchParams.set(
      'viewport',
      `${overrides.viewport.width}x${overrides.viewport.height}`,
    );
  }
  if (overrides.deviceScaleFactor != null) {
    searchParams.set('dsf', String(overrides.deviceScaleFactor));
  }
  if (overrides.fullPage) {
    searchParams.set('fullPage', 'true');
  }
  if (overrides.clip) {
    searchParams.set(
      'clip',
      `${overrides.clip.x},${overrides.clip.y},${overrides.clip.width}x${overrides.clip.height}`,
    );
  }
  let qs = searchParams.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

// The durable served URL for one capture of one instance: the platform's
// only public screenshot URL form. A re-capture changes what this URL
// serves, never the URL itself.
export function screenshotURLFor({
  realmURL,
  instanceLocalPath,
  spec,
}: {
  realmURL: string;
  instanceLocalPath: string;
  spec: CaptureSpec;
}): string {
  return `${realmURL}_screenshot/${instanceLocalPath}${canonicalCaptureSpecQuery(spec)}`;
}
