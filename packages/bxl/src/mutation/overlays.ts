import { clone, hasAt, setAt, valueAt } from './json-path.ts';
import type {
  BxlMutationJson,
  BxlMutationOverlayTier,
  BxlMutationOverlays,
  BxlMutationPath,
  BxlMutationReadEvent,
  BxlMutationUnavailableOverlay,
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
    .replace(/\[\s*(\d+)\s*\]/g, '.$1')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '');
}

function isWithin(candidate: string, ancestor: string): boolean {
  return candidate.startsWith(`${ancestor}.`);
}

/** The stored document answers a read only where it holds a value of its own. */
function storedAnswers(
  stored: BxlMutationJson,
  path: BxlMutationPath,
): boolean {
  return hasAt(stored, path) && valueAt(stored, path) !== null;
}

export interface OverlayIndex {
  /** The stored document, which answers a path ahead of any overlay. */
  readonly stored: BxlMutationJson;
  /** Dotted path to the tier that supplied the value there. */
  readonly coverage: ReadonlyMap<string, BxlMutationOverlayTier>;
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
  unavailable: new Map(),
  unavailableUnder: new Map(),
  covers: new Set(),
  coversComputed: new Set(),
  empty: true,
};

function* overlayLeaves(
  value: BxlMutationJson,
  path: BxlMutationPath,
): Generator<{ path: BxlMutationPath; value: BxlMutationJson }> {
  if (value !== null && typeof value === 'object') {
    const entries: Array<[string | number, BxlMutationJson]> = Array.isArray(
      value,
    )
      ? value.map((item, index) => [index, item])
      : Object.entries(value);
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
 * and grafting past the end of a stored array would renumber positions the
 * planner is about to compute collection indices against — so a leaf whose path
 * runs through either is dropped. Index drift between a Card and its indexed
 * copy is normal; it must not reshape the document a program plans over.
 */
function reachableInStored(
  stored: BxlMutationJson,
  path: BxlMutationPath,
): boolean {
  for (let length = 0; length < path.length; length++) {
    const prefix = path.slice(0, length);
    if (!storedAnswers(stored, prefix)) return true;
    const container = valueAt(stored, prefix);
    const segment = path[length]!;
    if (Array.isArray(container)) {
      if (typeof segment !== 'number' || segment >= container.length) {
        return false;
      }
      continue;
    }
    if (container === null || typeof container !== 'object') return false;
    if (typeof segment !== 'string') return false;
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
): { root: BxlMutationJson; index: OverlayIndex } {
  const root = clone(stored);
  const declared = overlays?.unavailable ?? [];
  if (
    overlays === undefined ||
    (overlays.computeds === undefined &&
      overlays.linked === undefined &&
      declared.length === 0)
  ) {
    return { root, index: EMPTY_OVERLAY_INDEX };
  }

  const coverage = new Map<string, BxlMutationOverlayTier>();
  const covers = new Set<string>();
  const coversComputed = new Set<string>();
  for (const tier of OVERLAY_TIERS) {
    const overlay = tier === 'computed' ? overlays.computeds : overlays.linked;
    if (overlay === undefined) continue;
    for (const leaf of overlayLeaves(overlay, [])) {
      if (leaf.path.length === 0) continue;
      const key = overlayPathKey(leaf.path);
      // The stored document wins over both tiers, and computeds over linked —
      // for a whole subtree, so a later tier cannot replace a value an earlier
      // one supplied by nesting something under it.
      if (storedAnswers(stored, leaf.path)) continue;
      if (coverage.has(key) || covers.has(key)) continue;
      if (selfOrAncestor(coverage, leaf.path) !== undefined) continue;
      if (!reachableInStored(stored, leaf.path)) continue;
      setAt(root, leaf.path, leaf.value);
      coverage.set(key, tier);
      for (let length = 1; length < leaf.path.length; length++) {
        const prefix = leaf.path.slice(0, length);
        covers.add(overlayPathKey(prefix));
        // Only a container the merge created is a computed value in its own
        // right. A stored collection that merely holds a computed Field in
        // each row stays writable as a collection.
        if (tier === 'computed' && !storedAnswers(stored, prefix)) {
          coversComputed.add(overlayPathKey(prefix));
        }
      }
    }
  }

  const unavailable = new Map<string, BxlMutationUnavailableOverlay>();
  const unavailableUnder = new Map<string, BxlMutationUnavailableOverlay>();
  for (const entry of declared) {
    const path = normalizeOverlayPath(entry.path);
    if (path.length === 0) continue;
    const marker = { ...entry, path };
    unavailable.set(path, marker);
    const parts = path.split('.');
    for (let length = 1; length < parts.length; length++) {
      const ancestor = parts.slice(0, length).join('.');
      if (!unavailableUnder.has(ancestor))
        unavailableUnder.set(ancestor, marker);
    }
  }

  return {
    root,
    index: {
      stored,
      coverage,
      unavailable,
      unavailableUnder,
      covers,
      coversComputed,
      empty: coverage.size === 0 && unavailable.size === 0,
    },
  };
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
