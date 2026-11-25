/* eslint-env node */
import fsExtra from 'fs-extra';
const { readFileSync } = fsExtra;
import { resolve, join } from 'path';
import { createHmac } from 'crypto';
import yaml from 'yaml';
import { existsSync } from 'fs';
import { sanitizeSlug } from '../../scripts/env-slug.js';
import {
  APP_BOXEL_REALMS_EVENT_TYPE,
  APP_BOXEL_REALM_SERVERS_EVENT_TYPE,
} from '@cardstack/runtime-common';
import { SERVER_MATRIX_DEVICE_ID } from '@cardstack/runtime-common/matrix-client';

function homeserverFile(): string {
  if (process.env.BOXEL_ENVIRONMENT) {
    // Through the shared helper, which caps the slug at the 63 characters a
    // DNS label allows — the same cap the stack applies when it names this
    // directory. Recomputing it here without the cap silently misses the
    // directory for any branch longer than that, and an empty registration
    // secret is what the realm server reports instead.
    let slug = sanitizeSlug(process.env.BOXEL_ENVIRONMENT);
    let branchFile = resolve(
      join(
        import.meta.dirname,
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
    join(
      import.meta.dirname,
      '..',
      'matrix',
      'synapse-data',
      'homeserver.yaml',
    ),
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
  admin = false,
}: {
  matrixURL: URL;
  displayname: string;
  username: string;
  password: string;
  registrationSecret: string;
  // Mint the user as a synapse admin. Required for any user that will
  // later drive synapse's admin-only endpoints (e.g. the admin-
  // impersonate "log in as user" flow used by the grafana-grant
  // account_data sync). The MAC's last segment is "admin" / "notadmin"
  // — both must match between the nonce-MAC and the body's `admin`
  // bool, hence the joint switch.
  admin?: boolean;
}) {
  let nonceResponse = await fetch(
    `${matrixURL.href}_synapse/admin/v1/register`,
  );
  let { nonce } = (await nonceResponse.json()) as { nonce: string };
  let mac = createHmac('sha1', registrationSecret)
    .update(
      `${nonce}\0${username}\0${password}\0${admin ? 'admin' : 'notadmin'}`,
    )
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
        admin,
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

export class MatrixHttpError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// The admin's own login failed. Its status is the login's, never an answer
// about the user an admin request was for.
export class MatrixAdminLoginError extends MatrixHttpError {}

// How long the admin's password login may take. The login is shared by every
// request in the process (`getMatrixAdminToken`), so one that hangs would
// hold them all.
const ADMIN_LOGIN_TIMEOUT_MS = 10_000;

// Log in as a matrix admin user via the standard password-login endpoint and
// return the resulting access token. The token is later used to drive synapse
// admin endpoints (notably the per-user admin-impersonation login below).
//
// Every login reuses the server device, so it adds no device and writes no
// device-list change rows; see SERVER_MATRIX_DEVICE_ID. Logging out a token
// from this login deletes that shared device, which revokes every other
// admin token on it, including ones another request is still using.
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
      device_id: SERVER_MATRIX_DEVICE_ID,
    }),
    signal: AbortSignal.timeout(ADMIN_LOGIN_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new MatrixAdminLoginError(
      `matrix admin login for "${adminUsername}" failed: HTTP ${response.status} ${await response.text()}`,
      response.status,
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
  signal,
}: {
  matrixURL: URL;
  adminAccessToken: string;
  userId: string;
  signal?: AbortSignal;
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
      signal,
    },
  );
  if (!response.ok) {
    throw new MatrixHttpError(
      `matrix admin-impersonate for "${userId}" failed: HTTP ${response.status} ${await response.text()}`,
      response.status,
    );
  }
  let body = (await response.json()) as { access_token: string };
  return body.access_token;
}

// Resolve admin credentials for the synapse admin-impersonate flow. When
// explicit env-derived values are present (any environment), use them.
// When both are absent AND the matrix homeserver is on a `.localhost`
// hostname (covers bare `localhost` and env-mode Traefik names like
// `matrix.<slug>.localhost`), fall back to the dev `admin`/`password`
// pair that register-matrix-users.ts seeds — keeps local dev and tests
// friction-free without baking the default into every other deployment.
export function resolveAdminCreds(
  matrixURL: URL,
  username: string | undefined,
  password: string | undefined,
):
  | { ok: true; username: string; password: string }
  | { ok: false; reason: string } {
  if (username && password) {
    return { ok: true, username, password };
  }
  if (username || password) {
    return {
      ok: false,
      reason: `MATRIX_ADMIN_USERNAME and MATRIX_ADMIN_PASSWORD must be set together (got only ${username ? 'USERNAME' : 'PASSWORD'})`,
    };
  }
  let h = matrixURL.hostname;
  if (h === 'localhost' || h.endsWith('.localhost')) {
    return { ok: true, username: 'admin', password: 'password' };
  }
  return {
    ok: false,
    reason:
      'MATRIX_ADMIN_USERNAME / MATRIX_ADMIN_PASSWORD unset and MATRIX_URL is not a local homeserver',
  };
}

// One admin access token per matrix server and admin user, shared by every
// request in this process, so admin work doesn't log in (and leave a token
// behind) per request.
const adminTokens = new Map<string, Promise<string>>();

export async function getMatrixAdminToken({
  matrixURL,
  adminUsername,
  adminPassword,
  stale,
}: {
  matrixURL: URL;
  adminUsername: string;
  adminPassword: string;
  // A token synapse rejected. Passing it logs in again, unless another
  // request already replaced it, so concurrent rejections share one login.
  stale?: string;
}): Promise<string> {
  let key = `${matrixURL.href} ${adminUsername}`;
  let token = adminTokens.get(key);
  if (
    token &&
    stale !== undefined &&
    (await token.catch(() => undefined)) === stale
  ) {
    if (adminTokens.get(key) === token) {
      adminTokens.delete(key);
    }
    token = adminTokens.get(key);
  }
  if (!token) {
    token = loginAsMatrixAdmin({ matrixURL, adminUsername, adminPassword });
    adminTokens.set(key, token);
    // A failed login isn't cached, so the next request tries again.
    token.catch(() => {
      if (adminTokens.get(key) === token) {
        adminTokens.delete(key);
      }
    });
  }
  return await token;
}

// Mint an access token for `userId` through the process's shared admin token,
// logging the admin in again if synapse no longer accepts it. The returned
// token has no device, so logging it out deletes only that token.
export async function impersonateAsMatrixAdmin({
  matrixURL,
  adminUsername,
  adminPassword,
  userId,
  signal,
}: {
  matrixURL: URL;
  adminUsername: string;
  adminPassword: string;
  userId: string;
  signal?: AbortSignal;
}): Promise<string> {
  let admin = { matrixURL, adminUsername, adminPassword };
  let adminAccessToken = await getMatrixAdminToken(admin);
  try {
    return await adminImpersonateUser({
      matrixURL,
      adminAccessToken,
      userId,
      signal,
    });
  } catch (e) {
    if (!(e instanceof MatrixHttpError && e.status === 401)) {
      throw e;
    }
    return await adminImpersonateUser({
      matrixURL,
      adminAccessToken: await getMatrixAdminToken({
        ...admin,
        stale: adminAccessToken,
      }),
      userId,
      signal,
    });
  }
}

// Invalidate a matrix access token via the standard logout endpoint, so
// short-lived impersonation tokens don't pile up in synapse's access_tokens
// table. A token with a device takes its whole device with it, along with
// every other token on that device. Treats 401 as "token already invalid".
export async function logoutMatrixAccessToken({
  matrixURL,
  accessToken,
  signal,
}: {
  matrixURL: URL;
  accessToken: string;
  signal?: AbortSignal;
}): Promise<void> {
  let response = await fetch(`${matrixURL.href}_matrix/client/v3/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  });
  if (!response.ok && response.status !== 401) {
    throw new Error(
      `matrix logout failed: HTTP ${response.status} ${await response.text()}`,
    );
  }
}

export interface MatrixAdmin {
  matrixURL: URL;
  adminUsername: string;
  adminPassword: string;
}

// How long logging out an impersonation token may take. It runs whatever
// the work it ended did, including after that work's own deadline passed.
const LOGOUT_TIMEOUT_MS = 5_000;

// Runs `fn` with an access token for `userId` minted through the admin API,
// and logs that token out afterwards, whatever `fn` did. Undefined when the
// Matrix server has no such account; a failure of the admin's own login is
// thrown, never read as that. A failed logout is passed to `onLogoutError`
// rather than thrown, so it never changes `fn`'s outcome. `signal` ends the
// minting when it aborts; `fn` is handed it to end its own requests.
export async function withImpersonatedUser<T>(
  admin: MatrixAdmin,
  userId: string,
  fn: (accessToken: string) => Promise<T>,
  onLogoutError: (e: unknown) => void,
  { signal }: { signal?: AbortSignal } = {},
): Promise<T | undefined> {
  let accessToken: string;
  try {
    accessToken = await impersonateAsMatrixAdmin({ ...admin, userId, signal });
  } catch (e: any) {
    if (
      !(e instanceof MatrixAdminLoginError) &&
      (e?.status === 404 || e?.status === 400)
    ) {
      return undefined;
    }
    throw e;
  }
  try {
    return await fn(accessToken);
  } finally {
    await logoutMatrixAccessToken({
      matrixURL: admin.matrixURL,
      accessToken,
      signal: AbortSignal.timeout(LOGOUT_TIMEOUT_MS),
    }).catch(onLogoutError);
  }
}

// The display name of `userId` as the admin API reports it: null when the
// account has none, undefined when the Matrix server has no such account.
export async function fetchDisplayName(
  admin: MatrixAdmin,
  userId: string,
  { signal }: { signal?: AbortSignal } = {},
): Promise<string | null | undefined> {
  let response = await adminGet(
    admin,
    `_synapse/admin/v2/users/${encodeURIComponent(userId)}`,
    { signal },
  );
  if (response.status === 404) {
    return undefined;
  }
  if (!response.ok) {
    throw new MatrixHttpError(
      `matrix admin user lookup for "${userId}" failed: HTTP ${response.status} ${await response.text()}`,
      response.status,
    );
  }
  let { displayname } = (await response.json()) as { displayname?: unknown };
  return typeof displayname === 'string' && displayname ? displayname : null;
}

// The content of `userId`'s global account data of `eventType`, read with the
// admin API: empty when the user never wrote it, undefined when the Matrix
// server has no such account. A failure of the admin's own login is thrown,
// never read as that. Only reads: the admin API can't write another user's
// account data, so a write needs the user's own token.
export async function fetchAccountDataAsAdmin(
  admin: MatrixAdmin,
  userId: string,
  eventType: string,
  { signal }: { signal?: AbortSignal } = {},
): Promise<Record<string, unknown> | undefined> {
  let response = await adminGet(
    admin,
    `_synapse/admin/v1/users/${encodeURIComponent(userId)}/accountdata`,
    { signal },
  );
  // 400: a user of another server. 404: no such account.
  if (response.status === 404 || response.status === 400) {
    return undefined;
  }
  if (!response.ok) {
    throw new MatrixHttpError(
      `matrix admin account-data read for "${userId}" failed: HTTP ${response.status} ${await response.text()}`,
      response.status,
    );
  }
  let body = (await response.json()) as {
    account_data?: { global?: Record<string, unknown> };
  };
  let content = body.account_data?.global?.[eventType];
  return content && typeof content === 'object'
    ? (content as Record<string, unknown>)
    : {};
}

// GETs an admin API path with the process's shared admin token, logging the
// admin in again once if synapse no longer accepts it.
async function adminGet(
  admin: MatrixAdmin,
  path: string,
  { signal }: { signal?: AbortSignal } = {},
): Promise<Response> {
  let request = async (adminAccessToken: string) =>
    await fetch(new URL(path, admin.matrixURL), {
      headers: { Authorization: `Bearer ${adminAccessToken}` },
      signal,
    });
  let adminAccessToken = await getMatrixAdminToken(admin);
  let response = await request(adminAccessToken);
  if (response.status === 401) {
    response = await request(
      await getMatrixAdminToken({ ...admin, stale: adminAccessToken }),
    );
  }
  return response;
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
  signal,
}: {
  matrixURL: URL;
  userId: string;
  userAccessToken: string;
  realmURL: string;
  signal?: AbortSignal;
}): Promise<{ alreadyPresent: boolean }> {
  return appendStringToUserAccountDataArray({
    matrixURL,
    userId,
    userAccessToken,
    eventType: APP_BOXEL_REALMS_EVENT_TYPE,
    arrayKey: 'realms',
    value: realmURL,
    signal,
  });
}

// Append a single realm-server URL to a user's `app.boxel.realm-servers`
// account_data, preserving any existing entries. Same semantics as
// appendRealmToUserAccountData (idempotent, retry-on-stomp).
export async function appendRealmServerToUserAccountData({
  matrixURL,
  userId,
  userAccessToken,
  realmServerURL,
}: {
  matrixURL: URL;
  userId: string;
  userAccessToken: string;
  realmServerURL: string;
}): Promise<{ alreadyPresent: boolean }> {
  return appendStringToUserAccountDataArray({
    matrixURL,
    userId,
    userAccessToken,
    eventType: APP_BOXEL_REALM_SERVERS_EVENT_TYPE,
    arrayKey: 'realmServers',
    value: realmServerURL,
  });
}

// Remove a single realm URL from a user's `app.boxel.realms` account_data,
// preserving every other entry. Idempotent: when `realmURL` is absent no PUT
// is fired and `{ wasPresent: false }` is returned, so callers can tell a
// no-op from a removal. A 404 from the GET means the user has no realms list
// yet, which is the same as an empty array. Requires a user-scoped access
// token (admin-impersonate first; synapse admin tokens cannot write other
// users' account_data). The same lost-update protection as the append
// applies: after the PUT the entry is re-read, and the loop retries while a
// concurrent writer has put the realm back.
export async function removeRealmFromUserAccountData({
  matrixURL,
  userId,
  userAccessToken,
  realmURL,
  signal,
}: {
  matrixURL: URL;
  userId: string;
  userAccessToken: string;
  realmURL: string;
  signal?: AbortSignal;
}): Promise<{ wasPresent: boolean }> {
  return removeStringFromUserAccountDataArray({
    matrixURL,
    userId,
    userAccessToken,
    eventType: APP_BOXEL_REALMS_EVENT_TYPE,
    arrayKey: 'realms',
    value: realmURL,
    signal,
  });
}

async function removeStringFromUserAccountDataArray({
  matrixURL,
  userId,
  userAccessToken,
  eventType,
  arrayKey,
  value,
  signal,
}: {
  matrixURL: URL;
  userId: string;
  userAccessToken: string;
  eventType: string;
  arrayKey: string;
  value: string;
  signal?: AbortSignal;
}): Promise<{ wasPresent: boolean }> {
  let firstAttemptWasPresent: boolean | undefined;
  for (let attempt = 1; attempt <= APPEND_REALM_MAX_ATTEMPTS; attempt++) {
    let existing = await fetchAccountData(
      matrixURL,
      userId,
      userAccessToken,
      eventType,
      signal,
    );
    let entries = Array.isArray(existing[arrayKey])
      ? (existing[arrayKey] as unknown[]).filter(
          (v): v is string => typeof v === 'string',
        )
      : [];
    if (!entries.includes(value)) {
      // On the first attempt the value was never there, so this call removed
      // nothing. On a retry a concurrent writer dropped it for us, which is
      // still a removal from the caller's perspective.
      return { wasPresent: firstAttemptWasPresent ?? false };
    }
    firstAttemptWasPresent = true;
    await putAccountData(
      matrixURL,
      userId,
      userAccessToken,
      eventType,
      {
        ...existing,
        [arrayKey]: entries.filter((entry) => entry !== value),
      },
      signal,
    );
    let verified = await fetchAccountData(
      matrixURL,
      userId,
      userAccessToken,
      eventType,
      signal,
    );
    let verifiedEntries = Array.isArray(verified[arrayKey])
      ? (verified[arrayKey] as unknown[]).filter(
          (v): v is string => typeof v === 'string',
        )
      : [];
    if (!verifiedEntries.includes(value)) {
      return { wasPresent: true };
    }
  }
  throw new Error(
    `matrix ${eventType} removal for "${userId}" lost to a concurrent writer after ${APPEND_REALM_MAX_ATTEMPTS} attempts`,
  );
}

async function appendStringToUserAccountDataArray({
  matrixURL,
  userId,
  userAccessToken,
  eventType,
  arrayKey,
  value,
  signal,
}: {
  matrixURL: URL;
  userId: string;
  userAccessToken: string;
  eventType: string;
  arrayKey: string;
  value: string;
  signal?: AbortSignal;
}): Promise<{ alreadyPresent: boolean }> {
  let firstAttemptAlreadyPresent: boolean | undefined;
  for (let attempt = 1; attempt <= APPEND_REALM_MAX_ATTEMPTS; attempt++) {
    let existing = await fetchAccountData(
      matrixURL,
      userId,
      userAccessToken,
      eventType,
      signal,
    );
    let entries = Array.isArray(existing[arrayKey])
      ? (existing[arrayKey] as unknown[]).filter(
          (v): v is string => typeof v === 'string',
        )
      : [];
    if (entries.includes(value)) {
      // First-attempt observation: the caller cares whether THIS
      // invocation appended, so a value that was already there before
      // we did anything reads as `alreadyPresent: true`. A retry-loop
      // observation: a concurrent writer added our value for us — still
      // a fresh append from the caller's perspective.
      return { alreadyPresent: firstAttemptAlreadyPresent ?? true };
    }
    firstAttemptAlreadyPresent = false;
    await putAccountData(
      matrixURL,
      userId,
      userAccessToken,
      eventType,
      {
        ...existing,
        [arrayKey]: [...entries, value],
      },
      signal,
    );
    // Verify our entry survived; if another writer raced us we retry.
    let verified = await fetchAccountData(
      matrixURL,
      userId,
      userAccessToken,
      eventType,
      signal,
    );
    let verifiedEntries = Array.isArray(verified[arrayKey])
      ? (verified[arrayKey] as unknown[]).filter(
          (v): v is string => typeof v === 'string',
        )
      : [];
    if (verifiedEntries.includes(value)) {
      return { alreadyPresent: false };
    }
  }
  throw new Error(
    `matrix ${eventType} append for "${userId}" lost to a concurrent writer after ${APPEND_REALM_MAX_ATTEMPTS} attempts`,
  );
}

export async function fetchAccountData(
  matrixURL: URL,
  userId: string,
  userAccessToken: string,
  eventType: string,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  let path = `_matrix/client/v3/user/${encodeURIComponent(userId)}/account_data/${eventType}`;
  let response = await fetch(`${matrixURL.href}${path}`, {
    headers: { Authorization: `Bearer ${userAccessToken}` },
    signal,
  });
  if (response.status === 404) {
    return {};
  }
  if (!response.ok) {
    throw new MatrixHttpError(
      `matrix GET ${eventType} for "${userId}" failed: HTTP ${response.status} ${await response.text()}`,
      response.status,
    );
  }
  return (await response.json()) as Record<string, unknown>;
}

async function putAccountData(
  matrixURL: URL,
  userId: string,
  userAccessToken: string,
  eventType: string,
  content: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<void> {
  let path = `_matrix/client/v3/user/${encodeURIComponent(userId)}/account_data/${eventType}`;
  let response = await fetch(`${matrixURL.href}${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${userAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(content),
    signal,
  });
  if (!response.ok) {
    throw new MatrixHttpError(
      `matrix PUT ${eventType} for "${userId}" failed: HTTP ${response.status} ${await response.text()}`,
      response.status,
    );
  }
}
