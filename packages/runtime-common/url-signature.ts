/**
 * Creates a signature binding a token to a specific URL.
 * This prevents token reuse for other endpoints if intercepted.
 *
 * The signature is HMAC-SHA256(token, urlPath) where:
 * - token is used as the HMAC key
 * - urlPath is the pathname + search params (without the sig param)
 *
 * This module holds only the Web Crypto (browser) signing path, so it pulls in
 * no Node builtins and is safe to bundle for the browser. The synchronous
 * Node-only signing/verification path lives in `./url-signature-node`.
 */

// The exact bytes both signing paths must HMAC. Shared so the browser signer
// and the Node verifier provably agree on the message; drift here would
// silently break URL-signature verification.
export function signingMessageFor(url: URL): string {
  // Copy the URL without the signature param so signing and verifying match.
  let urlForSigning = new URL(url.href);
  urlForSigning.searchParams.delete('sig');
  return urlForSigning.pathname + urlForSigning.search;
}

// Browser implementation using Web Crypto API
export async function createURLSignature(
  token: string,
  url: URL,
): Promise<string> {
  let message = signingMessageFor(url);
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
