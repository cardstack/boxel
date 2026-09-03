import { computeMediaCacheKey } from './media-cache.ts';

import type {
  ScreenshotCaptureEntry,
  ScreenshotCaptureOverrides,
  ScreenshotCaptureSpec,
} from './index.ts';

// Card formats a screenshot can be captured in. `isolated`/`embedded` fill
// the viewport; `fitted` renders into a parent-owned box and so requires an
// `envelope`. Distinct from CAPTURE_FORMATS below, which is the canonical
// (ledger/GET-DSL) serving contract and stays viewport-filling only.
export const SCREENSHOT_FORMATS = ['isolated', 'embedded', 'fitted'] as const;
export type ScreenshotFormat = (typeof SCREENSHOT_FORMATS)[number];

export function isScreenshotFormat(value: unknown): value is ScreenshotFormat {
  return (SCREENSHOT_FORMATS as readonly unknown[]).includes(value);
}

// Formats whose card fills a parent-owned box rather than the viewport, and
// so require an `envelope` to lay out. `isolated`/`embedded` fill the
// viewport and must NOT be given an envelope.
const ENVELOPE_FORMATS: readonly ScreenshotFormat[] = ['fitted'];

// ---------------------------------------------------------------------------
// Declared screenshots (`static screenshots` on CardDef/FileDef) — the name
// grammar and format roster shared by the declaration reader in
// packages/base/card-api and the realm's `_screenshot/…?name=` route.
// ---------------------------------------------------------------------------

// A declared screenshot's name addresses the capture in a URL, so it is
// constrained to a charset that survives a URL path segment with no
// percent-encoding: a leading letter or digit, then letters, digits, `-`,
// or `_`.
export const SCREENSHOT_NAME_MAX_LENGTH = 64;
export const SCREENSHOT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export function isValidScreenshotName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= SCREENSHOT_NAME_MAX_LENGTH &&
    SCREENSHOT_NAME_PATTERN.test(value)
  );
}

// Display formats a declared screenshot may reuse via its `format` slot.
// Distinct from the on-demand rosters above: a declared capture renders in
// the indexing-time prerender pass, which can lay out any display format —
// `atom` included — while `edit` and the non-visual formats are not
// meaningful pixel sources.
export const DECLARED_SCREENSHOT_FORMATS = [
  'isolated',
  'embedded',
  'fitted',
  'atom',
] as const;
export type DeclaredScreenshotFormat =
  (typeof DECLARED_SCREENSHOT_FORMATS)[number];

export function isDeclaredScreenshotFormat(
  value: unknown,
): value is DeclaredScreenshotFormat {
  return (DECLARED_SCREENSHOT_FORMATS as readonly unknown[]).includes(value);
}

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
// Built by inclusion (`Pick`), not by extending `ScreenshotCaptureSpec`
// wholesale: the canonical form serializes exactly these fields, so a field
// outside the pick (`envelope`, `captures`, or anything the capture engine
// grows later) cannot ride into the identity and silently hash two distinct
// captures onto one ledger key. Widening the identity means changing this
// pick, `canonicalCaptureSpecString` / `canonicalCaptureSpecQuery` below,
// and `sameCaptureSpec` (jobs/screenshot-card.ts) together — and the
// exhaustive destructure in `canonicalOverrides` refuses to compile until
// the widened pick is actually handled there.
export interface CaptureSpec extends Pick<
  ScreenshotCaptureSpec,
  'viewport' | 'deviceScaleFactor' | 'fullPage' | 'clip'
> {
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
// The scale a *declared* screenshot (a `static screenshots` entry) captures
// at when the author writes no deviceScaleFactor — retina-quality output by
// default. Distinct from the wire-spec identity, where an absent
// deviceScaleFactor means 1: declaration readers and the capture pass must
// share this value so a declaration that validates clean cannot exceed the
// physical-edge cap once the default is applied.
export const SCREENSHOT_DEFAULT_DEVICE_SCALE_FACTOR = 2;
// The Chromium single-texture cap the viewport bounds are derived from,
// enforced on *physical* pixels: CSS dimension × deviceScaleFactor. The CSS
// caps alone would admit e.g. a 16384-tall viewport at 3× (~49k physical px).
// A fullPage capture's extent (the document's scroll size) is unknowable at
// parse time, so the capture path checks it against this cap itself.
export const SCREENSHOT_MAX_PHYSICAL_EDGE_PX = 16384;

// Cap on batch size. A batch is capture-only (persist: null), so it must finish
// within the handler's sync-wait budget (`SCREENSHOT_SYNC_WAIT_BUDGET_MS`, 25s)
// or it's discarded on the 503 and the retry re-renders from scratch — nothing
// resumes. Viewport-filling entries share one settled render, so each costs only
// a bounded viewport-switch paint wait (`VIEWPORT_SWITCH_PAINT_WAIT_MS`, 2s) +
// screenshot. A fitted batch is costlier: each DISTINCT envelope re-lays-out the
// hydrated card (route re-transition, settle, envelope-box and image-paint waits
// — each individually bounded), so it eats the budget faster. 12 keeps the
// viewport-filling case well inside the window and leaves headroom for fitted
// re-layout; callers batching many image-heavy envelopes should split the batch
// rather than raise this. The ceiling can rise once incremental persistence lets
// a batch resume instead of discard.
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
  'envelope',
  'captures',
]);
const CAPTURE_ENTRY_FIELDS = new Set([
  'name',
  'viewport',
  'deviceScaleFactor',
  'fullPage',
  'clip',
  'target',
  'envelope',
]);
const CAPTURE_SPEC_VIEWPORT_FIELDS = new Set(['width', 'height']);
const CAPTURE_SPEC_ENVELOPE_FIELDS = new Set(['width', 'height']);
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

  if (raw.envelope !== undefined) {
    let envelope = raw.envelope;
    if (!isPlainObject(envelope)) {
      return {
        error: `${path}.envelope must have positive integer width and height`,
      };
    }
    for (let key of Object.keys(envelope)) {
      if (!CAPTURE_SPEC_ENVELOPE_FIELDS.has(key)) {
        return {
          error: `${path}.envelope.${key} is not a supported field`,
        };
      }
    }
    if (
      !isPositiveInteger(envelope.width) ||
      !isPositiveInteger(envelope.height)
    ) {
      return {
        error: `${path}.envelope must have positive integer width and height`,
      };
    }
    if (envelope.width > SCREENSHOT_MAX_VIEWPORT_WIDTH) {
      return {
        error: `${path}.envelope.width must be <= ${SCREENSHOT_MAX_VIEWPORT_WIDTH}`,
      };
    }
    if (envelope.height > SCREENSHOT_MAX_VIEWPORT_HEIGHT) {
      return {
        error: `${path}.envelope.height must be <= ${SCREENSHOT_MAX_VIEWPORT_HEIGHT}`,
      };
    }
    overrides.envelope = { width: envelope.width, height: envelope.height };
  }

  return { overrides };
}

// Cross-field checks against a fully-merged effective spec.
function checkMergedOverrides(
  spec: ScreenshotCaptureOverrides,
  path: string,
  format: ScreenshotFormat,
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

  // Envelope formats lay out in a parent-owned box, so an envelope is
  // required;
  // isolated/embedded fill the viewport, where an envelope would be a
  // silent no-op — refused rather than ignored, per the module contract.
  let requiresEnvelope = ENVELOPE_FORMATS.includes(format);
  if (requiresEnvelope && !spec.envelope) {
    return `${path}.envelope is required for ${format} format`;
  }
  if (!requiresEnvelope && spec.envelope) {
    return `${path}.envelope is only valid for ${ENVELOPE_FORMATS.join('/')} format`;
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
  // The capture viewport IS the envelope for envelope formats, so the same
  // physical-pixel composition applies to it.
  if (spec.envelope) {
    if (
      spec.envelope.width * effectiveScale >
      SCREENSHOT_MAX_PHYSICAL_EDGE_PX
    ) {
      return `${path}.envelope.width × deviceScaleFactor must be <= ${SCREENSHOT_MAX_PHYSICAL_EDGE_PX} physical pixels`;
    }
    if (
      spec.envelope.height * effectiveScale >
      SCREENSHOT_MAX_PHYSICAL_EDGE_PX
    ) {
      return `${path}.envelope.height × deviceScaleFactor must be <= ${SCREENSHOT_MAX_PHYSICAL_EDGE_PX} physical pixels`;
    }
  }
  return undefined;
}

// Engine defaults are elided so equal capture intents key identically:
// `{ deviceScaleFactor: 1 }`, `{ fullPage: false }`, and an explicit
// `DEFAULT_CAPTURE_VIEWPORT`-sized viewport mean the same capture as no spec
// at all. Runs after the batch merge, so an entry that explicitly sets a
// field back to its default wins over a batch-wide override first.
function elideDefaults(
  spec: ScreenshotCaptureOverrides,
): ScreenshotCaptureOverrides {
  let out: ScreenshotCaptureOverrides = {};
  if (
    spec.viewport &&
    !(
      spec.viewport.width === DEFAULT_CAPTURE_VIEWPORT.width &&
      spec.viewport.height === DEFAULT_CAPTURE_VIEWPORT.height
    )
  ) {
    out.viewport = spec.viewport;
  }
  if (
    spec.deviceScaleFactor !== undefined &&
    spec.deviceScaleFactor !== DEFAULT_CAPTURE_VIEWPORT.deviceScaleFactor
  ) {
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
  if (spec.envelope) {
    out.envelope = spec.envelope;
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
  let envelope = entry.envelope ?? base.envelope;
  if (envelope) {
    merged.envelope = envelope;
  }
  return merged;
}

export function parseScreenshotCaptureSpec(
  raw: unknown,
  format: ScreenshotFormat,
): ScreenshotCaptureSpecParse {
  if (raw === undefined || raw === null) {
    // An envelope-format capture needs an envelope, which can only arrive
    // via the
    // captureSpec — an absent spec is therefore refused for those formats.
    if (ENVELOPE_FORMATS.includes(format)) {
      return {
        error: `captureSpec.envelope is required for ${format} format`,
      };
    }
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
    let crossError = checkMergedOverrides(
      singular.overrides,
      'captureSpec',
      format,
    );
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
    let crossError = checkMergedOverrides(merged, path, format);
    if (crossError !== undefined) {
      return { error: crossError };
    }
    entries.push({ name, ...elideDefaults(merged) });
  }

  return { captureSpec: { captures: entries } };
}

// The identity's geometry fields, default-elided via the one shared rule
// (`elideDefaults`), so the parse and the hash canonicalize identically. The
// parameter is the identity type itself and the destructure is exhaustive
// over it: widening the `CaptureSpec` pick fails to compile here — the one
// function that has to learn a new identity field — instead of silently
// dropping the field from the ledger key and hashing two distinct captures
// onto one entry.
function canonicalOverrides(
  spec: Omit<CaptureSpec, 'format'>,
): ScreenshotCaptureSpec {
  let { viewport, deviceScaleFactor, fullPage, clip, ...rest } = spec;
  rest satisfies Record<string, never>;
  return elideDefaults({ viewport, deviceScaleFactor, fullPage, clip });
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
    // Deliberately narrower than the POST /_screenshot-card roster
    // (SCREENSHOT_FORMATS): CAPTURE_FORMATS is the canonical ledger/GET-DSL
    // serving contract and stays viewport-filling only, so this message
    // speaks its own roster.
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

  let parsed = parseScreenshotCaptureSpec(raw, format);
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
// them. Assembled by hand rather than through `URLSearchParams`, which would
// percent-encode the clip commas (`clip=0%2C0%2C400x300`) — `,` is a valid
// query sub-delim, and the emitted URL should read as the same grammar the
// params document and the 400 messages teach. Safe without encoding because
// every value comes from the closed grammar above: format is an enum, the
// rest are digits, `x`, `,`, and a decimal point.
export function canonicalCaptureSpecQuery(spec: CaptureSpec): string {
  let params: string[] = [];
  if (spec.format !== DEFAULT_CAPTURE_FORMAT) {
    params.push(`format=${spec.format}`);
  }
  let overrides = canonicalOverrides(spec);
  if (overrides.viewport) {
    params.push(
      `viewport=${overrides.viewport.width}x${overrides.viewport.height}`,
    );
  }
  if (overrides.deviceScaleFactor != null) {
    params.push(`dsf=${overrides.deviceScaleFactor}`);
  }
  if (overrides.fullPage) {
    params.push('fullPage=true');
  }
  if (overrides.clip) {
    params.push(
      `clip=${overrides.clip.x},${overrides.clip.y},${overrides.clip.width}x${overrides.clip.height}`,
    );
  }
  return params.length > 0 ? `?${params.join('&')}` : '';
}

// ---------------------------------------------------------------------------
// Declared-screenshot capture identity + manifest — the grammar shared by the
// prerender pass (which captures and persists) and the realm's
// `_screenshot/…?name=` route (which joins a manifest entry to the ledger).
// ---------------------------------------------------------------------------

export const SCREENSHOT_IMAGE_TYPES = ['png', 'jpeg', 'webp'] as const;
export type ScreenshotImageType = (typeof SCREENSHOT_IMAGE_TYPES)[number];
export const SCREENSHOT_DEFAULT_IMAGE_TYPE: ScreenshotImageType = 'png';
export const SCREENSHOT_DEFAULT_BACKGROUND = 'white';

export function isScreenshotImageType(
  value: unknown,
): value is ScreenshotImageType {
  return (SCREENSHOT_IMAGE_TYPES as readonly unknown[]).includes(value);
}

export function screenshotContentType(type: ScreenshotImageType): string {
  switch (type) {
    case 'png':
      return 'image/png';
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
  }
}

// One merged `static screenshots` entry as it crosses the render-page
// boundary: everything in the declaration except the capture-only component
// itself, which cannot serialize — it is flagged `render: true` and
// re-resolved in-page by slot name when the capture renders.
export interface DeclaredScreenshotSpecPayload {
  width: number;
  height: number;
  deviceScaleFactor?: number;
  background?: string;
  useAsThumbnail?: boolean;
  keyBy?: 'generation' | 'file-content';
  type?: ScreenshotImageType;
  format?: DeclaredScreenshotFormat;
  render?: true;
}

export type DeclaredScreenshotRoster = Record<
  string,
  DeclaredScreenshotSpecPayload
>;

// The canonical identity of one declared capture. Unlike the wire spec —
// whose canonical form elides defaults so equivalent spellings collapse —
// this keys the *effective* pixel parameters with declaration defaults
// applied, so a later change to a default is a change of identity (and thus
// a recapture) rather than a silent aliasing of old bytes under new intent.
// The slot name is part of the identity: a capture-only component's pixels
// are identified only by the slot that declares it, and format twins sharing
// a ledger row would let one slot's re-persist reclaim the other's object.
// `keyBy` and `useAsThumbnail` steer invalidation and consumption, not
// pixels, so they stay out.
export function canonicalDeclaredCaptureString(
  name: string,
  payload: DeclaredScreenshotSpecPayload,
): string {
  let canonical: Record<string, unknown> = {
    background: payload.background ?? SCREENSHOT_DEFAULT_BACKGROUND,
    declared: name,
    deviceScaleFactor:
      payload.deviceScaleFactor ?? SCREENSHOT_DEFAULT_DEVICE_SCALE_FACTOR,
    height: payload.height,
    source: payload.render ? 'render' : payload.format,
    type: payload.type ?? SCREENSHOT_DEFAULT_IMAGE_TYPE,
    width: payload.width,
  };
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(canonical).sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
}

export async function declaredCaptureSpecHash(
  name: string,
  payload: DeclaredScreenshotSpecPayload,
): Promise<string> {
  return await computeMediaCacheKey(
    new TextEncoder().encode(canonicalDeclaredCaptureString(name, payload)),
  );
}

// One name's entry in a `prerendered_html.screenshots` manifest — the
// indexing-time artifact that joins a `?name=` request to its MediaCache
// ledger row (`specHash`) and object (`objectKey`), and carries the
// dimensions/consumption facts serve-time readers need without a ledger
// round-trip. `sourceContentHash` is recorded for `keyBy: 'file-content'`
// slots so the next prerender pass can carry the entry forward without
// re-rendering when the source file's bytes are unchanged.
export interface ScreenshotManifestEntry {
  specHash: string;
  objectKey: string;
  contentType: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  useAsThumbnail?: true;
  sourceContentHash?: string;
}

export type ScreenshotManifest = Record<string, ScreenshotManifestEntry>;

// The engine-side carry-forward decision for one declared slot: a
// `file-content`-keyed entry whose capture identity (spec hash) and source
// bytes (content hash) both match the prior manifest's is reused without
// re-rendering — a generation advance alone (a dependency edit, say) must
// not re-decode large media. Everything else re-captures.
export function shouldCarryForwardDeclaredEntry({
  keyBy,
  specHash,
  prior,
  contentHash,
}: {
  keyBy: 'generation' | 'file-content';
  specHash: string;
  prior: ScreenshotManifestEntry | undefined;
  contentHash: string | null | undefined;
}): boolean {
  return (
    keyBy === 'file-content' &&
    !!contentHash &&
    !!prior &&
    prior.specHash === specHash &&
    prior.sourceContentHash === contentHash
  );
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
