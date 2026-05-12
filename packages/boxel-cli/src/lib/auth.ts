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
): Promise<string> {
  let openIdToken = await getOpenIdToken(matrixAuth);
  let url = `${realmServerUrl.replace(/\/$/, '')}/_server-session`;

  let response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(openIdToken),
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

export async function getUserRealmsFromMatrixAccountData(
  matrixAuth: MatrixAuth,
): Promise<string[]> {
  let response: Response;
  try {
    response = await fetch(userRealmsAccountDataUrl(matrixAuth), {
      headers: { Authorization: `Bearer ${matrixAuth.accessToken}` },
    });
  } catch {
    // Network unreachable / DNS / similar — treat as empty (best-effort).
    return [];
  }
  if (response.status === 401 || response.status === 403) {
    let text = await response.text();
    throw new MatrixAuthError(
      response.status,
      `Matrix account_data fetch failed: ${response.status} ${text}`,
    );
  }
  if (!response.ok) {
    // 404 just means the event has never been set — return empty list.
    return [];
  }
  try {
    let data = (await response.json()) as { realms?: string[] };
    return Array.isArray(data.realms) ? [...data.realms] : [];
  } catch {
    return [];
  }
}

export async function addRealmToMatrixAccountData(
  matrixAuth: MatrixAuth,
  realmUrl: string,
): Promise<void> {
  let existingRealms = await getUserRealmsFromMatrixAccountData(matrixAuth);

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
    throw new Error(
      `Failed to update Matrix account data: ${putResponse.status} ${text}`,
    );
  }
  return true;
}
