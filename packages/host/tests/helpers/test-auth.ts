import ms from 'ms';

import { unixTime, type TokenClaims } from '@cardstack/runtime-common';

import type { RealmServerTokenClaims } from '@cardstack/host/services/realm-server';

export const testRealmSecretSeed = "shhh! it's a secret";

export function createJWT(
  claims: TokenClaims | RealmServerTokenClaims,
  expiration: string,
  secret: string,
) {
  let nowInSeconds = unixTime(Date.now());
  let expires = nowInSeconds + unixTime(ms(expiration));
  let header = { alg: 'none', typ: 'JWT' };
  let payload = {
    iat: nowInSeconds,
    exp: expires,
    ...claims,
  };
  let headerAndPayload = `${btoa(JSON.stringify(header))}.${btoa(
    JSON.stringify(payload),
  )}`;
  // We don't sign with crypto since we are running in the browser so the secret is the signature.
  return `${headerAndPayload}.${secret}`;
}
