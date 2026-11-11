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
} from '../definition-lookup.ts';
import type {
  IndexRowWithHtml,
  QueryOptions,
  QueryResultsMeta,
  ReadContext,
} from './types.ts';
import { InvalidQueryError, type Query } from '../query.ts';
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
    this.definitionLookup = definitionLookup;
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
  ): Promise<T> {
    if (opts.reader || !this.dbAdapter.withReadSnapshot) {
      return await fn(opts);
    }
    // A search under a time budget tells the snapshot its deadline, so
    // Postgres stops a statement that outruns it (`withReadSnapshot`).
    let deadline = signalDeadline(opts.signal);
    return await this.dbAdapter.withReadSnapshot(
      (reader) => fn({ ...opts, reader }),
      opts.signal
        ? {
            signal: opts.signal,
            ...(deadline !== undefined ? { deadline } : {}),
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
      let found = await this.definitionLookup
        .lookupDefinition(ref)
        .then(() => true)
        .catch(() => false);
      if (!found) {
        let scope = ref.module.split('/').slice(0, 2).join('/');
        throw new InvalidQueryError(
          `type "${ref.name}" from "${ref.module}" names no module: no realm or package is registered at "${scope}/". A type's module is a URL, or an identifier under a prefix this server knows`,
          'invalid-type',
        );
      }
    }
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
        let definition = await this.definitionLookup.lookupDefinition(ref);
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
        if (!isFilterRefersToNonexistentTypeError(error)) {
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
