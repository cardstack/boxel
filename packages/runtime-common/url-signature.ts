/**
 * Creates a signature binding a token to a specific URL.
 * This prevents token reuse for other endpoints if intercepted.
 *
 * The signature is HMAC-SHA256(token, urlPath) where:
 * - token is used as the HMAC key
 * - urlPath is the pathname + search params (without the sig param)
 */

// Browser implementation using Web Crypto API
export async function createURLSignature(
  token: string,
  url: URL,
): Promise<string> {
  // Create a copy of the URL without the signature param
  let urlForSigning = new URL(url.href);
  urlForSigning.searchParams.delete('sig');

  let message = urlForSigning.pathname + urlForSigning.search;
  let encoder = new TextEncoder();
  let keyData = encoder.encode(token);
  let messageData = encoder.encode(message);

  let key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  let signature = await crypto.subtle.sign('HMAC', key, messageData);
  let signatureArray = new Uint8Array(signature);
  return btoa(String.fromCharCode(...signatureArray))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, ''); // URL-safe base64
}

// Node.js implementation
export function createURLSignatureSync(token: string, url: URL): string {
  // Dynamic import to avoid issues in browser
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  let crypto = require('crypto');

  let urlForSigning = new URL(url.href);
  urlForSigning.searchParams.delete('sig');

  let message = urlForSigning.pathname + urlForSigning.search;
  let signature = crypto
    .createHmac('sha256', token)
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
