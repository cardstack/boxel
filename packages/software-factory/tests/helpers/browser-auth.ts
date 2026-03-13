import { createHash } from 'node:crypto';
import type { BrowserContext, Page } from '@playwright/test';

type BrowserAuth = {
  access_token: string;
  user_id: string;
  device_id: string;
  home_server: string;
};

type BrowserSession = Record<string, string>;
export type FactoryBrowserState = {
  auth: BrowserAuth;
  boxelSession: BrowserSession;
};

type BoxelProfile = {
  username: string;
  matrixUrl: string;
  password: string;
};

const defaultMatrixUrl = ensureTrailingSlash(
  process.env.SOFTWARE_FACTORY_BROWSER_MATRIX_URL ??
    process.env.MATRIX_URL ??
    'http://localhost:8008/',
);
const defaultUsername =
  process.env.SOFTWARE_FACTORY_BROWSER_MATRIX_USERNAME ??
  'software-factory-browser';
const defaultSeed =
  process.env.SOFTWARE_FACTORY_BROWSER_SECRET_SEED ?? "shhh! it's a secret";

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function getBrowserProfile(): BoxelProfile {
  let username = (
    process.env.SOFTWARE_FACTORY_BROWSER_USERNAME ?? defaultUsername
  )
    .replace(/^@/, '')
    .replace(/:.*$/, '');

  let password =
    process.env.SOFTWARE_FACTORY_BROWSER_PASSWORD ??
    createHash('sha256').update(username).update(defaultSeed).digest('hex');

  return {
    matrixUrl: defaultMatrixUrl,
    username,
    password,
  };
}

async function matrixLogin(profile = getBrowserProfile()) {
  let response = await fetch(
    new URL('_matrix/client/v3/login', profile.matrixUrl),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        identifier: {
          type: 'm.id.user',
          user: profile.username,
        },
        password: profile.password,
        type: 'm.login.password',
      }),
    },
  );

  let json = await response.json();
  if (!response.ok) {
    throw new Error(
      `Matrix login failed: ${response.status} ${JSON.stringify(json)}`,
    );
  }

  return {
    accessToken: json.access_token as string,
    deviceId: json.device_id as string,
    userId: json.user_id as string,
    homeServer: new URL(profile.matrixUrl).host,
    matrixUrl: profile.matrixUrl,
  };
}

async function getOpenIdToken(matrixAuth: {
  accessToken: string;
  userId: string;
  matrixUrl: string;
}) {
  let response = await fetch(
    new URL(
      `_matrix/client/v3/user/${encodeURIComponent(matrixAuth.userId)}/openid/request_token`,
      matrixAuth.matrixUrl,
    ),
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
    throw new Error(
      `OpenID token request failed: ${response.status} ${await response.text()}`,
    );
  }

  return await response.json();
}

async function getRealmServerToken(
  matrixAuth: {
    accessToken: string;
    userId: string;
    matrixUrl: string;
  },
  realmURL: string,
) {
  let openIdToken = await getOpenIdToken(matrixAuth);
  let response = await fetch(new URL('_server-session', realmURL), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(openIdToken),
  });

  if (!response.ok) {
    throw new Error(
      `Realm server session request failed: ${response.status} ${await response.text()}`,
    );
  }

  let token = response.headers.get('Authorization');
  if (!token) {
    throw new Error(
      'Realm server session response did not include an Authorization header',
    );
  }
  return token;
}

async function getRealmAuthTokens(
  matrixAuth: {
    accessToken: string;
    userId: string;
    matrixUrl: string;
  },
  realmURL: string,
): Promise<Record<string, string>> {
  let serverToken = await getRealmServerToken(matrixAuth, realmURL);
  let response = await fetch(new URL('_realm-auth', realmURL), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: serverToken,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Realm auth lookup failed: ${response.status} ${await response.text()}`,
    );
  }

  return (await response.json()) as Record<string, string>;
}

export async function buildBrowserState(
  realmURL: string,
  realmServerURL = new URL('/', realmURL).href,
): Promise<FactoryBrowserState> {
  let matrixAuth = await matrixLogin();
  let realmTokens = await getRealmAuthTokens(matrixAuth, realmServerURL);

  return {
    auth: {
      access_token: matrixAuth.accessToken,
      user_id: matrixAuth.userId,
      device_id: matrixAuth.deviceId,
      home_server: matrixAuth.homeServer,
    },
    boxelSession: {
      [ensureTrailingSlash(realmURL)]:
        realmTokens[ensureTrailingSlash(realmURL)] ?? '',
    },
  };
}

type InitScriptTarget =
  | Pick<Page, 'addInitScript'>
  | Pick<BrowserContext, 'addInitScript'>;

export async function installBrowserState(
  target: InitScriptTarget,
  state: FactoryBrowserState,
) {
  await target.addInitScript((payload) => {
    window.localStorage.clear();
    window.localStorage.setItem('auth', JSON.stringify(payload.auth));
    window.localStorage.setItem(
      'boxel-session',
      JSON.stringify(payload.boxelSession),
    );
  }, state);
}

export async function seedBrowserSession(page: Page, realmURL: string) {
  let state = await buildBrowserState(realmURL);
  await installBrowserState(page, state);
}
