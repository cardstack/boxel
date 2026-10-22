import { randomUUID } from 'node:crypto';
import { logger, type DBAdapter } from '@cardstack/runtime-common';
import {
  openSealedColumns,
  PLATFORM_SECRET_OWNER,
  reportUnreadableSecret,
  sealedColumnBindings,
  sealedColumnsSelect,
  sealedFromColumns,
  secretsKeyring,
  type SecretBinding,
  type SecretsKeyring,
} from './secrets-at-rest/index.ts';

// A proxy endpoint's key is sealed with the secrets-at-rest helper into
// `api_key_ciphertext`, `api_key_nonce`, `api_key_tag` and `api_key_key_id`,
// the only copy of it. A row with none of them set has no key.

const log = logger('proxy-endpoint-keys');

export const PROXY_ENDPOINT_KEY_FIELD = 'proxy_endpoints.api_key';

// The key columns a read selects, with the sealed parts as base64.
export const PROXY_ENDPOINT_KEY_COLUMNS = sealedColumnsSelect('api_key');

export interface ProxyEndpointKeyRow {
  id: string;
  url: string;
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

// Each row whose sealed key doesn't open is reported once per sealed value,
// not on every reload of the endpoint cache.
const reportedUnreadable = new Set<string>();

function reportUnreadable(row: ProxyEndpointKeyRow, reason: string): void {
  let unreadable = `${row.id}|${row.api_key_nonce}|${reason}`;
  if (reportedUnreadable.has(unreadable)) {
    return;
  }
  reportedUnreadable.add(unreadable);
  reportUnreadableSecret(
    log,
    `the sealed key for proxy endpoint ${row.url} ${reason}, so the endpoint is refused until its key is replaced`,
  );
}

// Thrown for a row whose sealed key doesn't open. The message names the
// endpoint, never the key.
export class UnreadableProxyEndpointKeyError extends Error {
  constructor(url: string) {
    super(`the sealed key for proxy endpoint ${url} could not be opened`);
    this.name = 'UnreadableProxyEndpointKeyError';
  }
}

// The key a row holds, opened from its sealed columns, or null for a row with
// no key. A sealed key that doesn't open (sealed under a data key this
// process hasn't loaded, or on a row whose id or url was edited outside the
// application) is reported once and throws `UnreadableProxyEndpointKeyError`,
// so its endpoint is refused rather than sent with no key, until an operator
// replaces the key.
export function readProxyEndpointKey(
  row: ProxyEndpointKeyRow,
  keyring?: SecretsKeyring,
): string | null {
  let sealed = sealedFromColumns({ ...row }, 'api_key');
  if (!sealed) {
    return null;
  }
  let key = openSealedColumns({
    sealed,
    binding: proxyEndpointKeyBinding(row),
    keyring: keyring ?? secretsKeyring(),
    onFailure: (reason) => reportUnreadable(row, reason),
  });
  if (key === undefined) {
    throw new UnreadableProxyEndpointKeyError(row.url);
  }
  return key;
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
// returns its id. The key is sealed into the sealed columns.
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
       id, url, credit_strategy, supports_streaming, auth_method,
       auth_parameter_name, api_key_ciphertext, api_key_nonce, api_key_tag,
       api_key_key_id, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, decode($7, 'base64'), decode($8, 'base64'),
       decode($9, 'base64'), $10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     )
     ON CONFLICT (id) DO UPDATE SET
       url = EXCLUDED.url,
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
