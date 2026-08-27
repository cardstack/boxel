import { computeMediaCacheKey } from './media-cache.ts';

import type {
  ScreenshotCaptureEntry,
  ScreenshotCaptureOverrides,
  ScreenshotCaptureSpec,
} from './index.ts';

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

export interface CaptureSpec {
  format: CaptureFormat;
}

// Whether a screenshot job's per-capture overrides (viewport / scale /
// fullPage / clip) make it a non-canonical render. The canonical capture
// identity (and thus the MediaCache ledger and job coalescing) cannot
// represent these overrides, so everything keyed on that identity must treat
// an override-carrying capture as outside it: never persisted under a ledger
// key, never joined to (or by) a canonical twin.
export function hasCaptureSpecOverrides(
  captureSpec: ScreenshotCaptureSpec | null | undefined,
): boolean {
  return !!captureSpec && Object.keys(captureSpec).length > 0;
}

// ---------------------------------------------------------------------------
// ScreenshotCaptureSpec bounds + strict parse — one enforcement point for
// every surface that accepts a spec off the wire (the realm-server's POST
// /_screenshot-card body and the prerender server's /prerender-screenshot
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

// Cap on batch size. Every entry captures on the same settled render, so this
// bounds only the number of screenshots taken after one settle, not renders.
// Sized so a full batch finishes within the handler's sync-wait budget
// (`SCREENSHOT_SYNC_WAIT_BUDGET_MS`, 25s): a batch is capture-only (persist:
// null), so a batch that misses the sync wait is discarded on the 503 and the
// retry re-renders from scratch — nothing resumes. Budget: one shared settle +
// the initial paint wait, then per entry a bounded viewport-switch paint wait
// (`VIEWPORT_SWITCH_PAINT_WAIT_MS`, 2s) + screenshot. Deliberately conservative;
// the ceiling can rise once incremental persistence lets a batch resume instead
// of discard.
export const SCREENSHOT_MAX_CAPTURES = 12;

// A `target` is a CSS selector, not an arbitrary program: bound its length so a
// pathological selector can't be smuggled through. It needs no XPath guard —
// the capture path runs it through `document.querySelector`, which executes
// only CSS.
export const SCREENSHOT_MAX_TARGET_SELECTOR_LENGTH = 1024;

// Result of validating a raw `captureSpec` value. On success `captureSpec`
// is the normalized spec — null when the value was absent or carried no
// overrides (default-valued fields are elided), so `null` exactly means
// "the canonical capture"; a batch spec normalizes to `{ captures }` with
// the singular batch-wide defaults folded into every entry, so the capture
// path iterates self-contained specs. On failure `error` names the
// offending field.
export type ScreenshotCaptureSpecParse =
  | { captureSpec: ScreenshotCaptureSpec | null; error?: undefined }
  | { captureSpec?: undefined; error: string };

const CAPTURE_SPEC_FIELDS = new Set([
  'viewport',
  'deviceScaleFactor',
  'fullPage',
  'clip',
  'target',
  'captures',
]);
const CAPTURE_ENTRY_FIELDS = new Set([
  'name',
  'viewport',
  'deviceScaleFactor',
  'fullPage',
  'clip',
  'target',
]);
const CAPTURE_SPEC_VIEWPORT_FIELDS = new Set(['width', 'height']);
const CAPTURE_SPEC_CLIP_FIELDS = new Set(['x', 'y', 'width', 'height']);

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type OverrideFieldsParse =
  | { overrides: ScreenshotCaptureOverrides; error?: undefined }
  | { overrides?: undefined; error: string };

// Per-field shape + bounds validation for the override fields present on
// `raw`, with `path`-prefixed errors ("captureSpec" or
// "captureSpec.captures[i]"). Values are kept verbatim — default elision
// happens after the batch merge, so an entry can explicitly override a
// batch-wide default back to the engine default. Cross-field constraints
// (fullPage×clip, clip within viewport, physical-pixel caps) run against
// the merged effective spec in `checkMergedOverrides`.
function parseOverrideFields(
  raw: Record<string, unknown>,
  path: string,
): OverrideFieldsParse {
  let overrides: ScreenshotCaptureOverrides = {};

  if (raw.viewport !== undefined) {
    let viewport = raw.viewport;
    if (!isPlainObject(viewport)) {
      return {
        error: `${path}.viewport must have positive integer width and height`,
      };
    }
    for (let key of Object.keys(viewport)) {
      if (!CAPTURE_SPEC_VIEWPORT_FIELDS.has(key)) {
        return {
          error: `${path}.viewport.${key} is not a supported field`,
        };
      }
    }
    if (
      !isPositiveInteger(viewport.width) ||
      !isPositiveInteger(viewport.height)
    ) {
      return {
        error: `${path}.viewport must have positive integer width and height`,
      };
    }
    if (viewport.width > SCREENSHOT_MAX_VIEWPORT_WIDTH) {
      return {
        error: `${path}.viewport.width must be <= ${SCREENSHOT_MAX_VIEWPORT_WIDTH}`,
      };
    }
    if (viewport.height > SCREENSHOT_MAX_VIEWPORT_HEIGHT) {
      return {
        error: `${path}.viewport.height must be <= ${SCREENSHOT_MAX_VIEWPORT_HEIGHT}`,
      };
    }
    overrides.viewport = { width: viewport.width, height: viewport.height };
  }

  if (raw.deviceScaleFactor !== undefined) {
    let scale = raw.deviceScaleFactor;
    if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) {
      return {
        error: `${path}.deviceScaleFactor must be a positive number`,
      };
    }
    if (scale > SCREENSHOT_MAX_DEVICE_SCALE_FACTOR) {
      return {
        error: `${path}.deviceScaleFactor must be <= ${SCREENSHOT_MAX_DEVICE_SCALE_FACTOR}`,
      };
    }
    overrides.deviceScaleFactor = scale;
  }

  if (raw.fullPage !== undefined) {
    if (typeof raw.fullPage !== 'boolean') {
      return { error: `${path}.fullPage must be a boolean` };
    }
    overrides.fullPage = raw.fullPage;
  }

  if (raw.clip !== undefined) {
    let clip = raw.clip;
    // `clip: null` is an explicit unset — the only way a batch entry can drop a
    // batch-wide clip default, since object-valued fields have no scalar
    // "back to default" spelling the way fullPage/deviceScaleFactor do. It
    // elides away after the merge, so a normalized spec never carries it.
    if (clip === null) {
      overrides.clip = null;
    } else if (!isPlainObject(clip)) {
      return {
        error: `${path}.clip must have non-negative x/y and positive integer width/height`,
      };
    } else {
      for (let key of Object.keys(clip)) {
        if (!CAPTURE_SPEC_CLIP_FIELDS.has(key)) {
          return { error: `${path}.clip.${key} is not a supported field` };
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
          error: `${path}.clip must have non-negative x/y and positive integer width/height`,
        };
      }
      // The clip's extent is bounded by the same caps as the viewport whether
      // or not one was sent: Puppeteer captures beyond the viewport by default
      // (`captureBeyondViewport`), so an unbounded clip would be a way around
      // the viewport cost caps.
      if (clip.x + clip.width > SCREENSHOT_MAX_VIEWPORT_WIDTH) {
        return {
          error: `${path}.clip x + width must be <= ${SCREENSHOT_MAX_VIEWPORT_WIDTH}`,
        };
      }
      if (clip.y + clip.height > SCREENSHOT_MAX_VIEWPORT_HEIGHT) {
        return {
          error: `${path}.clip y + height must be <= ${SCREENSHOT_MAX_VIEWPORT_HEIGHT}`,
        };
      }
      overrides.clip = {
        x: clip.x,
        y: clip.y,
        width: clip.width,
        height: clip.height,
      };
    }
  }

  if (raw.target !== undefined) {
    let target = raw.target;
    // `target: null` is an explicit unset, mirroring `clip: null` — the only
    // way a batch entry drops a batch-wide target default. It elides after the
    // merge, so a normalized spec never carries null.
    if (target === null) {
      overrides.target = null;
    } else if (typeof target !== 'string' || target.trim().length === 0) {
      return { error: `${path}.target must be a non-empty string` };
    } else if (target.length > SCREENSHOT_MAX_TARGET_SELECTOR_LENGTH) {
      return {
        error: `${path}.target must be at most ${SCREENSHOT_MAX_TARGET_SELECTOR_LENGTH} characters`,
      };
    } else {
      // No XPath guard: the capture path passes `target` to `page.$`
      // (`document.querySelector`), which can only execute CSS, so an
      // XPath-shaped string already dead-ends as a named "invalid selector"
      // capture error. A syntactic `//` check would instead reject valid CSS
      // whose attribute value happens to contain `//` (e.g. `a[href="https://…"]`).
      overrides.target = target;
    }
  }

  return { overrides };
}

// Cross-field checks against a fully-merged effective spec.
function checkMergedOverrides(
  spec: ScreenshotCaptureOverrides,
  path: string,
): string | undefined {
  if (spec.fullPage && spec.clip) {
    return `${path} cannot set both fullPage and clip`;
  }

  // A `target` is an element-handle screenshot: it crops to one element and
  // honors neither a region clip nor a full-page capture, so combining them is
  // a contradiction rather than a composition.
  if (spec.target && spec.clip) {
    return `${path} cannot set both target and clip`;
  }
  if (spec.target && spec.fullPage) {
    return `${path} cannot set both target and fullPage`;
  }

  // Tighter containment when a viewport was declared: the layout was
  // requested at that size, so a clip past its edge is caller error — the
  // region would be unstyled overflow or blank area past the document edge.
  if (spec.clip && spec.viewport) {
    if (spec.clip.x + spec.clip.width > spec.viewport.width) {
      return `${path}.clip exceeds the viewport width`;
    }
    if (spec.clip.y + spec.clip.height > spec.viewport.height) {
      return `${path}.clip exceeds the viewport height`;
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
      return `${path}.viewport.width × deviceScaleFactor must be <= ${SCREENSHOT_MAX_PHYSICAL_EDGE_PX} physical pixels`;
    }
    if (
      spec.viewport.height * effectiveScale >
      SCREENSHOT_MAX_PHYSICAL_EDGE_PX
    ) {
      return `${path}.viewport.height × deviceScaleFactor must be <= ${SCREENSHOT_MAX_PHYSICAL_EDGE_PX} physical pixels`;
    }
  }
  if (spec.clip) {
    if (spec.clip.width * effectiveScale > SCREENSHOT_MAX_PHYSICAL_EDGE_PX) {
      return `${path}.clip.width × deviceScaleFactor must be <= ${SCREENSHOT_MAX_PHYSICAL_EDGE_PX} physical pixels`;
    }
    if (spec.clip.height * effectiveScale > SCREENSHOT_MAX_PHYSICAL_EDGE_PX) {
      return `${path}.clip.height × deviceScaleFactor must be <= ${SCREENSHOT_MAX_PHYSICAL_EDGE_PX} physical pixels`;
    }
  }
  return undefined;
}

// Engine defaults are elided so equal capture intents key identically:
// `{ deviceScaleFactor: 1 }` and `{ fullPage: false }` mean the same capture
// as no spec at all. Runs after the batch merge, so an entry that explicitly
// sets a field back to its default wins over a batch-wide override first.
function elideDefaults(
  spec: ScreenshotCaptureOverrides,
): ScreenshotCaptureOverrides {
  let out: ScreenshotCaptureOverrides = {};
  if (spec.viewport) {
    out.viewport = spec.viewport;
  }
  if (spec.deviceScaleFactor !== undefined && spec.deviceScaleFactor !== 1) {
    out.deviceScaleFactor = spec.deviceScaleFactor;
  }
  if (spec.fullPage) {
    out.fullPage = true;
  }
  if (spec.clip) {
    out.clip = spec.clip;
  }
  if (spec.target) {
    out.target = spec.target;
  }
  return out;
}

// Merge an entry's overrides onto the singular batch-wide defaults, per field.
function mergeOverrides(
  base: ScreenshotCaptureOverrides,
  entry: ScreenshotCaptureOverrides,
): ScreenshotCaptureOverrides {
  let merged: ScreenshotCaptureOverrides = {};
  let viewport = entry.viewport ?? base.viewport;
  if (viewport) {
    merged.viewport = viewport;
  }
  let deviceScaleFactor = entry.deviceScaleFactor ?? base.deviceScaleFactor;
  if (deviceScaleFactor !== undefined) {
    merged.deviceScaleFactor = deviceScaleFactor;
  }
  let fullPage = entry.fullPage ?? base.fullPage;
  if (fullPage !== undefined) {
    merged.fullPage = fullPage;
  }
  // An entry that sets `clip` at all (including `clip: null` to unset) wins over
  // the batch-wide default; only an absent entry clip inherits the base. `??`
  // would wrongly treat `clip: null` as "inherit".
  let clip = entry.clip !== undefined ? entry.clip : base.clip;
  if (clip) {
    merged.clip = clip;
  }
  // Same "explicit-wins, null-unsets" rule as clip.
  let target = entry.target !== undefined ? entry.target : base.target;
  if (target) {
    merged.target = target;
  }
  return merged;
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

  let singular = parseOverrideFields(raw, 'captureSpec');
  if (singular.error !== undefined) {
    return { error: singular.error };
  }

  if (raw.captures === undefined) {
    let crossError = checkMergedOverrides(singular.overrides, 'captureSpec');
    if (crossError !== undefined) {
      return { error: crossError };
    }
    let spec: ScreenshotCaptureSpec = elideDefaults(singular.overrides);
    // A spec whose every field matched an engine default normalizes to null:
    // it means the canonical capture, and null is what consumers key that
    // classification on.
    return { captureSpec: Object.keys(spec).length > 0 ? spec : null };
  }

  // Batch: up to SCREENSHOT_MAX_CAPTURES named entries, each capturing the
  // same settled render. The singular fields act as batch-wide defaults and
  // are folded into every entry, so the normalized spec's entries are
  // self-contained. A batch spec always has overrides (the `captures` key),
  // so it can never classify as canonical.
  if (!Array.isArray(raw.captures)) {
    return { error: 'captureSpec.captures must be an array' };
  }
  if (raw.captures.length === 0) {
    return { error: 'captureSpec.captures must not be empty' };
  }
  if (raw.captures.length > SCREENSHOT_MAX_CAPTURES) {
    return {
      error: `captureSpec.captures must have at most ${SCREENSHOT_MAX_CAPTURES} entries`,
    };
  }

  let seenNames = new Set<string>();
  let entries: ScreenshotCaptureEntry[] = [];
  for (let i = 0; i < raw.captures.length; i++) {
    let rawEntry: unknown = raw.captures[i];
    let path = `captureSpec.captures[${i}]`;
    if (!isPlainObject(rawEntry)) {
      return { error: `${path} must be an object` };
    }
    for (let key of Object.keys(rawEntry)) {
      if (!CAPTURE_ENTRY_FIELDS.has(key)) {
        return { error: `${path}.${key} is not a supported field` };
      }
    }
    if (
      typeof rawEntry.name !== 'string' ||
      rawEntry.name.trim().length === 0
    ) {
      return { error: `${path}.name must be a non-empty string` };
    }
    let name = rawEntry.name;
    if (seenNames.has(name)) {
      return { error: `${path}.name "${name}" is duplicated` };
    }
    seenNames.add(name);

    let parsed = parseOverrideFields(rawEntry, path);
    if (parsed.error !== undefined) {
      return { error: parsed.error };
    }
    let merged = mergeOverrides(singular.overrides, parsed.overrides);
    let crossError = checkMergedOverrides(merged, path);
    if (crossError !== undefined) {
      return { error: crossError };
    }
    entries.push({ name, ...elideDefaults(merged) });
  }

  return { captureSpec: { captures: entries } };
}

// The DSL's parameter surface grows with the capture engine; these names are
// reserved for the engine capabilities the project's URL grammar assigns
// them, and refused (never ignored) while the engine lacks them.
const RESERVED_CAPTURE_PARAMS = new Set([
  'envelope',
  'viewport',
  'dsf',
  'fullPage',
  'clip',
  'target',
]);

export type CaptureSpecParseResult =
  | { spec: CaptureSpec }
  | { error: { field: string; message: string } };

// Parses the flat, unprefixed query params of a `_screenshot/` request into
// a spec. Strict on principle (see the module comment): unknown and
// reserved params, repeated params, and out-of-range values are each a 400
// naming the offending field. `name=` addresses a declared screenshot, a
// different addressing form entirely — the route splits it off before
// calling this.
export function parseCaptureSpecParams(
  searchParams: URLSearchParams,
): CaptureSpecParseResult {
  for (let key of new Set(searchParams.keys())) {
    if (key === 'format') {
      continue;
    }
    let message = RESERVED_CAPTURE_PARAMS.has(key)
      ? `parameter "${key}" is not supported by this capture engine`
      : `unsupported parameter "${key}"`;
    return { error: { field: key, message } };
  }
  if (searchParams.getAll('format').length > 1) {
    return {
      error: { field: 'format', message: 'format may only be given once' },
    };
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
  return { spec: { format } };
}

// The canonical serialization: keys sorted, default-valued fields elided —
// so the all-defaults spec is `{}` however it was spelled, and any two
// requests meaning the same capture hash identically.
export function canonicalCaptureSpecString(spec: CaptureSpec): string {
  let canonical: Record<string, unknown> = {};
  if (spec.format !== DEFAULT_CAPTURE_FORMAT) {
    canonical.format = spec.format;
  }
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(canonical).sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
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
// canonical form.
export function canonicalCaptureSpecQuery(spec: CaptureSpec): string {
  let searchParams = new URLSearchParams();
  if (spec.format !== DEFAULT_CAPTURE_FORMAT) {
    searchParams.set('format', spec.format);
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
