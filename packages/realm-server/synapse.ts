/* eslint-env node */
import { readFileSync } from 'fs-extra';
import { resolve, join } from 'path';
import { createHmac } from 'crypto';
import yaml from 'yaml';
import { existsSync } from 'fs';
import { APP_BOXEL_REALMS_EVENT_TYPE } from '@cardstack/runtime-common';

function homeserverFile(): string {
  if (process.env.BOXEL_ENVIRONMENT) {
    let slug = process.env.BOXEL_ENVIRONMENT.toLowerCase()
      .replace(/\//g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    let branchFile = resolve(
      join(
        __dirname,
        '..',
        'matrix',
        `synapse-data-${slug}`,
        'homeserver.yaml',
      ),
    );
    if (existsSync(branchFile)) {
      return branchFile;
    }
  }
  return resolve(
    join(__dirname, '..', 'matrix', 'synapse-data', 'homeserver.yaml'),
  );
}

export function getLocalConfig() {
  let file = homeserverFile();
  if (existsSync(file)) {
    let homeserverYml = readFileSync(file, 'utf8');
    return yaml.parse(homeserverYml) as Record<string, any>;
  }
  return undefined;
}

export async function registerUser({
  matrixURL,
  displayname,
  username,
  password,
  registrationSecret,
}: {
  matrixURL: URL;
  displayname: string;
  username: string;
  password: string;
  registrationSecret: string;
}) {
  let nonceResponse = await fetch(
    `${matrixURL.href}_synapse/admin/v1/register`,
  );
  let { nonce } = (await nonceResponse.json()) as { nonce: string };
  let mac = createHmac('sha1', registrationSecret)
    .update(`${nonce}\0${username}\0${password}\0notadmin`)
    .digest('hex');

  let registerResponse = await fetch(
    `${matrixURL.href}_synapse/admin/v1/register`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        nonce,
        username,
        displayname,
        password,
        mac,
        admin: false,
      }),
    },
  );
  if (!registerResponse.ok) {
    throw new Error(
      `could not register matrix user '${username}': ${await registerResponse.text()}`,
    );
  }
  let {
    access_token: accessToken,
    user_id: userId,
    home_server: homeServer,
    device_id: deviceId,
  } = (await registerResponse.json()) as {
    access_token: string;
    user_id: string;
    home_server: string;
    device_id: string;
  };
  return { accessToken, userId, homeServer, deviceId };
}

// Log in as a matrix admin user via the standard password-login endpoint and
// return the resulting access token. The token is later used to drive synapse
// admin endpoints (notably the per-user admin-impersonation login below).
export async function loginAsMatrixAdmin({
  matrixURL,
  adminUsername,
  adminPassword,
}: {
  matrixURL: URL;
  adminUsername: string;
  adminPassword: string;
}): Promise<string> {
  let response = await fetch(`${matrixURL.href}_matrix/client/r0/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'm.login.password',
      user: adminUsername,
      password: adminPassword,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `matrix admin login for "${adminUsername}" failed: HTTP ${response.status} ${await response.text()}`,
    );
  }
  let body = (await response.json()) as { access_token: string };
  return body.access_token;
}

// Use the synapse admin-only "log in as user" endpoint to mint an access
// token on behalf of `userId`. Requires an existing admin access token.
// Synapse rejects this for the admin's own user-id ("Cannot use admin API
// to login as self"), so callers shouldn't pass the admin's user-id here.
export async function adminImpersonateUser({
  matrixURL,
  adminAccessToken,
  userId,
}: {
  matrixURL: URL;
  adminAccessToken: string;
  userId: string;
}): Promise<string> {
  let response = await fetch(
    `${matrixURL.href}_synapse/admin/v1/users/${encodeURIComponent(userId)}/login`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    },
  );
  if (!response.ok) {
    throw new Error(
      `matrix admin-impersonate for "${userId}" failed: HTTP ${response.status} ${await response.text()}`,
    );
  }
  let body = (await response.json()) as { access_token: string };
  return body.access_token;
}

// Append a single realm URL to a user's `app.boxel.realms` account_data,
// preserving any existing entries. Idempotent: if `realmURL` is already in
// the user's `realms` array, no PUT is fired and `{ alreadyPresent: true }`
// is returned so callers can distinguish a no-op from a fresh append. A 404
// from the GET is treated as "user has no realms list yet" — equivalent to
// an empty array. Requires a user-scoped access token (admin-impersonate
// first; synapse admin tokens cannot write other users' account_data).
export async function appendRealmToUserAccountData({
  matrixURL,
  userId,
  userAccessToken,
  realmURL,
}: {
  matrixURL: URL;
  userId: string;
  userAccessToken: string;
  realmURL: string;
}): Promise<{ alreadyPresent: boolean }> {
  let path = `_matrix/client/v3/user/${encodeURIComponent(userId)}/account_data/${APP_BOXEL_REALMS_EVENT_TYPE}`;
  let getResponse = await fetch(`${matrixURL.href}${path}`, {
    headers: { Authorization: `Bearer ${userAccessToken}` },
  });
  let existing: { realms?: string[] } = {};
  if (getResponse.status === 404) {
    existing = { realms: [] };
  } else if (!getResponse.ok) {
    throw new Error(
      `matrix GET ${APP_BOXEL_REALMS_EVENT_TYPE} for "${userId}" failed: HTTP ${getResponse.status} ${await getResponse.text()}`,
    );
  } else {
    existing = (await getResponse.json()) as { realms?: string[] };
  }
  let realms = Array.isArray(existing.realms) ? existing.realms : [];
  if (realms.includes(realmURL)) {
    return { alreadyPresent: true };
  }
  let putResponse = await fetch(`${matrixURL.href}${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${userAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...existing, realms: [...realms, realmURL] }),
  });
  if (!putResponse.ok) {
    throw new Error(
      `matrix PUT ${APP_BOXEL_REALMS_EVENT_TYPE} for "${userId}" failed: HTTP ${putResponse.status} ${await putResponse.text()}`,
    );
  }
  return { alreadyPresent: false };
}
