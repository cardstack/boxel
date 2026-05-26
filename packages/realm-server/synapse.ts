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

// Invalidate a single matrix access token via the standard logout
// endpoint. Used so the short-lived admin login + admin-impersonate
// tokens minted for one grafana grant don't pile up in synapse's
// access_tokens table. Treats 401 as "token already invalid" — fine.
export async function logoutMatrixAccessToken({
  matrixURL,
  accessToken,
}: {
  matrixURL: URL;
  accessToken: string;
}): Promise<void> {
  let response = await fetch(`${matrixURL.href}_matrix/client/v3/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok && response.status !== 401) {
    throw new Error(
      `matrix logout failed: HTTP ${response.status} ${await response.text()}`,
    );
  }
}

// Append a single realm URL to a user's `app.boxel.realms` account_data,
// preserving any existing entries. Idempotent: if `realmURL` is already in
// the user's `realms` array, no PUT is fired and `{ alreadyPresent: true }`
// is returned so callers can distinguish a no-op from a fresh append. A 404
// from the GET is treated as "user has no realms list yet" — equivalent to
// an empty array. Requires a user-scoped access token (admin-impersonate
// first; synapse admin tokens cannot write other users' account_data).
//
// Lost-update protection: synapse account_data has no optimistic-
// concurrency primitive, so two appenders racing on the same user can
// stomp each other. After each PUT we re-GET and check our entry is
// present; if not, a concurrent PUT overwrote us and we loop. Capped at
// 3 attempts (one extra retry after the initial GET→PUT→verify) — beyond
// that the upstream caller logs a warning and returns 200 per the
// best-effort contract, and re-running the upsert recovers.
const APPEND_REALM_MAX_ATTEMPTS = 3;

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
  let firstAttemptAlreadyPresent: boolean | undefined;
  for (let attempt = 1; attempt <= APPEND_REALM_MAX_ATTEMPTS; attempt++) {
    let existing = await fetchRealmsAccountData(
      matrixURL,
      userId,
      userAccessToken,
    );
    let realms = Array.isArray(existing.realms) ? existing.realms : [];
    if (realms.includes(realmURL)) {
      // First-attempt observation: the caller cares whether THIS
      // invocation appended, so a realm that was already there before
      // we did anything reads as `alreadyPresent: true`. A retry-loop
      // observation: a concurrent writer added our realm for us — still
      // a fresh append from the caller's perspective.
      return { alreadyPresent: firstAttemptAlreadyPresent ?? true };
    }
    firstAttemptAlreadyPresent = false;
    await putRealmsAccountData(matrixURL, userId, userAccessToken, {
      ...existing,
      realms: [...realms, realmURL],
    });
    // Verify our entry survived; if another writer raced us we retry.
    let verified = await fetchRealmsAccountData(
      matrixURL,
      userId,
      userAccessToken,
    );
    let verifiedRealms = Array.isArray(verified.realms) ? verified.realms : [];
    if (verifiedRealms.includes(realmURL)) {
      return { alreadyPresent: false };
    }
  }
  throw new Error(
    `matrix ${APP_BOXEL_REALMS_EVENT_TYPE} append for "${userId}" lost to a concurrent writer after ${APPEND_REALM_MAX_ATTEMPTS} attempts`,
  );
}

async function fetchRealmsAccountData(
  matrixURL: URL,
  userId: string,
  userAccessToken: string,
): Promise<Record<string, unknown>> {
  let path = `_matrix/client/v3/user/${encodeURIComponent(userId)}/account_data/${APP_BOXEL_REALMS_EVENT_TYPE}`;
  let response = await fetch(`${matrixURL.href}${path}`, {
    headers: { Authorization: `Bearer ${userAccessToken}` },
  });
  if (response.status === 404) {
    return {};
  }
  if (!response.ok) {
    throw new Error(
      `matrix GET ${APP_BOXEL_REALMS_EVENT_TYPE} for "${userId}" failed: HTTP ${response.status} ${await response.text()}`,
    );
  }
  return (await response.json()) as Record<string, unknown>;
}

async function putRealmsAccountData(
  matrixURL: URL,
  userId: string,
  userAccessToken: string,
  content: Record<string, unknown>,
): Promise<void> {
  let path = `_matrix/client/v3/user/${encodeURIComponent(userId)}/account_data/${APP_BOXEL_REALMS_EVENT_TYPE}`;
  let response = await fetch(`${matrixURL.href}${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${userAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(content),
  });
  if (!response.ok) {
    throw new Error(
      `matrix PUT ${APP_BOXEL_REALMS_EVENT_TYPE} for "${userId}" failed: HTTP ${response.status} ${await response.text()}`,
    );
  }
}
