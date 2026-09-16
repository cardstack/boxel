import { param, type Expression, type Querier } from './expression.ts';
import type { LatticeChangeCapture, LatticeRead } from './lattice-adapters.ts';
import type { LatticeRealmConfig } from './lattice-config.ts';

export const LATTICE_RETAINED_LINK_LIMIT = 16384;

export interface LatticeSnapshotLink {
  realmURL: string;
  ownerURL: string;
  fieldPath: string;
  source: { realmURL: string; url: string };
  snapshot?: false;
}

export type LatticeSnapshotStatus =
  | 'live'
  | 'unavailable'
  | 'forbidden'
  | 'incompatible';

export interface LatticeDataSnapshot {
  kind: 'data';
  by: 'consumer';
  source: LatticeSnapshotLink['source'];
  validatedThrough: number;
  digest: string;
  definitionSeal: string;
  capturedAt: string;
  status: LatticeSnapshotStatus;
  since?: string;
  pinned: boolean;
  note?: string;
}

// Exact, already-authorized local input rows. These are producer receipts, never
// authored relationship metadata. Remote inputs use the ordinary byte capture.
export interface LatticeIndexedSnapshotInput {
  // Omitted for a direct link of the publishing card. A projected relationship
  // belongs to its actual owning input card, whose row must also remain current.
  owner?: { url: string; rowVersion: string; indexGeneration: number };
  fieldPath: string;
  sourceURL: string;
  rowVersion: string;
  // The indexed output can retain an older generation after equal-output cutoff.
  // It fences the row, while validatedThrough orders the source confirmation.
  indexGeneration: number;
  validatedThrough: number;
  definitionSeal: string;
  snapshot?: false;
}

export interface LatticeIndexedSnapshotCapture {
  kind: 'capture-index';
  realmURL: string;
  ownerURL: string;
  consumerGeneration: number;
  inputs: LatticeIndexedSnapshotInput[];
}

type Receipt = Pick<LatticeDataSnapshot, 'validatedThrough' | 'digest'>;
export type LatticeSnapshotChange =
  | LatticeIndexedSnapshotCapture
  | ({
      link: LatticeSnapshotLink;
      // The source version orders copies. This consumer generation fences delayed
      // availability/capture results; generations from different realms never mix.
      consumerGeneration: number;
    } & (
      | {
          kind: 'capture';
          validatedThrough: number;
          definitionSeal: string;
          document: string;
        }
      | {
          kind: 'availability';
          expected: Receipt;
          status: LatticeSnapshotStatus;
        }
      | { kind: 'pin'; expected: Receipt; pinned: boolean; note?: string }
    ));

export interface LatticeSnapshotRead {
  link: LatticeSnapshotLink;
  // An explicit pin selects a retained revision, never an ordering by digest.
  revision?: number;
}

export interface LatticeSnapshotArtifact {
  snapshot: LatticeDataSnapshot;
  document: string;
}

function integer(value: number) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error('Invalid snapshot generation');
}

function linkIdentity(link: LatticeSnapshotLink): string[] {
  let root = (value: string) => {
    let url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.endsWith('/') ||
      url.href !== value
    )
      throw new Error('Invalid snapshot realm');
  };
  let card = (value: string, realm: string) => {
    let url = new URL(value);
    if (
      url.href !== value ||
      !value.startsWith(realm) ||
      value === realm ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      throw new Error('Snapshot identity is outside its realm');
  };
  root(link.realmURL);
  root(link.source.realmURL);
  card(link.ownerURL, link.realmURL);
  card(link.source.url, link.source.realmURL);
  if (!link.fieldPath || link.fieldPath.length > 1024)
    throw new Error('Invalid snapshot field path');
  return [
    link.realmURL,
    link.ownerURL,
    link.fieldPath,
    link.source.realmURL,
    link.source.url,
  ];
}

function predicate(values: string[]): Expression {
  let columns = [
    'realm_url',
    'owner_url',
    'field_path',
    'source_realm_url',
    'source_url',
  ];
  return columns.flatMap((column, i) => [
    i ? 'AND' : '',
    column,
    '=',
    param(values[i]),
  ]);
}

// This adapter has no network/auth/file-write authority. Its caller supplies a
// pinned transaction and already authorized, validated input bytes. Authored
// metadata cannot opt a realm in or make a capture receipt. Current input
// artifact receipts remain separate and unchanged.
export class LatticeRetainedSnapshots
  implements
    LatticeChangeCapture<Querier, LatticeSnapshotChange>,
    LatticeRead<LatticeSnapshotRead, LatticeSnapshotArtifact>
{
  private config: LatticeRealmConfig;
  private query: Querier;

  constructor(config: LatticeRealmConfig, query: Querier) {
    this.config = config;
    this.query = query;
  }

  async recordChange(
    tx: Querier,
    change: LatticeSnapshotChange,
  ): Promise<void> {
    if (change.kind === 'capture-index') return this.captureIndex(tx, change);
    let { link } = change;
    if (!this.config.isEnabled(link.realmURL) || link.snapshot === false)
      return;
    let identity = linkIdentity(link);
    integer(change.consumerGeneration);
    if (change.kind === 'capture') {
      integer(change.validatedThrough);
      if (!change.definitionSeal || change.definitionSeal.length > 1024)
        throw new Error('Missing snapshot definition fingerprint');
    } else {
      integer(change.expected.validatedThrough);
      if (!/^sha256:[a-f0-9]{64}$/.test(change.expected.digest))
        throw new Error('Invalid snapshot digest');
    }
    // Concurrent captures of one link serialize across processes. The table
    // lock also coordinates body collection, but is compatible with other
    // captures. Both locks must remain in the caller's transaction.
    await tx(['LOCK TABLE lattice_retained_snapshots IN ROW EXCLUSIVE MODE']);
    await tx([
      'SELECT pg_advisory_xact_lock(hashtextextended(',
      param(JSON.stringify(['lattice-retained', ...identity])),
      ', 0))',
    ]);
    let where = predicate(identity);
    let [latest] = await tx([
      'SELECT validated_through, digest, definition_seal, state_generation',
      'FROM lattice_retained_snapshots WHERE',
      ...where,
      'ORDER BY validated_through DESC LIMIT 1',
    ]);
    if (latest && change.consumerGeneration < Number(latest.state_generation))
      return;

    if (change.kind === 'capture') {
      if (latest && change.validatedThrough < Number(latest.validated_through))
        return;
      // PostgreSQL validates and hashes the complete JSON document. Never load
      // the wide object graph into Node merely to copy or digest it.
      let [body] = await tx([
        `SELECT 'sha256:' || encode(sha256(convert_to(doc::text,'UTF8')),'hex') AS digest
         FROM (SELECT`,
        param(change.document),
        `::jsonb AS doc) input
         WHERE doc->'data'->>'id' =`,
        param(link.source.url),
        `AND doc->'data'->>'type' = 'card'
         AND jsonb_typeof(doc->'data'->'meta'->'adoptsFrom') = 'object'`,
      ]);
      if (!body)
        throw new Error('Snapshot must contain its source card document');
      if (
        latest &&
        Number(latest.validated_through) === change.validatedThrough &&
        (latest.digest !== body.digest ||
          latest.definition_seal !== change.definitionSeal)
      )
        throw new Error('Conflicting snapshot at the same source generation');
      await tx([
        `INSERT INTO lattice_retained_bodies (realm_url, digest, kind, document) VALUES (`,
        param(link.realmURL),
        ',',
        param(body.digest),
        ", 'data',",
        param(change.document),
        '::jsonb) ON CONFLICT (realm_url, digest) DO NOTHING',
      ]);
      await tx([
        `INSERT INTO lattice_retained_snapshots
         (realm_url,owner_url,field_path,source_realm_url,source_url,validated_through,
          digest,definition_seal,state_generation,status,captured_at) VALUES (`,
        ...identity.flatMap((value, i) => [i ? ',' : '', param(value)]),
        ',',
        param(change.validatedThrough),
        ',',
        param(body.digest),
        ',',
        param(change.definitionSeal),
        ',',
        param(change.consumerGeneration),
        ", 'live', statement_timestamp()) ON CONFLICT DO NOTHING",
      ]);
      await tx([
        "UPDATE lattice_retained_snapshots SET status='live', since=NULL, state_generation=",
        param(change.consumerGeneration),
        'WHERE',
        ...where,
      ]);
    } else if (change.kind === 'availability') {
      // An old failed read must not mark a newer capture unavailable.
      if (
        !latest ||
        Number(latest.validated_through) !== change.expected.validatedThrough ||
        latest.digest !== change.expected.digest
      )
        return;
      await tx([
        'UPDATE lattice_retained_snapshots SET since=CASE WHEN',
        param(change.status),
        "='live' THEN NULL WHEN status=",
        param(change.status),
        'THEN since ELSE statement_timestamp() END, status=',
        param(change.status),
        ', state_generation=',
        param(change.consumerGeneration),
        'WHERE',
        ...where,
      ]);
    } else {
      let rows = await tx([
        'UPDATE lattice_retained_snapshots SET pinned=',
        param(change.pinned),
        ', note=',
        param(change.pinned ? (change.note ?? null) : null),
        'WHERE',
        ...where,
        'AND validated_through=',
        param(change.expected.validatedThrough),
        'AND digest=',
        param(change.expected.digest),
        'RETURNING digest',
      ]);
      if (!rows.length)
        throw new Error('Cannot pin or release a missing snapshot');
      await tx([
        'UPDATE lattice_retained_snapshots SET state_generation=',
        param(change.consumerGeneration),
        'WHERE',
        ...where,
      ]);
    }
    await tx([
      'DELETE FROM lattice_retained_snapshots WHERE',
      ...where,
      'AND pinned=FALSE AND validated_through < (SELECT MAX(validated_through)',
      'FROM lattice_retained_snapshots WHERE',
      ...where,
      ')',
    ]);
  }

  private async captureIndex(
    tx: Querier,
    change: LatticeIndexedSnapshotCapture,
  ) {
    if (!this.config.isEnabled(change.realmURL)) return;
    const inputs = change.inputs.filter((input) => input.snapshot !== false);
    if (!inputs.length) return;
    if (inputs.length > LATTICE_RETAINED_LINK_LIMIT)
      throw new Error('Retained input capture exceeds link bound');
    integer(change.consumerGeneration);
    linkIdentity({
      realmURL: change.realmURL,
      ownerURL: change.ownerURL,
      fieldPath: inputs[0].fieldPath,
      source: { realmURL: change.realmURL, url: inputs[0].sourceURL },
    });
    const entries = new Map<string, Record<string, string | number>>();
    const sources = new Map<string, string>();
    const rowsToLock = new Map<
      string,
      { row_version: string; index_generation: number }
    >();
    const expectRow = (url: string, rowVersion: string, generation: number) => {
      integer(generation);
      if (!/^\d+:\d+:\(\d+,\d+\)$/.test(rowVersion))
        throw new Error('Invalid retained input receipt');
      const receipt = { row_version: rowVersion, index_generation: generation };
      const previous = rowsToLock.get(url);
      if (previous && JSON.stringify(previous) !== JSON.stringify(receipt))
        throw new Error('Conflicting retained owner/source receipts');
      rowsToLock.set(url, receipt);
    };
    for (const input of inputs) {
      const identity = linkIdentity({
        realmURL: change.realmURL,
        ownerURL: input.owner?.url ?? change.ownerURL,
        fieldPath: input.fieldPath,
        source: { realmURL: change.realmURL, url: input.sourceURL },
      });
      integer(input.validatedThrough);
      integer(input.indexGeneration);
      if (input.indexGeneration > input.validatedThrough)
        throw new Error('Retained index output is newer than its validation');
      if (input.validatedThrough > change.consumerGeneration)
        throw new Error('Retained source is newer than its consumer');
      expectRow(input.sourceURL, input.rowVersion, input.indexGeneration);
      if (input.owner) {
        if (input.owner.indexGeneration > input.validatedThrough)
          throw new Error('Retained owner is newer than its validation');
        expectRow(
          input.owner.url,
          input.owner.rowVersion,
          input.owner.indexGeneration,
        );
      }
      if (
        !input.definitionSeal ||
        input.definitionSeal.length > 1024 ||
        !/^\d+:\d+:\(\d+,\d+\)$/.test(input.rowVersion)
      )
        throw new Error('Invalid retained input receipt');
      const key = JSON.stringify(['lattice-retained', ...identity]);
      const receipt = JSON.stringify([
        input.rowVersion,
        input.indexGeneration,
        input.validatedThrough,
        input.definitionSeal,
      ]);
      const sourceReceipt = sources.get(input.sourceURL);
      if (sourceReceipt && sourceReceipt !== receipt)
        throw new Error('Conflicting retained source receipts');
      sources.set(input.sourceURL, receipt);
      const entry = {
        owner_url: input.owner?.url ?? change.ownerURL,
        field_path: input.fieldPath,
        source_url: input.sourceURL,
        row_version: input.rowVersion,
        index_generation: input.indexGeneration,
        validated_through: input.validatedThrough,
        definition_seal: input.definitionSeal,
        lock_key: key,
      };
      const previous = entries.get(key);
      if (previous && JSON.stringify(previous) !== JSON.stringify(entry))
        throw new Error('Conflicting retained input receipts');
      entries.set(key, entry);
    }
    const encoded = JSON.stringify([...entries.values()]);
    const inputRows: Expression = [
      `WITH e AS MATERIALIZED (SELECT owner_url,field_path,source_url,row_version,index_generation,
         validated_through,definition_seal,lock_key FROM jsonb_to_recordset(`,
      param(encoded),
      `::jsonb) AS e(owner_url text,field_path text,source_url text,row_version text,index_generation bigint,
        validated_through bigint,definition_seal text,lock_key text))`,
    ];
    const join: Expression = [
      's.realm_url=',
      param(change.realmURL),
      'AND s.owner_url=e.owner_url',
      'AND s.field_path=e.field_path AND s.source_realm_url=',
      param(change.realmURL),
      'AND s.source_url=e.source_url',
    ];
    await tx(['LOCK TABLE lattice_retained_snapshots IN ROW EXCLUSIVE MODE']);
    // Same per-link namespace as explicit captures/pins; sorted across the entire
    // set before mutation. A single bounded statement, not one RPC per link.
    await tx([
      ...inputRows,
      `SELECT pg_advisory_xact_lock(hashtextextended(lock_key,0))
       FROM (SELECT lock_key FROM e ORDER BY lock_key) ordered`,
    ]);
    const rows = await tx([
      `SELECT i.url FROM boxel_index i
       JOIN jsonb_to_recordset(`,
      param(
        JSON.stringify(
          [...rowsToLock].map(([url, receipt]) => ({ url, ...receipt })),
        ),
      ),
      `::jsonb) AS e(url text,row_version text,index_generation bigint)
         ON i.url=e.url || '.json'
       WHERE i.realm_url=`,
      param(change.realmURL),
      `AND i.type='instance' AND i.is_deleted IS NOT TRUE AND i.has_error IS NOT TRUE
         AND i.generation=e.index_generation
         AND i.xmin::text || ':' || i.cmin::text || ':' || i.ctid::text = e.row_version
         AND i.pristine_doc->>'type'='card'
         AND jsonb_typeof(i.pristine_doc->'meta'->'adoptsFrom')='object'
       ORDER BY i.url FOR SHARE OF i`,
    ]);
    if (rows.length !== rowsToLock.size)
      throw new Error('Retained input changed before capture');
    // Hash each distinct source once per statement, even when several fields
    // consume it. No source body or digest travels back through the pg driver.
    const bodies: Expression = [
      ...inputRows,
      `, source_bodies AS MATERIALIZED (
         SELECT e.source_url,jsonb_build_object('data',
           jsonb_set(i.pristine_doc,'{id}',to_jsonb(e.source_url))) AS document
         FROM (SELECT DISTINCT source_url FROM e) e JOIN boxel_index i
           ON i.url=e.source_url || '.json' WHERE i.realm_url=`,
      param(change.realmURL),
      `AND i.type='instance'), b AS MATERIALIZED (
         SELECT source_url,document,'sha256:' ||
           encode(sha256(convert_to(document::text,'UTF8')),'hex') AS digest FROM source_bodies)`,
    ];
    const [invalid] = await tx([
      ...bodies,
      `SELECT EXISTS(SELECT 1 FROM e JOIN b USING(source_url)
       JOIN lattice_retained_snapshots s ON`,
      ...join,
      `WHERE s.state_generation >`,
      param(change.consumerGeneration),
      `OR s.validated_through > e.validated_through
        OR (s.validated_through=e.validated_through AND
          (s.digest<>b.digest OR s.definition_seal<>e.definition_seal))) AS conflict`,
    ]);
    if (invalid?.conflict)
      throw new Error('Conflicting or obsolete retained input capture');
    await tx([
      ...bodies,
      `, installed AS (
         INSERT INTO lattice_retained_bodies(realm_url,digest,kind,document)
         SELECT DISTINCT ON (digest)`,
      param(change.realmURL),
      `,digest,'data',document FROM b ORDER BY digest
         ON CONFLICT (realm_url,digest) DO NOTHING RETURNING digest)
       INSERT INTO lattice_retained_snapshots
         (realm_url,owner_url,field_path,source_realm_url,source_url,validated_through,
          digest,definition_seal,state_generation,status,captured_at)
       SELECT`,
      param(change.realmURL),
      ',e.owner_url,e.field_path,',
      param(change.realmURL),
      ',e.source_url,e.validated_through,b.digest,e.definition_seal,',
      param(change.consumerGeneration),
      `,'live',statement_timestamp() FROM e JOIN b USING(source_url) ON CONFLICT DO NOTHING`,
    ]);
    await tx([
      ...inputRows,
      `UPDATE lattice_retained_snapshots s SET status='live',since=NULL,state_generation=`,
      param(change.consumerGeneration),
      'FROM e WHERE',
      ...join,
    ]);
    await tx([
      ...inputRows,
      'DELETE FROM lattice_retained_snapshots s USING e WHERE',
      ...join,
      'AND s.pinned=FALSE AND s.validated_through<e.validated_through',
    ]);
  }

  async read(
    request: LatticeSnapshotRead,
  ): Promise<LatticeSnapshotArtifact | undefined> {
    let { link } = request;
    if (!this.config.isEnabled(link.realmURL) || link.snapshot === false)
      return;
    let where = predicate(linkIdentity(link));
    if (request.revision !== undefined) integer(request.revision);
    let [row] = await this.query([
      `SELECT s.validated_through, s.digest, s.definition_seal, s.captured_at,
         s.status, s.since, s.pinned, s.note, b.document::text AS document
       FROM lattice_retained_snapshots s
       JOIN lattice_retained_bodies b USING (realm_url,digest) WHERE`,
      ...where,
      ...(request.revision === undefined
        ? []
        : ['AND validated_through=', param(request.revision)]),
      `ORDER BY validated_through DESC LIMIT 1`,
    ]);
    if (!row) return;
    return {
      snapshot: {
        kind: 'data',
        by: 'consumer',
        source: { ...link.source },
        validatedThrough: Number(row.validated_through),
        digest: row.digest as string,
        definitionSeal: row.definition_seal as string,
        capturedAt: new Date(row.captured_at as string).toISOString(),
        status: row.status as LatticeSnapshotStatus,
        ...(row.since
          ? { since: new Date(row.since as string).toISOString() }
          : {}),
        pinned: row.pinned as boolean,
        ...(row.note === null ? {} : { note: row.note as string }),
      },
      document: row.document as string,
    };
  }

  // Bounded maintenance, outside the interactive capture path. The table lock
  // prevents a capture from acquiring a body between the reference check and
  // deletion. Call in a short transaction; no index/source tables are locked.
  async collectUnreferenced(tx: Querier, realmURL: string): Promise<void> {
    if (!this.config.isEnabled(realmURL)) return;
    await tx([
      'LOCK TABLE lattice_retained_snapshots IN SHARE ROW EXCLUSIVE MODE',
    ]);
    await tx([
      `DELETE FROM lattice_retained_bodies WHERE realm_url=`,
      param(realmURL),
      `AND digest IN (SELECT b.digest FROM lattice_retained_bodies b
       WHERE b.realm_url=`,
      param(realmURL),
      `AND NOT EXISTS (SELECT 1 FROM lattice_retained_snapshots s
         WHERE s.realm_url=b.realm_url AND s.digest=b.digest) LIMIT 256)`,
    ]);
  }
}
