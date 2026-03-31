import { createHash } from 'node:crypto';
import type { BrowserContext, Page } from '@playwright/test';

import {
  SupportedMimeType,
  ensureTrailingSlash,
} from '@cardstack/runtime-common';

import { readSupportContext } from '../../src/runtime-metadata';

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

type SupportContext = {
  matrixURL?: string;
  realmServerURL?: string;
};

function getSupportMatrixURL(): string | undefined {
  let context = readSupportContext() as SupportContext | undefined;
  return context?.matrixURL;
}

function getSupportRealmServerURL(): string | undefined {
  let context = readSupportContext() as SupportContext | undefined;
  return context?.realmServerURL;
}

const defaultMatrixUrl = ensureTrailingSlash(
  process.env.SOFTWARE_FACTORY_BROWSER_MATRIX_URL ??
    getSupportMatrixURL() ??
    process.env.MATRIX_URL ??
    'http://localhost:8008/',
);
const defaultUsername =
  process.env.SOFTWARE_FACTORY_BROWSER_MATRIX_USERNAME ??
  'software-factory-browser';
const defaultSeed =
  process.env.SOFTWARE_FACTORY_BROWSER_SECRET_SEED ?? "shhh! it's a secret";

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
        'Content-Type': SupportedMimeType.JSON,
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

  let json = (await response.json()) as BrowserAuth;
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
}): Promise<Record<string, unknown>> {
  let response = await fetch(
    new URL(
      `_matrix/client/v3/user/${encodeURIComponent(matrixAuth.userId)}/openid/request_token`,
      matrixAuth.matrixUrl,
    ),
    {
      method: 'POST',
      headers: {
        'Content-Type': SupportedMimeType.JSON,
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

  return (await response.json()) as Record<string, unknown>;
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
      Accept: SupportedMimeType.JSON,
      'Content-Type': SupportedMimeType.JSON,
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
      Accept: SupportedMimeType.JSON,
      'Content-Type': SupportedMimeType.JSON,
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
  realmServerURL = getSupportRealmServerURL(),
): Promise<FactoryBrowserState> {
  if (!realmServerURL) {
    throw new Error(
      'A realmServerURL is required to build browser state for software-factory tests',
    );
  }
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
  await target.addInitScript((payload: FactoryBrowserState) => {
    try {
      window.localStorage.clear();
      window.localStorage.setItem('auth', JSON.stringify(payload.auth));
      window.localStorage.setItem(
        'boxel-session',
        JSON.stringify(payload.boxelSession),
      );
    } catch {
      // Init scripts also run on bootstrap documents where localStorage is not
      // accessible yet (for example, the initial about:blank page). The script
      // will run again for the actual realm page, where storage is available.
    }
  }, state);
}

export async function seedBrowserSession(
  page: Page,
  realmURL: string,
  realmServerURL?: string,
) {
  let state = await buildBrowserState(realmURL, realmServerURL);
  await installBrowserState(page, state);
}
