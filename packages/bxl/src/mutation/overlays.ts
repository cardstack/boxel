import {
  clone,
  deleteAt,
  equalJson,
  hasAt,
  setAt,
  valueAt,
} from './json-path.ts';
import {
  BxlMutationError,
  type BxlMutationJson,
  type BxlMutationOverlayTier,
  type BxlMutationOverlays,
  type BxlMutationPath,
  type BxlMutationReadEvent,
  type BxlMutationUnavailableOverlay,
} from './types.ts';

const OVERLAY_TIERS: readonly BxlMutationOverlayTier[] = ['computed', 'linked'];

/**
 * Overlay paths are dotted strings so a host can name one without building a
 * path array: `patient.name`, `recommendations.0.title`. Bracketed indices are
 * accepted on input and normalized to their own dotted segment.
 */
export function overlayPathKey(path: BxlMutationPath): string {
  return path.join('.');
}

function normalizeOverlayPath(path: string): string {
  return path
    .trim()
    .replace(/\[\s*(-?\d+)\s*\]/g, '.$1')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '');
}

/** A segment that names a place in a collection rather than a Field. */
const INDEX_LIKE = /^-?\d+$/;

/**
 * Segments that name something on a JavaScript object's prototype rather than
 * a Field of the Card. The planner refuses them in a program's own paths; an
 * overlay is host data read out of a column, so it is refused the same way.
 */
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

function isForbidden(path: BxlMutationPath): boolean {
  return path.some((segment) => FORBIDDEN_SEGMENTS.has(String(segment)));
}

const OVERLAY_TIER_NAMES = new Set<string>(OVERLAY_TIERS);
const OVERLAY_REASONS = new Set([
  'not-indexed',
  'not-searchable',
  'key-absent',
]);

/**
 * An `unavailable` entry describes something the planner will refuse a read
 * over, so a malformed one is a host bug worth naming rather than a value to
 * guess at or quietly ignore.
 */
function assertMarker(
  entry: BxlMutationUnavailableOverlay,
): BxlMutationUnavailableOverlay {
  const described = describe(entry);
  if (entry === null || typeof entry !== 'object') {
    throw overlayInvalid(
      `unavailable entries must be records; received ${described}.`,
    );
  }
  if (typeof entry.path !== 'string') {
    throw overlayInvalid(
      `an unavailable entry's path must be a string; received ${describe(entry.path)}.`,
    );
  }
  if (!OVERLAY_TIER_NAMES.has(entry.tier)) {
    throw overlayInvalid(
      `${entry.path} names an unknown overlay tier ${describe(entry.tier)}.`,
    );
  }
  if (!OVERLAY_REASONS.has(entry.reason)) {
    throw overlayInvalid(
      `${entry.path} names an unknown reason ${describe(entry.reason)}.`,
    );
  }
  return entry;
}

function describe(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value === null || value === undefined) return String(value);
  return typeof value;
}

function overlayInvalid(message: string): BxlMutationError {
  return new BxlMutationError('plan', 'overlay-invalid', 0, message);
}

/** Whether a path lies below another. The root lies above everything. */
function isWithin(candidate: string, ancestor: string): boolean {
  if (ancestor === '') return candidate.length > 0;
  return candidate.startsWith(`${ancestor}.`);
}

/**
 * Whether the stored document holds a value of its own at a path.
 *
 * A `null` is not one: it is what a Card holds at a path it never persists.
 * Neither is an empty list — a projection manufactures one for a list Field
 * the Card holds nothing in, so it carries none of the Card's own values and
 * an overlay answering there displaces nothing.
 */
function storedAnswers(
  stored: BxlMutationJson,
  path: BxlMutationPath,
): boolean {
  if (!hasAt(stored, path)) return false;
  const value = valueAt(stored, path);
  if (value === null) return false;
  return !(Array.isArray(value) && value.length === 0);
}

/** One value an overlay supplies, at the path it sits at. */
export interface OverlaySupply {
  readonly path: BxlMutationPath;
  readonly value: BxlMutationJson;
}

export interface OverlayIndex {
  /** The stored document, which answers a path ahead of any overlay. */
  readonly stored: BxlMutationJson;
  /** Dotted path to the tier that supplied the value there. */
  readonly coverage: ReadonlyMap<string, BxlMutationOverlayTier>;
  /** What each tier put where, for layering a view and for settling an update. */
  readonly supplied: readonly OverlaySupply[];
  /** Dotted path to what the host could not supply there, and why. */
  readonly unavailable: ReadonlyMap<string, BxlMutationUnavailableOverlay>;
  /** Proper ancestors of an unavailable path, to the marker nested under them. */
  readonly unavailableUnder: ReadonlyMap<string, BxlMutationUnavailableOverlay>;
  /** Proper ancestors of a supplied path, so a read spanning one is cheap to spot. */
  readonly covers: ReadonlySet<string>;
  /** Proper ancestors of a supplied *computed* path: containers of computed values. */
  readonly coversComputed: ReadonlySet<string>;
  /** True when no overlay layer participates, so every read is a source read. */
  readonly empty: boolean;
}

export const EMPTY_OVERLAY_INDEX: OverlayIndex = {
  stored: null,
  coverage: new Map(),
  supplied: [],
  unavailable: new Map(),
  unavailableUnder: new Map(),
  covers: new Set(),
  coversComputed: new Set(),
  empty: true,
};

/**
 * The values an overlay actually supplies, each with the path it sits at.
 *
 * A list is one value, not a place to descend into. An overlay may hand over
 * a whole list the Card does not store — a computed `containsMany`, say — and
 * that list is then read-only whole, its own positions consistent with each
 * other. What it may never do is name a position inside a list the Card *does*
 * store: see `reachableInStored`.
 */
function* overlayLeaves(
  value: BxlMutationJson,
  path: BxlMutationPath,
): Generator<{ path: BxlMutationPath; value: BxlMutationJson }> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value);
    if (entries.length > 0) {
      for (const [key, child] of entries) {
        yield* overlayLeaves(child, [...path, key]);
      }
      return;
    }
  }
  yield { path, value };
}

/**
 * Whether an overlay may reach a path without disturbing the stored document's
 * own shape.
 *
 * An overlay layers values *under* the stored document, so it may fill a place
 * the stored document leaves empty but never change what the stored document
 * already is. Grafting past a stored scalar would replace it with a container,
 * so a leaf whose path runs through one is dropped.
 *
 * A path *into* a collection is dropped as well, whichever side the collection
 * sits on: a segment that names a position, or a stored list anywhere along
 * the way. An overlay arrives keyed by position, and a position is an identity
 * only while nothing moves: inserting, deleting, reordering or moving an item
 * renumbers everything after it, and the indexed copy — written before the
 * program ran — cannot say which row it meant. Contained items carry no id to
 * re-key against. Reads inside a collection the Card stores therefore see the
 * Card's own values and nothing else.
 */
function reachableInStored(
  stored: BxlMutationJson,
  path: BxlMutationPath,
): boolean {
  if (path.some((segment) => INDEX_LIKE.test(String(segment)))) return false;
  for (let length = 0; length < path.length; length++) {
    const container = valueAt(stored, path.slice(0, length));
    // Nothing of the Card's stands in the way, so the rest of the path is
    // the overlay's to fill in.
    if (container === undefined || container === null) return true;
    // A list is never reached into, empty or not: the whole point is that no
    // overlay value is ever laid beside one of the Card's own items.
    if (Array.isArray(container)) return false;
    if (typeof container !== 'object') return false;
  }
  return true;
}

/**
 * A read-only view of the stored document with the host's overlay values
 * layered under it, plus an index of what came from where.
 *
 * The stored document is never modified and the view is never written back:
 * the planner keeps the Card's own document as its working state and derives
 * this view whenever an expression has to be evaluated. That is what keeps
 * overlay values out of a plan's output and off its intents, and it is why
 * the index can be rebuilt as the document changes — a path means the same
 * element in both, because a program that renumbers a collection renumbers
 * the view along with it.
 */
export function mergeBxlMutationOverlays(
  stored: BxlMutationJson,
  overlays: BxlMutationOverlays | undefined,
  /**
   * Paths a program has already written to or cleared. An overlay speaks for
   * a place the Card leaves empty, and a place the program emptied is not one
   * of those — it is the program's, and the overlay must not fill it back in.
   */
  claimed: ReadonlySet<string> = new Set(),
): { root: BxlMutationJson; index: OverlayIndex } {
  const declared = overlays?.unavailable ?? [];
  if (
    overlays === undefined ||
    (overlays.computeds === undefined &&
      overlays.linked === undefined &&
      declared.length === 0)
  ) {
    return { root: clone(stored), index: EMPTY_OVERLAY_INDEX };
  }

  const coverage = new Map<string, BxlMutationOverlayTier>();
  const supplied: OverlaySupply[] = [];
  const covers = new Set<string>();
  const coversComputed = new Set<string>();
  for (const tier of OVERLAY_TIERS) {
    const overlay = tier === 'computed' ? overlays.computeds : overlays.linked;
    if (overlay === undefined) continue;
    for (const leaf of overlayLeaves(overlay, [])) {
      if (leaf.path.length === 0) continue;
      // An overlay speaks only where it has something to say. `pristine_doc`
      // and `search_doc` carry the Card's own Fields alongside the ones only
      // they can answer, so a Field the Card leaves unset reaches us as a
      // `null` in both — and claiming it would make an ordinary writable
      // Field read-only for no reason.
      if (leaf.value === null) continue;
      if (isForbidden(leaf.path)) continue;
      const key = overlayPathKey(leaf.path);
      // The stored document wins over both tiers, and computeds over linked —
      // for a whole subtree, so a later tier cannot replace a value an earlier
      // one supplied by nesting something under it.
      if (storedAnswers(stored, leaf.path)) continue;
      if (coverage.has(key) || covers.has(key)) continue;
      if (selfOrAncestor(coverage, leaf.path) !== undefined) continue;
      if (isClaimed(claimed, leaf.path)) continue;
      if (!reachableInStored(stored, leaf.path)) continue;
      coverage.set(key, tier);
      supplied.push({ path: leaf.path, value: clone(leaf.value) });
      // A read of the whole document reaches every supplied value under it.
      covers.add('');
      for (let length = 1; length < leaf.path.length; length++) {
        const prefix = leaf.path.slice(0, length);
        covers.add(overlayPathKey(prefix));
        // Only a container the merge created is a computed value in its own
        // right. A container the Card stores, into which an overlay merely
        // filled a Field, stays the Card's to write.
        if (tier === 'computed' && !storedAnswers(stored, prefix)) {
          coversComputed.add(overlayPathKey(prefix));
        }
      }
    }
  }

  const unavailable = new Map<string, BxlMutationUnavailableOverlay>();
  const unavailableUnder = new Map<string, BxlMutationUnavailableOverlay>();
  for (const entry of declared) {
    const path = normalizeOverlayPath(assertMarker(entry).path);
    if (path.length === 0) continue;
    const parts = path.split('.');
    // Overlays do not participate inside a collection, so neither does an
    // absence of one: the Card's own items are the whole answer there.
    if (parts.some((segment) => INDEX_LIKE.test(segment))) continue;
    if (isForbidden(parts)) continue;
    // A path named twice is answered by the last entry, at the path itself and
    // everywhere under it alike.
    unavailable.set(path, { ...entry, path });
  }
  for (const [path, marker] of unavailable) {
    const parts = path.split('.');
    for (let length = 0; length < parts.length; length++) {
      const ancestor = parts.slice(0, length).join('.');
      if (!unavailableUnder.has(ancestor)) {
        unavailableUnder.set(ancestor, marker);
      }
    }
  }

  const index: OverlayIndex = {
    stored,
    coverage,
    supplied,
    unavailable,
    unavailableUnder,
    covers,
    coversComputed,
    empty: coverage.size === 0 && unavailable.size === 0,
  };
  return { root: layerBxlMutationOverlays(clone(stored), index), index };
}

/**
 * The stored document with the overlay values laid over it, for one read.
 *
 * Only the way down to each supplied value is copied; everything else is the
 * document's own nodes, shared. That keeps a read cheap enough to take per
 * evaluation, which is what lets a bulk statement rebuild the view between
 * locations instead of reasoning about when a cached one went stale. The
 * result is read-only: the planner writes to its working document, never here.
 *
 * Each value is re-checked against the document as it now stands, so a place
 * the statement has since filled is the Card's from then on and the overlay
 * stops answering for it.
 */
export function layerBxlMutationOverlays(
  root: BxlMutationJson,
  index: OverlayIndex,
): BxlMutationJson {
  let layered: Record<string, BxlMutationJson> | undefined;
  // Containers this view owns. A node the document also holds is copied before
  // it is written to; one already copied is written to directly, so laying
  // many values costs each container once rather than once per value.
  const owned = new Set<object>();
  for (const { path, value } of index.supplied) {
    const against: BxlMutationJson = layered ?? root;
    if (storedAnswers(against, path)) continue;
    if (!reachableInStored(against, path)) continue;
    if (layered === undefined) {
      layered = shallowCopy(root) as Record<string, BxlMutationJson>;
      owned.add(layered);
    }
    graft(layered, path, value, owned);
  }
  return layered ?? root;
}

/** A copy of a container, one level deep. */
function shallowCopy(value: BxlMutationJson | undefined): BxlMutationJson {
  if (Array.isArray(value)) return [...value];
  if (value !== null && typeof value === 'object') return { ...value };
  return {};
}

/**
 * Lay a value at a path, copying the containers along the way rather than the
 * whole document. Supplied paths never name a position, so every container on
 * the way down is addressed by key.
 */
function graft(
  root: Record<string, BxlMutationJson>,
  path: BxlMutationPath,
  value: BxlMutationJson,
  owned: Set<object>,
): void {
  let container = root;
  for (let length = 0; length < path.length - 1; length++) {
    const key = path[length] as string;
    const child = container[key];
    if (child === null || typeof child !== 'object' || !owned.has(child)) {
      const copy = shallowCopy(child) as Record<string, BxlMutationJson>;
      owned.add(copy);
      container[key] = copy;
      container = copy;
    } else {
      container = child as Record<string, BxlMutationJson>;
    }
  }
  container[path[path.length - 1] as string] = value;
}

/**
 * Which layer answers a read, and with what.
 *
 * A read reports `unavailable` when the value it returns is missing something
 * the host said it could not supply — a marker at the path, or one nested
 * under it, since the returned subtree would be incomplete. A marker *above*
 * the path only applies where the stored document has nothing of its own
 * there: a host that could not supply a linked Card's Fields has said nothing
 * about the stored edge pointing at it.
 *
 * Otherwise an overlay answers whenever one participates in the value: it
 * supplied the path, the read sits inside a value it supplied, or the value
 * returned carries overlay-supplied descendants. Only a read no overlay
 * touches is a source read.
 */
export function classifyOverlayRead(
  index: OverlayIndex,
  path: BxlMutationPath,
  value: BxlMutationJson | undefined,
): {
  event: BxlMutationReadEvent;
  unavailable?: BxlMutationUnavailableOverlay;
} {
  const key = overlayPathKey(path);
  if (index.empty) return { event: read(key, 'source', value) };

  const nested = index.unavailable.get(key) ?? index.unavailableUnder.get(key);
  if (nested) return unavailableRead(key, nested);

  const covered =
    index.coverage.get(key) ??
    selfOrAncestor(index.coverage, path) ??
    (index.covers.has(key) ? tierUnder(index, key) : undefined);
  if (covered) return { event: read(key, covered, value) };

  if (!storedAnswers(index.stored, path)) {
    const above = selfOrAncestor(index.unavailable, path);
    if (above) return unavailableRead(key, above);
  }
  return { event: read(key, 'source', value) };
}

function unavailableRead(
  path: string,
  entry: BxlMutationUnavailableOverlay,
): { event: BxlMutationReadEvent; unavailable: BxlMutationUnavailableOverlay } {
  return {
    event: { path, tier: entry.tier, outcome: 'unavailable' },
    unavailable: entry,
  };
}

function read(
  path: string,
  tier: BxlMutationReadEvent['tier'],
  value: BxlMutationJson | undefined,
): BxlMutationReadEvent {
  return {
    path,
    tier,
    outcome: value === undefined || value === null ? 'null' : 'value',
  };
}

/** The tier that supplied the first value found beneath a path. */
function tierUnder(
  index: OverlayIndex,
  key: string,
): BxlMutationOverlayTier | undefined {
  for (const [supplied, tier] of index.coverage) {
    if (isWithin(supplied, key)) return tier;
  }
  return undefined;
}

/** Whether a path, or anything above it, belongs to the program already. */
function isClaimed(
  claimed: ReadonlySet<string>,
  path: BxlMutationPath,
): boolean {
  if (claimed.size === 0) return false;
  for (let length = 1; length <= path.length; length++) {
    if (claimed.has(overlayPathKey(path.slice(0, length)))) return true;
  }
  return false;
}

/** What an index holds at a path, or at the nearest ancestor that carries one. */
function selfOrAncestor<Entry>(
  index: ReadonlyMap<string, Entry>,
  path: BxlMutationPath,
): Entry | undefined {
  if (index.size === 0) return undefined;
  for (let length = path.length; length >= 1; length--) {
    const entry = index.get(overlayPathKey(path.slice(0, length)));
    if (entry !== undefined) return entry;
  }
  return undefined;
}

/**
 * The overlay tier that owns a write location, if any. Only values an overlay
 * actually supplied are read-only; a path the host merely declared unavailable
 * carries no value and so refuses nothing on its own.
 *
 * A write lands on an overlay when it targets a supplied path or one nested
 * inside it, and — for computed values only — when it replaces a container
 * whose contents are computed. Writing an *ancestor* of a linked value stays a
 * stored write: replacing a `linksTo` edge changes the Card's own document,
 * not the Card on the far side of the link.
 */
export function overlayWriteOwner(
  index: OverlayIndex,
  path: BxlMutationPath,
): { path: string; tier: BxlMutationOverlayTier } | undefined {
  if (index.empty) return undefined;
  for (let length = path.length; length >= 1; length--) {
    const owner = overlayPathKey(path.slice(0, length));
    const tier = index.coverage.get(owner);
    if (tier) return { path: owner, tier };
  }
  const key = overlayPathKey(path);
  if (index.coversComputed.has(key)) return { path: key, tier: 'computed' };
  return undefined;
}

/**
 * What an update expression may actually write.
 *
 * `|=` is handed the layered value, so a Field an overlay filled into a stored
 * container is in scope the same way it is anywhere else. What comes back is
 * the Card's to store, so every overlay value the expression merely carried
 * along is put back to what the Card holds:
 *
 * - the expression passed the overlay value straight through — restore it;
 * - the expression left the Card's own value alone — nothing to do;
 * - the expression wrote something else there — that is a write to a
 *   read-only value, and it is refused rather than quietly dropped.
 *
 * Only paths an overlay supplied are settled, and no overlay reaches inside a
 * collection, so an update that reorders or resizes one has nothing here to
 * carry: its positions are the Card's own from end to end.
 */
export function settleOverlayUpdate(
  index: OverlayIndex,
  location: BxlMutationPath,
  layered: BxlMutationJson,
  stored: BxlMutationJson | undefined,
  produced: BxlMutationJson,
):
  | { value: BxlMutationJson }
  | { refused: string; tier: BxlMutationOverlayTier } {
  if (index.empty) return { value: produced };
  let value = produced;
  for (const { path } of index.supplied) {
    if (!startsWith(path, location)) continue;
    const key = overlayPathKey(path);
    const relative = path.slice(location.length);
    if (relative.length === 0) continue;
    const carried = valueAt(value, relative);
    if (sameValue(carried, valueAt(layered, relative))) {
      const held = stored ?? null;
      if (hasAt(held, relative)) {
        value = setAt(value, relative, valueAt(held, relative) ?? null);
      } else if (hasAt(value, relative)) {
        value = deleteAt(value, relative);
      }
      continue;
    }
    if (sameValue(carried, valueAt(stored ?? null, relative))) continue;
    return { refused: key, tier: index.coverage.get(key) ?? 'computed' };
  }
  // Reaching a supplied value may have taken containers the Card does not
  // hold either. Once their contents are back to the Card's, what is left is
  // the graft itself, and it is no more the Card's than the value was.
  for (const prefix of graftedContainers(index, location)) {
    if (!isEmptyObject(valueAt(value, prefix))) continue;
    const held = stored ?? null;
    if (hasAt(held, prefix)) {
      value = setAt(value, prefix, valueAt(held, prefix) ?? null);
    } else if (hasAt(value, prefix)) {
      value = deleteAt(value, prefix);
    }
  }
  return { value };
}

/**
 * The containers the merge created on the way to a value it supplied under
 * this location, innermost first so a nested graft collapses before the one
 * holding it.
 */
function graftedContainers(
  index: OverlayIndex,
  location: BxlMutationPath,
): BxlMutationPath[] {
  const seen = new Set<string>();
  const prefixes: BxlMutationPath[] = [];
  for (const { path } of index.supplied) {
    if (!startsWith(path, location)) continue;
    for (let length = location.length + 1; length < path.length; length++) {
      if (storedAnswers(index.stored, path.slice(0, length))) continue;
      const relative = path.slice(location.length, length);
      const key = overlayPathKey(relative);
      if (seen.has(key)) continue;
      seen.add(key);
      prefixes.push(relative);
    }
  }
  return prefixes.sort((left, right) => right.length - left.length);
}

/**
 * Whether a value is a container with nothing in it. Anything the expression
 * put there of its own would leave a key behind, so an empty one is the graft
 * and nothing else.
 */
function isEmptyObject(value: BxlMutationJson | undefined): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

/** Whether a path lies at or below another. */
function startsWith(path: BxlMutationPath, prefix: BxlMutationPath): boolean {
  if (path.length < prefix.length) return false;
  return prefix.every((segment, index) => path[index] === segment);
}

/**
 * Whether two readings of a place agree. A key the Card does not have and a
 * key it stores as `null` are the same absence everywhere else in this module,
 * and an expression that simply omits a key is not writing to it.
 */
function sameValue(
  left: BxlMutationJson | undefined,
  right: BxlMutationJson | undefined,
): boolean {
  return equalJson(left ?? null, right ?? null);
}
