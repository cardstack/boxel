/**
 * The capture-URL token: a short-lived JWT carried in a `?token=` query param
 * that authorizes exactly one `_screenshot/` GET without an Authorization
 * header. It exists for the fetches the host's auth service worker cannot
 * reach — `<object>`/`<embed>` loads (which bypass service workers per spec)
 * and top-level navigations to the realm origin (a "Download PDF" anchor, a
 * copied link) — where a private realm's capture URL would otherwise 401.
 *
 * The token is minted by the realm's `_sign-capture-urls` endpoint for any
 * caller who already holds realm read, so it grants nothing the caller
 * doesn't have; it only makes that grant portable to browser-native fetches.
 * Its `url` claim binds it to one capture URL (path plus its non-token query
 * params, param-order-insensitively), so a leaked token is worth one capture
 * for minutes rather than realm-wide read. Signed URLs are ephemeral
 * view-layer values: they must never be persisted into card data, index
 * docs, or prerendered HTML — the durable (unsigned) URL is the only
 * storable reference.
 *
 * Deliberately a leaf module with no imports (the same discipline as
 * `session-token.ts`), so the host's URL-signer service can take these values
 * without pulling in the runtime-common barrel.
 */

/**
 * Query param the signed token travels in. The serving path strips it before
 * the capture-spec parse (which refuses unknown params by name) and before
 * the ledger identity is computed, so a token never mints a distinct capture
 * identity. The same param name is masked in the realm-server's request log.
 */
export const CAPTURE_URL_TOKEN_PARAM = 'token';

/**
 * Lifetime of a capture-URL token. Short, because the token only has to be
 * live at load time: browser PDF viewers save the bytes they already
 * buffered without re-fetching, and every minting surface signs at the
 * moment of use (click or render), so nothing holds a signed URL across this
 * window. Anything that reasons about remaining life (the host signer's
 * re-mint slack) has to stay well inside it.
 */
export const CAPTURE_URL_TOKEN_TTL = '15m';

// The same lifetime in milliseconds, for computing `expiresAt` timestamps and
// re-mint slack without a runtime dependency on the `ms` package. Keep the
// two spellings in sync.
export const CAPTURE_URL_TOKEN_TTL_MS = 15 * 60 * 1000;

/**
 * The `scope` claim value. Its presence is what admits a query-param token on
 * the serving path — a session JWT pasted into `?token=` carries no such
 * claim and is refused, so query strings never become an alternate door for
 * full session tokens.
 */
export const CAPTURE_URL_TOKEN_SCOPE = 'read-capture';

/**
 * Upper bound on how many URLs one `_sign-capture-urls` request may carry.
 * Signing is cheap but unmetered; the cap keeps a runaway client from turning
 * the endpoint into a CPU sink, and is generous enough that a page full of
 * captures signs in one round trip.
 */
export const MAX_CAPTURE_URLS_PER_SIGNING_REQUEST = 100;

export interface CaptureURLTokenClaims {
  user: string;
  realm: string;
  scope: typeof CAPTURE_URL_TOKEN_SCOPE;
  // The binding produced by `captureURLTokenBinding` for the one URL this
  // token authorizes.
  url: string;
}

/**
 * The canonical string a token's `url` claim binds to: the realm-local
 * serving path plus its query params minus the token itself, sorted so the
 * binding is insensitive to param order. Mint and verify both call this —
 * the mint on the URL the client asked to sign, the verify on the request
 * that arrives — so a token replays only against the exact capture URL it
 * was minted for.
 */
export function captureURLTokenBinding(
  localPath: string,
  searchParams: URLSearchParams,
): string {
  let params = new URLSearchParams(searchParams);
  params.delete(CAPTURE_URL_TOKEN_PARAM);
  params.sort();
  let qs = params.toString();
  return qs ? `${localPath}?${qs}` : localPath;
}
