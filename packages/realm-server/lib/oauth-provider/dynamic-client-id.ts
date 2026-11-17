import { randomBytes } from 'crypto';

// The ID dynamic client registration gives a client: 24 random bytes in
// base64url, so always 32 characters of that alphabet. A client ID metadata
// document's ID is an `https://` URL, which can never take this form.
const DYNAMIC_CLIENT_ID = /^[A-Za-z0-9_-]{32}$/;

export function newDynamicClientId(): string {
  return randomBytes(24).toString('base64url');
}

export function isDynamicClientId(id: string): boolean {
  return DYNAMIC_CLIENT_ID.test(id);
}
