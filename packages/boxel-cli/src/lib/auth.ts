export interface MatrixAuth {
  accessToken: string;
  deviceId: string;
  userId: string;
  matrixUrl: string;
}

export type RealmTokens = Record<string, string>;

interface MatrixLoginResponse {
  access_token: string;
  device_id: string;
  user_id: string;
}

import { APP_BOXEL_REALMS_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';

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

/**
 * Returns true when the JWT is missing an `exp` claim, cannot be parsed, or
 * expires within `leadTimeSeconds` from now. Accepts either a raw JWT or an
 * Authorization header value that embeds one (e.g. "Bearer eyJ...").
 *
 * Tokens without an `exp` claim are treated as non-expiring — the caller
 * decides whether that is acceptable.
 */
export function isTokenExpiring(
  jwt: string | undefined,
  leadTimeSeconds = 60,
): boolean {
  if (!jwt) {
    return true;
  }
  let token = extractJwt(jwt);
  let parts = token.split('.');
  if (parts.length < 2) {
    return true;
  }
  try {
    let payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf-8'),
    ) as { exp?: number };
    if (typeof payload.exp !== 'number') {
      return false;
    }
    let nowSeconds = Math.floor(Date.now() / 1000);
    return payload.exp - leadTimeSeconds < nowSeconds;
  } catch {
    return true;
  }
}

function extractJwt(authHeader: string): string {
  let trimmed = authHeader.trim();
  let spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) {
    return trimmed;
  }
  return trimmed.slice(spaceIdx + 1).trim();
}

export async function addRealmToMatrixAccountData(
  matrixAuth: MatrixAuth,
  realmUrl: string,
): Promise<void> {
  let accountDataUrl = new URL(
    `_matrix/client/v3/user/${encodeURIComponent(matrixAuth.userId)}/account_data/${APP_BOXEL_REALMS_EVENT_TYPE}`,
    matrixAuth.matrixUrl,
  ).href;

  let existingRealms: string[] = [];
  try {
    let getResponse = await fetch(accountDataUrl, {
      headers: { Authorization: `Bearer ${matrixAuth.accessToken}` },
    });
    if (getResponse.ok) {
      let data = (await getResponse.json()) as { realms?: string[] };
      existingRealms = Array.isArray(data.realms) ? [...data.realms] : [];
    }
  } catch {
    // Best-effort — if we can't read existing realms, start fresh
  }

  if (!existingRealms.includes(realmUrl)) {
    existingRealms.push(realmUrl);
    let putResponse = await fetch(accountDataUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${matrixAuth.accessToken}`,
      },
      body: JSON.stringify({ realms: existingRealms }),
    });
    if (!putResponse.ok) {
      let text = await putResponse.text();
      throw new Error(
        `Failed to update Matrix account data: ${putResponse.status} ${text}`,
      );
    }
  }
}
