// Cookie name format: boxel_realm_auth_<base64url_encoded_realm_path>
// Example: boxel_realm_auth_dXNlci9yZWFsbS8 for /user/realm/

const COOKIE_NAME_PREFIX = 'boxel_realm_auth_';

/**
 * Encodes a string to base64url format (URL-safe base64)
 */
function toBase64Url(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Decodes a base64url string back to the original string
 */
function fromBase64Url(base64url: string): string {
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding if needed
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Generates the cookie name for a given realm URL
 * The realm path is base64url encoded to ensure cookie name is valid
 */
export function getAuthCookieName(realmURL: string): string {
  let url = new URL(realmURL);
  let path = url.pathname;
  return `${COOKIE_NAME_PREFIX}${toBase64Url(path)}`;
}

/**
 * Extracts the cookie path from a realm URL
 * This ensures the cookie is scoped to the realm path
 */
export function getAuthCookiePath(realmURL: string): string {
  let url = new URL(realmURL);
  return url.pathname;
}

/**
 * Parses a cookie name to extract the realm path
 * Returns null if the cookie name is not a valid auth cookie
 */
export function parseAuthCookieName(cookieName: string): string | null {
  if (!cookieName.startsWith(COOKIE_NAME_PREFIX)) {
    return null;
  }
  let encodedPath = cookieName.slice(COOKIE_NAME_PREFIX.length);
  try {
    return fromBase64Url(encodedPath);
  } catch {
    return null;
  }
}

export interface AuthCookieOptions {
  realmURL: string;
  token: string;
  expiresInSeconds: number;
  secure: boolean;
}

/**
 * Creates a Set-Cookie header value for realm authentication
 * Uses HttpOnly and SameSite=Lax for security
 */
export function createAuthCookie(options: AuthCookieOptions): string {
  let { realmURL, token, expiresInSeconds, secure } = options;
  let name = getAuthCookieName(realmURL);
  let path = getAuthCookiePath(realmURL);
  let maxAge = expiresInSeconds;

  let cookieParts = [
    `${name}=${encodeURIComponent(token)}`,
    `Path=${path}`,
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'SameSite=Lax',
  ];

  if (secure) {
    cookieParts.push('Secure');
  }

  return cookieParts.join('; ');
}

/**
 * Creates a Set-Cookie header value to delete/clear the auth cookie
 */
export function createAuthCookieDeletion(
  realmURL: string,
  secure: boolean,
): string {
  let name = getAuthCookieName(realmURL);
  let path = getAuthCookiePath(realmURL);

  let cookieParts = [
    `${name}=`,
    `Path=${path}`,
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax',
  ];

  if (secure) {
    cookieParts.push('Secure');
  }

  return cookieParts.join('; ');
}

/**
 * Parses cookies from a Cookie header string
 * Returns a Map of cookie name to cookie value
 */
export function parseCookies(
  cookieHeader: string | undefined,
): Map<string, string> {
  let cookies = new Map<string, string>();
  if (!cookieHeader) {
    return cookies;
  }

  let pairs = cookieHeader.split(';');
  for (let pair of pairs) {
    let [name, ...valueParts] = pair.trim().split('=');
    if (name) {
      let value = valueParts.join('='); // Handle values that contain '='
      let trimmedValue = value.trim();
      try {
        trimmedValue = decodeURIComponent(trimmedValue);
      } catch {
        // leave value undecoded if it contains invalid percent-encoding
      }
      cookies.set(name.trim(), trimmedValue);
    }
  }

  return cookies;
}

/**
 * Finds the auth cookie that matches the request path
 * Returns the token if found, null otherwise
 */
export function findAuthCookieForPath(
  cookieHeader: string | undefined,
  requestPath: string,
): string | null {
  let cookies = parseCookies(cookieHeader);

  // Find the most specific (longest) matching auth cookie.
  // Use path-boundary matching so /foo does not match /foobar.
  let bestMatch: { path: string; token: string } | null = null;

  for (let [name, value] of Array.from(cookies.entries())) {
    let realmPath = parseAuthCookieName(name);
    if (!realmPath) {
      continue;
    }
    // Require the request path to equal the realm path or continue past a
    // path separator so that realm path "/foo/" matches "/foo/bar" but not
    // "/foobar". Realm paths typically end with "/" but we handle both cases.
    let isMatch =
      requestPath === realmPath ||
      requestPath.startsWith(
        realmPath.endsWith('/') ? realmPath : `${realmPath}/`,
      );
    if (isMatch && (!bestMatch || realmPath.length > bestMatch.path.length)) {
      bestMatch = { path: realmPath, token: value };
    }
  }

  return bestMatch?.token ?? null;
}
