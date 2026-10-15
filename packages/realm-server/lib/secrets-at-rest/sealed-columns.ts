import type {
  SealedSecret,
  SecretBinding,
  SecretsKeyring,
} from './envelope.ts';
import * as Sentry from '@sentry/node';
import { LOCAL_DATA_KEY_ID } from './providers.ts';

// A table that seals a secret with the helper while its plain-text column
// still exists stores the sealed value in four columns named after the
// plain-text one: `<column>_ciphertext`, `<column>_nonce`, `<column>_tag`
// (bytea) and `<column>_key_id`. Every write keeps the plain-text column in
// step, so it is the source the sealed columns are checked against: reads
// serve the plain-text value whenever the two disagree, and `backfillDecision`
// decides whether a backfill seals it again.

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

export function hasSealedColumns(
  row: SealedColumnsRow,
  column: string,
): boolean {
  return ['ciphertext', 'nonce', 'tag', 'key_id'].some(
    (part) => row[`${column}_${part}`] != null,
  );
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

// The value a row holds. A sealed value that opens to the plain-text value is
// served from the sealed columns. Otherwise the plain-text value is served and
// `onDisagreement` is told why: a sealed value that doesn't open (sealed under
// a data key this process hasn't loaded, or on a row whose bound columns were
// edited outside the application), or one that opens to a different value
// (the plain text was edited outside the application). A row with no sealed
// value yet is served from plain text without a report.
export function openWithPlainTextFallback({
  plainText,
  sealed,
  binding,
  keyring,
  onDisagreement,
}: {
  plainText: string | null;
  sealed: SealedSecret | undefined;
  binding: SecretBinding;
  keyring: SecretsKeyring;
  onDisagreement: (reason: string) => void;
}): string | null {
  if (!sealed) {
    return plainText;
  }
  let opened: string;
  try {
    opened = keyring.open(sealed, binding);
  } catch (e: any) {
    onDisagreement(`could not be opened (${e?.message ?? e})`);
    return plainText;
  }
  if (opened !== plainText) {
    onDisagreement('differs from its plain-text value');
    return plainText;
  }
  return opened;
}

export type BackfillDecision =
  | 'seal'
  | 'unchanged'
  | 'unloadedKey'
  | 'tampered';

// What a backfill does with a row that has a plain-text value. A row whose
// sealed value is missing is sealed from its plain text; one whose sealed value
// opens to its plain text is left alone, so a second run changes nothing.
//
// A row sealed under a data key this process hasn't loaded is left alone:
// re-sealing it under this process's current key would move it back onto an
// older data key than the one a rotation put it under.
//
// A row is tampered when its sealed value fails to open under a loaded key,
// opens to a value other than the plain text, or, in a process sealing with
// any other key, is sealed under the public local development key. Every
// application write keeps the binding's columns, the plain text and the sealed
// value in step, and a deployed process never seals with the local key, so only
// an edit outside the application produces any of these states. A local-key
// row proves nothing about its binding, since anyone can seal with that key,
// so it is not opened to check. The binding's owner and id are what stop a
// sealed secret being moved to another row or user, so re-sealing such a row
// from what it says would make the edit permanent and indistinguishable from an
// application write. The row is left as it is and reported through
// `reportTampered`, unless `resealTampered` is set, which an operator does once
// they have looked at the row.
//
// `subject` names the secret in the reports, as in "the signing secret of
// webhook <id>"; it never carries the secret.
export function backfillDecision({
  plainText,
  sealed,
  binding,
  keyring,
  subject,
  warn,
  reportTampered,
  resealTampered = false,
}: {
  plainText: string;
  sealed: SealedSecret | undefined;
  binding: SecretBinding;
  keyring: SecretsKeyring;
  subject: string;
  warn: (message: string) => void;
  reportTampered: (message: string) => void;
  resealTampered?: boolean;
}): BackfillDecision {
  if (!sealed) {
    return 'seal';
  }
  if (
    sealed.keyId === LOCAL_DATA_KEY_ID &&
    keyring.currentKeyId !== LOCAL_DATA_KEY_ID
  ) {
    if (resealTampered) {
      warn(
        `${subject} is sealed under the public local development key, so it is sealed again under data key ${keyring.currentKeyId}`,
      );
      return 'seal';
    }
    reportTampered(
      `${subject} is sealed under the public local development key, which a process sealing with data key ${keyring.currentKeyId} never writes, so it is left as it is for an operator to inspect`,
    );
    return 'tampered';
  }
  if (!keyring.keyIds.includes(sealed.keyId)) {
    warn(
      `${subject} is sealed under data key ${sealed.keyId}, which this process has not loaded, so it is left as it is`,
    );
    return 'unloadedKey';
  }
  let opened: string | undefined;
  let problem: string | undefined;
  try {
    opened = keyring.open(sealed, binding);
  } catch {
    problem = 'does not open under its binding';
  }
  if (problem === undefined && opened === plainText) {
    return 'unchanged';
  }
  problem ??= 'opens to a value other than its plain-text value';
  if (resealTampered) {
    warn(
      `${subject} ${problem}, so it is sealed again from its plain-text value`,
    );
    return 'seal';
  }
  reportTampered(
    `${subject} ${problem}, which only an edit outside the application produces, so it is left as it is for an operator to inspect`,
  );
  return 'tampered';
}

// Reports a tampered row to the log and to Sentry. The message names the row,
// never the secret.
export function reportTamperedSecret(
  log: { error: (message: string) => void },
  message: string,
): void {
  log.error(message);
  Sentry.captureMessage(message, 'error');
}
