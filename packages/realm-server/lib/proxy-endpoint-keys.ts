import { randomUUID } from 'node:crypto';
import { logger, type DBAdapter } from '@cardstack/runtime-common';
import {
  backfillDecision,
  reportTamperedSecret,
  hasSealedColumns,
  openWithPlainTextFallback,
  PLATFORM_SECRET_OWNER,
  sealedColumnBindings,
  sealedColumnsSelect,
  sealedFromColumns,
  secretsKeyring,
  type SecretBinding,
  type SecretsKeyring,
} from './secrets-at-rest/index.ts';

// A proxy endpoint's key is sealed with the secrets-at-rest helper into
// `api_key_ciphertext`, `api_key_nonce`, `api_key_tag` and `api_key_key_id`.
// The plain-text `api_key` column is kept in step by every write, so a server
// running the previous revision reads the same key, and it is the source the
// backfill seals from.

const log = logger('proxy-endpoint-keys');

export const PROXY_ENDPOINT_KEY_FIELD = 'proxy_endpoints.api_key';

// The key columns a read selects, with the sealed parts as base64.
export const PROXY_ENDPOINT_KEY_COLUMNS = [
  'api_key',
  sealedColumnsSelect('api_key'),
].join(', ');

export interface ProxyEndpointKeyRow {
  id: string;
  url: string;
  api_key: string | null;
  api_key_ciphertext: string | null;
  api_key_nonce: string | null;
  api_key_tag: string | null;
  api_key_key_id: string | null;
}

// A key is the platform's own, bound to its row and to the endpoint url it is
// sent to.
export function proxyEndpointKeyBinding({
  id,
  url,
}: {
  id: string;
  url: string;
}): SecretBinding {
  return {
    field: PROXY_ENDPOINT_KEY_FIELD,
    owner: PLATFORM_SECRET_OWNER,
    id,
    destination: url,
  };
}

// Each row whose sealed key disagrees with its plain-text key is reported
// once per sealed value, not on every reload of the endpoint cache.
const reportedDrift = new Set<string>();

function reportDrift(row: ProxyEndpointKeyRow, reason: string): void {
  let drift = `${row.id}|${row.api_key_nonce}|${reason}`;
  if (reportedDrift.has(drift)) {
    return;
  }
  reportedDrift.add(drift);
  log.warn(
    `the sealed key for proxy endpoint ${row.url} ${reason}, so its plain-text key is used`,
  );
}

// The key a row holds. A sealed key that opens to the plain-text key is served
// from the sealed columns. The plain-text column is the source while it
// exists, so when the two disagree it wins: a row the backfill hasn't sealed
// yet, a sealed key that doesn't open (sealed under a data key this process
// hasn't loaded, or on a row whose id or url was edited outside the
// application), and a plain-text key edited outside the application are all
// served from `api_key`, and an operator's edit reaches the proxy without a
// restart. Each disagreement is reported.
export function readProxyEndpointKey(
  row: ProxyEndpointKeyRow,
  keyring?: SecretsKeyring,
): string | null {
  let sealed = sealedFromColumns({ ...row }, 'api_key');
  if (!sealed) {
    return row.api_key;
  }
  return openWithPlainTextFallback({
    plainText: row.api_key,
    sealed,
    binding: proxyEndpointKeyBinding(row),
    keyring: keyring ?? secretsKeyring(),
    onDisagreement: (reason) => reportDrift(row, reason),
  });
}

export interface ProxyEndpoint {
  url: string;
  apiKey: string | null;
  creditStrategy: string;
  supportsStreaming: boolean;
  authMethod?: string | null;
  authParameterName?: string | null;
}

// Adds an endpoint, or replaces the one configured for the same url, and
// returns its id. The key is sealed into the sealed columns and written to the
// plain-text column alongside.
export async function saveProxyEndpoint(
  dbAdapter: DBAdapter,
  endpoint: ProxyEndpoint,
  keyring: SecretsKeyring = secretsKeyring(),
): Promise<string> {
  let [existing] = await dbAdapter.execute(
    'SELECT id FROM proxy_endpoints WHERE url = $1',
    { bind: [endpoint.url] },
  );
  let id = existing ? String(existing.id) : randomUUID();
  let sealed =
    endpoint.apiKey == null
      ? undefined
      : keyring.seal(
          endpoint.apiKey,
          proxyEndpointKeyBinding({ id, url: endpoint.url }),
        );
  await dbAdapter.execute(
    `INSERT INTO proxy_endpoints (
       id, url, api_key, credit_strategy, supports_streaming, auth_method,
       auth_parameter_name, api_key_ciphertext, api_key_nonce, api_key_tag,
       api_key_key_id, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, decode($8, 'base64'), decode($9, 'base64'),
       decode($10, 'base64'), $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )
     ON CONFLICT (id) DO UPDATE SET
       url = EXCLUDED.url,
       api_key = EXCLUDED.api_key,
       credit_strategy = EXCLUDED.credit_strategy,
       supports_streaming = EXCLUDED.supports_streaming,
       auth_method = EXCLUDED.auth_method,
       auth_parameter_name = EXCLUDED.auth_parameter_name,
       api_key_ciphertext = EXCLUDED.api_key_ciphertext,
       api_key_nonce = EXCLUDED.api_key_nonce,
       api_key_tag = EXCLUDED.api_key_tag,
       api_key_key_id = EXCLUDED.api_key_key_id,
       updated_at = CURRENT_TIMESTAMP`,
    {
      bind: [
        id,
        endpoint.url,
        endpoint.apiKey,
        endpoint.creditStrategy,
        endpoint.supportsStreaming,
        endpoint.authMethod ?? null,
        endpoint.authParameterName ?? null,
        ...sealedColumnBindings(sealed),
      ],
      redactBindings: true,
    },
  );
  return id;
}

export interface ProxyEndpointKeySealing {
  // Rows whose key was sealed: rows with no sealed key and, with
  // `resealTampered`, tampered rows.
  sealed: number;
  // Rows with no plain-text key whose sealed columns were emptied.
  cleared: number;
  // Rows whose sealed key already matched their plain-text key.
  unchanged: number;
  // Rows sealed under a data key this process hasn't loaded, left as they
  // are.
  unloadedKey: number;
  // Rows whose sealed value fails to open under a loaded key, opens to a
  // value other than the plain text, or is sealed under the public local
  // development key in a process sealing with another key, reported and left
  // as they are.
  tampered: number;
  // Rows that changed between the read and the update, left to whoever
  // changed them.
  skipped: number;
}

// Seals every row's plain-text key into its sealed columns, as
// `backfillDecision` decides, and empties the sealed columns of a row with no
// plain-text key.
//
// Each update applies only while the row still holds the key and the nonce
// that were read, so it never overwrites a concurrent write or re-seal, and
// replicas can run it at once.
export async function sealProxyEndpointKeys(
  dbAdapter: DBAdapter,
  keyring: SecretsKeyring = secretsKeyring(),
  { resealTampered = false }: { resealTampered?: boolean } = {},
): Promise<ProxyEndpointKeySealing> {
  let rows = (await dbAdapter.execute(
    `SELECT id, url, ${PROXY_ENDPOINT_KEY_COLUMNS} FROM proxy_endpoints`,
  )) as unknown as ProxyEndpointKeyRow[];
  let result: ProxyEndpointKeySealing = {
    sealed: 0,
    cleared: 0,
    unchanged: 0,
    unloadedKey: 0,
    tampered: 0,
    skipped: 0,
  };
  for (let row of rows) {
    let binding = proxyEndpointKeyBinding(row);
    if (row.api_key == null) {
      if (!hasSealedColumns({ ...row }, 'api_key')) {
        result.unchanged++;
        continue;
      }
      let updated = await dbAdapter.execute(
        `UPDATE proxy_endpoints SET
           api_key_ciphertext = NULL, api_key_nonce = NULL, api_key_tag = NULL,
           api_key_key_id = NULL
         WHERE id = $1 AND api_key IS NULL
           AND api_key_nonce IS NOT DISTINCT FROM decode($2, 'base64')
         RETURNING id`,
        { bind: [row.id, row.api_key_nonce] },
      );
      result[updated.length > 0 ? 'cleared' : 'skipped']++;
      continue;
    }
    let decision = backfillDecision({
      plainText: row.api_key,
      sealed: sealedFromColumns({ ...row }, 'api_key'),
      binding,
      keyring,
      subject: `the key for proxy endpoint ${row.url}`,
      warn: (message) => log.warn(message),
      reportTampered: (message) => reportTamperedSecret(log, message),
      resealTampered,
    });
    if (decision !== 'seal') {
      result[decision]++;
      continue;
    }
    let updated = await dbAdapter.execute(
      `UPDATE proxy_endpoints SET
         api_key_ciphertext = decode($3, 'base64'),
         api_key_nonce = decode($4, 'base64'),
         api_key_tag = decode($5, 'base64'),
         api_key_key_id = $6
       WHERE id = $1 AND url = $2 AND api_key = $7
         AND api_key_nonce IS NOT DISTINCT FROM decode($8, 'base64')
       RETURNING id`,
      {
        bind: [
          row.id,
          row.url,
          ...sealedColumnBindings(keyring.seal(row.api_key, binding)),
          row.api_key,
          row.api_key_nonce,
        ],
        redactBindings: true,
      },
    );
    result[updated.length > 0 ? 'sealed' : 'skipped']++;
  }
  log.info(
    `proxy endpoint keys: sealed=${result.sealed} cleared=${result.cleared} unchanged=${result.unchanged} unloadedKey=${result.unloadedKey} tampered=${result.tampered} skipped=${result.skipped}`,
  );
  return result;
}
