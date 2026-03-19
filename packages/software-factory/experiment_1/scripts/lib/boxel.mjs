import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PROFILES_FILE = path.join(os.homedir(), '.boxel-cli', 'profiles.json');

function ensureTrailingSlash(url) {
  return url.endsWith('/') ? url : `${url}/`;
}

function parseProfilesConfig() {
  if (!fs.existsSync(PROFILES_FILE)) {
    return { profiles: {}, activeProfile: null };
  }

  return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8'));
}

export function getActiveProfile() {
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

export async function matrixLogin(credentials = getActiveProfile()) {
  let response = await fetch(new URL('_matrix/client/v3/login', credentials.matrixUrl), {
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
  });

  let json = await response.json();
  if (!response.ok) {
    throw new Error(`Matrix login failed: ${response.status} ${JSON.stringify(json)}`);
  }

  return {
    accessToken: json.access_token,
    deviceId: json.device_id,
    userId: json.user_id,
    homeServer: new URL(credentials.matrixUrl).host,
    credentials,
  };
}

export async function getOpenIdToken(matrixAuth) {
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
    let text = await response.text();
    throw new Error(`OpenID token request failed: ${response.status} ${text}`);
  }

  return response.json();
}

export async function getRealmServerToken(matrixAuth) {
  let openIdToken = await getOpenIdToken(matrixAuth);
  let response = await fetch(new URL('_server-session', matrixAuth.credentials.realmServerUrl), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(openIdToken),
  });

  if (!response.ok) {
    let text = await response.text();
    throw new Error(`Realm server session request failed: ${response.status} ${text}`);
  }

  let token = response.headers.get('Authorization');
  if (!token) {
    throw new Error('Realm server session response did not include an Authorization header');
  }
  return token;
}

export async function getAccessibleRealmTokens(matrixAuth) {
  let serverToken = await getRealmServerToken(matrixAuth);
  let response = await fetch(new URL('_realm-auth', matrixAuth.credentials.realmServerUrl), {
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

  return response.json();
}

export function buildBrowserAuth(matrixAuth) {
  return {
    access_token: matrixAuth.accessToken,
    user_id: matrixAuth.userId,
    device_id: matrixAuth.deviceId,
    home_server: matrixAuth.homeServer,
  };
}

export function buildBrowserSession(realmTokens, realmUrls) {
  if (!realmUrls || realmUrls.length === 0) {
    return realmTokens;
  }

  let result = {};
  for (let realmUrl of realmUrls) {
    let normalized = ensureTrailingSlash(realmUrl);
    if (realmTokens[normalized]) {
      result[normalized] = realmTokens[normalized];
    }
  }
  return result;
}

export async function searchRealm({ realmUrl, jwt, query }) {
  let response = await fetch(new URL('./_search', ensureTrailingSlash(realmUrl)), {
    method: 'QUERY',
    headers: {
      Accept: 'application/vnd.card+json',
      'Content-Type': 'application/json',
      ...(jwt ? { Authorization: jwt } : {}),
    },
    body: JSON.stringify(query),
  });

  if (!response.ok) {
    let text = await response.text();
    throw new Error(`Search failed: ${response.status} ${text}`);
  }

  return response.json();
}

export function parseArgs(argv) {
  let args = { _: [] };

  for (let i = 0; i < argv.length; i++) {
    let token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }

    let key = token.slice(2);
    let next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }

    if (args[key] === undefined) {
      args[key] = next;
    } else if (Array.isArray(args[key])) {
      args[key].push(next);
    } else {
      args[key] = [args[key], next];
    }
    i++;
  }

  return args;
}

export function forceArray(value) {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

export function fieldPairs(values) {
  let result = {};
  for (let entry of forceArray(values)) {
    let index = entry.indexOf('=');
    if (index === -1) {
      throw new Error(`Expected field pair in the form field=value, received: ${entry}`);
    }
    result[entry.slice(0, index)] = entry.slice(index + 1);
  }
  return result;
}

export function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}
