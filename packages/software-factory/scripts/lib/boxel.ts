import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { formatErrorResponse } from '../../src/error-format';
import { ensureTrailingSlash } from './realm-operations';

const PROFILES_FILE = join(homedir(), '.boxel-cli', 'profiles.json');

type BoxelStoredProfile = {
  matrixUrl: string;
  realmServerUrl: string;
  password: string;
};

type BoxelProfilesConfig = {
  profiles: Record<string, BoxelStoredProfile>;
  activeProfile: string | null;
};

export type ActiveBoxelProfile = {
  profileId: string | null;
  username: string;
  matrixUrl: string;
  realmServerUrl: string;
  password: string;
};

type MatrixLoginResponse = {
  access_token: string;
  device_id: string;
  user_id: string;
};

type OpenIdToken = Record<string, unknown>;

export type MatrixAuth = {
  accessToken: string;
  deviceId: string;
  userId: string;
  homeServer: string;
  credentials: ActiveBoxelProfile;
};

export type RealmTokens = Record<string, string>;

export type BrowserAuth = {
  access_token: string;
  user_id: string;
  device_id: string;
  home_server: string;
};

export type SearchSort = {
  by: string;
  direction: string;
  on?: {
    module: string;
    name: string;
  };
};

export type SearchQuery = {
  filter?: Record<string, unknown>;
  sort?: SearchSort[];
  page?: {
    size?: number;
    number?: number;
  };
};

export type SearchResultCard = {
  id: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, unknown>;
};

export type SearchResultDocument = {
  data?: SearchResultCard[];
} & Record<string, unknown>;

export type ParsedArgValue = string | boolean | string[];
export type ParsedArgs = Record<string, ParsedArgValue | undefined> & {
  _: string[];
};

function parseProfilesConfig(): BoxelProfilesConfig {
  if (!existsSync(PROFILES_FILE)) {
    return { profiles: {}, activeProfile: null };
  }

  return JSON.parse(readFileSync(PROFILES_FILE, 'utf8')) as BoxelProfilesConfig;
}

export function getActiveProfile(): ActiveBoxelProfile {
  let config = parseProfilesConfig();
  let activeProfileId = config.activeProfile;
  if (activeProfileId && config.profiles[activeProfileId]) {
    let profile = config.profiles[activeProfileId];
    return {
      profileId: activeProfileId,
      username: activeProfileId.replace(/^@/, '').replace(/:.*$/, ''),
      matrixUrl: profile.matrixUrl,
      realmServerUrl: ensureTrailingSlash(profile.realmServerUrl),
      password: profile.password,
    };
  }

  let matrixUrl = process.env.MATRIX_URL;
  let username = process.env.MATRIX_USERNAME;
  let password = process.env.MATRIX_PASSWORD;
  let realmServerUrl = process.env.REALM_SERVER_URL;
  if (!matrixUrl || !username || !password || !realmServerUrl) {
    throw new Error(
      'No active Boxel profile found and MATRIX_URL/MATRIX_USERNAME/MATRIX_PASSWORD/REALM_SERVER_URL are not fully set',
    );
  }

  return {
    profileId: null,
    username,
    matrixUrl,
    realmServerUrl: ensureTrailingSlash(realmServerUrl),
    password,
  };
}

export async function matrixLogin(
  credentials: ActiveBoxelProfile = getActiveProfile(),
): Promise<MatrixAuth> {
  let response = await fetch(
    new URL('_matrix/client/v3/login', credentials.matrixUrl),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        identifier: {
          type: 'm.id.user',
          user: credentials.username,
        },
        password: credentials.password,
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
    homeServer: new URL(credentials.matrixUrl).host,
    credentials,
  };
}

export async function getOpenIdToken(
  matrixAuth: MatrixAuth,
): Promise<OpenIdToken> {
  let response = await fetch(
    new URL(
      `_matrix/client/v3/user/${encodeURIComponent(matrixAuth.userId)}/openid/request_token`,
      matrixAuth.credentials.matrixUrl,
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
    let text = await formatErrorResponse(response);
    throw new Error(`OpenID token request failed: ${response.status} ${text}`);
  }

  return (await response.json()) as OpenIdToken;
}

export async function getRealmServerToken(
  matrixAuth: MatrixAuth,
): Promise<string> {
  let openIdToken = await getOpenIdToken(matrixAuth);
  let response = await fetch(
    new URL('_server-session', matrixAuth.credentials.realmServerUrl),
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
    let text = await formatErrorResponse(response);
    throw new Error(
      `Realm server session request failed: ${response.status} ${text}`,
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

export async function getAccessibleRealmTokens(
  matrixAuth: MatrixAuth,
): Promise<RealmTokens> {
  let serverToken = await getRealmServerToken(matrixAuth);
  let response = await fetch(
    new URL('_realm-auth', matrixAuth.credentials.realmServerUrl),
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
    let text = await formatErrorResponse(response);
    throw new Error(`Realm auth lookup failed: ${response.status} ${text}`);
  }

  return (await response.json()) as RealmTokens;
}

export function buildBrowserAuth(matrixAuth: MatrixAuth): BrowserAuth {
  return {
    access_token: matrixAuth.accessToken,
    user_id: matrixAuth.userId,
    device_id: matrixAuth.deviceId,
    home_server: matrixAuth.homeServer,
  };
}

export function buildBrowserSession(
  realmTokens: RealmTokens,
  realmUrls: string[],
): RealmTokens {
  if (realmUrls.length === 0) {
    return realmTokens;
  }

  let result: RealmTokens = {};
  for (let realmUrl of realmUrls) {
    let normalized = ensureTrailingSlash(realmUrl);
    if (realmTokens[normalized]) {
      result[normalized] = realmTokens[normalized];
    }
  }
  return result;
}

export async function searchRealm(input: {
  realmUrl: string;
  jwt?: string;
  query: SearchQuery;
}): Promise<SearchResultDocument> {
  let response = await fetch(
    new URL('./_search', ensureTrailingSlash(input.realmUrl)),
    {
      method: 'QUERY',
      headers: {
        Accept: 'application/vnd.card+json',
        'Content-Type': 'application/json',
        ...(input.jwt ? { Authorization: input.jwt } : {}),
      },
      body: JSON.stringify(input.query),
    },
  );

  if (!response.ok) {
    let text = await formatErrorResponse(response);
    throw new Error(`Search failed: ${response.status} ${text}`);
  }

  return (await response.json()) as SearchResultDocument;
}

export function parseArgs(argv: string[]): ParsedArgs {
  let args: ParsedArgs = { _: [] };

  for (let index = 0; index < argv.length; index++) {
    let token = argv[index];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }

    let key = token.slice(2);
    let next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }

    let existingValue = args[key];
    if (existingValue === undefined) {
      args[key] = next;
    } else if (Array.isArray(existingValue)) {
      existingValue.push(next);
    } else if (typeof existingValue === 'string') {
      args[key] = [existingValue, next];
    } else {
      args[key] = next;
    }
    index++;
  }

  return args;
}

export function forceArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

export function fieldPairs(
  values: string | string[] | undefined,
): Record<string, string> {
  let result: Record<string, string> = {};
  for (let entry of forceArray(values)) {
    let index = entry.indexOf('=');
    if (index === -1) {
      throw new Error(
        `Expected field pair in the form field=value, received: ${entry}`,
      );
    }
    result[entry.slice(0, index)] = entry.slice(index + 1);
  }
  return result;
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
