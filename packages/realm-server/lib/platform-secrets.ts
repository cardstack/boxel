import { randomUUID } from 'node:crypto';
import { logger, type DBAdapter } from '@cardstack/runtime-common';
import {
  PLATFORM_SECRET_OWNER,
  reportUnreadableSecret,
  sealedColumnBindings,
  sealedColumnsSelect,
  sealedFromColumns,
  secretsKeyring,
  type SecretBinding,
  type SecretsKeyring,
} from './secrets-at-rest/index.ts';
import {
  operatorNoteRefusal,
  operatorValueRefusal,
  type SystemKeyCaller,
} from './system-keys.ts';

// Platform secrets are secrets the platform keeps and only ever reads, such
// as the secret that verifies a vendor's signed webhook. Each is a named row
// in `platform_secrets`, its value sealed with the secrets-at-rest helper and
// bound to the field, the platform as owner, the row id and the secret's
// name. Unlike a system key a platform secret has no destination: nothing
// sends it anywhere, and nothing on the outbound path reads the table.
//
// Operators holding the realm secret seed set and delete them through the
// `platform-secrets` operator endpoints. A value is write-only once set: no
// endpoint, response, error, log line or history row carries it, whole or in
// part. What an operator sees is the name, the data key the value is sealed
// under, the note of whoever last set it and when. The one reader is server
// code calling `readPlatformSecret` where it uses the secret.
//
// Every change writes its row and a `platform_secret_history` entry in one
// statement, and logs a line on the `platform-secrets` channel, with the
// caller's address and when its operator token was signed next to the note,
// as system keys' changes do.

const log = logger('platform-secrets');

export const PLATFORM_SECRET_FIELD = 'platform_secrets.value';

export const PLATFORM_SECRET_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

export type PlatformSecretAction = 'set' | 'delete';

// What an operator sees of a platform secret: never its value.
export interface PlatformSecret {
  name: string;
  // The data key the value is sealed under.
  keyId: string;
  // Who last set it, by the operator's own account, and when.
  note: string;
  setAt: string;
}

// A refusal the endpoints answer with its status; its message names no value.
export class PlatformSecretError extends Error {
  readonly status: 400 | 404 | 409;

  constructor(status: 400 | 404 | 409, message: string) {
    super(message);
    this.status = status;
  }
}

// Thrown by `readPlatformSecret` for a secret that is set but whose sealed
// value doesn't open: sealed under a data key this process hasn't loaded, or
// on a row whose name or id was edited outside the application. Setting the
// secret again is the fix.
export class UnreadablePlatformSecretError extends Error {
  constructor(name: string) {
    super(
      `the platform secret ${name} could not be opened; set it again with boxel realm-server secrets set`,
    );
  }
}

export function platformSecretBinding(id: string, name: string): SecretBinding {
  return {
    field: PLATFORM_SECRET_FIELD,
    owner: PLATFORM_SECRET_OWNER,
    id,
    name,
  };
}

const UNKNOWN_CALLER: SystemKeyCaller = {
  clientAddress: null,
  tokenIssuedAt: null,
};

function validateName(name: unknown): string {
  if (typeof name !== 'string' || !PLATFORM_SECRET_NAME.test(name)) {
    throw new PlatformSecretError(
      400,
      'a platform secret is named by lower-case letters, digits and dashes',
    );
  }
  return name;
}

function validateNote(note: unknown, values: (string | undefined)[]): string {
  let refusal = operatorNoteRefusal(note);
  if (refusal) {
    throw new PlatformSecretError(400, refusal);
  }
  if (values.some((value) => value && (note as string).includes(value))) {
    throw new PlatformSecretError(400, 'the note must not contain the value');
  }
  return note as string;
}

const COLUMNS = `name, value_key_id, note, updated_at`;

function toPlatformSecret(row: Record<string, unknown>): PlatformSecret {
  return {
    name: String(row.name),
    keyId: String(row.value_key_id),
    note: String(row.note),
    setAt: new Date(row.updated_at as string).toISOString(),
  };
}

export async function listPlatformSecrets(
  dbAdapter: DBAdapter,
): Promise<PlatformSecret[]> {
  let rows = await dbAdapter.execute(
    `SELECT ${COLUMNS} FROM platform_secrets ORDER BY name`,
  );
  return rows.map(toPlatformSecret);
}

export async function getPlatformSecret(
  dbAdapter: DBAdapter,
  name: string,
): Promise<PlatformSecret> {
  validateName(name);
  let [row] = await dbAdapter.execute(
    `SELECT ${COLUMNS} FROM platform_secrets WHERE name = $1`,
    { bind: [name] },
  );
  if (!row) {
    throw new PlatformSecretError(404, `no platform secret is named ${name}`);
  }
  return toPlatformSecret(row);
}

// The row a write reads first: its id, which its value is bound to, and the
// sealed value it holds now, so a note can be checked against it.
async function currentRow(
  dbAdapter: DBAdapter,
  name: string,
): Promise<Record<string, unknown> | undefined> {
  let [row] = await dbAdapter.execute(
    `SELECT id, name, ${sealedColumnsSelect('value')} FROM platform_secrets WHERE name = $1`,
    { bind: [name] },
  );
  return row;
}

// The value a row holds, or undefined when it doesn't open. Used only to
// refuse a note that repeats it; it never leaves this module.
function currentValue(
  keyring: SecretsKeyring,
  row: Record<string, unknown> | undefined,
): string | undefined {
  let sealed = row && sealedFromColumns(row, 'value');
  if (!row || !sealed) {
    return undefined;
  }
  try {
    return keyring.open(
      sealed,
      platformSecretBinding(String(row.id), String(row.name)),
    );
  } catch {
    return undefined;
  }
}

function recordChange(
  action: PlatformSecretAction,
  id: string,
  name: string,
  keyId: string | null,
  note: string,
  caller: SystemKeyCaller,
): void {
  let signed =
    caller.tokenIssuedAt == null
      ? 'unknown'
      : new Date(caller.tokenIssuedAt * 1000).toISOString();
  log.info(
    `platform secret ${action}: ${name} (id ${id}${keyId ? `, data key ${keyId}` : ''}) from ${caller.clientAddress ?? 'an unknown address'}, token signed ${signed}. Note: ${JSON.stringify(note)}`,
  );
}

const RECORD_HISTORY = (from: string, action: PlatformSecretAction) =>
  `, recorded AS (
     INSERT INTO platform_secret_history (
       secret_id, name, action, note, key_id, client_address, token_issued_at
     )
     SELECT id, name, '${action}', note_value, value_key_id, client_address, token_issued_at
     FROM ${from}
   )`;

// Sets a platform secret: adds it under a name that has none, or replaces the
// value of the one that has it, keeping its row. The value is sealed under
// the row's id and the name. A note that contains the new value, or the value
// the secret holds now, is refused.
export async function setPlatformSecret(
  dbAdapter: DBAdapter,
  {
    name,
    value,
    note,
    caller = UNKNOWN_CALLER,
  }: { name: string; value: string; note: string; caller?: SystemKeyCaller },
  keyring: SecretsKeyring = secretsKeyring(),
): Promise<{ secret: PlatformSecret; added: boolean }> {
  validateName(name);
  let valueRefusal = operatorValueRefusal(value);
  if (valueRefusal) {
    throw new PlatformSecretError(400, valueRefusal);
  }
  validateNote(note, [value]);
  let existing = await currentRow(dbAdapter, name);
  validateNote(note, [currentValue(keyring, existing)]);
  let id = existing ? String(existing.id) : randomUUID();
  let sealed = keyring.seal(value, platformSecretBinding(id, name));
  let bind = [
    id,
    name,
    ...sealedColumnBindings(sealed),
    note,
    caller.clientAddress,
    caller.tokenIssuedAt,
    ...(existing ? [String(existing.value_nonce)] : []),
  ];
  // A new name is inserted only while no row has it, and an existing one is
  // updated only while its row still holds the value this set read (its id,
  // which the new value is sealed under, and its nonce, which every set
  // changes). So a concurrent set or delete makes this one refuse: it never
  // overwrites a value it didn't check its note against, and never stores a
  // value that doesn't open.
  let written = existing
    ? `UPDATE platform_secrets SET
         value_ciphertext = decode($3, 'base64'),
         value_nonce = decode($4, 'base64'),
         value_tag = decode($5, 'base64'),
         value_key_id = $6,
         note = $7,
         updated_at = NOW()
       WHERE id = $1 AND name = $2 AND value_nonce = decode($10, 'base64')`
    : `INSERT INTO platform_secrets (
         id, name, value_ciphertext, value_nonce, value_tag, value_key_id, note
       ) VALUES (
         $1, $2, decode($3, 'base64'), decode($4, 'base64'),
         decode($5, 'base64'), $6, $7
       )
       ON CONFLICT (name) DO NOTHING`;
  let [row] = await dbAdapter.execute(
    `WITH written AS (
       ${written}
       RETURNING id, name, value_key_id, note, updated_at,
         $7::text AS note_value, $8::varchar AS client_address,
         $9::bigint AS token_issued_at
     )${RECORD_HISTORY('written', 'set')}
     SELECT ${COLUMNS} FROM written`,
    { bind, redactBindings: true },
  );
  if (!row) {
    throw new PlatformSecretError(
      409,
      `the platform secret ${name} changed while it was being set; try again`,
    );
  }
  recordChange('set', id, name, sealed.keyId, note, caller);
  return { secret: toPlatformSecret(row), added: !existing };
}

export async function deletePlatformSecret(
  dbAdapter: DBAdapter,
  name: string,
  { note, caller = UNKNOWN_CALLER }: { note: string; caller?: SystemKeyCaller },
  keyring: SecretsKeyring = secretsKeyring(),
): Promise<PlatformSecret> {
  validateName(name);
  validateNote(note, []);
  let existing = await currentRow(dbAdapter, name);
  if (!existing) {
    throw new PlatformSecretError(404, `no platform secret is named ${name}`);
  }
  validateNote(note, [currentValue(keyring, existing)]);
  let [row] = await dbAdapter.execute(
    `WITH deleted AS (
       DELETE FROM platform_secrets WHERE id = $1
       RETURNING id, name, value_key_id, note, updated_at,
         $2::text AS note_value, $3::varchar AS client_address,
         $4::bigint AS token_issued_at
     )${RECORD_HISTORY('deleted', 'delete')}
     SELECT ${COLUMNS}, id FROM deleted`,
    {
      bind: [
        String(existing.id),
        note,
        caller.clientAddress,
        caller.tokenIssuedAt,
      ],
      redactBindings: true,
    },
  );
  if (!row) {
    throw new PlatformSecretError(404, `no platform secret is named ${name}`);
  }
  recordChange(
    'delete',
    String(row.id),
    name,
    String(row.value_key_id),
    note,
    caller,
  );
  return toPlatformSecret(row);
}

// Each sealed value that doesn't open is reported once, not on every read, so
// a caller that reads per request (a webhook receiver, per delivery) doesn't
// raise an event per request. A new value has a new nonce, so it is reported
// afresh if it doesn't open either.
const reportedUnreadable = new Set<string>();

// The value of the platform secret `name`, opened for server code that uses
// it, or undefined when no secret has that name. Call it where the secret is
// used, keep the value no longer than that use, and never log it. A secret
// that is set but doesn't open is logged and reported to Sentry once, naming
// the secret and never its value, and every read of it throws `UnreadablePlatformSecretError`, so
// a caller refuses rather than verify against nothing.
export async function readPlatformSecret(
  dbAdapter: DBAdapter,
  name: string,
  keyring: SecretsKeyring = secretsKeyring(),
): Promise<string | undefined> {
  validateName(name);
  let row = await currentRow(dbAdapter, name);
  if (!row) {
    return undefined;
  }
  let sealed = sealedFromColumns(row, 'value');
  try {
    if (!sealed) {
      throw new Error('its sealed value is incomplete');
    }
    return keyring.open(
      sealed,
      platformSecretBinding(String(row.id), String(row.name)),
    );
  } catch (e: any) {
    let unreadable = `${String(row.id)}|${String(row.value_nonce)}`;
    if (!reportedUnreadable.has(unreadable)) {
      reportedUnreadable.add(unreadable);
      reportUnreadableSecret(
        log,
        `the platform secret ${name} (id ${String(row.id)}) could not be opened (${e?.message ?? e}); set it again`,
      );
    }
    throw new UnreadablePlatformSecretError(name);
  }
}
