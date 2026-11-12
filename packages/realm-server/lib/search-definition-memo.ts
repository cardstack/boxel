import { AsyncLocalStorage } from 'node:async_hooks';
import {
  CachingDefinitionLookup,
  type DBAdapter,
  type DefinitionLookup,
  type DefinitionLookupOptions,
  type ModuleDefinitionResult,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

export const MAX_SEARCH_DEFINITIONS = 64;

type Entries = Map<string, Promise<ModuleDefinitionResult>>;
const search = new AsyncLocalStorage<{ entries?: Entries }>();
let nextLookupId = 0;

export async function withSearchDefinitionMemo<T>(
  run: () => Promise<T>,
): Promise<T> {
  let scope: { entries?: Entries } = { entries: new Map() };
  try {
    return await search.run(scope, run);
  } finally {
    // Background work spawned by the request can outlive its async scope.
    scope.entries?.clear();
    scope.entries = undefined;
  }
}

type DefinitionReads = Pick<
  DefinitionLookup,
  'lookupDefinition' | 'lookupDefinitionEntry' | 'definitionGeneration'
>;

// `waiting` marks a caller that joins a lookup another caller in the same
// request started (`DBAdapter.waitingOnSharedWork`). The joiner may hold a
// connection (a search's read snapshot) while that lookup waits for one; left
// unmarked, the connection scheduler could not count the joiner as blocked.
type SharedWorkWait = <R>(fn: () => Promise<R>) => Promise<R>;

export function memoizeSearchDefinitions<T extends DefinitionReads>(
  lookup: T,
  waiting?: SharedWorkWait,
): T {
  let lookupId = nextLookupId++;
  function entry(ref: ResolvedCodeRef, opts?: DefinitionLookupOptions) {
    let entries = search.getStore()?.entries;
    if (!entries) return lookup.lookupDefinitionEntry(ref, opts);

    // Keep each realm lookup, reference spelling and render priority distinct.
    let key = JSON.stringify([
      lookupId,
      lookup.definitionGeneration?.(),
      ref.module,
      ref.name,
      opts?.priority,
    ]);
    let pending = entries.get(key);
    if (pending) {
      let joined = pending;
      return waiting ? waiting(() => joined) : joined;
    }
    if (entries.size >= MAX_SEARCH_DEFINITIONS) {
      return lookup.lookupDefinitionEntry(ref, opts);
    }

    pending = lookup.lookupDefinitionEntry(ref, opts).catch((error) => {
      entries.delete(key);
      throw error;
    });
    entries.set(key, pending);
    return pending;
  }

  return new Proxy(lookup, {
    get(target, prop) {
      if (prop === 'lookupDefinitionEntry') return entry;
      if (prop === 'lookupDefinition') {
        return async (ref: ResolvedCodeRef, opts?: DefinitionLookupOptions) =>
          search.getStore()?.entries
            ? (await entry(ref, opts)).definition
            : target.lookupDefinition(ref, opts);
      }
      let value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export class SearchDefinitionLookup extends CachingDefinitionLookup {
  #waiting?: SharedWorkWait;

  constructor(...args: ConstructorParameters<typeof CachingDefinitionLookup>) {
    super(...args);
    let dbAdapter: DBAdapter = args[0];
    this.#waiting = dbAdapter.waitingOnSharedWork
      ? (fn) => dbAdapter.waitingOnSharedWork!(fn)
      : undefined;
  }

  override forRealm(
    realm: Parameters<CachingDefinitionLookup['forRealm']>[0],
  ): DefinitionLookup {
    return memoizeSearchDefinitions(super.forRealm(realm), this.#waiting);
  }
}
