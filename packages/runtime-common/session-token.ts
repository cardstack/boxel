/**
 * Lifetime of the session tokens a browser holds — both the realm-server
 * session and the per-realm sessions. These are stateless bearer tokens, so
 * apart from an operator revocation the TTL is the only thing bounding how long
 * a leaked one stays useful. Clients re-mint transparently when it lapses.
 *
 * Anything that reasons about how much life a token has left has to stay well
 * inside this window — a refresh margin at or above the TTL makes every
 * freshly minted token look already-expired.
 *
 * Deliberately a leaf module with no imports, so packages that only need these
 * values (the CLI, for one) can take them without pulling in the barrel.
 */
export const SESSION_TOKEN_TTL = '24h';

/**
 * Lifetime for a realm-server session a caller asks to be long-lived, by
 * sending `lifetime: 'extended'` to `_server-session`.
 *
 * This exists for consumers that receive a bare token and use it outside any
 * wrapper that could notice a 401 and re-mint — a static `Authorization`
 * header in another tool's config, say. They cannot recover from expiry, so a
 * token short enough for an interactive client strands them mid-session.
 *
 * Every authenticated caller can request this, so the shorter default above is
 * a convention rather than an enforced ceiling. What bounds the damage instead
 * is that minting still requires a live matrix session, and that an operator
 * revocation retires extended tokens exactly like any other — the check is on
 * the token's `iat`, which knows nothing about its lifetime.
 */
export const EXTENDED_SESSION_TOKEN_TTL = '7d';
