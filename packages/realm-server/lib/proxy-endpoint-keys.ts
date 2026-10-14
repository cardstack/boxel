import { randomUUID } from 'node:crypto';
import { logger, type DBAdapter } from '@cardstack/runtime-common';
import {
  PLATFORM_SECRET_OWNER,
  secretsKeyring,
  type SealedSecret,
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
  `encode(api_key_ciphertext, 'base64') AS api_key_ciphertext`,
  `encode(api_key_nonce, 'base64') AS api_key_nonce`,
  `encode(api_key_tag, 'base64') AS api_key_tag`,
  'api_key_key_id',
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

function sealedKey(row: ProxyEndpointKeyRow): SealedSecret | undefined {
  let {
    api_key_ciphertext: ciphertext,
    api_key_nonce: nonce,
    api_key_tag: tag,
    api_key_key_id: keyId,
  } = row;
  if (ciphertext == null || nonce == null || tag == null || keyId == null) {
    return undefined;
  }
  return {
    keyId,
    nonce: Buffer.from(nonce, 'base64'),
    ciphertext: Buffer.from(ciphertext, 'base64'),
    tag: Buffer.from(tag, 'base64'),
  };
}

function hasSealedColumns(row: ProxyEndpointKeyRow): boolean {
  return (
    row.api_key_ciphertext != null ||
    row.api_key_nonce != null ||
    row.api_key_tag != null ||
    row.api_key_key_id != null
  );
}

// The sealed columns as bindings for `decode($n, 'base64')`, `decode(...)`,
// `decode(...)` and the key id.
function sealedBindings(sealed: SealedSecret | undefined) {
  if (!sealed) {
    return [null, null, null, null];
  }
  return [
    sealed.ciphertext.toString('base64'),
    sealed.nonce.toString('base64'),
    sealed.tag.toString('base64'),
    sealed.keyId,
  ];
}

// The key a row holds: its sealed value, or the plain-text value of a row the
// backfill hasn't sealed yet. A sealed value that doesn't open (sealed under a
// data key this process hasn't loaded, or on a row whose id or url was changed
// outside the application) is reported, and the plain-text value is served in
// its place.
export function readProxyEndpointKey(
  row: ProxyEndpointKeyRow,
  keyring?: SecretsKeyring,
): string | null {
  let sealed = sealedKey(row);
  if (!sealed) {
    return row.api_key;
  }
  try {
    return (keyring ?? secretsKeyring()).open(
      sealed,
      proxyEndpointKeyBinding(row),
    );
  } catch (e: any) {
    log.error(
      `the sealed key for proxy endpoint ${row.url} could not be opened, so its plain-text key is used: ${e?.message ?? e}`,
    );
    return row.api_key;
  }
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
        ...sealedBindings(sealed),
      ],
      redactBindings: true,
    },
  );
  return id;
}

export interface ProxyEndpointKeySealing {
  // Rows whose key was sealed.
  sealed: number;
  // Rows with no plain-text key whose sealed columns were emptied.
  cleared: number;
  // Rows whose sealed key already matched their plain-text key.
  unchanged: number;
  // Rows sealed under a data key this process hasn't loaded, left as they
  // are.
  unloadedKey: number;
  // Rows that changed between the read and the update, left to whoever
  // changed them.
  skipped: number;
}

// Seals every row's plain-text key into its sealed columns. The plain-text
// column is the source: a row whose sealed key is missing, doesn't open under
// its binding (its url or id was edited outside the application), or opens to
// a different value (its plain text was) is sealed from it, and a row with no
// plain-text key has its sealed columns emptied. A row whose sealed key opens
// to its plain-text key is left alone, so a second run changes nothing.
//
// A row sealed under a data key this process hasn't loaded is left alone and
// reported: re-sealing it under this process's current key would move it back
// onto an older data key than the one a rotation put it under.
//
// Each update applies only while the row still holds the key and the nonce
// that were read, so it never overwrites a concurrent write or re-seal, and
// replicas can run it at once.
export async function sealProxyEndpointKeys(
  dbAdapter: DBAdapter,
  keyring: SecretsKeyring = secretsKeyring(),
): Promise<ProxyEndpointKeySealing> {
  let rows = (await dbAdapter.execute(
    `SELECT id, url, ${PROXY_ENDPOINT_KEY_COLUMNS} FROM proxy_endpoints`,
  )) as unknown as ProxyEndpointKeyRow[];
  let result: ProxyEndpointKeySealing = {
    sealed: 0,
    cleared: 0,
    unchanged: 0,
    unloadedKey: 0,
    skipped: 0,
  };
  for (let row of rows) {
    let binding = proxyEndpointKeyBinding(row);
    if (row.api_key == null) {
      if (!hasSealedColumns(row)) {
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
    let sealed = sealedKey(row);
    if (sealed) {
      if (!keyring.keyIds.includes(sealed.keyId)) {
        log.warn(
          `the key for proxy endpoint ${row.url} is sealed under data key ${sealed.keyId}, which this process has not loaded, so it is left as it is`,
        );
        result.unloadedKey++;
        continue;
      }
      let opened: string | undefined;
      try {
        opened = keyring.open(sealed, binding);
      } catch {
        log.warn(
          `the sealed key for proxy endpoint ${row.url} does not open under its binding, so it is sealed again from its plain-text key`,
        );
      }
      if (opened === row.api_key) {
        result.unchanged++;
        continue;
      }
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
          ...sealedBindings(keyring.seal(row.api_key, binding)),
          row.api_key,
          row.api_key_nonce,
        ],
        redactBindings: true,
      },
    );
    result[updated.length > 0 ? 'sealed' : 'skipped']++;
  }
  log.info(
    `proxy endpoint keys: sealed=${result.sealed} cleared=${result.cleared} unchanged=${result.unchanged} unloadedKey=${result.unloadedKey} skipped=${result.skipped}`,
  );
  return result;
}
