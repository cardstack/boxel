import type {
  CodeRef,
  Filter,
  TypeRefResult,
  VirtualNetwork,
} from '@cardstack/runtime-common';
import {
  baseCardRef,
  baseFieldRef,
  baseFileRef,
  baseRef,
  getTypeRefsFromFilter,
  identifyCard,
  isBaseDef,
  internalKeyFor,
  isResolvedCodeRef,
} from '@cardstack/runtime-common';

import type { CardDef } from '@cardstack/base/card-api';

/**
 * Internal key strings for root types (CardDef, FieldDef, FileDef, BaseDef).
 * These represent the base of the type hierarchy and are excluded
 * from type picker options and type-constraint checks. Pass the
 * caller's VirtualNetwork so the keys produced here match those
 * generated elsewhere in the same realm-mapping context.
 */
export function getRootTypeKeys(virtualNetwork: VirtualNetwork): Set<string> {
  return new Set([
    internalKeyFor(baseCardRef, undefined, virtualNetwork),
    internalKeyFor(baseFieldRef, undefined, virtualNetwork),
    internalKeyFor(baseFileRef, undefined, virtualNetwork),
    internalKeyFor(baseRef, undefined, virtualNetwork),
  ]);
}

/**
 * Extracts type references from a Filter (thin wrapper around runtime-common).
 */
export function getFilterTypeRefs(
  baseFilter: Filter | undefined,
): TypeRefResult[] | undefined {
  if (baseFilter) {
    return getTypeRefsFromFilter(baseFilter);
  }
  return undefined;
}

/**
 * Extracts non-negated, non-root type internal keys from a base filter.
 * Returns undefined if there are no constraining types (or only root types).
 *
 * Used by TypeSummariesResource to constrain available type options,
 * and to determine `hasNonRootBaseFilter`.
 */
export function getBaseFilterTypeKeys(
  baseFilter: Filter | undefined,
  virtualNetwork: VirtualNetwork,
): Set<string> | undefined {
  const typeRefs = getFilterTypeRefs(baseFilter);
  if (!typeRefs || typeRefs.length === 0) {
    return undefined;
  }
  const refs = new Set<string>();
  for (const { ref, negated } of typeRefs) {
    if (!negated && isResolvedCodeRef(ref)) {
      refs.add(internalKeyFor(ref, undefined, virtualNetwork));
    }
  }
  if (refs.size === 0) return undefined;

  // CardDef/FieldDef are root types — all card types inherit from them,
  // so filtering by them would incorrectly show zero results. Skip.
  const rootKeys = getRootTypeKeys(virtualNetwork);
  if ([...refs].every((r) => rootKeys.has(r))) {
    return undefined;
  }

  return refs;
}

/**
 * Whether a base filter constrains to non-root types.
 */
export function hasNonRootBaseFilter(
  baseFilter: Filter | undefined,
  virtualNetwork: VirtualNetwork,
): boolean {
  return getBaseFilterTypeKeys(baseFilter, virtualNetwork) !== undefined;
}

/**
 * Checks whether a card matches a type ref by walking its prototype chain.
 */
export function cardMatchesTypeRef(card: CardDef, typeRef: CodeRef): boolean {
  if (!isResolvedCodeRef(typeRef)) {
    return false;
  }
  let cls: unknown = card.constructor;
  while (cls && isBaseDef(cls)) {
    const ref = identifyCard(cls);
    if (
      ref &&
      isResolvedCodeRef(ref) &&
      ref.module === typeRef.module &&
      ref.name === typeRef.name
    ) {
      return true;
    }
    cls = Reflect.getPrototypeOf(cls as object);
  }
  return false;
}

/**
 * Filters cards by type refs extracted from a Filter.
 * Handles both positive (include) and negated (exclude) type constraints.
 */
export function filterCardsByTypeRefs(
  cards: CardDef[],
  typeRefs: TypeRefResult[] | undefined,
): CardDef[] {
  if (!typeRefs) {
    return cards;
  }
  const positiveRefs = typeRefs.filter((r) => !r.negated).map((r) => r.ref);
  const negatedRefs = typeRefs.filter((r) => r.negated).map((r) => r.ref);
  let filtered = cards;
  if (positiveRefs.length > 0) {
    filtered = filtered.filter((c) =>
      positiveRefs.some((ref) => cardMatchesTypeRef(c, ref)),
    );
  }
  if (negatedRefs.length > 0) {
    filtered = filtered.filter(
      (c) => !negatedRefs.some((ref) => cardMatchesTypeRef(c, ref)),
    );
  }
  return filtered;
}
