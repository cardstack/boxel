import {
  LATTICE_RETAINED_LINK_LIMIT,
  type LatticeIndexedSnapshotInput,
} from '@cardstack/runtime-common/lattice-retained-snapshots';
import {
  IndexQueryEngine,
  latticeSnapshotFields,
  type DBAdapter,
  type DefinitionLookup,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import { assertQuery, type Query } from '@cardstack/runtime-common/query';
import {
  param,
  query,
  textArrayParam,
  type Expression,
  type Querier,
} from '@cardstack/runtime-common/expression';
import type { LooseCardResource } from '@cardstack/runtime-common/resource-types';
import {
  assertLatticeOwnerCodes,
  latticeOwnerDefinitionCurrent,
} from '@cardstack/runtime-common/lattice-code-reference';
import { latticeCutoffFilter } from '@cardstack/runtime-common/lattice-query-cutoff';
import { LatticeQueryRegistry } from '@cardstack/runtime-common/lattice-query-registry';
import { latticeReadSetCurrent } from '@cardstack/runtime-common/lattice-kernel';

interface Frame {
  realmURL: string;
  actor: string;
  generation: number;
  loaderEpoch: string;
  permissionVersion: string;
  metadataVersion: string;
}

interface InputReceipt {
  url: string;
  version: string;
  generation: number;
  bytes: number;
  materialized: boolean;
  missing: boolean;
  ownerVersion: string | null;
  rowVersion?: string;
  definitionSeal?: string;
}

export interface LatticeCardInput {
  url: string;
  generation: number;
  resource: LooseCardResource;
}

// A confirmed source deletion is data, unlike an absent index row or an error.
// Its row revision participates in exactly the same publication fence.
export interface LatticeMissingLinkInput {
  url: string;
  generation: number;
  resource: null;
}
export type LatticeLinkInput = LatticeCardInput | LatticeMissingLinkInput;

// No index row cannot establish absence. Only a declared link projection may
// decline to the browser producer, whose authorized input endpoint checks the
// source. This is never a publishable missing-slot receipt.
export class LatticeUnknownLinkInput extends Error {
  constructor() {
    super('Missing Lattice card input');
    this.name = 'LatticeUnknownLinkInput';
  }
}

async function checkFrame(tx: Querier, frame: Frame, lock = false) {
  let [row] = await tx([
    `SELECT g.current_generation,g.loader_epoch,p.xmin::text AS permission_version,
      r.xmin::text AS metadata_version
     FROM realm_generations g JOIN realm_user_permissions p ON p.realm_url=g.realm_url
     JOIN realm_metadata r ON r.url=g.realm_url
     WHERE g.realm_url=`,
    param(frame.realmURL),
    'AND p.username=',
    param(frame.actor),
    `AND p.read=TRUE AND r.archived_at IS NULL`,
    ...(lock ? ['FOR SHARE OF g,p,r'] : []),
  ]);
  if (
    !row ||
    Number(row.current_generation) !== frame.generation ||
    row.loader_epoch !== frame.loaderEpoch ||
    row.permission_version !== frame.permissionVersion ||
    row.metadata_version !== frame.metadataVersion
  )
    throw new Error('Lattice input generation or read authority changed');
  let pending = await tx([
    'SELECT 1 FROM lattice_pending_generations WHERE realm_url=',
    param(frame.realmURL),
    'LIMIT 1',
  ]);
  if (pending.length) throw new Error('Lattice input matching is pending');
}

async function checkQueryInputs(
  tx: Querier,
  frame: Frame,
  typeScope: Expression,
) {
  // Do not evaluate membership using stale computeds: an old value can be a
  // false negative, so checking freshness only on returned rows is insufficient.
  // Missing indexed identities have unknown types and conservatively block.
  const pending = await tx([
    `SELECT 1 FROM lattice_owners o LEFT JOIN boxel_index i
     ON i.realm_url=o.realm_url AND i.url=o.owner_url AND i.type='instance'
     WHERE o.realm_url=`,
    param(frame.realmURL),
    `AND o.retired=FALSE AND (i.url IS NULL OR (`,
    ...typeScope,
    `)) AND (
      i.url IS NULL OR i.has_error IS TRUE OR i.is_deleted IS TRUE
      OR o.dirty_generation IS NOT NULL OR o.published_generation IS NULL
      OR NOT`,
    ...latticeOwnerDefinitionCurrent(
      ['o.realm_url'],
      ['o.owner_url'],
      [param(frame.loaderEpoch)],
      ['o.definition_revision'],
    ),
    `OR i.generation IS DISTINCT FROM o.published_generation
      OR (i.pristine_doc->'meta'->'publication'->>'version') IS DISTINCT FROM '1'
      OR (i.pristine_doc->'meta'->'publication'->>'state') IS DISTINCT FROM 'ready'
      OR (i.pristine_doc->'meta'->'publication'->>'outputRevision') IS DISTINCT FROM o.published_generation::text
      OR (i.pristine_doc->'meta'->'publication'->>'validatedThrough') IS DISTINCT FROM o.input_generation::text
      OR o.input_generation IS NULL OR o.input_generation<0 OR o.input_generation>`,
    param(frame.generation),
    `OR o.published_generation<1
      OR (i.pristine_doc->'meta'->'publication'->>'definitionRevision') IS DISTINCT FROM o.definition_revision
      OR jsonb_typeof(i.pristine_doc->'meta'->'publication'->'computedFields') IS DISTINCT FROM 'array'
      OR jsonb_typeof(i.pristine_doc->'meta'->'publication'->'queryFields') IS DISTINCT FROM 'array'
    ) LIMIT 1`,
  ]);
  if (pending.length)
    throw new Error('Lattice query has unsettled materialized inputs');
}

// A computation reads published card DATA. This object never imports CardDef,
// invokes a card loader, follows relationships, fetches HTTP or starts Chrome.
// The supplied lookup reads indexed schema metadata and must retain its code
// receipts in the enclosing native admission. It has no cache-populate API.
export class LatticeMaterializationInputs {
  static MAX_CARDS = 4096;
  // Raised from 1 MiB / 4 MiB for the baseball stress realm: a season
  // leaderboard reads every player season (673 cards, 4.3 MB after one month
  // of games, growing with the game log). Revisit the bound with that shape.
  static MAX_CARD_BYTES = 4_194_304;
  static MAX_TOTAL_BYTES = 67_108_864;
  static MAX_QUERIES = 64;
  #db: DBAdapter;
  #frame: Frame;
  #engine: IndexQueryEngine;
  #cards = new Map<string, LatticeLinkInput>();
  #receipts = new Map<string, InputReceipt>();
  #watches = new Map<string, Query>();
  #retainedQueries = new Map<string, string[]>();
  #retainedLinks = new Map<
    string,
    { ownerURL: string; fieldPath: string; urls: string[] }
  >();
  #retainedLinkCount = 0;
  #queryScopes = new Map<string, Expression>();
  #bytes = 0;
  #failed = false;
  #sealed = false;
  #busy = false;
  #signal?: AbortSignal;

  private constructor(
    db: DBAdapter,
    frame: Frame,
    lookup: Pick<DefinitionLookup, 'lookupDefinition'>,
    network: VirtualNetwork,
    signal?: AbortSignal,
  ) {
    this.#db = db;
    this.#frame = frame;
    this.#signal = signal;
    this.#engine = new IndexQueryEngine(
      db,
      lookup,
      network,
    ).reverseCompilationScope();
  }

  static async open({
    db,
    realmURL,
    actor,
    generation,
    loaderEpoch,
    lookup,
    network,
    signal,
  }: {
    db: DBAdapter;
    realmURL: string;
    actor: string;
    generation: number;
    loaderEpoch: string;
    lookup: Pick<DefinitionLookup, 'lookupDefinition'>;
    network: VirtualNetwork;
    signal?: AbortSignal;
  }) {
    signal?.throwIfAborted();
    if (
      db.kind !== 'pg' ||
      !Number.isSafeInteger(generation) ||
      generation < 0 ||
      !loaderEpoch
    )
      throw new Error(
        'Lattice materialization needs a PostgreSQL input generation',
      );
    let realm = new URL(realmURL);
    if (!realm.href.endsWith('/') || realm.search || realm.hash)
      throw new Error('Invalid Lattice input realm');
    let [authority] = await query(db, [
      'SELECT p.xmin::text AS permission_version,r.xmin::text AS metadata_version FROM realm_user_permissions p JOIN realm_metadata r ON r.url=p.realm_url WHERE p.realm_url=',
      param(realmURL),
      'AND p.username=',
      param(actor),
      'AND p.read=TRUE AND r.archived_at IS NULL',
    ]);
    if (!authority) throw new Error('Missing Lattice input read authority');
    let frame = {
      realmURL,
      actor,
      generation,
      loaderEpoch,
      permissionVersion: String(authority.permission_version),
      metadataVersion: String(authority.metadata_version),
    };
    await checkFrame((expression) => query(db, expression), frame);
    signal?.throwIfAborted();
    return new LatticeMaterializationInputs(db, frame, lookup, network, signal);
  }

  async #operation<T>(work: () => Promise<T>): Promise<T> {
    this.#signal?.throwIfAborted();
    if (this.#busy || this.#sealed || this.#failed) {
      this.#failed = true;
      throw new Error('Lattice input frame is busy, sealed or failed');
    }
    this.#busy = true;
    try {
      await checkFrame(
        (expression) => query(this.#db, expression),
        this.#frame,
      );
      this.#signal?.throwIfAborted();
      const result = await work();
      this.#signal?.throwIfAborted();
      return result;
    } catch (error) {
      // Catching a missing/oversize input must never turn it into a published
      // zero or empty list. The whole computation loses publication eligibility.
      this.#failed = true;
      throw error;
    } finally {
      this.#busy = false;
    }
  }

  async query(
    fieldPath: string,
    queryInput: Query,
    policy?: { snapshot?: false },
  ) {
    const retain = policy?.snapshot !== false;
    // Keep membership and the invalidation watch tied to the same expression
    // even if the caller edits its query object while the SQL is in flight.
    const input = structuredClone(queryInput);
    return this.#operation(async () => {
      assertQuery(input);
      let realms =
        input.realms ?? (input.realm ? [input.realm] : [this.#frame.realmURL]);
      if (realms.length !== 1 || realms[0] !== this.#frame.realmURL)
        throw new Error(
          'Lattice input query must stay in its authorized realm',
        );
      if (
        !fieldPath ||
        this.#watches.has(fieldPath) ||
        this.#watches.size >= LatticeMaterializationInputs.MAX_QUERIES
      )
        throw new Error('Lattice query paths must be unique and bounded');
      const typeScope = await this.#engine.latticeQueryTypeScope(input.filter);
      const scopeKey = JSON.stringify(typeScope);
      if (!this.#queryScopes.has(scopeKey)) {
        await checkQueryInputs(
          (expression) => query(this.#db, expression),
          this.#frame,
          typeScope,
        );
        this.#queryScopes.set(scopeKey, typeScope);
      }
      let result = await this.#engine.latticeQueryIdentities(
        new URL(this.#frame.realmURL),
        input,
      );
      let cards = await this.#read(result.urls);
      // A truncated sorted page watches its key range, not the whole match:
      // the owner reads the page, so a row that cannot reach the page cannot
      // change what it read. The gate rides in the watch's own filter, so
      // routing, matching and read-path detection all see it as one predicate.
      this.#watches.set(
        fieldPath,
        structuredClone(
          result.cutoff
            ? {
                ...input,
                filter: latticeCutoffFilter(input.filter, result.cutoff),
              }
            : input,
        ),
      );
      if (retain)
        this.#retainedQueries.set(
          fieldPath,
          cards.map((card) => card.url),
        );
      return {
        cards,
        meta: result.meta,
        paged: result.paged,
        cutoff: result.cutoff,
      };
    });
  }

  async read(urls: string[]) {
    const identities = [...urls];
    return this.#operation(() => this.#read(identities));
  }

  async readLinks(urls: string[]) {
    const identities = [...urls];
    return this.#operation(() => this.#read(identities, true));
  }

  // Policy is supplied only by the producer's trusted definition lookup. Target
  // bodies may be admitted later in this same frame; sealing requires receipts.
  retainLinks(
    ownerURL: string,
    fieldPath: string,
    urls: string[],
    policy: { snapshot?: false },
  ) {
    this.#signal?.throwIfAborted();
    if (this.#busy || this.#sealed || this.#failed)
      throw new Error(
        'Cannot retain links in an incomplete Lattice input frame',
      );
    if (policy.snapshot === false) return;
    const owner = this.#receipts.get(ownerURL);
    if (!owner || owner.missing || !owner.rowVersion)
      throw new Error('Missing retained owner receipt');
    const key = JSON.stringify([ownerURL, fieldPath]);
    const count =
      this.#retainedLinkCount -
      (this.#retainedLinks.get(key)?.urls.length ?? 0) +
      urls.length;
    if (count > LATTICE_RETAINED_LINK_LIMIT)
      throw new Error('Retained input capture exceeds link bound');
    this.#retainedLinkCount = count;
    this.#retainedLinks.set(key, { ownerURL, fieldPath, urls: [...urls] });
  }

  #read(urls: string[], allowMissing?: false): Promise<LatticeCardInput[]>;
  #read(urls: string[], allowMissing: true): Promise<LatticeLinkInput[]>;
  async #read(
    urls: string[],
    allowMissing = false,
  ): Promise<LatticeLinkInput[]> {
    this.#signal?.throwIfAborted();
    if (urls.length > LatticeMaterializationInputs.MAX_CARDS)
      throw new Error('Lattice input batch exceeds card bound');
    for (let value of urls) {
      let url = new URL(value);
      if (
        !url.href.startsWith(this.#frame.realmURL) ||
        url.search ||
        url.hash ||
        !url.pathname.endsWith('.json')
      )
        throw new Error(
          'Lattice input must be a canonical card URL in its realm',
        );
    }
    if (
      !allowMissing &&
      urls.some((url) => this.#cards.get(url)?.resource === null)
    )
      throw new Error('Lattice card input is failed, future or oversized');
    let missing = [...new Set(urls)].filter((url) => !this.#cards.has(url));
    if (
      this.#cards.size + missing.length >
      LatticeMaterializationInputs.MAX_CARDS
    )
      throw new Error('Lattice input frame exceeds card bound');
    if (missing.length) {
      // Inspect lengths and freshness before the pg driver receives any body.
      let headers = await query(this.#db, [
        `SELECT i.url,i.xmin::text AS version,i.generation,
          i.xmin::text || ':' || i.cmin::text || ':' || i.ctid::text AS row_version,
          octet_length(i.pristine_doc::text) AS bytes,i.has_error,i.is_deleted,
          COALESCE(i.pristine_doc->'meta' ? 'publication',FALSE) AS materialized,
          i.pristine_doc->'meta'->'publication'->>'version' AS stamp_version,
          i.pristine_doc->'meta'->'publication'->>'state' AS state,
          i.pristine_doc->'meta'->'publication'->>'outputRevision' AS published,
          i.pristine_doc->'meta'->'publication'->>'validatedThrough' AS input,
          i.pristine_doc->'meta'->'publication'->>'definitionRevision' AS revision,
          o.xmin::text AS owner_version,o.published_generation,o.dirty_generation,
          o.retired,o.definition_revision,o.input_generation,`,
        ...latticeOwnerDefinitionCurrent(
          ['o.realm_url'],
          ['o.owner_url'],
          [param(this.#frame.loaderEpoch)],
          ['o.definition_revision'],
        ),
        `AS code_current
         FROM boxel_index i LEFT JOIN lattice_owners o ON o.realm_url=i.realm_url AND o.owner_url=i.url
         WHERE i.realm_url=`,
        param(this.#frame.realmURL),
        "AND i.type='instance' AND i.url = ANY(",
        textArrayParam(missing),
        '::text[])',
      ]);
      let receipts: InputReceipt[] = headers.map((row) => {
        let generation = Number(row.generation),
          bytes = Number(row.bytes);
        if (
          row.has_error ||
          !Number.isSafeInteger(generation) ||
          generation > this.#frame.generation ||
          generation < 0
        )
          throw new Error('Lattice card input is failed, future or oversized');
        if (row.is_deleted) {
          if (!allowMissing)
            throw new Error(
              'Lattice card input is failed, future or oversized',
            );
          return {
            url: String(row.url),
            version: String(row.version),
            generation,
            bytes: 0,
            materialized: false,
            missing: true,
            ownerVersion: null,
          };
        }
        if (
          !Number.isSafeInteger(bytes) ||
          bytes < 1 ||
          bytes > LatticeMaterializationInputs.MAX_CARD_BYTES
        )
          throw new Error('Lattice card input is failed, future or oversized');
        if (row.owner_version && !row.materialized)
          throw new Error('Lattice materialized feeder has no provenance');
        if (
          row.materialized &&
          (row.stamp_version !== '1' ||
            row.state !== 'ready' ||
            !row.owner_version ||
            row.dirty_generation != null ||
            row.retired ||
            Number(row.published) !== generation ||
            Number(row.published_generation) !== generation ||
            row.input == null ||
            !Number.isSafeInteger(Number(row.input)) ||
            Number(row.input) < 0 ||
            Number(row.input) > this.#frame.generation ||
            Number(row.input_generation) !== Number(row.input) ||
            row.code_current !== true ||
            row.definition_revision !== row.revision)
        )
          throw new Error('Lattice materialized feeder is not current');
        return {
          url: String(row.url),
          version: String(row.version),
          generation,
          bytes,
          rowVersion: String(row.row_version),
          definitionSeal: row.materialized
            ? String(row.revision)
            : this.#frame.loaderEpoch,
          materialized: Boolean(row.materialized),
          missing: false,
          ownerVersion:
            row.owner_version == null ? null : String(row.owner_version),
        };
      });
      let bytes = receipts.reduce((total, row) => total + row.bytes, 0);
      if (this.#bytes + bytes > LatticeMaterializationInputs.MAX_TOTAL_BYTES)
        throw new Error('Lattice input frame exceeds byte bound');
      // Validate the returned headers first: an unknown target alongside a
      // failed/future/oversized input must not disguise that failure as decline.
      if (headers.length !== missing.length) {
        if (allowMissing) throw new LatticeUnknownLinkInput();
        throw new Error('Missing Lattice card input');
      }
      this.#signal?.throwIfAborted();
      const present = receipts.filter((receipt) => !receipt.missing);
      let rows = present.length
        ? await query(this.#db, [
            `SELECT i.url,CASE WHEN i.xmin::text=e.version THEN i.pristine_doc::text END AS body
         FROM boxel_index i JOIN jsonb_to_recordset(`,
            param(
              JSON.stringify(
                present.map(({ url, version }) => ({ url, version })),
              ),
            ),
            `::jsonb) AS e(url text,version text) ON e.url=i.url WHERE i.realm_url=`,
            param(this.#frame.realmURL),
            "AND i.type='instance'",
          ])
        : [];
      this.#signal?.throwIfAborted();
      if (
        rows.length !== present.length ||
        rows.some((row) => typeof row.body !== 'string')
      )
        throw new Error('Lattice input changed during read');
      let bodies = new Map(rows.map((row) => [row.url, row.body as string]));
      for (let receipt of receipts) {
        if (receipt.missing) {
          this.#cards.set(receipt.url, {
            url: receipt.url,
            generation: receipt.generation,
            resource: null,
          });
          this.#receipts.set(receipt.url, receipt);
          continue;
        }
        let body = bodies.get(receipt.url)!;
        let resource: LooseCardResource = JSON.parse(body);
        if (resource.type !== 'card' || !resource.meta?.adoptsFrom)
          throw new Error('Invalid published Lattice card data');
        if (receipt.materialized) latticeSnapshotFields(resource);
        this.#cards.set(receipt.url, {
          url: receipt.url,
          generation: receipt.generation,
          resource,
        });
        this.#receipts.set(receipt.url, receipt);
      }
      this.#bytes += bytes;
    }
    return urls.map((url) => structuredClone(this.#cards.get(url)!));
  }

  // Call after computation, then attach this compact check to Batch.done.
  // No card bodies or lookup graphs survive in the commit closure. The caller
  // also checks the definition/code receipts used to compile and compute.
  async sealWithQueries() {
    const queryPreparation = await this.#operation(async () => {
      const watches = [...this.#watches].map(([fieldPath, query]) => ({
        fieldPath,
        query,
      }));
      // Reuse the application's reviewed definitions. The generated identity
      // watch stays on the normal path: base CardDef schema need not belong
      // to the native computation's execution review.
      const prepared = await new LatticeQueryRegistry(
        this.#db,
        this.#engine,
      ).prepareNativeQueries(watches, this.#engine);
      if (!prepared) return undefined;
      const identities = [...this.#receipts.keys()].map((url) =>
        url.replace(/\.json$/, ''),
      );
      if (identities.length) {
        prepared.manifest = [
          ...watches,
          {
            fieldPath: '@lattice/inputs',
            query: {
              realms: [this.#frame.realmURL],
              filter: { in: { id: identities } },
            },
          },
        ];
      }
      if (
        new TextEncoder().encode(JSON.stringify(prepared)).byteLength >
        1_048_576
      )
        return undefined;
      return prepared;
    });
    return { ...this.seal(), queryPreparation };
  }

  seal() {
    this.#signal?.throwIfAborted();
    if (this.#busy || this.#sealed || this.#failed)
      throw new Error('Cannot publish an incomplete Lattice input frame');
    this.#sealed = true;
    let frame = { ...this.#frame },
      receipts = [...this.#receipts.values()],
      queryScopes = [...this.#queryScopes.values()];
    const readSet = receipts.map(({ url, version }) => ({
      id: url,
      revision: version,
    }));
    let watches = [...this.#watches].map(([fieldPath, query]) => ({
      fieldPath,
      query,
    }));
    const retainedInputs: LatticeIndexedSnapshotInput[] = [];
    const append = (
      fieldPath: string,
      url: string,
      owner?: LatticeIndexedSnapshotInput['owner'],
    ) => {
      if (retainedInputs.length >= LATTICE_RETAINED_LINK_LIMIT)
        throw new Error('Retained input capture exceeds link bound');
      const receipt = this.#receipts.get(url);
      if (owner && receipt?.missing) return;
      if (
        !receipt ||
        receipt.missing ||
        !receipt.rowVersion ||
        !receipt.definitionSeal
      )
        throw new Error('Missing retained input receipt');
      retainedInputs.push({
        ...(owner ? { owner } : {}),
        fieldPath,
        sourceURL: url.replace(/\.json$/, ''),
        rowVersion: receipt.rowVersion,
        indexGeneration: receipt.generation,
        validatedThrough: frame.generation,
        definitionSeal: receipt.definitionSeal,
      });
    };
    for (const [fieldPath, urls] of this.#retainedQueries) {
      for (const url of urls) {
        append(fieldPath, url);
      }
    }
    for (const { ownerURL, fieldPath, urls } of this.#retainedLinks.values()) {
      const receipt = this.#receipts.get(ownerURL)!;
      const owner = {
        url: ownerURL.replace(/\.json$/, ''),
        rowVersion: receipt.rowVersion!,
        indexGeneration: receipt.generation,
      };
      for (const url of urls) append(fieldPath, url, owner);
    }
    this.#cards.clear();
    this.#retainedQueries.clear();
    this.#retainedLinks.clear();
    this.#retainedLinkCount = 0;
    return {
      watches,
      retainedInputs,
      identities: receipts.map((row) => row.url.replace(/\.json$/, '')),
      async assertCurrent(tx: Querier) {
        await checkFrame(tx, frame, true);
        for (const scope of queryScopes)
          await checkQueryInputs(tx, frame, scope);
        if (!receipts.length) return;
        let rows = await tx([
          `SELECT i.url,i.xmin::text AS version FROM boxel_index i
           JOIN jsonb_to_recordset(`,
          param(JSON.stringify(receipts.map(({ url }) => ({ url })))),
          `::jsonb) AS e(url text) ON e.url=i.url WHERE i.realm_url=`,
          param(frame.realmURL),
          "AND i.type='instance' ORDER BY i.url FOR SHARE OF i",
        ]);
        let versions = new Map(rows.map((row) => [row.url, row.version]));
        if (
          rows.length !== receipts.length ||
          !latticeReadSetCurrent(readSet, (id) =>
            versions.has(id)
              ? {
                  id,
                  revision: versions.get(id) as string,
                  // Coverage was verified when the frame admitted this row.
                  // An unchanged xmin under this lock preserves that evidence.
                  complete: true,
                  pending: false,
                }
              : undefined,
          )
        )
          throw new Error('Lattice card input changed before publication');
        let owners = receipts.filter((row) => row.materialized);
        if (!owners.length) return;
        let current = await tx([
          'SELECT owner_url,xmin::text AS version FROM lattice_owners WHERE realm_url=',
          param(frame.realmURL),
          'AND owner_url = ANY(',
          textArrayParam(owners.map((row) => row.url)),
          '::text[]) ORDER BY owner_url FOR SHARE',
        ]);
        let ownerVersions = new Map(
          current.map((row) => [row.owner_url, row.version]),
        );
        if (
          current.length !== owners.length ||
          owners.some(
            (receipt) =>
              ownerVersions.get(receipt.url) !== receipt.ownerVersion,
          )
        )
          throw new Error(
            'Lattice feeder freshness changed before publication',
          );
        await assertLatticeOwnerCodes(
          tx,
          frame.realmURL,
          owners.map((row) => row.url),
        );
      },
    };
  }
}
