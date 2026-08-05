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
 * Deliberately a leaf module with no imports, so packages that only need this
 * value (the CLI, for one) can take it without pulling in the barrel.
 */
export const SESSION_TOKEN_TTL = '24h';
