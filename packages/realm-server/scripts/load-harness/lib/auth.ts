// The Matrix to realm-server auth chain, implemented against the same
// endpoints the `boxel` CLI uses (`packages/boxel-cli/src/lib/auth.ts`). It is
// re-implemented rather than imported because the harness runs with no
// checkout and no `node_modules` — global `fetch` is the whole dependency set.
//
// Four steps, each feeding the next:
//   1. Matrix password login              -> access_token + user_id
//   2. Matrix OpenID request_token        -> an OIDC token the realm server trusts
//   3. realm-server POST /_server-session -> server JWT (in the response header)
//   4. realm-server POST /_realm-auth     -> per-realm JWTs
//
// Step 4 is the one a search needs: `_federated-search` authorizes per realm.

export interface MatrixAuth {
  accessToken: string;
  userId: string;
  matrixUrl: string;
}

export interface Session {
  userId: string;
  username: string;
  accessToken: string;
  serverToken: string;
  realmTokens: Record<string, string>;
}

export async function matrixLogin({
  matrixUrl,
  username,
  password,
}: {
  matrixUrl: string;
  username: string;
  password: string;
}): Promise<MatrixAuth> {
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
  let json = (await response.json()) as {
    access_token?: string;
    user_id?: string;
    errcode?: string;
  };
  if (!response.ok) {
    // Report only the status and the server's error code. The password must
    // never reach a log line, and the response body can echo the attempted
    // identifier back.
    throw new Error(
      `Matrix login failed for ${username}: ${response.status} ${json?.errcode ?? ''}`,
    );
  }
  return {
    accessToken: json.access_token ?? '',
    userId: json.user_id ?? '',
    matrixUrl,
  };
}

async function getOpenIdToken({
  matrixUrl,
  userId,
  accessToken,
}: MatrixAuth): Promise<unknown> {
  let url = new URL(
    `_matrix/client/v3/user/${encodeURIComponent(userId)}/openid/request_token`,
    matrixUrl,
  ).href;
  let response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: '{}',
  });
  if (!response.ok) {
    throw new Error(
      `OpenID request_token failed for ${userId}: ${response.status}`,
    );
  }
  return await response.json();
}

async function getServerToken(
  matrixAuth: MatrixAuth,
  realmServerUrl: string,
): Promise<string> {
  let openIdToken = await getOpenIdToken(matrixAuth);
  let response = await fetch(
    `${realmServerUrl.replace(/\/$/, '')}/_server-session`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(openIdToken),
    },
  );
  if (!response.ok) {
    throw new Error(`_server-session failed: ${response.status}`);
  }
  // The JWT arrives in the `Authorization` response header, not the body.
  let token = response.headers.get('Authorization');
  if (!token) {
    throw new Error('_server-session returned no Authorization header');
  }
  return token;
}

export async function getRealmTokens(
  realmServerUrl: string,
  serverToken: string,
): Promise<Record<string, string>> {
  let response = await fetch(
    `${realmServerUrl.replace(/\/$/, '')}/_realm-auth`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: serverToken,
      },
    },
  );
  if (!response.ok) {
    throw new Error(`_realm-auth failed: ${response.status}`);
  }
  return (await response.json()) as Record<string, string>;
}

// One authenticated session, ready to issue searches and writes.
export async function authenticate({
  matrixUrl,
  realmServerUrl,
  username,
  password,
}: {
  matrixUrl: string;
  realmServerUrl: string;
  username: string;
  password: string;
}): Promise<Session> {
  let matrixAuth = await matrixLogin({ matrixUrl, username, password });
  let serverToken = await getServerToken(matrixAuth, realmServerUrl);
  let realmTokens = await getRealmTokens(realmServerUrl, serverToken);
  // `accessToken` rides along so the caller can open its own Matrix sync: the
  // realm broadcasts index events into each user's DM session room, and a
  // driver that reacts to invalidation the way a browser does has to read them
  // there.
  return {
    userId: matrixAuth.userId,
    username,
    accessToken: matrixAuth.accessToken,
    serverToken,
    realmTokens,
  };
}

// The realm JWT for one realm, falling back to the server token. `_realm-auth`
// keys its response by realm URL; a realm the user can reach but which has no
// specific entry is still reachable with the server token.
export function realmAuthHeader(session: Session, realmUrl: string): string {
  let bare = realmUrl.replace(/\/$/, '');
  let token =
    session.realmTokens?.[realmUrl] ??
    session.realmTokens?.[bare] ??
    session.realmTokens?.[`${bare}/`];
  if (!token) {
    return session.serverToken;
  }
  return token.startsWith('Bearer ') ? token : `Bearer ${token}`;
}
