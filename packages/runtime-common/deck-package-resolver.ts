import {
  canonicalRRIImportMap,
  isExactVersionRRI,
  isRRI,
  resolveRRI,
  type RRIImportMap,
} from '@cardstack/deck';

// How a lock change affects modules the Loader has already registered. An
// additive change only adds entries, so no specifier that already resolved
// can resolve differently; anything else can, and is destructive.
export type DeckResolutionChange = 'additive' | 'destructive';

// Resolution with no importer may use a lock's global imports but never its
// scopes, so a top-level request cannot impersonate a package subtree. Deck's
// resolver needs some importer RRI to compare scopes against; this one sits
// outside every scope a lock can name.
const TOP_LEVEL_IMPORTER = '@deck/top-level/';

/**
 * Resolves a bare module specifier to an exact Version RRI through a Deck lock.
 *
 * The lock is the canonical, URL-free form of an import map: every target is
 * an exact Version RRI, such as `@acme/ui@3.4.2/button.gts`. This class holds
 * that lock and answers in RRIs only. It knows nothing about the network:
 * turning the RRI it returns into a URL is the network boundary's job, which
 * keeps Deck independent of how that boundary is built.
 *
 * It answers only for a bare specifier the lock maps. A specifier that is
 * already an RRI is absolute by its shape and is returned as `undefined`, for
 * the caller to resolve as it would without Deck. That is also what leaves a
 * scoped npm package name, such as `@babel/runtime/...`, to the shims.
 */
export class DeckPackageResolver {
  private lock: RRIImportMap = { imports: {}, scopes: {} };
  private listeners = new Set<(change: DeckResolutionChange) => void>();

  /**
   * Replace the lock. Deck canonicalizes it, which rejects URL-form targets,
   * and every target must name an exact Version, because a range or tag would
   * make one lock resolve differently over time.
   */
  setLock(lock: unknown): void {
    let canonical = canonicalRRIImportMap(lock);
    let targets = [
      ...Object.values(canonical.imports),
      ...Object.values(canonical.scopes).flatMap((table) =>
        Object.values(table),
      ),
    ];
    if (targets.some((target) => !isExactVersionRRI(target))) {
      throw new Error('Deck lock targets must be exact Versions');
    }
    if (sameLock(this.lock, canonical)) {
      return;
    }
    let change: DeckResolutionChange = containsLock(canonical, this.lock)
      ? 'additive'
      : 'destructive';
    this.lock = canonical;
    for (let listener of this.listeners) {
      listener(change);
    }
  }

  clear(): void {
    this.setLock({ imports: {}, scopes: {} });
  }

  /** A copy of the lock, safe to inspect or persist. */
  getLock(): RRIImportMap {
    return cloneLock(this.lock);
  }

  onChange(listener: (change: DeckResolutionChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * The exact Version RRI that `specifier` resolves to for the module
   * `importerRRI`, or `undefined` when the lock has no answer.
   *
   * An importer that is not an RRI gets no answer at all: its scope cannot be
   * named, so nothing the lock says is known to apply to it.
   */
  resolve(specifier: string, importerRRI?: string): string | undefined {
    if (specifier.startsWith('@') && isRRI(specifier)) {
      return undefined;
    }
    if (importerRRI !== undefined && !isRRI(importerRRI)) {
      return undefined;
    }
    return resolveRRI({
      specifier,
      fromRRI: importerRRI ?? TOP_LEVEL_IMPORTER,
      imports: this.lock.imports,
      scopes: importerRRI ? this.lock.scopes : {},
    });
  }
}

/**
 * The Loader's `resolveImport`, with Deck consulted first.
 *
 * The importer arrives as whatever identifier the Loader holds; the network
 * folds it to an RRI, Deck picks the exact Version, and the network resolves
 * that RRI as it resolves any other. A specifier Deck has no answer for goes to
 * the network unchanged, so a realm without Deck resolves as before.
 */
export function resolveImportThroughDeck(
  resolver: DeckPackageResolver,
  network: {
    resolveImport(moduleIdentifier: string): string;
    unresolveURL(url: string): string;
  },
): (moduleIdentifier: string, relativeTo?: string) => string {
  return (moduleIdentifier, relativeTo) => {
    let importer = relativeTo ? network.unresolveURL(relativeTo) : undefined;
    let resolved = resolver.resolve(moduleIdentifier, importer);
    return network.resolveImport(resolved ?? moduleIdentifier);
  };
}

function cloneLock(lock: RRIImportMap): RRIImportMap {
  return {
    imports: { ...lock.imports },
    scopes: Object.fromEntries(
      Object.entries(lock.scopes).map(([scope, table]) => [
        scope,
        { ...table },
      ]),
    ),
    ...(lock.integrity ? { integrity: { ...lock.integrity } } : {}),
  };
}

function sameEntries(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  let keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => left[key] === right[key])
  );
}

function sameLock(left: RRIImportMap, right: RRIImportMap): boolean {
  let scopes = Object.keys(left.scopes);
  return (
    sameEntries(left.imports, right.imports) &&
    scopes.length === Object.keys(right.scopes).length &&
    scopes.every(
      (scope) =>
        right.scopes[scope] !== undefined &&
        sameEntries(left.scopes[scope], right.scopes[scope]),
    ) &&
    sameEntries(left.integrity ?? {}, right.integrity ?? {})
  );
}

// Whether `next` keeps every entry `previous` had, unchanged.
function containsLock(next: RRIImportMap, previous: RRIImportMap): boolean {
  let keeps = (
    after: Record<string, string> | undefined,
    before: Record<string, string>,
  ) => Object.entries(before).every(([key, value]) => after?.[key] === value);
  return (
    keeps(next.imports, previous.imports) &&
    Object.entries(previous.scopes).every(([scope, table]) =>
      keeps(next.scopes[scope], table),
    ) &&
    keeps(next.integrity, previous.integrity ?? {})
  );
}
