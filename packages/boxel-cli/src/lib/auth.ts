export interface MatrixAuth {
  accessToken: string;
  deviceId: string;
  userId: string;
  matrixUrl: string;
}

export type RealmTokens = Record<string, string>;

// Thrown when Matrix rejects an access token (401/403). Callers can catch
// this specifically to drive interactive re-auth without parsing messages.
export class MatrixAuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'MatrixAuthError';
    this.status = status;
  }
}

// Thrown when Matrix rate-limits login-token minting (429 / M_LIMIT_EXCEEDED).
// Carries the server-reported wait when present. The limit is per user id and
// deliberately not configurable upstream, so callers surface it or wait+retry
// rather than re-authenticating — a fresh token is subject to the same limit.
export class MatrixRateLimitError extends Error {
  retryAfterMs?: number;
  constructor(message: string, retryAfterMs?: number) {
    super(message);
    this.name = 'MatrixRateLimitError';
    if (retryAfterMs !== undefined) {
      this.retryAfterMs = retryAfterMs;
    }
  }
}

interface MatrixLoginResponse {
  access_token: string;
  device_id: string;
  user_id: string;
}

import { APP_BOXEL_REALMS_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';

export async function matrixLogin(
  matrixUrl: string,
  username: string,
  password: string,
): Promise<MatrixAuth> {
  let response = await fetch(
    new URL('_matrix/client/v3/login', matrixUrl).href,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: { type: 'm.id.user', user: username },
        password,
        type: 'm.login.password',
      }),
    },
  );

  let json = (await response.json()) as MatrixLoginResponse;
  if (!response.ok) {
    throw new Error(
      `Matrix login failed: ${response.status} ${JSON.stringify(json)}`,
    );
  }

  return {
    accessToken: json.access_token,
    deviceId: json.device_id,
    userId: json.user_id,
    matrixUrl,
  };
}

export interface LoginToken {
  loginToken: string;
  // How long the token is valid, in milliseconds, as reported by the server.
  // Absent when the server omits `expires_in_ms`.
  expiresInMs?: number;
}

// Parse a Matrix error body, which is JSON `{ errcode, error, ... }` on a
// standard error and additionally carries `flows` when the endpoint answers a
// User-Interactive Auth (UIA) challenge, or `retry_after_ms` on a rate limit.
// Tolerant of a non-JSON body.
function parseMatrixError(text: string): {
  errcode?: string;
  flows?: unknown;
  retryAfterMs?: number;
} {
  try {
    let parsed = JSON.parse(text) as {
      errcode?: string;
      flows?: unknown;
      retry_after_ms?: unknown;
    };
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    let retryAfterMs =
      typeof parsed.retry_after_ms === 'number' && parsed.retry_after_ms >= 0
        ? parsed.retry_after_ms
        : undefined;
    return {
      errcode: parsed.errcode,
      flows: parsed.flows,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    };
  } catch {
    return {};
  }
}

/**
 * Mint a short-lived, single-use Matrix login token from an existing session
 * (MSC3882 `POST /_matrix/client/v1/login/get_token`). The token can be handed
 * to a browser to sign it in as the same user without re-entering credentials.
 *
 * Requires the homeserver to have `login_via_existing_session` enabled; when it
 * doesn't, the endpoint is unrecognized and this throws a clear "not enabled"
 * error naming the server. A rejected access token throws `MatrixAuthError`, so
 * a caller can drive interactive re-auth and retry.
 */
export async function requestLoginToken(
  matrixAuth: MatrixAuth,
  fetchFn: typeof fetch = fetch,
): Promise<LoginToken> {
  let response = await fetchFn(
    new URL('_matrix/client/v1/login/get_token', matrixAuth.matrixUrl).href,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${matrixAuth.accessToken}`,
      },
      body: '{}',
    },
  );

  if (response.ok) {
    let json = (await response.json()) as {
      login_token?: string;
      expires_in_ms?: number;
    };
    if (!json.login_token) {
      throw new Error(
        `Matrix login-token response from ${matrixAuth.matrixUrl} did not include a login_token`,
      );
    }
    return {
      loginToken: json.login_token,
      ...(json.expires_in_ms !== undefined
        ? { expiresInMs: json.expires_in_ms }
        : {}),
    };
  }

  let text = await response.text();
  let { errcode, flows, retryAfterMs } = parseMatrixError(text);

  // A rejected access token — surface it as MatrixAuthError so the caller can
  // re-authenticate and retry once, matching the other Matrix calls here.
  if (response.status === 401 && errcode === 'M_UNKNOWN_TOKEN') {
    throw new MatrixAuthError(
      response.status,
      `Matrix rejected the access token: ${response.status} ${text}`,
    );
  }

  // Synapse rate-limits login-token minting to ~1/min per user id (hardcoded,
  // not configurable). Surface it as a typed error carrying the server-reported
  // wait so the caller can wait+retry or print a clear message. Deliberately
  // NOT a MatrixAuthError: re-authenticating mints a new token, but the limit is
  // per user, so re-auth wouldn't help.
  if (response.status === 429 || errcode === 'M_LIMIT_EXCEEDED') {
    // The body's `retry_after_ms` is deprecated (Matrix v1.10) in favor of the
    // standard `Retry-After` header (in seconds); Synapse currently sends both,
    // so the header is the fallback. Its HTTP-date form parses as NaN and is
    // ignored — a missing wait is fine, callers treat it as unknown.
    let retryAfterHeader = response.headers.get('Retry-After');
    if (retryAfterMs === undefined && retryAfterHeader) {
      let headerSeconds = Number(retryAfterHeader);
      if (Number.isFinite(headerSeconds) && headerSeconds >= 0) {
        retryAfterMs = headerSeconds * 1000;
      }
    }
    throw new MatrixRateLimitError(
      `Matrix rate-limited the login-token request: ${response.status} ${text}`,
      retryAfterMs,
    );
  }

  // The endpoint is unrecognized (feature off) or gated behind an interactive
  // UIA challenge (require_ui_auth). Neither is something this non-interactive
  // path can drive, and both mean the same thing to the user: the server isn't
  // set up to mint login tokens from a session. `M_UNRECOGNIZED` covers both
  // response shapes for an unknown endpoint (404 per spec, 400 from older
  // Synapse); a 400 with any other errcode is a genuine bad request and falls
  // through to the raw failure below.
  let featureUnavailable =
    errcode === 'M_UNRECOGNIZED' ||
    response.status === 404 ||
    (response.status === 401 && Array.isArray(flows));
  if (featureUnavailable) {
    throw new Error(
      `The Matrix server at ${matrixAuth.matrixUrl} does not have ` +
        `login_via_existing_session enabled, so it cannot mint a login token ` +
        `(${response.status} ${errcode ?? 'no errcode'}). This is expected ` +
        `until that feature is turned on for this environment.`,
    );
  }

  throw new Error(
    `Matrix login-token request failed: ${response.status} ${text}`,
  );
}

async function getOpenIdToken(
  matrixAuth: MatrixAuth,
): Promise<Record<string, unknown>> {
  let response = await fetch(
    new URL(
      `_matrix/client/v3/user/${encodeURIComponent(matrixAuth.userId)}/openid/request_token`,
      matrixAuth.matrixUrl,
    ).href,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${matrixAuth.accessToken}`,
      },
      body: '{}',
    },
  );

  if (!response.ok) {
    let text = await response.text();
    if (response.status === 401 || response.status === 403) {
      throw new MatrixAuthError(
        response.status,
        `OpenID token request failed: ${response.status} ${text}`,
      );
    }
    throw new Error(`OpenID token request failed: ${response.status} ${text}`);
  }

  return (await response.json()) as Record<string, unknown>;
}

export async function getRealmServerToken(
  matrixAuth: MatrixAuth,
  realmServerUrl: string,
  // Ask the realm server for a long-lived token. Only for a caller that hands
  // the bare token to something which cannot re-mint on a 401 — everything
  // going through the CLI's own fetch wrappers should take the default.
  opts: { extendedLifetime?: boolean } = {},
): Promise<string> {
  let openIdToken = await getOpenIdToken(matrixAuth);
  let url = `${realmServerUrl.replace(/\/$/, '')}/_server-session`;

  let response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(
      opts.extendedLifetime
        ? { ...openIdToken, lifetime: 'extended' }
        : openIdToken,
    ),
  });

  if (!response.ok) {
    let text = await response.text();
    throw new Error(`Realm server session failed: ${response.status} ${text}`);
  }

  let token = response.headers.get('Authorization');
  if (!token) {
    throw new Error(
      'Realm server session response did not include an Authorization header',
    );
  }
  return token;
}

export async function getRealmTokens(
  realmServerUrl: string,
  serverToken: string,
): Promise<RealmTokens> {
  let url = `${realmServerUrl.replace(/\/$/, '')}/_realm-auth`;

  let response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: serverToken,
    },
  });

  if (!response.ok) {
    let text = await response.text();
    throw new Error(`Realm auth lookup failed: ${response.status} ${text}`);
  }

  return (await response.json()) as RealmTokens;
}

function userRealmsAccountDataUrl(matrixAuth: MatrixAuth): string {
  return new URL(
    `_matrix/client/v3/user/${encodeURIComponent(matrixAuth.userId)}/account_data/${APP_BOXEL_REALMS_EVENT_TYPE}`,
    matrixAuth.matrixUrl,
  ).href;
}

// Best-effort read for display paths: any failure short of an auth error
// reads as an empty list. Never gate a mutation on this — an empty result
// may mean "couldn't read", not "has none"; mutating callers must use
// requireUserRealmsFromMatrixAccountData instead.
export async function getUserRealmsFromMatrixAccountData(
  matrixAuth: MatrixAuth,
): Promise<string[]> {
  return readUserRealmsFromMatrixAccountData(matrixAuth, 'best-effort');
}

// Strict read: a confirmed answer or a throw. A 404 (the event has never
// been set) confirms an empty list; every other failure — network error,
// non-2xx status, unparseable body — throws, so callers that act on the
// answer never act on a guess.
export async function requireUserRealmsFromMatrixAccountData(
  matrixAuth: MatrixAuth,
): Promise<string[]> {
  return readUserRealmsFromMatrixAccountData(matrixAuth, 'strict');
}

async function readUserRealmsFromMatrixAccountData(
  matrixAuth: MatrixAuth,
  mode: 'best-effort' | 'strict',
): Promise<string[]> {
  let response: Response;
  try {
    response = await fetch(userRealmsAccountDataUrl(matrixAuth), {
      headers: { Authorization: `Bearer ${matrixAuth.accessToken}` },
    });
  } catch (e) {
    // Network unreachable / DNS / similar.
    if (mode === 'strict') {
      throw new Error(
        `Could not read the realm list from Matrix account data: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    return [];
  }
  if (response.status === 401 || response.status === 403) {
    let text = await response.text();
    throw new MatrixAuthError(
      response.status,
      `Matrix account_data fetch failed: ${response.status} ${text}`,
    );
  }
  if (response.status === 404) {
    // The event has never been set — a confirmed empty list.
    return [];
  }
  if (!response.ok) {
    if (mode === 'strict') {
      let text = await response.text();
      throw new Error(
        `Could not read the realm list from Matrix account data: ${response.status} ${text}`,
      );
    }
    return [];
  }
  try {
    let data = (await response.json()) as { realms?: string[] };
    return Array.isArray(data.realms) ? [...data.realms] : [];
  } catch {
    if (mode === 'strict') {
      throw new Error(
        'Could not read the realm list from Matrix account data: response body was not valid JSON',
      );
    }
    return [];
  }
}

export async function addRealmToMatrixAccountData(
  matrixAuth: MatrixAuth,
  realmUrl: string,
): Promise<void> {
  // Read-modify-write: the read must be a confirmed answer. Building the PUT
  // body from a failed read's empty guess would replace the account's realm
  // list with just the realm being added, dropping every other realm in it.
  let existingRealms = await requireUserRealmsFromMatrixAccountData(matrixAuth);

  if (!existingRealms.includes(realmUrl)) {
    existingRealms.push(realmUrl);
    let putResponse = await fetch(userRealmsAccountDataUrl(matrixAuth), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${matrixAuth.accessToken}`,
      },
      body: JSON.stringify({ realms: existingRealms }),
    });
    if (!putResponse.ok) {
      let text = await putResponse.text();
      if (putResponse.status === 401 || putResponse.status === 403) {
        throw new MatrixAuthError(
          putResponse.status,
          `Failed to update Matrix account data: ${putResponse.status} ${text}`,
        );
      }
      throw new Error(
        `Failed to update Matrix account data: ${putResponse.status} ${text}`,
      );
    }
  }
}

// Returns true when at least one entry was removed and a write occurred,
// false when no entry matched the URL (caller decides how to surface that
// to the user). Comparison is normalized via `ensureTrailingSlash` and every
// matching entry is dropped, so legacy duplicates like `https://host/realm`
// + `https://host/realm/` are both cleaned out in a single PUT.
export async function removeRealmFromMatrixAccountData(
  matrixAuth: MatrixAuth,
  realmUrl: string,
): Promise<boolean> {
  let target = ensureTrailingSlash(realmUrl);
  let existingRealms = await getUserRealmsFromMatrixAccountData(matrixAuth);
  let next = existingRealms.filter(
    (url) => ensureTrailingSlash(url) !== target,
  );
  if (next.length === existingRealms.length) {
    return false;
  }
  let putResponse = await fetch(userRealmsAccountDataUrl(matrixAuth), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${matrixAuth.accessToken}`,
    },
    body: JSON.stringify({ realms: next }),
  });
  if (!putResponse.ok) {
    let text = await putResponse.text();
    if (putResponse.status === 401 || putResponse.status === 403) {
      throw new MatrixAuthError(
        putResponse.status,
        `Failed to update Matrix account data: ${putResponse.status} ${text}`,
      );
    }
    throw new Error(
      `Failed to update Matrix account data: ${putResponse.status} ${text}`,
    );
  }
  return true;
}
