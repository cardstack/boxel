import { isResolvedCodeRef } from './code-ref.ts';

import type { ResolvedCodeRef } from './code-ref.ts';
import type {
  AnyFilter,
  CardTypeFilter,
  EveryFilter,
  Filter,
  NotFilter,
  TypedFilter,
} from './query.ts';

// Resolves a code ref to the canonical (defining-module) ref for the type it
// names, or undefined when the ref can't be resolved. The server backs this
// with the definition lookup (a re-export spelling's definition entry carries
// the defining module's codeRef); the host backs it with a loader import plus
// `identifyCard` on the loaded export.
export type CanonicalRefResolver = (
  ref: ResolvedCodeRef,
) => Promise<ResolvedCodeRef | undefined>;

export interface CanonicalizedFilter {
  filter: Filter;
  // True when some `type`/`on` ref could not be resolved; that ref is kept
  // as-given in the returned filter. The server treats an unresolvable ref as
  // matching nothing (the ref names no known type), while the host's search
  // resource uses this flag to fall back to server-only evaluation so the
  // client matcher never disagrees with the server about such a ref.
  incomplete: boolean;
}

// Rewrites every `type`/`on` code ref in a filter tree to its canonical
// (defining-module) form. Index rows stamp `types` with the canonical key
// (`identifyCard` of the class), so a filter ref that names the same type
// through a re-exporting module (e.g. `file-api`'s FileDef, re-exported from
// `card-api`) only matches once both sides agree on the canonical spelling.
// URL-form tolerance (RRI / real-URL / virtual-alias) is separate and stays
// in `internalKeysFor`; this handles the module-identity half.
export async function canonicalizeFilterRefs(
  filter: Filter,
  resolve: CanonicalRefResolver,
): Promise<CanonicalizedFilter> {
  let incomplete = false;
  // One lookup per distinct ref spelling within a query. The memo holds the
  // in-flight promise rather than the settled value: sibling filter nodes are
  // walked concurrently, and a value-memo would let both siblings pass the
  // has() check before either lookup settles.
  let memo = new Map<string, Promise<ResolvedCodeRef | undefined>>();

  async function canonicalRef(
    ref: CardTypeFilter['type'],
  ): Promise<CardTypeFilter['type']> {
    if (!isResolvedCodeRef(ref)) {
      return ref;
    }
    let key = `${ref.module}/${ref.name}`;
    if (!memo.has(key)) {
      memo.set(key, resolve(ref));
    }
    let canonical = await memo.get(key);
    if (!canonical) {
      incomplete = true;
      return ref;
    }
    return canonical;
  }

  async function walk(node: Filter): Promise<Filter> {
    let out: Filter = { ...node };
    if ('type' in out && out.type) {
      out.type = await canonicalRef(out.type);
    }
    let typed = out as TypedFilter;
    if (typed.on) {
      typed.on = await canonicalRef(typed.on);
    }
    if ('any' in out && Array.isArray(out.any)) {
      (out as AnyFilter).any = await Promise.all(
        (out as AnyFilter).any.map(walk),
      );
    }
    if ('every' in out && Array.isArray(out.every)) {
      (out as EveryFilter).every = await Promise.all(
        (out as EveryFilter).every.map(walk),
      );
    }
    if ('not' in out && out.not) {
      (out as NotFilter).not = await walk((out as NotFilter).not);
    }
    return out;
  }

  let canonicalized = await walk(filter);
  return { filter: canonicalized, incomplete };
}
