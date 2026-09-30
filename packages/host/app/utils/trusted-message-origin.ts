// A message is trusted only when its origin is exactly the realm server's
// origin. A prefix comparison would let look-alike origins through (for
// example `https://realms.cardstack.co` against `https://realms.cardstack.com/`).
export function isTrustedMessageOrigin(
  origin: string,
  trustedURL: string,
): boolean {
  let trustedOrigin: string;
  try {
    trustedOrigin = new URL(trustedURL).origin;
  } catch {
    return false;
  }
  // Opaque origins (sandboxed iframes, file: URLs) serialize as "null" and
  // must never match.
  return trustedOrigin !== 'null' && origin === trustedOrigin;
}
