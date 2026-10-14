import { randomBytes } from 'node:crypto';
import { logger, type DBAdapter } from '@cardstack/runtime-common';
import {
  backfillDecision,
  openWithPlainTextFallback,
  sealedColumnBindings,
  sealedColumnsSelect,
  sealedFromColumns,
  secretsKeyring,
  type SecretBinding,
  type SecretsKeyring,
} from './secrets-at-rest/index.ts';

// An incoming webhook's signing secret is sealed with the secrets-at-rest
// helper into `signing_secret_ciphertext`, `signing_secret_nonce`,
// `signing_secret_tag` and `signing_secret_key_id`. The plain-text
// `signing_secret` column is kept in step by every write, so a server running
// the previous revision verifies with the same secret, and it is the source
// the backfill seals from.
//
// Only the webhook receiver opens a secret, to check a signature. The API
// returns a secret once, in the response that creates the webhook or rotates
// its secret; every other read reports only when the secret was issued.

const log = logger('incoming-webhook-secrets');

export const INCOMING_WEBHOOK_SECRET_FIELD = 'incoming_webhooks.signing_secret';

// The secret columns a read selects, with the sealed parts as base64.
export const INCOMING_WEBHOOK_SECRET_COLUMNS = [
  'signing_secret',
  sealedColumnsSelect('signing_secret'),
].join(', ');

// When the current secret was issued. A row written by a revision that
// doesn't record it was issued with the webhook.
export const SIGNING_SECRET_CREATED_AT =
  'COALESCE(signing_secret_created_at, created_at)';

export interface IncomingWebhookSecretRow {
  id: string;
  username: string;
  signing_secret: string;
  signing_secret_ciphertext: string | null;
  signing_secret_nonce: string | null;
  signing_secret_tag: string | null;
  signing_secret_key_id: string | null;
}

export function generateSigningSecret(): string {
  return randomBytes(32).toString('hex');
}

// A signing secret belongs to the user who registered the webhook and is
// bound to its row. It has no destination: Boxel never sends it anywhere, it
// only verifies what it receives.
export function incomingWebhookSecretBinding({
  id,
  username,
}: {
  id: string;
  username: string;
}): SecretBinding {
  return {
    field: INCOMING_WEBHOOK_SECRET_FIELD,
    owner: username,
    id,
  };
}

// Each row whose sealed secret disagrees with its plain-text secret is
// reported once per sealed value, not on every delivery.
const reportedDrift = new Set<string>();

function reportDrift(row: IncomingWebhookSecretRow, reason: string): void {
  let drift = `${row.id}|${row.signing_secret_nonce}|${reason}`;
  if (reportedDrift.has(drift)) {
    return;
  }
  reportedDrift.add(drift);
  log.warn(
    `the sealed signing secret of incoming webhook ${row.id} ${reason}, so its plain-text secret is used until the backfill seals it again`,
  );
}

// The secret a webhook's signatures are checked against. A sealed secret that
// opens to the plain-text secret is served from the sealed columns. The
// plain-text column is the source while it exists, so when the two disagree it
// wins: a row the backfill hasn't sealed yet, a sealed secret that doesn't
// open (sealed under a data key this process hasn't loaded, or on a row whose
// id or username was edited outside the application), and a plain-text secret
// edited outside the application are all verified against `signing_secret`.
// Each disagreement is reported.
export function readIncomingWebhookSecret(
  row: IncomingWebhookSecretRow,
  keyring?: SecretsKeyring,
): string {
  let sealed = sealedFromColumns({ ...row }, 'signing_secret');
  if (!sealed) {
    return row.signing_secret;
  }
  return openWithPlainTextFallback({
    plainText: row.signing_secret,
    sealed,
    binding: incomingWebhookSecretBinding(row),
    keyring: keyring ?? secretsKeyring(),
    onDisagreement: (reason) => reportDrift(row, reason),
  }) as string;
}

// The attributes of an incoming webhook as the API reports them. Reads never
// select the secret.
export const INCOMING_WEBHOOK_ATTRIBUTE_COLUMNS = `id, username, webhook_path, verification_type, verification_config, ${SIGNING_SECRET_CREATED_AT} AS signing_secret_created_at, created_at, updated_at`;

export interface IncomingWebhookRegistration {
  username: string;
  webhookPath: string;
  verificationType: string;
  verificationConfig: Record<string, unknown>;
}

// Registers a webhook with a new signing secret, written sealed and in plain
// text together. Returns the stored row and the secret, which the caller
// hands to the user this once.
export async function insertIncomingWebhook(
  dbAdapter: DBAdapter,
  registration: IncomingWebhookRegistration,
  { id, keyring = secretsKeyring() }: { id: string; keyring?: SecretsKeyring },
): Promise<{ row: Record<string, unknown>; signingSecret: string }> {
  let signingSecret = generateSigningSecret();
  let sealed = keyring.seal(
    signingSecret,
    incomingWebhookSecretBinding({ id, username: registration.username }),
  );
  let [row] = await dbAdapter.execute(
    `INSERT INTO incoming_webhooks (
       id, username, webhook_path, verification_type, verification_config,
       signing_secret, signing_secret_ciphertext, signing_secret_nonce,
       signing_secret_tag, signing_secret_key_id, signing_secret_created_at,
       created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, decode($7, 'base64'), decode($8, 'base64'),
       decode($9, 'base64'), $10, NOW(), NOW(), NOW()
     )
     RETURNING ${INCOMING_WEBHOOK_ATTRIBUTE_COLUMNS}`,
    {
      bind: [
        id,
        registration.username,
        registration.webhookPath,
        registration.verificationType,
        JSON.stringify(registration.verificationConfig),
        signingSecret,
        ...sealedColumnBindings(sealed),
      ],
      redactBindings: true,
    },
  );
  return { row, signingSecret };
}

// Replaces a webhook's signing secret with a new one, written sealed and in
// plain text together, so a signature made with the old secret stops
// verifying at once. Returns the stored row and the new secret, which the
// caller hands to the user this once, or undefined when the webhook doesn't
// exist or belongs to another user.
export async function rotateIncomingWebhookSecret(
  dbAdapter: DBAdapter,
  { id, username }: { id: string; username: string },
  keyring: SecretsKeyring = secretsKeyring(),
): Promise<
  { row: Record<string, unknown>; signingSecret: string } | undefined
> {
  let signingSecret = generateSigningSecret();
  let sealed = keyring.seal(
    signingSecret,
    incomingWebhookSecretBinding({ id, username }),
  );
  let [row] = await dbAdapter.execute(
    `UPDATE incoming_webhooks SET
       signing_secret = $3,
       signing_secret_ciphertext = decode($4, 'base64'),
       signing_secret_nonce = decode($5, 'base64'),
       signing_secret_tag = decode($6, 'base64'),
       signing_secret_key_id = $7,
       signing_secret_created_at = NOW(),
       updated_at = NOW()
     WHERE id = $1 AND username = $2
     RETURNING ${INCOMING_WEBHOOK_ATTRIBUTE_COLUMNS}`,
    {
      bind: [id, username, signingSecret, ...sealedColumnBindings(sealed)],
      redactBindings: true,
    },
  );
  return row ? { row, signingSecret } : undefined;
}

export interface IncomingWebhookSecretSealing {
  // Rows whose secret was sealed, including rows sealed under the public
  // local development key by a process that seals with another key.
  sealed: number;
  // Rows whose sealed secret already matched their plain-text secret.
  unchanged: number;
  // Rows sealed under a data key this process hasn't loaded, left as they
  // are.
  unloadedKey: number;
  // Rows that changed between the read and the update, left to whoever
  // changed them.
  skipped: number;
}

// Seals every row's plain-text signing secret into its sealed columns, as
// `backfillDecision` decides. Every row has a plain-text secret, since the
// column is NOT NULL.
//
// Each update applies only while the row still holds the secret and the
// nonce that were read, so it never overwrites a rotation or a concurrent
// re-seal, and replicas can run it at once.
export async function sealIncomingWebhookSecrets(
  dbAdapter: DBAdapter,
  keyring: SecretsKeyring = secretsKeyring(),
): Promise<IncomingWebhookSecretSealing> {
  let rows = (await dbAdapter.execute(
    `SELECT id, username, ${INCOMING_WEBHOOK_SECRET_COLUMNS} FROM incoming_webhooks`,
  )) as unknown as IncomingWebhookSecretRow[];
  let result: IncomingWebhookSecretSealing = {
    sealed: 0,
    unchanged: 0,
    unloadedKey: 0,
    skipped: 0,
  };
  for (let row of rows) {
    let binding = incomingWebhookSecretBinding(row);
    let decision = backfillDecision({
      plainText: row.signing_secret,
      sealed: sealedFromColumns({ ...row }, 'signing_secret'),
      binding,
      keyring,
      subject: `the signing secret of incoming webhook ${row.id}`,
      warn: (message) => log.warn(message),
    });
    if (decision !== 'seal') {
      result[decision]++;
      continue;
    }
    let updated = await dbAdapter.execute(
      `UPDATE incoming_webhooks SET
         signing_secret_ciphertext = decode($3, 'base64'),
         signing_secret_nonce = decode($4, 'base64'),
         signing_secret_tag = decode($5, 'base64'),
         signing_secret_key_id = $6
       WHERE id = $1 AND username = $2 AND signing_secret = $7
         AND signing_secret_nonce IS NOT DISTINCT FROM decode($8, 'base64')
       RETURNING id`,
      {
        bind: [
          row.id,
          row.username,
          ...sealedColumnBindings(keyring.seal(row.signing_secret, binding)),
          row.signing_secret,
          row.signing_secret_nonce,
        ],
        redactBindings: true,
      },
    );
    result[updated.length > 0 ? 'sealed' : 'skipped']++;
  }
  log.info(
    `incoming webhook secrets: sealed=${result.sealed} unchanged=${result.unchanged} unloadedKey=${result.unloadedKey} skipped=${result.skipped}`,
  );
  return result;
}
