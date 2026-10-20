import { randomBytes } from 'node:crypto';
import { logger, type DBAdapter } from '@cardstack/runtime-common';
import {
  openSealedColumns,
  reportUnreadableSecret,
  sealedColumnBindings,
  sealedColumnsSelect,
  sealedFromColumns,
  secretsKeyring,
  type SecretBinding,
  type SecretsKeyring,
} from './secrets-at-rest/index.ts';

// An incoming webhook's signing secret is sealed with the secrets-at-rest
// helper into `signing_secret_ciphertext`, `signing_secret_nonce`,
// `signing_secret_tag` and `signing_secret_key_id`, the only copy of it.
//
// Only the webhook receiver opens a secret, to check a signature. The API
// returns a secret once, in the response that creates the webhook or rotates
// its secret; every other read reports only when the secret was issued.

const log = logger('incoming-webhook-secrets');

export const INCOMING_WEBHOOK_SECRET_FIELD = 'incoming_webhooks.signing_secret';

// The secret columns a read selects, with the sealed parts as base64.
export const INCOMING_WEBHOOK_SECRET_COLUMNS =
  sealedColumnsSelect('signing_secret');

// When the current secret was issued. A row written by a revision that
// doesn't record it was issued with the webhook.
export const SIGNING_SECRET_CREATED_AT =
  'COALESCE(signing_secret_created_at, created_at)';

export interface IncomingWebhookSecretRow {
  id: string;
  username: string;
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

// Each row whose signing secret can't be opened is reported once per sealed
// value, not on every delivery.
const reportedUnreadable = new Set<string>();

function reportUnreadable(row: IncomingWebhookSecretRow, reason: string): void {
  let unreadable = `${row.id}|${row.signing_secret_nonce}|${reason}`;
  if (reportedUnreadable.has(unreadable)) {
    return;
  }
  reportedUnreadable.add(unreadable);
  reportUnreadableSecret(
    log,
    `the signing secret of incoming webhook ${row.id} ${reason}, so its deliveries can't be verified; rotate its secret to issue a new one`,
  );
}

// The secret a webhook's signatures are checked against, opened from its
// sealed columns. A webhook whose secret isn't sealed, or doesn't open (sealed
// under a data key this process hasn't loaded, or on a row whose id or
// username was edited outside the application), has nothing to check against:
// it is reported, and the read throws, so no delivery verifies until the
// secret is rotated.
export function readIncomingWebhookSecret(
  row: IncomingWebhookSecretRow,
  keyring?: SecretsKeyring,
): string {
  let sealed = sealedFromColumns({ ...row }, 'signing_secret');
  if (!sealed) {
    reportUnreadable(row, 'is not sealed');
  }
  let secret = openSealedColumns({
    sealed,
    binding: incomingWebhookSecretBinding(row),
    keyring: keyring ?? secretsKeyring(),
    onFailure: (reason) => reportUnreadable(row, reason),
  });
  if (secret === undefined) {
    throw new Error(
      `incoming webhook ${row.id} has no signing secret to verify with`,
    );
  }
  return secret;
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

// Registers a webhook with a new signing secret, written sealed. Returns the
// stored row and the secret, which the caller hands to the user this once.
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
       signing_secret_ciphertext, signing_secret_nonce, signing_secret_tag,
       signing_secret_key_id, signing_secret_created_at, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, decode($6, 'base64'), decode($7, 'base64'),
       decode($8, 'base64'), $9, NOW(), NOW(), NOW()
     )
     RETURNING ${INCOMING_WEBHOOK_ATTRIBUTE_COLUMNS}`,
    {
      bind: [
        id,
        registration.username,
        registration.webhookPath,
        registration.verificationType,
        JSON.stringify(registration.verificationConfig),
        ...sealedColumnBindings(sealed),
      ],
      redactBindings: true,
    },
  );
  return { row, signingSecret };
}

// Replaces a webhook's signing secret with a new one, written sealed, so a
// signature made with the old secret stops verifying at once. Returns the
// stored row and the new secret, which the caller hands to the user this
// once, or undefined when the webhook doesn't exist or belongs to another
// user.
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
       signing_secret_ciphertext = decode($3, 'base64'),
       signing_secret_nonce = decode($4, 'base64'),
       signing_secret_tag = decode($5, 'base64'),
       signing_secret_key_id = $6,
       signing_secret_created_at = NOW(),
       updated_at = NOW()
     WHERE id = $1 AND username = $2
     RETURNING ${INCOMING_WEBHOOK_ATTRIBUTE_COLUMNS}`,
    {
      bind: [id, username, ...sealedColumnBindings(sealed)],
      redactBindings: true,
    },
  );
  return row ? { row, signingSecret } : undefined;
}
