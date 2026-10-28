import { param, query, type DBAdapter } from '@cardstack/runtime-common';
import type { SecretsKeyring } from './secrets-at-rest/envelope.ts';
import {
  sealedColumnsSelect,
  sealedFromColumns,
} from './secrets-at-rest/sealed-columns.ts';
import { userKeyBinding } from './user-keys.ts';
import {
  GoogleServiceAccountRejectedError,
  GoogleTokenEndpointUnavailableError,
  deserializeGoogleServiceAccount,
  googleAccessToken,
} from './outbound/google-service-account.ts';

export type ServiceAccountTokenFailure = 'rejected' | 'unavailable';

// Why a service-account key couldn't mint an access token. The message never
// carries the key, a token or Google's own description.
export class ServiceAccountTokenError extends Error {
  readonly reason: ServiceAccountTokenFailure;
  // The sealed value the failed exchange was signed with (its nonce, base64),
  // when one was opened.
  readonly copy: string | undefined;
  constructor(
    reason: ServiceAccountTokenFailure,
    message: string,
    copy?: string,
  ) {
    super(message);
    this.name = 'ServiceAccountTokenError';
    this.reason = reason;
    this.copy = copy;
  }
}

// The access token a `google-service-account` key sends now. Its grants hold
// markers, so the key's own sealed value, opened here, is the only copy of
// the private key, and it goes only to the platform's token endpoint.
export async function serviceAccountAccessToken(
  dbAdapter: DBAdapter,
  keyring: SecretsKeyring,
  keyId: string,
  options: { fresh?: boolean } = {},
): Promise<string> {
  let [key] = await query(dbAdapter, [
    `SELECT owner, kind, ${sealedColumnsSelect('value')} FROM user_keys WHERE id = `,
    param(keyId),
  ]);
  if (!key || key.kind !== 'google-service-account') {
    throw new ServiceAccountTokenError(
      'rejected',
      'the key is no longer a service account key',
    );
  }
  let sealed = sealedFromColumns(key, 'value');
  if (!sealed) {
    throw new Error(`key ${keyId} holds no sealed value`);
  }
  let credential = deserializeGoogleServiceAccount(
    keyring.open(sealed, userKeyBinding(key.owner as string, keyId)),
  );
  let copy = sealed.nonce.toString('base64');
  try {
    return await googleAccessToken(keyId, credential, options);
  } catch (error) {
    if (error instanceof GoogleServiceAccountRejectedError) {
      throw new ServiceAccountTokenError('rejected', error.message, copy);
    }
    if (error instanceof GoogleTokenEndpointUnavailableError) {
      throw new ServiceAccountTokenError('unavailable', error.message, copy);
    }
    throw error;
  }
}
