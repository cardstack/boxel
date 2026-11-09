import { logger } from '@cardstack/runtime-common';
import type { DBAdapter } from '@cardstack/runtime-common';
import {
  PLATFORM_SECRET_OWNER,
  SecretDecryptionError,
  type SealedSecret,
  type SecretBinding,
  type SecretsKeyring,
} from './envelope.ts';

// Rotating the data key. A process seals under its current data key and opens
// under any data key it loaded, so a new data key is rolled out in steps: load
// it everywhere, make it current, re-seal every stored row under it with the
// pass below, and stop loading the old one once no row references it. Each
// step keeps every row openable by every running process, so reads and writes
// of sealed values carry on throughout.

const log = logger('secrets-at-rest');

// A column that stores a secret sealed with the helper, as the four columns
// of a `SealedSecret`. Each table that seals its secrets adds its column to
// SEALED_COLUMNS, so the census reports it and the re-seal pass covers it.
export interface SealedColumn {
  // The binding's field, `<table>.<column>`.
  field: string;
  table: string;
  // A unique, orderable column the pass pages through the table by.
  idColumn: string;
  keyIdColumn: string;
  nonceColumn: string;
  ciphertextColumn: string;
  tagColumn: string;
  // The other columns `binding` reads from a row.
  bindingColumns?: string[];
  // The binding a row's value is sealed under, built from the row's id column
  // and binding columns.
  binding(row: Record<string, unknown>): SecretBinding;
}

export const SEALED_COLUMNS: SealedColumn[] = [
  // The platform's own vendor keys, bound to their row and the endpoint url
  // they are sent to (`lib/proxy-endpoint-keys.ts` seals them the same way).
  {
    field: 'proxy_endpoints.api_key',
    table: 'proxy_endpoints',
    idColumn: 'id',
    keyIdColumn: 'api_key_key_id',
    nonceColumn: 'api_key_nonce',
    ciphertextColumn: 'api_key_ciphertext',
    tagColumn: 'api_key_tag',
    bindingColumns: ['url'],
    binding: (row) => ({
      field: 'proxy_endpoints.api_key',
      owner: PLATFORM_SECRET_OWNER,
      id: String(row.id),
      destination: String(row.url),
    }),
  },
  // The secrets that verify webhooks Boxel receives, bound to their row and
  // the user who registered them, with no destination
  // (`lib/incoming-webhook-secrets.ts` seals them the same way).
  {
    field: 'incoming_webhooks.signing_secret',
    table: 'incoming_webhooks',
    idColumn: 'id',
    keyIdColumn: 'signing_secret_key_id',
    nonceColumn: 'signing_secret_nonce',
    ciphertextColumn: 'signing_secret_ciphertext',
    tagColumn: 'signing_secret_tag',
    bindingColumns: ['username'],
    binding: (row) => ({
      field: 'incoming_webhooks.signing_secret',
      owner: String(row.username),
      id: String(row.id),
    }),
  },
  // Keys that belong to people, bound to their row and their owner
  // (`lib/user-keys.ts` seals them the same way).
  {
    field: 'user_keys.value',
    table: 'user_keys',
    idColumn: 'id',
    keyIdColumn: 'value_key_id',
    nonceColumn: 'value_nonce',
    ciphertextColumn: 'value_ciphertext',
    tagColumn: 'value_tag',
    bindingColumns: ['owner'],
    binding: (row) => ({
      field: 'user_keys.value',
      owner: String(row.owner),
      id: String(row.id),
    }),
  },
  // Each grant's copy of a user's key, bound to the grant, its key, its owner
  // and its destination (`grantCopyBinding` in `lib/user-keys.ts`).
  {
    field: 'user_key_grants.value',
    table: 'user_key_grants',
    idColumn: 'id',
    keyIdColumn: 'value_key_id',
    nonceColumn: 'value_nonce',
    ciphertextColumn: 'value_ciphertext',
    tagColumn: 'value_tag',
    bindingColumns: ['owner', 'key_id', 'destination'],
    binding: (row) => ({
      field: 'user_key_grants.value',
      owner: String(row.owner),
      id: String(row.id),
      parentId: String(row.key_id),
      destination: String(row.destination),
    }),
  },
  // The secrets of the OAuth clients Boxel registers itself, bound to their
  // row and the token endpoint they are sent to (`platformClientBinding` in
  // `lib/oauth.ts`).
  {
    field: 'platform_oauth_clients.secret',
    table: 'platform_oauth_clients',
    idColumn: 'id',
    keyIdColumn: 'secret_key_id',
    nonceColumn: 'secret_nonce',
    ciphertextColumn: 'secret_ciphertext',
    tagColumn: 'secret_tag',
    bindingColumns: ['token_url'],
    binding: (row) => ({
      field: 'platform_oauth_clients.secret',
      owner: PLATFORM_SECRET_OWNER,
      id: String(row.id),
      destination: String(row.token_url),
    }),
  },
];

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function identifier(name: string): string {
  if (!IDENTIFIER.test(name)) {
    throw new Error(`${name} is not a plain lower-case SQL identifier`);
  }
  return name;
}

function columnNames(column: SealedColumn) {
  return {
    table: identifier(column.table),
    id: identifier(column.idColumn),
    keyId: identifier(column.keyIdColumn),
    nonce: identifier(column.nonceColumn),
    ciphertext: identifier(column.ciphertextColumn),
    tag: identifier(column.tagColumn),
    binding: (column.bindingColumns ?? []).map(identifier),
  };
}

// How many rows of a sealed column each data key sealed.
export interface SealedColumnCensus {
  field: string;
  rowsByKeyId: Record<string, number>;
}

export async function sealedCensus(
  dbAdapter: DBAdapter,
  columns: SealedColumn[] = SEALED_COLUMNS,
): Promise<SealedColumnCensus[]> {
  let census: SealedColumnCensus[] = [];
  for (let column of columns) {
    let names = columnNames(column);
    let rows = await dbAdapter.execute(
      `SELECT ${names.keyId} AS key_id, COUNT(*) AS count FROM ${names.table}
       WHERE ${names.keyId} IS NOT NULL GROUP BY ${names.keyId}`,
    );
    let rowsByKeyId: Record<string, number> = {};
    for (let row of rows) {
      rowsByKeyId[String(row.key_id)] = Number(row.count);
    }
    census.push({ field: column.field, rowsByKeyId });
  }
  return census;
}

// Where a rotation stands, as far as one process's keyring and the stored rows
// can tell.
export interface DataKeyStatus {
  currentKeyId: string;
  loadedKeyIds: string[];
  columns: SealedColumnCensus[];
  // Rows sealed under a data key other than the current one: what a re-seal
  // pass has left to do.
  rowsToReseal: number;
  // Loaded data keys, other than the current one, that no row references.
  // Every process can stop loading them.
  retirableKeyIds: string[];
  // Data keys rows reference that this process hasn't loaded. Those rows
  // don't open here.
  unloadedKeyIds: string[];
}

export async function dataKeyStatus(
  dbAdapter: DBAdapter,
  keyring: SecretsKeyring,
  columns: SealedColumn[] = SEALED_COLUMNS,
): Promise<DataKeyStatus> {
  let census = await sealedCensus(dbAdapter, columns);
  let loadedKeyIds = keyring.keyIds;
  let referenced = new Set<string>();
  let rowsToReseal = 0;
  for (let { rowsByKeyId } of census) {
    for (let [keyId, count] of Object.entries(rowsByKeyId)) {
      if (count > 0) {
        referenced.add(keyId);
      }
      if (keyId !== keyring.currentKeyId) {
        rowsToReseal += count;
      }
    }
  }
  return {
    currentKeyId: keyring.currentKeyId,
    loadedKeyIds,
    columns: census,
    rowsToReseal,
    retirableKeyIds: loadedKeyIds.filter(
      (keyId) => keyId !== keyring.currentKeyId && !referenced.has(keyId),
    ),
    unloadedKeyIds: [...referenced].filter(
      (keyId) => !loadedKeyIds.includes(keyId),
    ),
  };
}

// Logs, at startup, how many rows of each sealed column each data key sealed,
// and warns about rows sealed under a data key this process hasn't loaded,
// which is what stopping loading a data key too early looks like.
export async function reportSealedCensus(
  dbAdapter: DBAdapter,
  keyring: SecretsKeyring,
  columns: SealedColumn[] = SEALED_COLUMNS,
): Promise<void> {
  if (columns.length === 0) {
    return;
  }
  try {
    let status = await dataKeyStatus(dbAdapter, keyring, columns);
    for (let { field, rowsByKeyId } of status.columns) {
      let counts = Object.entries(rowsByKeyId)
        .map(([keyId, count]) => `${keyId}=${count}`)
        .join(',');
      log.info(`sealed census: ${field} rowsByKeyId=${counts || 'none'}`);
    }
    if (status.unloadedKeyIds.length > 0) {
      log.warn(
        `sealed census: rows are sealed under data keys this process has not loaded (${status.unloadedKeyIds.join(',')}); those rows do not open`,
      );
    }
  } catch (e: any) {
    log.warn(`sealed census failed: ${e?.message ?? e}`);
  }
}

export interface ResealColumnReport {
  field: string;
  // Rows the pass re-sealed under the current data key.
  resealed: number;
  // Rows that changed between the pass reading and writing them. A write
  // seals under the current data key, so these need nothing more.
  changedConcurrently: number;
  // Rows whose value didn't open under its binding: sealed under a data key
  // this process hasn't loaded, altered, or bound to values the row no longer
  // holds. The pass leaves them as they are.
  unopenable: number;
}

export interface ResealReport {
  currentKeyId: string;
  columns: ResealColumnReport[];
  // True when the pass stopped on its signal before reaching the end. Running
  // it again carries on with the rows it hadn't reached.
  interrupted: boolean;
}

export interface ResealOptions {
  columns?: SealedColumn[];
  batchSize?: number;
  signal?: AbortSignal;
  // Called after each batch with the column's running totals.
  onBatch?: (progress: ResealColumnReport) => void | Promise<void>;
}

// Re-seals every row of every sealed column that a data key other than the
// current one sealed, a batch at a time. Each row is written back only if it
// still holds the value the pass read, so a concurrent write is never undone,
// and a row is selected only while it isn't under the current data key, so a
// pass that stops part way resumes where it left off and a second pass changes
// nothing.
export async function resealUnderCurrentKey(
  dbAdapter: DBAdapter,
  keyring: SecretsKeyring,
  {
    columns = SEALED_COLUMNS,
    batchSize = 100,
    signal,
    onBatch,
  }: ResealOptions = {},
): Promise<ResealReport> {
  let currentKeyId = keyring.currentKeyId;
  let report: ResealReport = { currentKeyId, columns: [], interrupted: false };
  for (let column of columns) {
    let names = columnNames(column);
    let progress: ResealColumnReport = {
      field: column.field,
      resealed: 0,
      changedConcurrently: 0,
      unopenable: 0,
    };
    report.columns.push(progress);
    // Rows that don't open stay under their old data key, so the pass pages
    // by id rather than re-selecting from the start.
    let after: unknown = undefined;
    for (;;) {
      if (signal?.aborted) {
        report.interrupted = true;
        return report;
      }
      let rows = await dbAdapter.execute(
        `SELECT ${[
          names.id,
          names.keyId,
          names.nonce,
          names.ciphertext,
          names.tag,
          ...names.binding,
        ].join(', ')}
         FROM ${names.table}
         WHERE ${names.keyId} IS NOT NULL AND ${names.keyId} <> $1
         ${after === undefined ? '' : `AND ${names.id} > $3`}
         ORDER BY ${names.id}
         LIMIT $2`,
        {
          bind: (after === undefined
            ? [currentKeyId, batchSize]
            : [currentKeyId, batchSize, after]) as any,
        },
      );
      if (rows.length === 0) {
        break;
      }
      for (let row of rows) {
        let sealed: SealedSecret = {
          keyId: String(row[names.keyId]),
          nonce: row[names.nonce] as unknown as Buffer,
          ciphertext: row[names.ciphertext] as unknown as Buffer,
          tag: row[names.tag] as unknown as Buffer,
        };
        let binding = column.binding(row);
        let resealed: SealedSecret;
        try {
          resealed = keyring.reseal(sealed, binding, binding);
        } catch (e) {
          if (!(e instanceof SecretDecryptionError)) {
            throw e;
          }
          progress.unopenable++;
          log.warn(
            `data-key reseal: ${column.field} row ${String(row[names.id])} sealed under ${sealed.keyId} did not open; left as it is`,
          );
          continue;
        }
        let updated = await dbAdapter.execute(
          `UPDATE ${names.table}
           SET ${names.keyId} = $1, ${names.nonce} = $2,
               ${names.ciphertext} = $3, ${names.tag} = $4
           WHERE ${names.id} = $5 AND ${names.keyId} = $6 AND ${names.nonce} = $7
           RETURNING ${names.id}`,
          {
            bind: [
              resealed.keyId,
              resealed.nonce,
              resealed.ciphertext,
              resealed.tag,
              row[names.id],
              sealed.keyId,
              sealed.nonce,
            ] as any,
          },
        );
        if (updated.length > 0) {
          progress.resealed++;
        } else {
          progress.changedConcurrently++;
        }
      }
      after = rows[rows.length - 1][names.id];
      await onBatch?.({ ...progress });
    }
    log.info(
      `data-key reseal: ${column.field} resealed=${progress.resealed} changedConcurrently=${progress.changedConcurrently} unopenable=${progress.unopenable} currentKeyId=${currentKeyId}`,
    );
  }
  return report;
}

export interface ResealPassState {
  running: boolean;
  startedAt?: string;
  finishedAt?: string;
  report?: ResealReport;
  error?: string;
}

// The re-seal pass this process runs in the background, one at a time. Passes
// in two processes at once are safe, since each row is written back only if
// it is unchanged, but the second does no useful work.
export class ResealPass {
  #state: ResealPassState = { running: false };
  #abort: AbortController | undefined;
  #done: Promise<void> = Promise.resolve();

  get state(): ResealPassState {
    return structuredClone(this.#state);
  }

  // Whatever the current pass settles to; resolves straight away when none is
  // running.
  get done(): Promise<void> {
    return this.#done;
  }

  // Starts a pass unless one is running. Returns whether it started one.
  start(
    dbAdapter: DBAdapter,
    keyring: SecretsKeyring,
    options: Omit<ResealOptions, 'signal'> = {},
  ): boolean {
    if (this.#state.running) {
      return false;
    }
    let abort = new AbortController();
    this.#abort = abort;
    this.#state = { running: true, startedAt: new Date().toISOString() };
    log.info(
      `data-key reseal: starting a pass under currentKeyId=${keyring.currentKeyId}`,
    );
    this.#done = resealUnderCurrentKey(dbAdapter, keyring, {
      ...options,
      signal: abort.signal,
    }).then(
      (report) => {
        this.#state = {
          running: false,
          startedAt: this.#state.startedAt,
          finishedAt: new Date().toISOString(),
          report,
        };
      },
      (e: any) => {
        log.error(`data-key reseal: the pass failed: ${e?.message ?? e}`);
        this.#state = {
          running: false,
          startedAt: this.#state.startedAt,
          finishedAt: new Date().toISOString(),
          error: String(e?.message ?? e),
        };
      },
    );
    return true;
  }

  // Stops the running pass after its current batch.
  async stop(): Promise<void> {
    this.#abort?.abort();
    await this.#done;
  }
}
