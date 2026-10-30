import jwt from 'jsonwebtoken';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import type { RealmAuthenticator } from './realm-authenticator.ts';
import { realmFetch } from './realm-fetch.ts';

/**
 * The realm server's shared matrix-client username in every deployed
 * environment (local, staging, production). Bot user ids are formed as
 * `@realm_server:<matrix server name>` and the realm short-circuits
 * authorization for that id — see packages/runtime-common/realm.ts:2221.
 */
export const DEFAULT_REALM_BOT_USERNAME = 'realm_server';

/**
 * The environment variable naming the Matrix server paired with the realm
 * server (ADR 004 §1.1). It is the variable the realm server itself is
 * configured with, so an operator sets one value for both.
 */
export const MATRIX_SERVER_NAME_ENV = 'MATRIX_SERVER_NAME';

export const MATRIX_SERVER_NAME_MISSING_ERROR =
  `Seed mode needs the name of the Matrix server paired with the realm ` +
  `server, for example "localhost" for a local stack. Set ` +
  `${MATRIX_SERVER_NAME_ENV} in the environment.`;

/**
 * The name of the Matrix server a seed-minted token names its user on: the
 * explicit value when one is given, else `MATRIX_SERVER_NAME`. A realm URL's
 * hostname is never a source. Matrix delegation lets a server be named by one
 * host and served by another (ADR 004 §1.2), so only the operator can say
 * which server the realm server's accounts are on.
 */
export function resolveMatrixServerName(explicit?: string): string {
  const name = explicit?.trim() || process.env[MATRIX_SERVER_NAME_ENV]?.trim();
  if (!name) {
    throw new Error(MATRIX_SERVER_NAME_MISSING_ERROR);
  }
  return name;
}

/**
 * The full Matrix id of the realm server's own account on `matrixServerName`.
 */
export function botUserId(
  matrixServerName: string,
  username: string = DEFAULT_REALM_BOT_USERNAME,
): string {
  return `@${username}:${matrixServerName}`;
}

/**
 * Origin (with trailing slash) for the realm server hosting a given realm URL.
 * This is what the realm embeds in JWT claims as `realmServerURL`.
 */
export function deriveRealmServerUrl(realmUrl: string): string {
  return new URL(realmUrl).origin + '/';
}

/**
 * The realm owner's Matrix user id, from a realm URL and the name of the
 * Matrix server paired with the realm server. A realm path is
 * `/<owner localpart>/<realm>/` only for an owner on the paired homeserver
 * (ADR 004 §1.5), so the first path segment is that owner's localpart on
 * `matrixServerName`. Used to mint an owner-scoped realm-server token for
 * owner-gated admin endpoints (e.g. realm publish).
 */
export function deriveOwnerUserId(
  realmUrl: string,
  matrixServerName: string,
): string {
  // A realm URL is `https://<host>/<owner>/<realm>/` — two path segments, the
  // first being the owner. Require both so a non-realm URL (a 1-segment path or
  // the server root) doesn't silently yield a bogus owner.
  const segments = new URL(realmUrl).pathname.split('/').filter(Boolean);
  if (segments.length < 2) {
    throw new Error(
      `Cannot derive realm owner: ${realmUrl} is not a <host>/<owner>/<realm>/ realm URL`,
    );
  }
  return `@${segments[0]}:${matrixServerName}`;
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

export type OperatorScope = 'data-keys' | 'system-keys' | 'diagnostic-render';

/**
 * Mint an operator token for one family of the realm server's operator
 * endpoints (the `boxel realm-server` commands). It carries no user, names its
 * family in the `operator` claim, names the realm server's origin as its
 * audience and lives for minutes; only that server accepts it, on those
 * endpoints only, and the seed never leaves this machine.
 */
export function mintOperatorToken(
  seed: string,
  scope: OperatorScope,
  audience: string,
  opts: { expiresIn?: jwt.SignOptions['expiresIn'] } = {},
): string {
  return jwt.sign({ operator: scope }, seed, {
    audience,
    expiresIn: opts.expiresIn ?? '5m',
  });
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The URL of an operator endpoint on a realm server. An operator request
 * carries a seed-signed token, and may carry a key value, so it goes only over
 * https, or over plain http to this machine.
 */
export function operatorEndpointURL(realmServerUrl: string, path: string): URL {
  let url: URL;
  try {
    url = new URL(path, ensureTrailingSlash(realmServerUrl));
  } catch {
    throw new Error(`${realmServerUrl} is not a URL`);
  }
  if (url.protocol !== 'https:' && !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(
      `${url.origin} is not https; refusing to send an operator request to it`,
    );
  }
  return url;
}

/**
 * Sends a request to a realm server's operator endpoint with an operator token
 * for `scope` bound to that server's origin. Redirects are refused rather than
 * followed: a redirect to another origin would carry the body there.
 */
export async function operatorRequest(
  {
    realmServerUrl,
    realmSecretSeed,
    fetch = globalThis.fetch,
  }: {
    realmServerUrl: string;
    realmSecretSeed: string;
    fetch?: typeof globalThis.fetch;
  },
  scope: OperatorScope,
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<{ url: string; response: Response }> {
  let url = operatorEndpointURL(realmServerUrl, path);
  let response = await fetch(url.href, {
    method,
    redirect: 'error',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${mintOperatorToken(realmSecretSeed, scope, url.origin)}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { url: url.href, response };
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
   * The name of the Matrix server the realm server's account is on. When
   * absent it is read from `MATRIX_SERVER_NAME` (`resolveMatrixServerName`),
   * and construction fails when neither names it. Not consulted when
   * `botUserId` names the account in full.
   */
  matrixServerName?: string;
  /**
   * @internal Override the realm-server's matrix-client username. Real
   * deployments all use `realm_server`; tests against a server with a
   * different username inject their own.
   */
  botUsername?: string;
  /**
   * @internal Full override for the bot matrix user id (e.g.
   * `@node-test_realm-server:localhost`), for a test realm server whose
   * account is not `realm_server`'s on the configured server.
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
 * `@realm_server:<matrix server name>` in every real environment. So given
 * the seed and the server name, we mint a token with `user =
 * @realm_server:<matrix server name>`, `realm = <normalized realm url>`,
 * `realmServerURL = <origin>/`, `permissions = []`, and everything else is
 * ignored by the short-circuit.
 */
export class SeedAuthenticator implements RealmAuthenticator {
  readonly #seed: string;
  readonly #botUserId: string;
  readonly #expiresIn: jwt.SignOptions['expiresIn'];
  readonly #tokenCache = new Map<string, string>();

  constructor(options: SeedAuthenticatorOptions) {
    if (!options.seed) {
      throw new Error('SeedAuthenticator requires a non-empty seed');
    }
    this.#seed = options.seed;
    this.#botUserId =
      options.botUserId ??
      botUserId(
        resolveMatrixServerName(options.matrixServerName),
        options.botUsername ?? DEFAULT_REALM_BOT_USERNAME,
      );
    this.#expiresIn = options.expiresIn ?? '7d';
  }

  /**
   * Build the JWT claims for a given realm URL. Exposed for tests that need
   * to inspect payload shape without decoding the signed token.
   */
  buildClaims(realmUrl: string): RealmJwtClaims {
    const normalizedRealm = normalizeRealmUrl(realmUrl);
    const user = this.#botUserId;
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
    return realmFetch(input, { ...init, headers });
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
