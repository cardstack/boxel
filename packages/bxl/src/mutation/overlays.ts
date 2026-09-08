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
  /** Dotted path to the tier that supplied the value there. */
  readonly coverage: ReadonlyMap<string, BxlMutationOverlayTier>;
  /** Dotted path to what the host could not supply there, and why. */
  readonly unavailable: ReadonlyMap<string, BxlMutationUnavailableOverlay>;
  readonly anchors: readonly OverlayAnchor[];
  /** True when no overlay layer participates, so every read is a source read. */
  readonly empty: boolean;
}

export const EMPTY_OVERLAY_INDEX: OverlayIndex = {
  coverage: new Map(),
  unavailable: new Map(),
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
      coverage,
      unavailable,
      anchors,
      empty: coverage.size === 0 && unavailable.size === 0,
    },
  };
}

/**
 * Which layer answers a read, and with what. A path the host declared
 * unavailable reports `unavailable` — including paths nested inside it, since
 * the host could not supply the subtree either. Otherwise an overlay answers
 * when it supplied the path, when the read sits inside a value an overlay
 * supplied, or when the value returned carries overlay-supplied descendants.
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
  const declared = selfOrAncestor(index.unavailable, path);
  if (declared) {
    return {
      event: { path: key, tier: declared.tier, outcome: 'unavailable' },
      unavailable: declared,
    };
  }
  const covered = selfOrAncestor(index.coverage, path);
  if (covered) return { event: read(key, covered, value) };
  for (const [supplied, tier] of index.coverage) {
    if (isWithin(supplied, key)) return { event: read(key, tier, value) };
  }
  return { event: read(key, 'source', value) };
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

/**
 * The overlay tier that owns a write location, if any. A write lands on an
 * overlay when it targets a path an overlay supplied, a path nested inside
 * one, or a path the host declared unavailable. Writing to an *ancestor* of an
 * overlay path stays a stored write — replacing a `linksTo` edge is a change
 * to the Card's own document, not a write through the link.
 */
export function overlayWriteOwner(
  index: OverlayIndex,
  path: BxlMutationPath,
): { path: string; tier: BxlMutationOverlayTier } | undefined {
  if (index.empty) return undefined;
  for (let length = path.length; length >= 1; length--) {
    const owner = overlayPathKey(path.slice(0, length));
    const tier =
      index.coverage.get(owner) ?? index.unavailable.get(owner)?.tier;
    if (tier) return { path: owner, tier };
  }
  return undefined;
}

/**
 * Undo the merge, so a plan's `output` is the stored document the program
 * produced rather than the layered view the program read. An anchor a
 * statement wrote to — or wrote inside — belongs to the program now and is
 * left alone.
 */
export function restoreOverlayAnchors(
  root: BxlMutationJson,
  index: OverlayIndex,
  written: readonly BxlMutationPath[],
): BxlMutationJson {
  if (index.anchors.length === 0) return root;
  const writtenKeys = written.map(overlayPathKey);
  for (const anchor of index.anchors) {
    const key = overlayPathKey(anchor.path);
    if (
      writtenKeys.some(
        (target) =>
          target === key || isWithin(target, key) || isWithin(key, target),
      )
    ) {
      continue;
    }
    if (!hasAt(root, anchor.path.slice(0, -1))) continue;
    if (anchor.existed) setAt(root, anchor.path, anchor.previous ?? null);
    else if (hasAt(root, anchor.path)) deleteAt(root, anchor.path);
  }
  return root;
}
