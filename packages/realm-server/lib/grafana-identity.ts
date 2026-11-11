import { createPublicKey, type JsonWebKey, type KeyObject } from 'crypto';
import jwt from 'jsonwebtoken';
import { logger } from '@cardstack/runtime-common';

const log = logger('realm:grafana-identity');

// The Grafana datasource that carries operator actions sends this header on
// every request it proxies. Grafana adds it from the datasource's own
// configuration, so a caller going through Grafana can't leave it off. Its
// presence is what marks a request as having come through Grafana, and a
// request that did must also prove who clicked.
export const GRAFANA_PROXY_HEADER = 'x-boxel-grafana-proxy';

// Grafana's ID token: an ES256 JWT that Grafana adds to every request it
// proxies to a datasource, naming the signed-in identity that made it.
export const GRAFANA_ID_HEADER = 'x-grafana-id';

// Org roles that may perform operator actions. A Viewer may look at the
// dashboards but not act on them.
const OPERATOR_ROLES = new Set(['Editor', 'Admin']);

// How long an unknown key id waits before it may trigger another fetch of
// Grafana's signing keys, so a stream of forged tokens can't turn into a
// stream of requests to Grafana.
const REFETCH_INTERVAL_MS = 30_000;
const FETCH_TIMEOUT_MS = 5_000;

export interface GrafanaIdentity {
  // `user:<id>`, the stable identity Grafana assigns.
  subject: string;
  // The GitHub login (or Grafana login) of the user who clicked.
  username: string | undefined;
  role: string;
}

export class GrafanaIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GrafanaIdentityError';
  }
}

interface GrafanaIdClaims {
  sub?: unknown;
  type?: unknown;
  role?: unknown;
  username?: unknown;
}

// Verifies the ID token Grafana attaches to proxied requests against the
// signing keys Grafana publishes at `/api/signing-keys/keys`.
export class GrafanaIdentityVerifier {
  #keysURL: string;
  #keys = new Map<string, KeyObject>();
  #lastFetch = 0;
  #inFlight: Promise<void> | undefined;
  #refetchIntervalMs: number;

  constructor(
    grafanaURL: string,
    {
      refetchIntervalMs = REFETCH_INTERVAL_MS,
    }: { refetchIntervalMs?: number } = {},
  ) {
    this.#refetchIntervalMs = refetchIntervalMs;
    this.#keysURL = new URL(
      'api/signing-keys/keys',
      ensureTrailingSlash(grafanaURL),
    ).href;
  }

  async verify(token: string): Promise<GrafanaIdentity> {
    let decoded = jwt.decode(token, { complete: true });
    let kid = decoded?.header.kid;
    if (!kid) {
      throw new GrafanaIdentityError('Grafana ID token has no key id');
    }
    let key = await this.#keyFor(kid);
    if (!key) {
      throw new GrafanaIdentityError(
        `Grafana ID token is signed with an unknown key (${kid})`,
      );
    }

    let claims: GrafanaIdClaims;
    try {
      claims = jwt.verify(token, key, {
        algorithms: ['ES256'],
        clockTolerance: 30,
      }) as GrafanaIdClaims;
    } catch (e) {
      throw new GrafanaIdentityError(
        `Grafana ID token is invalid: ${(e as Error).message}`,
      );
    }

    if (claims.type !== 'user' || typeof claims.sub !== 'string') {
      throw new GrafanaIdentityError(
        `Operator actions need a signed-in user, not a ${String(claims.type)}`,
      );
    }
    if (typeof claims.role !== 'string' || !OPERATOR_ROLES.has(claims.role)) {
      throw new GrafanaIdentityError(
        `Operator actions need the Editor or Admin role, not ${String(claims.role)}`,
      );
    }
    return {
      subject: claims.sub,
      username:
        typeof claims.username === 'string' ? claims.username : undefined,
      role: claims.role,
    };
  }

  async #keyFor(kid: string): Promise<KeyObject | undefined> {
    let key = this.#keys.get(kid);
    if (key) {
      return key;
    }
    if (
      !this.#inFlight &&
      Date.now() - this.#lastFetch >= this.#refetchIntervalMs
    ) {
      this.#lastFetch = Date.now();
      this.#inFlight = this.#fetchKeys().finally(() => {
        this.#inFlight = undefined;
      });
    }
    if (this.#inFlight) {
      await this.#inFlight;
    }
    return this.#keys.get(kid);
  }

  async #fetchKeys(): Promise<void> {
    try {
      let response = await fetch(this.#keysURL, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        log.warn(
          `fetching Grafana signing keys from ${this.#keysURL} returned HTTP ${response.status}`,
        );
        return;
      }
      let { keys } = (await response.json()) as { keys?: JsonWebKey[] };
      let next = new Map<string, KeyObject>();
      for (let jwk of keys ?? []) {
        if (typeof jwk.kid !== 'string') {
          continue;
        }
        try {
          next.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
        } catch (e) {
          log.warn(
            `skipping Grafana signing key ${jwk.kid}: ${(e as Error).message}`,
          );
        }
      }
      this.#keys = next;
    } catch (e) {
      log.warn(
        `fetching Grafana signing keys from ${this.#keysURL} failed: ${(e as Error).message}`,
      );
    }
  }
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}
