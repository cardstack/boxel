import type {
  SealedSecret,
  SecretBinding,
  SecretsKeyring,
} from './envelope.ts';
import * as Sentry from '@sentry/node';

// A table that seals a secret with the helper in its own row stores the
// sealed value in four columns named after the field: `<column>_ciphertext`,
// `<column>_nonce`, `<column>_tag` (bytea) and `<column>_key_id`. The sealed
// columns are the only copy of the secret.

type SealedColumnsRow = Record<string, unknown>;

// The sealed columns as a read selects them, with the binary parts as base64.
export function sealedColumnsSelect(column: string): string {
  return [
    `encode(${column}_ciphertext, 'base64') AS ${column}_ciphertext`,
    `encode(${column}_nonce, 'base64') AS ${column}_nonce`,
    `encode(${column}_tag, 'base64') AS ${column}_tag`,
    `${column}_key_id`,
  ].join(', ');
}

// The sealed value a row holds, if all four columns are set.
export function sealedFromColumns(
  row: SealedColumnsRow,
  column: string,
): SealedSecret | undefined {
  let ciphertext = row[`${column}_ciphertext`];
  let nonce = row[`${column}_nonce`];
  let tag = row[`${column}_tag`];
  let keyId = row[`${column}_key_id`];
  if (ciphertext == null || nonce == null || tag == null || keyId == null) {
    return undefined;
  }
  return {
    keyId: String(keyId),
    nonce: Buffer.from(String(nonce), 'base64'),
    ciphertext: Buffer.from(String(ciphertext), 'base64'),
    tag: Buffer.from(String(tag), 'base64'),
  };
}

// The sealed columns as bindings for `decode($n, 'base64')` (ciphertext),
// `decode($n, 'base64')` (nonce), `decode($n, 'base64')` (tag) and the key id,
// in that order.
export function sealedColumnBindings(
  sealed: SealedSecret | undefined,
): (string | null)[] {
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

// The value a row's sealed columns hold, opened under its binding, or
// undefined when the row holds none. A sealed value that doesn't open (sealed
// under a data key this process hasn't loaded, or on a row whose bound
// columns were edited outside the application) is reported through
// `onFailure` and read as no value: there is no other copy to serve.
export function openSealedColumns({
  sealed,
  binding,
  keyring,
  onFailure,
}: {
  sealed: SealedSecret | undefined;
  binding: SecretBinding;
  keyring: SecretsKeyring;
  onFailure: (reason: string) => void;
}): string | undefined {
  if (!sealed) {
    return undefined;
  }
  try {
    return keyring.open(sealed, binding);
  } catch (e: any) {
    onFailure(`could not be opened (${e?.message ?? e})`);
    return undefined;
  }
}

// Reports a row whose secret can't be served to the log and to Sentry. The
// message names the row, never the secret.
export function reportUnreadableSecret(
  log: { error: (message: string) => void },
  message: string,
): void {
  log.error(message);
  Sentry.captureMessage(message, 'error');
}
