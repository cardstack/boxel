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
  constructor(reason: ServiceAccountTokenFailure, message: string) {
    super(message);
    this.name = 'ServiceAccountTokenError';
    this.reason = reason;
  }
}

// The access token a `google-service-account` key sends now. Its grants hold
// markers, so the key's own sealed value, opened here, is the only copy of
// the private key, and it goes only to the platform's token endpoint.
export async function serviceAccountAccessToken(
  dbAdapter: DBAdapter,
  keyring: SecretsKeyring,
  keyId: string,
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
  try {
    return await googleAccessToken(keyId, credential);
  } catch (error) {
    if (error instanceof GoogleServiceAccountRejectedError) {
      throw new ServiceAccountTokenError('rejected', error.message);
    }
    if (error instanceof GoogleTokenEndpointUnavailableError) {
      throw new ServiceAccountTokenError('unavailable', error.message);
    }
    throw error;
  }
}
