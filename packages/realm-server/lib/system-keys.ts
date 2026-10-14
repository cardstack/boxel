import { randomUUID } from 'node:crypto';
import { logger, type DBAdapter } from '@cardstack/runtime-common';
import { AllowedProxyDestinations } from './allowed-proxy-destinations.ts';
import { proxyEndpointKeyBinding } from './proxy-endpoint-keys.ts';
import {
  secretsKeyring,
  type SealedSecret,
  type SecretsKeyring,
} from './secrets-at-rest/index.ts';

// System keys are the platform's own vendor keys: the `proxy_endpoints` rows
// `_request-forward` attaches. Operators holding the realm secret seed add,
// replace and delete them through the `system-keys` operator endpoints. Every
// change writes its row and a `proxy_endpoint_history` entry in one statement,
// and logs a line on the `system-keys` channel. Neither the history, the log
// nor anything this module returns carries a key's value.

const log = logger('system-keys');

export type SystemKeyAuthMethod = 'header' | 'url-parameter';
export type SystemKeyCreditStrategy = 'openrouter' | 'none';
export type SystemKeyAction = 'add' | 'replace' | 'delete';

export const SYSTEM_KEY_AUTH_METHODS: readonly SystemKeyAuthMethod[] = [
  'header',
  'url-parameter',
];
export const SYSTEM_KEY_CREDIT_STRATEGIES: readonly SystemKeyCreditStrategy[] =
  ['openrouter', 'none'];

// `proxy_endpoints.credit_strategy` spells "none" as `no-credit`, the name
// `CreditStrategyFactory` knows it by.
const STORED_CREDIT_STRATEGY: Record<SystemKeyCreditStrategy, string> = {
  openrouter: 'openrouter',
  none: 'no-credit',
};

function creditStrategyFromRow(stored: string): string {
  return stored === 'no-credit' ? 'none' : stored;
}

export const MAX_SYSTEM_KEY_VALUE_LENGTH = 8 * 1024;
export const MAX_SYSTEM_KEY_NOTE_LENGTH = 1000;
const HISTORY_SHOWN = 20;

export interface SystemKey {
  id: string;
  destination: string;
  authMethod: string;
  paramName: string | null;
  creditStrategy: string;
  supportsStreaming: boolean;
  hasValue: boolean;
  // The data key the value is sealed under, or null while it is in plain text
  // only.
  keyId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SystemKeyChange {
  action: SystemKeyAction;
  destination: string;
  note: string;
  keyId: string | null;
  changedAt: string;
}

export interface NewSystemKey {
  destination: string;
  authMethod: SystemKeyAuthMethod;
  paramName: string | null;
  creditStrategy: SystemKeyCreditStrategy;
  supportsStreaming: boolean;
  value: string;
  note: string;
}

// A refusal the endpoints answer with its status; its message names no value.
export class SystemKeyError extends Error {
  readonly status: 400 | 404 | 409;

  constructor(status: 400 | 404 | 409, message: string) {
    super(message);
    this.status = status;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A destination is an http(s) URL with no credentials, query or fragment: the
// proxy matches a request against its origin and path alone. It is stored as
// the URL parser spells it, which is also what the value is bound to.
export function normalizeDestination(destination: string): string {
  let url: URL;
  try {
    url = new URL(destination);
  } catch {
    throw new SystemKeyError(400, 'the destination is not a URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new SystemKeyError(400, 'the destination must be an http(s) URL');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new SystemKeyError(
      400,
      'the destination must not carry credentials, a query string or a fragment',
    );
  }
  return url.href;
}

// Checks a value and its note together, so a note that repeats the value is
// refused before the note reaches the history or the log.
export function validateValueAndNote(value: unknown, note: unknown): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SystemKeyError(400, 'a value is required');
  }
  if (value.length > MAX_SYSTEM_KEY_VALUE_LENGTH) {
    throw new SystemKeyError(
      400,
      `the value is longer than ${MAX_SYSTEM_KEY_VALUE_LENGTH} characters`,
    );
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value) || value.trim() !== value) {
    throw new SystemKeyError(
      400,
      'the value must not contain control characters or surrounding whitespace',
    );
  }
  validateNote(note);
  if ((note as string).includes(value)) {
    throw new SystemKeyError(400, 'the note must not contain the value');
  }
}

export function validateNote(note: unknown): void {
  if (typeof note !== 'string' || note.trim().length === 0) {
    throw new SystemKeyError(400, 'an operator note is required');
  }
  if (note.length > MAX_SYSTEM_KEY_NOTE_LENGTH) {
    throw new SystemKeyError(
      400,
      `the note is longer than ${MAX_SYSTEM_KEY_NOTE_LENGTH} characters`,
    );
  }
}

const SYSTEM_KEY_COLUMNS = `id, url, auth_method, auth_parameter_name,
  credit_strategy, supports_streaming, api_key IS NOT NULL AS has_value,
  api_key_key_id, created_at, updated_at`;

function toSystemKey(row: Record<string, unknown>): SystemKey {
  return {
    id: String(row.id),
    destination: String(row.url),
    authMethod: (row.auth_method as string | null) ?? 'header',
    paramName: (row.auth_parameter_name as string | null) ?? null,
    creditStrategy: creditStrategyFromRow(String(row.credit_strategy)),
    supportsStreaming: Boolean(row.supports_streaming),
    hasValue: Boolean(row.has_value),
    keyId: (row.api_key_key_id as string | null) ?? null,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

export async function listSystemKeys(
  dbAdapter: DBAdapter,
): Promise<SystemKey[]> {
  let rows = await dbAdapter.execute(
    `SELECT ${SYSTEM_KEY_COLUMNS} FROM proxy_endpoints ORDER BY url`,
  );
  return rows.map(toSystemKey);
}

export async function getSystemKey(
  dbAdapter: DBAdapter,
  id: string,
): Promise<{ key: SystemKey; history: SystemKeyChange[] }> {
  if (!UUID.test(id)) {
    throw new SystemKeyError(404, 'no system key has that id');
  }
  let [row] = await dbAdapter.execute(
    `SELECT ${SYSTEM_KEY_COLUMNS} FROM proxy_endpoints WHERE id = $1`,
    { bind: [id] },
  );
  if (!row) {
    throw new SystemKeyError(404, 'no system key has that id');
  }
  return { key: toSystemKey(row), history: await history(dbAdapter, id) };
}

async function history(
  dbAdapter: DBAdapter,
  id: string,
): Promise<SystemKeyChange[]> {
  let rows = await dbAdapter.execute(
    `SELECT action, url, note, key_id, changed_at FROM proxy_endpoint_history
     WHERE endpoint_id = $1 ORDER BY changed_at DESC, id DESC LIMIT ${HISTORY_SHOWN}`,
    { bind: [id] },
  );
  return rows.map((row) => ({
    action: row.action as SystemKeyAction,
    destination: String(row.url),
    note: String(row.note),
    keyId: (row.key_id as string | null) ?? null,
    changedAt: new Date(row.changed_at as string).toISOString(),
  }));
}

function sealedBindings(sealed: SealedSecret) {
  return [
    sealed.ciphertext.toString('base64'),
    sealed.nonce.toString('base64'),
    sealed.tag.toString('base64'),
    sealed.keyId,
  ];
}

// The change reaches this process's proxy at once, and every other process's
// within its endpoint cache's lifetime.
function recordChange(
  action: SystemKeyAction,
  id: string,
  destination: string,
  keyId: string | null,
  note: string,
): void {
  AllowedProxyDestinations.invalidate();
  log.info(
    `system key ${action}: ${destination} (id ${id}${keyId ? `, data key ${keyId}` : ''}). Note: ${JSON.stringify(note)}`,
  );
}

// Adds a system key for a destination that has none. The value is sealed
// under the row's id and destination, and the plain-text column is kept in
// step, as every write to `proxy_endpoints` does.
export async function addSystemKey(
  dbAdapter: DBAdapter,
  key: NewSystemKey,
  keyring: SecretsKeyring = secretsKeyring(),
): Promise<SystemKey> {
  let destination = normalizeDestination(key.destination);
  validateValueAndNote(key.value, key.note);
  if (!SYSTEM_KEY_AUTH_METHODS.includes(key.authMethod)) {
    throw new SystemKeyError(
      400,
      `the auth method must be one of ${SYSTEM_KEY_AUTH_METHODS.join(', ')}`,
    );
  }
  if (!SYSTEM_KEY_CREDIT_STRATEGIES.includes(key.creditStrategy)) {
    throw new SystemKeyError(
      400,
      `the credit strategy must be one of ${SYSTEM_KEY_CREDIT_STRATEGIES.join(', ')}`,
    );
  }
  if (key.paramName != null && !/^[A-Za-z0-9_.-]{1,128}$/.test(key.paramName)) {
    throw new SystemKeyError(400, 'the parameter name is not a valid name');
  }
  let id = randomUUID();
  let sealed = keyring.seal(
    key.value,
    proxyEndpointKeyBinding({ id, url: destination }),
  );
  let [row] = await dbAdapter.execute(
    `WITH added AS (
       INSERT INTO proxy_endpoints (
         id, url, api_key, credit_strategy, supports_streaming, auth_method,
         auth_parameter_name, api_key_ciphertext, api_key_nonce, api_key_tag,
         api_key_key_id, created_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, decode($8, 'base64'),
         decode($9, 'base64'), decode($10, 'base64'), $11,
         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
       )
       ON CONFLICT (url) DO NOTHING
       RETURNING id, url, api_key_key_id
     ), recorded AS (
       INSERT INTO proxy_endpoint_history (endpoint_id, url, action, note, key_id)
       SELECT id, url, 'add', $12, api_key_key_id FROM added
     )
     SELECT id FROM added`,
    {
      bind: [
        id,
        destination,
        key.value,
        STORED_CREDIT_STRATEGY[key.creditStrategy],
        key.supportsStreaming,
        key.authMethod,
        key.paramName,
        ...sealedBindings(sealed),
        key.note,
      ],
      redactBindings: true,
    },
  );
  if (!row) {
    throw new SystemKeyError(
      409,
      `a system key for ${destination} already exists; replace it instead`,
    );
  }
  recordChange('add', id, destination, sealed.keyId, key.note);
  return (await getSystemKey(dbAdapter, id)).key;
}

// Replaces a system key's value, keeping its destination and settings.
export async function replaceSystemKey(
  dbAdapter: DBAdapter,
  id: string,
  { value, note }: { value: string; note: string },
  keyring: SecretsKeyring = secretsKeyring(),
): Promise<SystemKey> {
  validateValueAndNote(value, note);
  let { key: existing } = await getSystemKey(dbAdapter, id);
  let sealed = keyring.seal(
    value,
    proxyEndpointKeyBinding({ id, url: existing.destination }),
  );
  // The update applies only while the row still has the destination the value
  // was sealed under.
  let [row] = await dbAdapter.execute(
    `WITH replaced AS (
       UPDATE proxy_endpoints SET
         api_key = $3,
         api_key_ciphertext = decode($4, 'base64'),
         api_key_nonce = decode($5, 'base64'),
         api_key_tag = decode($6, 'base64'),
         api_key_key_id = $7,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND url = $2
       RETURNING id, url, api_key_key_id
     ), recorded AS (
       INSERT INTO proxy_endpoint_history (endpoint_id, url, action, note, key_id)
       SELECT id, url, 'replace', $8, api_key_key_id FROM replaced
     )
     SELECT id FROM replaced`,
    {
      bind: [id, existing.destination, value, ...sealedBindings(sealed), note],
      redactBindings: true,
    },
  );
  if (!row) {
    throw new SystemKeyError(
      409,
      'the system key changed while it was being replaced; try again',
    );
  }
  recordChange('replace', id, existing.destination, sealed.keyId, note);
  return (await getSystemKey(dbAdapter, id)).key;
}

export async function deleteSystemKey(
  dbAdapter: DBAdapter,
  id: string,
  { note }: { note: string },
): Promise<SystemKey> {
  validateNote(note);
  let { key: existing } = await getSystemKey(dbAdapter, id);
  let [row] = await dbAdapter.execute(
    `WITH deleted AS (
       DELETE FROM proxy_endpoints WHERE id = $1
       RETURNING id, url, api_key_key_id
     ), recorded AS (
       INSERT INTO proxy_endpoint_history (endpoint_id, url, action, note, key_id)
       SELECT id, url, 'delete', $2, api_key_key_id FROM deleted
     )
     SELECT id FROM deleted`,
    { bind: [id, note] },
  );
  if (!row) {
    throw new SystemKeyError(404, 'no system key has that id');
  }
  recordChange('delete', id, existing.destination, null, note);
  return existing;
}
