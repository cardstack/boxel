/**
 * Synchronous, Node-only signing/verification for URL signatures. This is the
 * counterpart to the Web Crypto path in `./url-signature` and is kept in a
 * separate module so the browser bundle never has to resolve `node:crypto`.
 *
 * The signature is HMAC-SHA256(token, urlPath) — identical to the browser
 * path — where the token is the HMAC key and urlPath is the pathname + search
 * params (without the sig param).
 */

import { createHmac } from 'node:crypto';
import { signingMessageFor } from './url-signature.ts';

export function createURLSignatureSync(token: string, url: URL): string {
  let message = signingMessageFor(url);
  let signature = createHmac('sha256', token)
    .update(message)
    .digest('base64url');

  return signature;
}

export function verifyURLSignature(
  token: string,
  url: URL,
  providedSignature: string,
): boolean {
  let expectedSignature = createURLSignatureSync(token, url);
  return expectedSignature === providedSignature;
}
