// What a pack carries, and what it admits it left behind.
//
// Part of the browser-safe surface (see `resolve.ts`): no `node:` import
// here, or in anything this file reaches. Deciding what to carry is a pure
// function of the decklist; CARRYING it is I/O and belongs to the vendoring
// machinery (`vendor.ts`), which already exists.
//
// The two modes are the endpoints of a spectrum whose middle is not designed:
//
//   bare      every dependency stays a REFERENCE. Smallest, and correct when
//             both ends can reach the same places.
//   hermetic  every dependency is VENDORED — bytes ride inside, canonical
//             identity recorded. Assumes nothing but a runtime.
//
// The mode is not a new mechanism. `deck-pack-equivalence.md` §2 settled
// that carriage mode IS the kind of value in the import map: a web URL is a
// reference, a `$DECK/…` path is local or vendored. So choosing a mode is
// choosing which values get rewritten, and this module answers only that.
//
// Why it exists at all: a pack that prunes silently is the failure worth
// designing out. `bare` prunes the ENTIRE external closure, which is the
// most aggressive prune available — and a `bare` pack that does not say so
// opens on a machine that happens to reach the same things the source did,
// and fails everywhere else with nothing to read.

import { classifyReference } from './classify.ts';
import type { PackMode, PrunedRecord } from './packlist.ts';

export interface PackPlan {
  mode: PackMode;
  /** Specifiers whose bytes must be fetched and placed inside the pack.
   *  Empty for `bare`. The caller does the fetching. */
  vendor: { specifier: string; from: string }[];
  /** What the pack will not contain, ready to store as
   *  `provenance.pruned`. */
  pruned: PrunedRecord;
}

export interface PlanPackOptions {
  mode: PackMode;
  /** The tree's resolved decklist: specifier → where the dependency lives. */
  imports: Record<string, string>;
  /** The URL prefix that means "this tree". Anything under it is already
   *  inside the pack, so it is never a dependency to carry or prune. */
  sourceBase?: string;
  /**
   * Absolute references found in the tree's own content that are neither
   * declared dependencies nor part of this tree — the `foreign` list from
   * `summarise()`.
   *
   * They are recorded, never resolved. No mode can carry them: nothing says
   * what they are, so fetching them would be guessing and dropping them
   * would lose information.
   */
  foreign?: readonly string[];
}

/**
 * Decide what a pack in this mode carries, and what it must admit to
 * leaving out.
 *
 * Pure. The result's `pruned` is exactly what belongs in the provenance
 * block, so a pack cannot be built in a mode without also recording the
 * consequence of that mode.
 */
export function planPack(options: PlanPackOptions): PackPlan {
  let { mode, imports, sourceBase, foreign = [] } = options;

  let external: { specifier: string; from: string }[] = [];
  for (let [specifier, target] of Object.entries(imports)) {
    if (!target) {
      continue;
    }
    // A value pointing inside this tree is not a dependency — it is the
    // deck's own module, and it travels because the tree travels.
    if (sourceBase && target.startsWith(sourceBase)) {
      continue;
    }
    // Reuse the one classifier rather than re-deciding what "external"
    // means. A relative or bare target is position-independent and needs
    // nothing; only something that resolves elsewhere is a dependency.
    let verdict = classifyReference({
      value: target,
      role: 'reference',
      imports: {},
      sourceBase,
    });
    if (verdict.action === 'leave' && verdict.reason !== 'foreign') {
      continue;
    }
    external.push({ specifier, from: target });
  }

  let unresolved = [...foreign];

  if (mode === 'hermetic') {
    // Everything nameable rides inside. What remains pruned is only what
    // cannot be named — which is why `hermetic` is "assumes a runtime", not
    // "assumes nothing at all".
    return {
      mode,
      vendor: external,
      pruned: unresolved.length > 0 ? { unresolved } : {},
    };
  }

  return {
    mode,
    vendor: [],
    pruned: {
      ...(external.length > 0 ? { external } : {}),
      ...(unresolved.length > 0 ? { unresolved } : {}),
    },
  };
}

/**
 * Can a recipient open this pack using only what it already has?
 *
 * `bare` is honest, not self-sufficient. This is the question a receiving
 * realm asks before intake, and the answer is a list it can check rather
 * than a promise it has to trust.
 */
export function unmetDependencies(
  pruned: PrunedRecord | undefined,
  reachable: (specifier: string) => boolean,
): { specifier: string; from: string }[] {
  return (pruned?.external ?? []).filter((dep) => !reachable(dep.specifier));
}
