import jwt from 'jsonwebtoken';
import type { RealmAuthenticator } from './realm-authenticator.ts';

/**
 * The realm server's shared matrix-client username in every deployed
 * environment (local, staging, production). Bot user ids are formed as
 * `@realm_server:<host>` and the realm short-circuits authorization for that
 * id — see packages/runtime-common/realm.ts:2221.
 */
export const DEFAULT_REALM_BOT_USERNAME = 'realm_server';

/**
 * Derive the Matrix host portion (`:<host>`) for a bot user id from a realm
 * URL, mirroring `userIdFromUsername` in
 * `packages/runtime-common/matrix-client.ts`:
 *   - hostname ending in `.localhost` (and bare `localhost`) collapses to `localhost`
 *   - otherwise the last two labels of the hostname are used
 * So:
 *   - http://localhost:4201/…             → localhost
 *   - https://realms-staging.stack.cards/… → stack.cards
 *   - https://app.boxel.ai/…              → boxel.ai
 */
export function deriveHostFromRealmUrl(realmUrl: string): string {
  const { hostname } = new URL(realmUrl);
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return 'localhost';
  }
  const labels = hostname.split('.');
  if (labels.length <= 2) {
    return hostname;
  }
  return labels.slice(-2).join('.');
}

export function deriveBotUserId(
  realmUrl: string,
  username: string = DEFAULT_REALM_BOT_USERNAME,
): string {
  return `@${username}:${deriveHostFromRealmUrl(realmUrl)}`;
}

/**
 * Origin (with trailing slash) for the realm server hosting a given realm URL.
 * This is what the realm embeds in JWT claims as `realmServerURL`.
 */
export function deriveRealmServerUrl(realmUrl: string): string {
  return new URL(realmUrl).origin + '/';
}

/**
 * Derive the realm owner's Matrix user id from a realm URL. The CLI-visible
 * realm URL convention is `https://<host>/<owner>/<realm>/`, so the first path
 * segment is the owner's username and the host maps to the Matrix domain (the
 * same mapping `deriveHostFromRealmUrl` applies). Used to mint an owner-scoped
 * realm-server token for owner-gated admin endpoints (e.g. realm publish).
 */
export function deriveOwnerUserId(realmUrl: string): string {
  const segments = new URL(realmUrl).pathname.split('/').filter(Boolean);
  const owner = segments[0];
  if (!owner) {
    throw new Error(`Cannot derive realm owner from realm URL: ${realmUrl}`);
  }
  return `@${owner}:${deriveHostFromRealmUrl(realmUrl)}`;
}

/**
 * Mint a realm-server (admin) token signed with the seed, for the given user.
 * The realm server verifies it with the same seed and reads `{ user,
 * sessionRoom }` (realm-server `utils/jwt.ts` `RealmServerTokenClaim`). This is
 * the seed-mode counterpart to a Matrix-login `/_server-session` token.
 */
export function mintRealmServerToken(
  seed: string,
  user: string,
  opts: { sessionRoom?: string; expiresIn?: jwt.SignOptions['expiresIn'] } = {},
): string {
  return jwt.sign({ user, sessionRoom: opts.sessionRoom ?? '' }, seed, {
    expiresIn: opts.expiresIn ?? '7d',
  });
}

function normalizeRealmUrl(realmUrl: string): string {
  try {
    const u = new URL(realmUrl);
    return u.href.replace(/\/+$/, '') + '/';
  } catch {
    throw new Error(`Invalid realm URL: ${realmUrl}`);
  }
}

export interface SeedAuthenticatorOptions {
  /** Raw realm secret seed used to sign JWTs (HS256). */
  seed: string;
  /**
   * @internal Override the realm-server's matrix-client username. Real
   * deployments all use `realm_server`; tests against a server with a
   * different username inject their own.
   */
  botUsername?: string;
  /**
   * @internal Full override for the bot matrix user id (e.g.
   * `@node-test_realm-server:localhost`). Used by integration tests that run
   * against a realm on `127.0.0.1`, where the two-label host-derivation
   * formula is nonsensical.
   */
  botUserId?: string;
  /** @internal Override the 7-day JWT expiry used by real deployments. */
  expiresIn?: jwt.SignOptions['expiresIn'];
}

export interface RealmJwtClaims {
  user: string;
  realm: string;
  sessionRoom: undefined;
  permissions: [];
  realmServerURL: string;
}

/**
 * `RealmAuthenticator` implementation that authenticates via a locally-minted
 * JWT signed with the realm secret seed, bypassing Matrix login and the
 * `/_server-session` + `/_realm-auth` handshake.
 *
 * How it works: the realm short-circuits authorization when the JWT's `user`
 * claim equals the realm's own matrix-client user id
 * (packages/runtime-common/realm.ts:2221). That id is stable per deployment —
 * `@realm_server:<host>` in every real environment. So given the seed, we mint
 * a token with `user = @realm_server:<derived-host>`, `realm = <normalized
 * realm url>`, `realmServerURL = <origin>/`, `permissions = []`, and
 * everything else is ignored by the short-circuit.
 */
export class SeedAuthenticator implements RealmAuthenticator {
  readonly #seed: string;
  readonly #botUsername: string;
  readonly #botUserIdOverride: string | undefined;
  readonly #expiresIn: jwt.SignOptions['expiresIn'];
  readonly #tokenCache = new Map<string, string>();

  constructor(options: SeedAuthenticatorOptions) {
    if (!options.seed) {
      throw new Error('SeedAuthenticator requires a non-empty seed');
    }
    this.#seed = options.seed;
    this.#botUsername = options.botUsername ?? DEFAULT_REALM_BOT_USERNAME;
    this.#botUserIdOverride = options.botUserId;
    this.#expiresIn = options.expiresIn ?? '7d';
  }

  /**
   * Build the JWT claims for a given realm URL. Exposed for tests that need
   * to inspect payload shape without decoding the signed token.
   */
  buildClaims(realmUrl: string): RealmJwtClaims {
    const normalizedRealm = normalizeRealmUrl(realmUrl);
    const user =
      this.#botUserIdOverride ??
      deriveBotUserId(normalizedRealm, this.#botUsername);
    return {
      user,
      realm: normalizedRealm,
      sessionRoom: undefined,
      permissions: [],
      realmServerURL: deriveRealmServerUrl(normalizedRealm),
    };
  }

  /**
   * Mint (or return a cached) JWT for the given realm URL.
   */
  mintTokenForRealm(realmUrl: string): string {
    const claims = this.buildClaims(realmUrl);
    const cached = this.#tokenCache.get(claims.realm);
    if (cached) {
      return cached;
    }
    const token = jwt.sign(claims, this.#seed, {
      expiresIn: this.#expiresIn,
    });
    this.#tokenCache.set(claims.realm, token);
    return token;
  }

  /**
   * Given any URL inside a realm (or the realm root itself), return the realm
   * root URL we'll use to mint the token. We match against the set of realm
   * URLs we've already minted tokens for; the fallback (when nothing is
   * pre-registered) takes the request's origin + first two path segments
   * with a trailing slash, which matches the CLI-visible realm URL
   * convention `https://<host>/<owner>/<realm>/`.
   */
  #resolveRealmUrl(requestUrl: string): string {
    for (const realmUrl of this.#tokenCache.keys()) {
      if (requestUrl.startsWith(realmUrl)) {
        return realmUrl;
      }
    }
    const u = new URL(requestUrl);
    const segments = u.pathname.split('/').filter(Boolean);
    const realmRootPath =
      segments.length > 0 ? `/${segments.slice(0, 2).join('/')}/` : '/';
    return `${u.origin}${realmRootPath}`;
  }

  async authedRealmFetch(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    const url =
      input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.href
          : input;

    const realmUrl = this.#resolveRealmUrl(url);
    const token = this.mintTokenForRealm(realmUrl);
    const headers = this.#buildHeaders(input, init, token);
    return fetch(input, { ...init, headers });
  }

  #buildHeaders(
    input: string | URL | Request,
    init: RequestInit | undefined,
    token: string,
  ): Headers {
    const baseHeaders =
      input instanceof Request ? new Headers(input.headers) : new Headers();
    const initHeaders = new Headers(init?.headers);
    for (const [key, value] of initHeaders) {
      baseHeaders.set(key, value);
    }
    if (!baseHeaders.has('Authorization')) {
      baseHeaders.set('Authorization', token);
    }
    return baseHeaders;
  }

  /**
   * Pre-register a realm URL so that requests to sub-paths of it always use
   * the exact realm URL for token minting. The CLI commands call this with
   * the user-supplied realm URL before doing any fetches.
   */
  registerRealmUrl(realmUrl: string): void {
    this.mintTokenForRealm(realmUrl);
  }
}
