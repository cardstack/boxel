import type {
  Definition,
  DefinitionLookup,
  ResolvedCodeRef,
} from '@cardstack/runtime-common';

// Definition lookups over a fixed test fixture. Only lookupDefinition answers;
// the cache methods are inert and forRealm returns the same lookup.

// A definition lookup that answers from `find`, which throws for a type the
// fixture does not have. Nothing is cached.
export function definitionLookupOf(
  find: (codeRef: ResolvedCodeRef) => Definition,
): DefinitionLookup {
  const lookup = {
    async lookupDefinition(codeRef: ResolvedCodeRef): Promise<Definition> {
      return find(codeRef);
    },
    async lookupDefinitionEntry(): Promise<never> {
      throw new Error('lookupDefinitionEntry is not used by these tests');
    },
    async lookupCachedDefinition() {
      return undefined;
    },
    async invalidate() {
      return [];
    },
    async clearRealmDefinitions() {},
    async clearAllDefinitions() {},
    registerRealm() {},
    async getCachedDefinitions() {
      return undefined;
    },
    async populateDefinitionCacheEntry() {
      return undefined;
    },
    async getCachedDefinitionsBatch() {
      return {};
    },
    forRealm() {
      return lookup;
    },
  } as unknown as DefinitionLookup;
  return lookup;
}

// A lookup over a list of definitions, by code ref.
export function definitionsLookup(definitions: Definition[]): DefinitionLookup {
  return definitionLookupOf((codeRef) => {
    let found = definitions.find((d) => {
      let r = d.codeRef as ResolvedCodeRef;
      return r.module === codeRef.module && r.name === codeRef.name;
    });
    if (!found) {
      throw new Error(
        `unexpected definition lookup: ${codeRef.module}/${codeRef.name}`,
      );
    }
    return found;
  });
}
