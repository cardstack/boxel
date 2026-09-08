import { clone, deleteAt, hasAt, setAt, valueAt } from './json-path.ts';
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
    .replace(/^\.+/, '');
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

/**
 * Where the merge grafted an overlay subtree onto the stored document, and
 * what the stored document held there, so `plan.output` can be handed back
 * carrying stored values only.
 */
interface OverlayAnchor {
  path: BxlMutationPath;
  existed: boolean;
  previous: BxlMutationJson | undefined;
}

export interface OverlayIndex {
  /** The stored document, which answers a path ahead of any overlay. */
  readonly stored: BxlMutationJson;
  /** Dotted path to the tier that supplied the value there. */
  readonly coverage: ReadonlyMap<string, BxlMutationOverlayTier>;
  /** Dotted path to what the host could not supply there, and why. */
  readonly unavailable: ReadonlyMap<string, BxlMutationUnavailableOverlay>;
  /** Every supplied path, longest first, for undoing the merge. */
  readonly supplied: readonly BxlMutationPath[];
  /** Proper ancestors of a supplied path, so a read spanning one is cheap to spot. */
  readonly covers: ReadonlySet<string>;
  /** Proper ancestors of a supplied *computed* path: containers of computed values. */
  readonly coversComputed: ReadonlySet<string>;
  readonly anchors: readonly OverlayAnchor[];
  /** True when no overlay layer participates, so every read is a source read. */
  readonly empty: boolean;
}

export const EMPTY_OVERLAY_INDEX: OverlayIndex = {
  stored: null,
  coverage: new Map(),
  supplied: [],
  unavailable: new Map(),
  covers: new Set(),
  coversComputed: new Set(),
  anchors: [],
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

function anchorFor(
  stored: BxlMutationJson,
  path: BxlMutationPath,
): OverlayAnchor {
  for (let length = 1; length <= path.length; length++) {
    const prefix = path.slice(0, length);
    if (storedAnswers(stored, prefix)) continue;
    return {
      path: prefix,
      existed: hasAt(stored, prefix),
      previous: valueAt(stored, prefix),
    };
  }
  return { path, existed: true, previous: valueAt(stored, path) };
}

/**
 * Layer the host's read-only values under the stored document. Every overlay
 * leaf whose path the stored document does not answer is grafted in and
 * recorded, so a later read can say which tier answered and a write to that
 * path can be refused.
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
  const supplied: BxlMutationPath[] = [];
  const covers = new Set<string>();
  const coversComputed = new Set<string>();
  const anchors: OverlayAnchor[] = [];
  const anchored = new Set<string>();
  for (const tier of OVERLAY_TIERS) {
    const overlay = tier === 'computed' ? overlays.computeds : overlays.linked;
    if (overlay === undefined) continue;
    for (const leaf of overlayLeaves(overlay, [])) {
      if (leaf.path.length === 0) continue;
      const key = overlayPathKey(leaf.path);
      // The stored document wins over both tiers, and computeds over linked.
      if (coverage.has(key) || storedAnswers(stored, leaf.path)) continue;
      const anchor = anchorFor(stored, leaf.path);
      const anchorKey = overlayPathKey(anchor.path);
      if (!anchored.has(anchorKey)) {
        anchored.add(anchorKey);
        anchors.push(anchor);
      }
      setAt(root, leaf.path, leaf.value);
      coverage.set(key, tier);
      supplied.push(leaf.path);
      for (let length = 1; length < leaf.path.length; length++) {
        const ancestor = overlayPathKey(leaf.path.slice(0, length));
        covers.add(ancestor);
        if (tier === 'computed') coversComputed.add(ancestor);
      }
    }
  }

  const unavailable = new Map<string, BxlMutationUnavailableOverlay>();
  for (const entry of declared) {
    const path = normalizeOverlayPath(entry.path);
    if (path.length === 0) continue;
    unavailable.set(path, { ...entry, path });
  }

  return {
    root,
    index: {
      stored,
      coverage,
      supplied: supplied.sort((left, right) => right.length - left.length),
      unavailable,
      covers,
      coversComputed,
      anchors,
      empty: coverage.size === 0 && unavailable.size === 0,
    },
  };
}

/**
 * Which layer answers a read, and with what.
 *
 * The stored document answers first: where it holds a value of its own, the
 * read is a source read whatever the overlays say — a host that could not
 * supply the fields of a linked Card has said nothing about the stored edge.
 * Below that, an overlay answers when it supplied the path, when the read sits
 * inside a value an overlay supplied, or when the value returned carries
 * overlay-supplied descendants. A path the host declared unavailable, or one
 * nested inside such a path, reports `unavailable`.
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
  if (index.empty || storedAnswers(index.stored, path)) {
    return { event: read(key, 'source', value) };
  }
  const declared = selfOrAncestor(index.unavailable, path);
  if (declared) {
    return {
      event: { path: key, tier: declared.tier, outcome: 'unavailable' },
      unavailable: declared,
    };
  }
  const covered = selfOrAncestor(index.coverage, path);
  if (covered) return { event: read(key, covered, value) };
  if (index.covers.has(key)) {
    return { event: read(key, tierUnder(index, path), value) };
  }
  return { event: read(key, 'source', value) };
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
  path: BxlMutationPath,
): BxlMutationOverlayTier {
  const key = overlayPathKey(path);
  for (const [supplied, tier] of index.coverage) {
    if (isWithin(supplied, key)) return tier;
  }
  return 'computed';
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
 * Undo the merge, so a plan's `output` is the stored document the program
 * produced rather than the layered view the program read.
 *
 * Supplied values are removed leaf by leaf, then each container the merge
 * created is restored. Anything a statement wrote to — or wrote inside —
 * belongs to the program and is left as the program left it, so a write to a
 * stored sibling keeps its own value without keeping the overlay leaves
 * alongside it.
 */
export function restoreOverlayAnchors(
  root: BxlMutationJson,
  index: OverlayIndex,
  written: readonly BxlMutationPath[],
): BxlMutationJson {
  if (index.anchors.length === 0) return root;
  const writtenKeys = written.map(overlayPathKey);
  const ownedByProgram = (key: string): boolean =>
    writtenKeys.some((target) => target === key || isWithin(key, target));

  for (const leaf of index.supplied) {
    if (ownedByProgram(overlayPathKey(leaf))) continue;
    restore(root, index.stored, leaf);
  }
  for (const anchor of index.anchors) {
    const key = overlayPathKey(anchor.path);
    if (ownedByProgram(key)) continue;
    if (writtenKeys.some((target) => isWithin(target, key))) continue;
    restore(root, index.stored, anchor.path);
  }
  return root;
}

/** Put a path back to what the stored document held there. */
function restore(
  root: BxlMutationJson,
  stored: BxlMutationJson,
  path: BxlMutationPath,
): void {
  if (!hasAt(root, path.slice(0, -1))) return;
  if (hasAt(stored, path)) setAt(root, path, valueAt(stored, path) ?? null);
  else if (hasAt(root, path)) deleteAt(root, path);
}
