// The engine's base layer: the adapter, definition lookup, virtual network,
// vector query and dialect every layer above reads; running a statement
// (through the search's read snapshot when it has one); the realm's default
// time zone; and type resolution (definitions, a type's index keys, the
// field names at a level for labels, refusing a module no realm holds).
// Owns: shared state, and the `_search` contract later layers call back
// into (implemented by search-pipeline.ts).
// Must not: compile a filter, sort or facet.
// Guarantees: one snapshot per search (docs/search.md, "Bounds every query
// runs under"); the realm default zone (docs/search.md, "Time zones").

import { refuse } from '../query-v2/query-refusals.ts';
import {
  DefinitionsUnavailableError,
  SearchBoundError,
  definitionWaitMs,
} from '../search-bounds.ts';
import { InvalidQueryError } from '../invalid-query-error.ts';
import { type CardExpression, type Expression, query } from '../expression.ts';
import {
  type CodeRef,
  type ResolvedCodeRef,
  internalKeyFor,
  isResolvedCodeRef,
} from '../index.ts';
import { type DBAdapter, signalDeadline } from '../db.ts';
import { type Definition, getFieldDef } from '../definitions.ts';
import {
  type DefinitionLookup,
  isFilterRefersToNonexistentTypeError,
  isTransientDefinitionLookupError,
} from '../definition-lookup.ts';
import type {
  IndexRowWithHtml,
  QueryOptions,
  QueryResultsMeta,
  ReadContext,
} from './types.ts';
import type { Query } from '../query.ts';
import { VectorQuery, type VectorStatus } from '../vector-query.ts';
import type { VirtualNetwork } from '../virtual-network.ts';
import { coerceTypes } from '../index-structure.ts';
import { getField } from './filter-paths.ts';
import stringify from 'safe-stable-stringify';
import { tableFromOpts } from './index-sql.ts';
import { RealmZoneCache } from './realm-time-zone.ts';
import { dialectFor, type QueryDialect } from './dialect.ts';

export abstract class EngineCore {
  // Implemented by later layers (see the module map in the file header of
  // index-query-engine.ts). Bindings, a sort window and column reads run a
  // nested search through the coordinator.
  protected abstract _search(
    realmURL: URL,
    asWritten: Query,
    opts: QueryOptions,
    selectClauseExpression: CardExpression,
    entryType?: 'instance' | 'file' | 'all',
  ): Promise<{
    meta: QueryResultsMeta;
    results: Partial<IndexRowWithHtml>[];
  }>;

  protected dbAdapter: DBAdapter;
  protected definitionLookup: DefinitionLookup;
  protected virtualNetwork: VirtualNetwork;
  // near sorts, filters and signals, look-alikes, and the space guard
  protected vectors: VectorQuery;
  // What differs between the Postgres and SQLite indexes (dialect.ts).
  protected dialect: Readonly<QueryDialect>;

  constructor(
    dbAdapter: DBAdapter,
    definitionLookup: DefinitionLookup,
    virtualNetwork: VirtualNetwork,
  ) {
    this.dbAdapter = dbAdapter;
    // Every lookup the engine makes, nested field types included, is
    // classified the same way (`asSearchDefinitionError`).
    // A lookup inside a search's read snapshot is waited on outside it
    // (`DBAdapter.outsideReadSnapshot`), and one under a time budget is
    // bounded (`definitionWaitMs`).
    this.definitionLookup = classifyingDefinitionLookup(
      definitionLookup,
      dbAdapter,
    );
    this.virtualNetwork = virtualNetwork;
    this.dialect = dialectFor(dbAdapter.kind);
    this.vectors = new VectorQuery({
      dbAdapter,
      virtualNetwork,
      fieldOf: async (on, path) =>
        await getField(
          await this.getDefinition(on),
          path,
          this.definitionLookup,
        ),
    });
  }

  // A search's statements read through its snapshot (`opts.reader`, see
  // `inSnapshot`) and are cancelled by its signal; a statement outside a
  // search reads the adapter itself.
  protected db(ctx?: ReadContext): DBAdapter {
    return ctx?.reader ?? this.dbAdapter;
  }

  protected async query(expression: Expression, ctx?: ReadContext) {
    return await query(this.db(ctx), expression, coerceTypes, ctx?.signal);
  }

  // Run `fn` with every statement of one search reading one snapshot of the
  // index: its rows, total and facets, the narrow and wide passes of a page,
  // its bindings' and comparison sets' queries, and its near reads (see
  // `DBAdapter.withReadSnapshot`). A search nested in another (a binding, a
  // rerank's window, an exact retry) already has one, and reuses it. An
  // adapter without snapshots runs `fn` as it is.
  protected async inSnapshot<T>(
    opts: QueryOptions,
    fn: (opts: QueryOptions) => Promise<T>,
    settled?: ReadonlyMap<string, Promise<unknown>>,
  ): Promise<T> {
    if (opts.reader || !this.dbAdapter.withReadSnapshot) {
      return await fn(opts);
    }
    // A search under a time budget tells the snapshot its deadline, so
    // Postgres stops a statement that outruns it (`withReadSnapshot`).
    let deadline = signalDeadline(opts.signal);
    return await this.dbAdapter.withReadSnapshot(
      (reader) => fn({ ...opts, reader }),
      opts.signal || settled
        ? {
            ...(opts.signal ? { signal: opts.signal } : {}),
            ...(deadline !== undefined ? { deadline } : {}),
            ...(settled ? { settled } : {}),
          }
        : undefined,
    );
  }

  // The realm's default time zone, cached per realm index generation
  // (realm-time-zone.ts).
  #realmZones = new RealmZoneCache();
  protected async realmTimeZone(
    realmURL: URL,
    opts: QueryOptions,
  ): Promise<string | undefined> {
    return await this.#realmZones.read(realmURL, {
      table: tableFromOpts(opts),
      cacheable:
        this.dialect.realmGenerations && opts.pendingStagingId === undefined,
      run: (expression) => this.query(expression, opts),
    });
  }

  // The field names at one level of a type, for label resolution.
  protected fieldsAt = async (
    type: CodeRef,
    prefix: string[],
  ): Promise<string[] | undefined> => {
    let definition = await this.getDefinition(type).catch(() => undefined);
    if (!definition) return undefined;
    if (!prefix.length) return Object.keys(definition.fields);
    let field = await getFieldDef(definition, prefix.join('.'), async (ref) =>
      isResolvedCodeRef(ref)
        ? await this.definitionLookup.lookupDefinition(ref)
        : undefined,
    ).catch(() => undefined);
    if (!field || !isResolvedCodeRef(field.fieldOrCard)) return undefined;
    let inner = await this.definitionLookup
      .lookupDefinition(field.fieldOrCard)
      .catch(() => undefined);
    return inner ? Object.keys(inner.fields) : undefined;
  };

  protected async getDefinition(codeRef: CodeRef): Promise<Definition> {
    if (!isResolvedCodeRef(codeRef)) {
      throw new Error(
        `Your filter refers to a nonexistent type: ${stringify(codeRef)}`,
      );
    }
    return await this.lookupDefinitionForSearch(codeRef);
  }

  // A definition lookup on behalf of a search. A type that is genuinely absent
  // stays `FilterRefersToNonexistentTypeError`, which matches nothing; every
  // other failure — the module's prerender aborted, timed out or was
  // unreachable, a cached row recording that, a populate an invalidation
  // discarded — says nothing about the type's cards, so it is refused as
  // retryable (`DefinitionsUnavailableError`, 503) and never answered `ok, 0`.
  protected async lookupDefinitionForSearch(
    codeRef: ResolvedCodeRef,
  ): Promise<Definition> {
    return await this.definitionLookup.lookupDefinition(codeRef);
  }

  // A type named by an `@scope/…` identifier that no realm or package this
  // server registers holds, and that names no type it can read, is refused
  // (`invalid-type`) rather than matching nothing: no module answers to it.
  // An identifier the network does not register but whose type is found
  // anyway (a definition lookup that knows it) is read as before.
  protected async assertKnownModules(parts: Record<string, unknown>) {
    let refs = new Map<string, ResolvedCodeRef>();
    let walk = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      for (let [key, value] of Object.entries(node)) {
        if (
          (key === 'on' || key === 'type') &&
          value &&
          typeof value === 'object' &&
          typeof (value as any).module === 'string' &&
          typeof (value as any).name === 'string'
        ) {
          let ref = value as ResolvedCodeRef;
          if (
            ref.module.startsWith('@') &&
            !this.virtualNetwork.isRegisteredPrefix(ref.module)
          ) {
            refs.set(`${ref.module}#${ref.name}`, ref);
          }
          continue;
        }
        walk(value);
      }
    };
    walk(parts);
    for (let ref of refs.values()) {
      let found = await this.lookupDefinitionForSearch(ref)
        .then(() => true)
        .catch((error: unknown) => {
          if (
            isFilterRefersToNonexistentTypeError(error) &&
            !isTransientDefinitionLookupError(error)
          ) {
            return false;
          }
          throw error;
        });
      if (!found) {
        let scope = ref.module.split('/').slice(0, 2).join('/');
        throw refuse('type-names-no-module', undefined, {
          name: ref.name,
          module: ref.module,
          scope,
        });
      }
    }
  }

  // Resolve every type a query names (`on` / `type`, in its filter, sort,
  // bindings and facets) through the definition lookup, so the snapshot a
  // search then opens finds them cached rather than waiting on a prerender
  // while it holds a connection. A warm-up only: a lookup that fails here is
  // not the search's failure, since the search may never need that type (a
  // query refused by validation, a filter that names a type it does not
  // read through). The search's own lookup decides, and classifies, when it
  // does (`asSearchDefinitionError`). The one thing this can end the search
  // with is its signal — its time budget or its caller going away — with
  // that signal's reason, or, under a time budget, a lookup still pending at
  // the definition wait bound (`definitionWaitMs`): that one is refused as
  // `definitions-unavailable` (503), since the search would only wait on it
  // again.
  //
  // Returns the lookups that succeeded, by their key as work outside the
  // snapshot, for the search to hand its snapshot (`inSnapshot`): the search
  // then reads each definition once. One that failed is not handed on, so
  // the search's own lookup tries again and decides.
  protected async resolveDefinitionsBeforeSnapshot(
    query: unknown,
    opts: { signal?: AbortSignal },
  ): Promise<Map<string, Promise<unknown>>> {
    let settled = new Map<string, Promise<unknown>>();
    let refs = namedTypeRefs(query);
    if (refs.length === 0) {
      return settled;
    }
    let pending = new Set(refs);
    let lookups = Promise.all(
      refs.map((ref) => {
        let lookup = this.lookupDefinitionForSearch(ref);
        return lookup.then(
          () => {
            pending.delete(ref);
            settled.set(definitionWorkKey(ref), lookup);
          },
          () => {
            pending.delete(ref);
          },
        );
      }),
    );
    let signal = opts.signal;
    if (!signal) {
      await lookups;
      return settled;
    }
    signal.throwIfAborted();
    lookups.catch(() => {});
    let onAbort: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let waitMs = definitionWaitMs(signalDeadline(signal));
    try {
      await Promise.race([
        lookups,
        new Promise<never>((_resolve, reject) => {
          onAbort = () => reject(signal!.reason);
          signal!.addEventListener('abort', onAbort, { once: true });
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            let ref = [...pending][0] ?? refs[0];
            reject(definitionWaitExpired(ref, waitMs));
          }, waitMs);
        }),
      ]);
    } finally {
      if (onAbort) {
        signal.removeEventListener('abort', onAbort);
      }
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
    return settled;
  }

  // Every `types` membership key a ref can legitimately match:
  //
  // - the ref's own key. `internalKeyFor` resolves any spelling to a real URL
  //   and unresolves it to the registered prefix, so a filter naming a module
  //   by prefix, real URL or virtual alias yields one key — the same form the
  //   indexer writes.
  // - the key of the ref's canonical (defining-module) codeRef. Rows stamp
  //   `types` via `identifyCard`, which names the module a class is defined
  //   in — so a ref that names the type through a re-exporting module (e.g.
  //   file-api's FileDef, re-exported from card-api) only matches through its
  //   definition's canonical ref. The host's search resource applies the same
  //   canonicalization (via the loader) before its client-side matching,
  //   keeping the two evaluations in agreement.
  //
  // A ref whose definition doesn't resolve keeps only its own key and matches
  // nothing (unless rows were stamped under that spelling).
  //
  // Public because the live-search cache key is scoped by the same keys: it
  // reads a per-type watermark for each of a query's type anchors, and those
  // keys have to be the ones this engine matches rows on or the key would
  // address a row nothing writes. Calling the engine rather than reproducing
  // it is what keeps the two from drifting.
  async typeKeysFor(ref: CodeRef): Promise<string[]> {
    let keys = [internalKeyFor(ref, undefined, this.virtualNetwork)];
    if (isResolvedCodeRef(ref)) {
      try {
        let definition = await this.lookupDefinitionForSearch(ref);
        if (isResolvedCodeRef(definition.codeRef)) {
          let key = internalKeyFor(
            definition.codeRef,
            undefined,
            this.virtualNetwork,
          );
          if (!keys.includes(key)) {
            keys.push(key);
          }
        }
      } catch (error) {
        // A ref that names no resolvable type falls through to the
        // spelling-based keys (matching nothing unless rows were stamped under
        // that spelling) — the same way the engine's top-level catch treats a
        // nonexistent type as an empty result rather than an error. Any other
        // failure is unexpected and propagates rather than silently
        // narrowing the match.
        if (
          !isFilterRefersToNonexistentTypeError(error) ||
          isTransientDefinitionLookupError(error)
        ) {
          throw error;
        }
      }
    }
    return keys;
  }

  // Each vector field's state for a card read: `ok` when every vector it
  // holds is in the field's declared space, `stale` when some are in another
  // (see `VectorQuery#vectorStatus`).
  async vectorStatus(url: URL): Promise<VectorStatus> {
    return await this.vectors.vectorStatus(url);
  }
}

function asSearchDefinitionError(
  error: unknown,
  codeRef: ResolvedCodeRef,
): unknown {
  if (
    error instanceof SearchBoundError ||
    error instanceof InvalidQueryError ||
    (error as { name?: unknown })?.name === 'AbortError' ||
    (error as { name?: unknown })?.name === 'TimeoutError' ||
    (isFilterRefersToNonexistentTypeError(error) &&
      !isTransientDefinitionLookupError(error))
  ) {
    return error;
  }
  return new DefinitionsUnavailableError(
    `${codeRef.name} from "${codeRef.module}"`,
    { cause: error },
  );
}

// The refusal of a search whose definition lookup outlasted its wait bound.
function definitionWaitExpired(
  codeRef: ResolvedCodeRef,
  waitMs: number,
): DefinitionsUnavailableError {
  return new DefinitionsUnavailableError(
    `${codeRef.name} from "${codeRef.module}"`,
    {
      cause: new Error(
        `the definition lookup did not finish within ${waitMs}ms`,
      ),
    },
  );
}

// `lookup`, or the definition wait bound's refusal if it has not settled
// within `waitMs`. The lookup itself runs on for whoever else awaits it.
async function withinDefinitionWait<T>(
  lookup: Promise<T>,
  codeRef: ResolvedCodeRef,
  waitMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  lookup.catch(() => {});
  try {
    return await Promise.race([
      lookup,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(definitionWaitExpired(codeRef, waitMs)),
          waitMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// The key a definition lookup has as work outside a read snapshot
// (`outsideReadSnapshot`), so a lookup done before the snapshot answers the
// same lookup inside it.
function definitionWorkKey(codeRef: ResolvedCodeRef, rest: unknown[] = []) {
  return `definition:${stringify([codeRef.module, codeRef.name, rest])}`;
}

function classifyingDefinitionLookup(
  inner: DefinitionLookup,
  dbAdapter: DBAdapter,
): DefinitionLookup {
  return new Proxy(inner, {
    get(target, prop) {
      if (prop === 'lookupDefinition') {
        return async (codeRef: ResolvedCodeRef, ...rest: unknown[]) => {
          let classified = async () => {
            try {
              return await (target.lookupDefinition as any)(codeRef, ...rest);
            } catch (error) {
              throw asSearchDefinitionError(error, codeRef);
            }
          };
          // Under a time budget (a snapshot opened with a signal) the wait is
          // bounded; without one (the indexer's searches) it lasts as long as
          // the lookup does.
          let run = (bound: { signal?: AbortSignal; deadline?: number }) =>
            bound.signal
              ? withinDefinitionWait(
                  classified(),
                  codeRef,
                  definitionWaitMs(
                    bound.deadline ?? signalDeadline(bound.signal),
                  ),
                )
              : classified();
          if (!dbAdapter.outsideReadSnapshot) {
            return await run({});
          }
          return await dbAdapter.outsideReadSnapshot(
            definitionWorkKey(codeRef, rest),
            run,
          );
        };
      }
      let value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

// The resolved type refs a query names under `on` or `type`, anywhere in it.
function namedTypeRefs(query: unknown): ResolvedCodeRef[] {
  let refs = new Map<string, ResolvedCodeRef>();
  let walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    for (let [key, value] of Object.entries(node)) {
      if (
        (key === 'on' || key === 'type') &&
        value &&
        typeof value === 'object' &&
        typeof (value as any).module === 'string' &&
        typeof (value as any).name === 'string'
      ) {
        let ref = value as ResolvedCodeRef;
        refs.set(`${ref.module}#${ref.name}`, ref);
        continue;
      }
      walk(value);
    }
  };
  walk(query);
  return [...refs.values()];
}
