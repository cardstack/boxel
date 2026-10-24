import { createHash, randomBytes, randomUUID } from 'crypto';
import {
  fetchSessionRoom,
  logger,
  param,
  query,
  type DBAdapter,
} from '@cardstack/runtime-common';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { APP_BOXEL_REALMS_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import {
  getRandomBackgroundURL,
  iconURLFor,
  PERSONAL_REALM_ENDPOINT,
} from '@cardstack/runtime-common/realm-display-defaults';
import {
  appendRealmToUserAccountData,
  fetchAccountData,
  getMatrixAdminToken,
  impersonateAsMatrixAdmin,
  logoutMatrixAccessToken,
  resolveAdminCreds,
} from '../synapse.ts';
import {
  createRealm,
  realmURLFor,
  type CreateRealmDeps,
} from '../handlers/create-realm.ts';
import {
  createSecureSessionJWT,
  type RealmServerTokenClaim,
} from '../utils/jwt.ts';
import {
  discover,
  exchangeGoogleCode,
  GoogleSignInError,
  synapseIdpId,
  type GoogleSignInConfig,
} from './google-sign-in.ts';
import {
  GoogleAccountRefusal,
  resolveGoogleAccount,
  type GoogleAccountLookups,
  type GoogleIdentity,
} from './google-account.ts';
import { GOOGLE_CALLBACK_PATH } from './secure-origin.ts';
import { ensureSessionRoom } from './session-room.ts';
import type { SignInLimiter } from './sign-in-limiter.ts';

// A session signed in on the secure origin: the credential that minting a key
// write ticket requires, which card code can't reach.
//
// Card code runs in the app page with the user's realm-server session and
// Matrix access token, and can carry both out of the browser. The Matrix
// server lets any access token mint a login token for a fresh device, so a
// Matrix sign-in, however it was made, proves nothing card code couldn't
// produce. What it can't produce is the user's own credential, typed or
// confirmed on the secure origin:
//
// - **A password.** The realm server checks it with a Matrix user-interactive
//   auth (UIA) check it drives itself, in one request: it mints a short-lived
//   token for the user through the admin "log in as user" API, asks to add a
//   third-party identifier from a validation session that doesn't exist — a
//   request that always requires UIA — and completes the password stage with
//   the password. Matrix runs the request only once the password is right,
//   and it then fails on the made-up validation session
//   (`M_THREEPID_AUTH_FAILED`) having changed nothing. That failure is the
//   proof.
// - **A Google sign-in** whose authorization code reached the secure origin
//   (see `google-sign-in.ts`).
//
// Either way the result is a realm-server session carrying the
// `secureSession` claim, which names a `secure_sessions` row. The claim is
// honoured only while that row is unexpired, so signing out expires it.

const log = logger('realm:secure-session');

// How long a secure session lasts: a week, as long as the CLI's extended
// session.
export const SECURE_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
// How long a row outlives its session, so the proof it records can't sign in
// again while the Matrix server would still accept it: a completed UIA session
// stays usable for a while after completion.
const PROOF_RETENTION = `interval '2 days'`;

export type SecureSessionClient = 'window' | 'cli';

export class SecureSessionError extends Error {
  readonly status: 400 | 401 | 403 | 409 | 429 | 503;
  readonly code: string;
  // For a 429, how long until the caller may try again, when that's known.
  readonly retryAfterMs?: number;
  constructor(
    status: SecureSessionError['status'],
    code: string,
    message: string,
    opts: { retryAfterMs?: number } = {},
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfterMs = opts.retryAfterMs;
  }
}

export interface SecureSessionDeps {
  dbAdapter: DBAdapter;
  matrixClient: MatrixClient;
  realmSecretSeed: string;
  matrixAdminUsername?: string;
  matrixAdminPassword?: string;
  secureOriginURL?: URL;
  googleSignIn?: GoogleSignInConfig;
  // What making a personal realm needs, for a user's first sign-in to Boxel
  // through Google.
  createRealm?: CreateRealmDeps;
}

export interface SignedInSession {
  token: string;
  user: string;
  expiresAt: string;
}

// The one answer to a password sign-in that fails for the account or the
// password, whichever it was, so a caller learns nothing about which accounts
// exist or how they sign in.
function invalidCredentials() {
  return new SecureSessionError(
    401,
    'invalid-credentials',
    'that account and password don’t match',
  );
}

// Too many failed sign-ins for the account, refused by this server's limit or
// the Matrix server's.
function rateLimited(retryAfterMs: unknown) {
  return new SecureSessionError(
    429,
    'rate-limited',
    'too many failed attempts; try again later',
    {
      retryAfterMs:
        typeof retryAfterMs === 'number' &&
        Number.isFinite(retryAfterMs) &&
        retryAfterMs >= 0
          ? Math.ceil(retryAfterMs)
          : undefined,
    },
  );
}

function unavailable() {
  return new SecureSessionError(
    503,
    'unavailable',
    'signing in is unavailable right now; try again later',
  );
}

function adminCreds(deps: SecureSessionDeps) {
  let creds = resolveAdminCreds(
    deps.matrixClient.matrixURL,
    deps.matrixAdminUsername,
    deps.matrixAdminPassword,
  );
  if (!creds.ok) {
    log.error(`secure sign-in is unavailable: ${creds.reason}`);
    throw unavailable();
  }
  return {
    matrixURL: deps.matrixClient.matrixURL,
    adminUsername: creds.username,
    adminPassword: creds.password,
  };
}

// Whether this server can sign anyone in on the secure origin: every sign-in
// drives the Matrix server's admin API, so without its credentials each one
// answers 503.
export function secureSignInConfigured({
  matrixURL,
  matrixAdminUsername,
  matrixAdminPassword,
}: {
  matrixURL: URL;
  matrixAdminUsername?: string;
  matrixAdminPassword?: string;
}): boolean {
  return resolveAdminCreds(matrixURL, matrixAdminUsername, matrixAdminPassword)
    .ok;
}

// The realm server's own Matrix client signs in on first use.
async function ensureLoggedIn(matrixClient: MatrixClient): Promise<void> {
  if (!matrixClient.isLoggedIn()) {
    await matrixClient.login();
  }
}

async function adminRequest(
  deps: SecureSessionDeps,
  path: string,
  {
    method = 'GET',
    body,
  }: { method?: 'GET' | 'PUT' | 'POST'; body?: unknown } = {},
): Promise<{ status: number; body: Record<string, any> }> {
  let admin = adminCreds(deps);
  let response = await fetch(new URL(path, admin.matrixURL), {
    method,
    headers: {
      Authorization: `Bearer ${await getMatrixAdminToken(admin)}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let json: Record<string, any> = {};
  try {
    json = (await response.json()) as Record<string, any>;
  } catch {
    // Judged by its status alone.
  }
  return { status: response.status, body: json };
}

function userPath(user: string) {
  return `_synapse/admin/v2/users/${encodeURIComponent(user)}`;
}

// The name of the Matrix server this realm server's own user is on, which
// every account it resolves by localpart, or the secure origin registers, is
// on too.
export async function matrixServerName(
  deps: Pick<SecureSessionDeps, 'matrixClient'>,
): Promise<string> {
  await ensureLoggedIn(deps.matrixClient);
  let serverName = deps.matrixClient.getUserId()?.split(':').slice(1).join(':');
  if (!serverName) {
    throw new Error(`the realm server's Matrix user id names no server`);
  }
  return serverName;
}

// The account holding an email address as a third-party id, by the Matrix
// server's admin lookup. Undefined when none does.
async function userByEmail(
  deps: SecureSessionDeps,
  email: string,
): Promise<string | undefined> {
  let { status, body } = await adminRequest(
    deps,
    `_synapse/admin/v1/threepid/email/users/${encodeURIComponent(email)}`,
  );
  if (status === 404) {
    return undefined;
  }
  if (status !== 200) {
    throw new Error(`email lookup failed: HTTP ${status}`);
  }
  return typeof body.user_id === 'string' ? body.user_id : undefined;
}

// The Matrix user a password sign-in names: a full Matrix id on this realm
// server's Matrix server, an email address by the account it is bound to, or a
// bare username on that server. Undefined when there is no such account,
// including for an id on another server, which no account here can be.
async function resolveMatrixUser(
  deps: SecureSessionDeps,
  username: string,
): Promise<string | undefined> {
  let name = username.trim();
  if (name.startsWith('@')) {
    let match = /^@[^:\s]+:(\S+)$/.exec(name);
    return match && match[1] === (await matrixServerName(deps))
      ? name
      : undefined;
  }
  if (name.includes('@')) {
    return await userByEmail(deps, name.toLowerCase());
  }
  return `@${name}:${await matrixServerName(deps)}`;
}

interface MatrixResult {
  status: number;
  body: Record<string, any>;
  // For a 429, how long the Matrix server asks the caller to wait: the body's
  // `retry_after_ms`, or else the standard `Retry-After` header, which a
  // Matrix server may send on its own (the body field is deprecated).
  retryAfterMs?: number;
}

function matrixRetryAfterMs(
  response: Response,
  body: Record<string, any>,
): number | undefined {
  if (typeof body.retry_after_ms === 'number') {
    return body.retry_after_ms;
  }
  let seconds = Number(response.headers.get('Retry-After') ?? NaN);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

// The request whose UIA check confirms a password. It adds a third-party
// identifier from a validation session that doesn't exist, so once the check
// passes it fails without changing the account.
async function attemptThreepidAdd(
  matrixURL: URL,
  accessToken: string,
  request: { clientSecret: string; sid: string },
  auth?: Record<string, unknown>,
): Promise<MatrixResult> {
  let response = await fetch(
    new URL('_matrix/client/v3/account/3pid/add', matrixURL),
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_secret: request.clientSecret,
        sid: request.sid,
        ...(auth ? { auth } : {}),
      }),
    },
  );
  let body: Record<string, any> = {};
  try {
    body = (await response.json()) as Record<string, any>;
  } catch {
    // A response that isn't JSON is judged by its status alone.
  }
  return {
    status: response.status,
    body,
    retryAfterMs:
      response.status === 429 ? matrixRetryAfterMs(response, body) : undefined,
  };
}

// Runs `fn` with a Matrix access token for `user` minted through the admin
// API, and logs the token out afterwards. Undefined when the Matrix server has
// no such account.
async function asUser<T>(
  deps: SecureSessionDeps,
  user: string,
  fn: (accessToken: string) => Promise<T>,
): Promise<T | undefined> {
  let admin = adminCreds(deps);
  let accessToken: string;
  try {
    accessToken = await impersonateAsMatrixAdmin({ ...admin, userId: user });
  } catch (e: any) {
    if (e?.status === 404 || e?.status === 400) {
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
    }).catch((e: any) =>
      log.warn(`could not log out a sign-in token: ${e?.message ?? e}`),
    );
  }
}

// Signs in with a password, checked by the Matrix server's UIA check as
// described above, within the account's limit on failed attempts
// (`withPasswordLimit`).
//
// An account that has never signed in to Boxel, as one just registered on the
// secure origin, gets the app's first-sign-in setup once its password checks
// out. `registrationToken` is the invite code the account registered with,
// which the realm-server user it makes records, as the app's first sign-in
// records it.
export async function signInWithPassword(
  deps: SecureSessionDeps,
  limiter: SignInLimiter,
  attempt: {
    username: string;
    password: string;
    client: SecureSessionClient;
    registrationToken?: string;
  },
): Promise<SignedInSession> {
  return await withPasswordLimit(deps, limiter, attempt, async (user) => {
    let uiaSession = await confirmPassword(deps, user, attempt.password);
    if (!(await fetchSessionRoom(deps.dbAdapter, user))) {
      await setUpFirstSignIn(deps, user, attempt.registrationToken);
    }
    return await createSecureSession(deps, {
      user,
      client: attempt.client,
      proof: `uia:${uiaSession}`,
    });
  });
}

// A password change the secure origin's pages ask the realm server to make:
// the new password, and the proof the Matrix server asks for to set it.
//
// - `reset`: the email validation session a reset email confirmed, and the
//   email address the reset was sent to, when the page knows it.
// - `change`: the access token of a device the account is signed in on, and
//   the account's current password.
export type PasswordChange =
  | {
      kind: 'reset';
      newPassword: string;
      sid: string;
      clientSecret: string;
      email?: string;
    }
  | {
      kind: 'change';
      newPassword: string;
      accessToken: string;
      currentPassword: string;
    };

// Sets an account's password on the Matrix server, and then ends every secure
// session of the account, the window's and the CLI's alike: a session signed
// in with the old password, perhaps by whoever it leaked to, must not outlive
// the change. Resolves to the Matrix server's answer to the change, which the
// page reads as it would had it asked the Matrix server itself.
//
// The Matrix server accepting the change is the proof, so ending the sessions
// needs no password check of its own, and no limit on failed attempts that
// whoever holds the old password could keep full. The Matrix server signs out
// every device of the account but the one making a change (`logout_devices`),
// but it has no way to tell the realm server, which is why the change goes
// through here.
//
// A login token minted before the change and not yet used still signs in a
// new device after it, so once every such token has expired the account's
// devices are signed out again, all but the one that made a change
// (`scheduleDeviceSweep`).
//
// - A change is made with the access token, so the account is the token's.
//   Card code holds the app's token but not the current password, which the
//   Matrix server checks.
// - A reset names no account to the Matrix server, which finds it from the
//   validated email. The realm server can't see which that was, so it ends
//   the sessions of the account the page names by email address, once the new
//   password checks out for it. That check isn't refused under the sign-in
//   limit, or whoever holds the old password could keep it full. Resetting
//   one account while naming another does test a guess at the other's
//   password, which someone holding a session of it learns from that session
//   ending; but the Matrix server deletes a validation session when a reset
//   uses it, so each guess costs a reset email, confirmed, to an account the
//   guesser controls.
export async function changePassword(
  deps: SecureSessionDeps,
  change: PasswordChange,
): Promise<MatrixResult> {
  let matrixURL = deps.matrixClient.matrixURL;
  let user: string | undefined;
  let changingDevice: string | undefined;
  let auth: Record<string, unknown>;
  if (change.kind === 'change') {
    let whoami = await matrixClientRequest(matrixURL, 'account/whoami', {
      method: 'GET',
      accessToken: change.accessToken,
    });
    if (whoami.status !== 200 || typeof whoami.body.user_id !== 'string') {
      return whoami;
    }
    user = whoami.body.user_id;
    changingDevice =
      typeof whoami.body.device_id === 'string'
        ? whoami.body.device_id
        : undefined;
    auth = {
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user },
      password: change.currentPassword,
    };
  } else {
    auth = {
      type: 'm.login.email.identity',
      threepid_creds: { sid: change.sid, client_secret: change.clientSecret },
    };
  }
  let result = await matrixClientRequest(matrixURL, 'account/password', {
    accessToken: change.kind === 'change' ? change.accessToken : undefined,
    body: { auth, new_password: change.newPassword, logout_devices: true },
  });
  if (result.status !== 200) {
    return result;
  }
  try {
    if (change.kind === 'reset') {
      user = change.email
        ? await resetAccount(deps, change.email, change.newPassword)
        : undefined;
    }
    if (user) {
      await deps.dbAdapter.execute(
        `UPDATE secure_sessions SET expires_at = NOW()
          WHERE user_id = $1 AND expires_at > NOW()`,
        { bind: [user] },
      );
      // Only once the rows are expired, so no secure session can mint a
      // login token that outlives the sweep.
      try {
        await scheduleDeviceSweep(deps, user, changingDevice);
      } catch (e: any) {
        log.error(
          `could not schedule a changed password's device sweep: ${e?.name ?? 'Error'}: ${e?.message ?? e}`,
        );
      }
    }
  } catch (e: any) {
    // The password is changed either way, and the page can't make it again:
    // a reset's validation session is spent. A session left signed in runs
    // out within its week.
    log.error(
      `could not end a changed password's secure sessions: ${e?.name ?? 'Error'}: ${e?.message ?? e}`,
    );
  }
  return { status: 200, body: {} };
}

// Ends every secure session of the account a password belongs to, once the
// password checks out, for a page that has set the password with the Matrix
// server itself and sends only the account and the new password. A page
// stays as it loaded, and an app tab can stay open for days, so such a page
// can reach a realm server that sets passwords itself (`changePassword`).
// The new password is the proof here, so it is checked, and limited, exactly
// as a password sign-in is: whoever holds the old password can keep that
// limit full, which `changePassword` doesn't share.
export async function endSessionsForNewPassword(
  deps: SecureSessionDeps,
  limiter: SignInLimiter,
  attempt: { username: string; password: string },
): Promise<void> {
  await withPasswordLimit(deps, limiter, attempt, async (user) => {
    await confirmPassword(deps, user, attempt.password);
    await deps.dbAdapter.execute(
      `UPDATE secure_sessions SET expires_at = NOW()
        WHERE user_id = $1 AND expires_at > NOW()`,
      { bind: [user] },
    );
  });
}

// The account a reset sent to `email` reset, when `password`, the one the
// reset set, is that account's password. Undefined otherwise.
async function resetAccount(
  deps: SecureSessionDeps,
  email: string,
  password: string,
): Promise<string | undefined> {
  let user = await userByEmail(deps, email.trim().toLowerCase());
  if (!user) {
    return undefined;
  }
  try {
    await confirmPassword(deps, user, password);
  } catch (e) {
    if (e instanceof SecureSessionError && e.code === 'invalid-credentials') {
      return undefined;
    }
    throw e;
  }
  return user;
}

// How long after a password change the account's devices are signed out
// again: the lifetime of a Matrix login token
// (`login_via_existing_session.token_timeout`, two minutes on every
// deployment), and a margin for the time the change's requests take.
export const DEVICE_SWEEP_DELAY_MS = (2 * 60 + 30) * 1000;
// How soon a sweep that failed (the Matrix server's admin API is down, say)
// is tried again.
const DEVICE_SWEEP_RETRY_MS = 60 * 1000;

// Signs an account's Matrix devices out once every login token minted before
// its password changed has expired, all but `keepDevice`, the device that made
// the change. The Matrix server signs out the account's other devices when
// the password changes, but leaves its unused login tokens, and any device of
// the account could mint one (`login/get_token` asks for no password), as
// could a secure session (`mintLoginToken`). Such a token redeemed after the
// change makes a device the change never signed out, so the sweep signs it
// out. It also signs out any device that signs in with the new password
// before the sweep: nothing tells the two apart, since a device records
// neither when nor how it signed in.
//
// The sweep is recorded in `password_change_device_sweeps` before it is
// armed, so a realm server that stops before it is due leaves it for the
// next one to start (`resumeDeviceSweeps`).
async function scheduleDeviceSweep(
  deps: SecureSessionDeps,
  user: string,
  keepDevice: string | undefined,
): Promise<void> {
  // A later change of the same account signed out the device an earlier one
  // kept, so its device is the one to keep, and its sweep comes later.
  await deps.dbAdapter.execute(
    `INSERT INTO password_change_device_sweeps (user_id, keep_device_id, sweep_at)
       VALUES ($1, $2, NOW() + $3::integer * interval '1 millisecond')
     ON CONFLICT (user_id) DO UPDATE
       SET keep_device_id = EXCLUDED.keep_device_id,
           sweep_at = GREATEST(
             password_change_device_sweeps.sweep_at,
             EXCLUDED.sweep_at
           )`,
    { bind: [user, keepDevice ?? null, DEVICE_SWEEP_DELAY_MS] },
  );
  armDeviceSweeps(deps, DEVICE_SWEEP_DELAY_MS);
}

// Runs the sweeps a realm server stopped before running, and any due later,
// when the realm server starts.
export function resumeDeviceSweeps(deps: SecureSessionDeps): void {
  armDeviceSweeps(deps, 0);
}

// One timer per database, for the earliest sweep this process knows is due.
// Every realm server process arms its own, so a sweep may run twice, which
// signs out nothing more.
const sweepTimers = new WeakMap<
  SecureSessionDeps['dbAdapter'],
  { at: number; timer: ReturnType<typeof setTimeout> }
>();

function armDeviceSweeps(deps: SecureSessionDeps, delayMs: number): void {
  let at = Date.now() + Math.max(0, delayMs);
  let armed = sweepTimers.get(deps.dbAdapter);
  if (armed && armed.at <= at) {
    return;
  }
  if (armed) {
    clearTimeout(armed.timer);
  }
  let timer = setTimeout(async () => {
    sweepTimers.delete(deps.dbAdapter);
    if (deps.dbAdapter.isClosed) {
      return;
    }
    let next: number | undefined;
    try {
      next = await runDueDeviceSweeps(deps);
    } catch (e: any) {
      log.error(
        `could not run password changes' device sweeps: ${e?.name ?? 'Error'}: ${e?.message ?? e}`,
      );
      next = DEVICE_SWEEP_RETRY_MS;
    }
    if (next !== undefined) {
      armDeviceSweeps(deps, next);
    }
  }, at - Date.now());
  // A sweep left when the process exits is in the table for the next one.
  timer.unref();
  sweepTimers.set(deps.dbAdapter, { at, timer });
}

// Runs every sweep that is due, and resolves to how long until the next one
// is, if any is left. A sweep that fails stays in the table and is tried
// again within a minute.
export async function runDueDeviceSweeps(
  deps: SecureSessionDeps,
): Promise<number | undefined> {
  let due = (await deps.dbAdapter.execute(
    `SELECT user_id, keep_device_id FROM password_change_device_sweeps
      WHERE sweep_at <= NOW()`,
  )) as { user_id: string; keep_device_id: string | null }[];
  let failed = false;
  for (let { user_id: user, keep_device_id: keepDevice } of due) {
    try {
      await signOutDevicesExcept(deps, user, keepDevice ?? undefined);
      // A sweep a later change moved past now stays for that change.
      await deps.dbAdapter.execute(
        `DELETE FROM password_change_device_sweeps
          WHERE user_id = $1 AND sweep_at <= NOW()`,
        { bind: [user] },
      );
    } catch (e: any) {
      failed = true;
      log.error(
        `could not sign a changed password's devices out: ${e?.name ?? 'Error'}: ${e?.message ?? e}`,
      );
    }
  }
  let [{ ms }] = (await deps.dbAdapter.execute(
    `SELECT EXTRACT(EPOCH FROM MIN(sweep_at) - NOW()) * 1000 AS ms
      FROM password_change_device_sweeps`,
  )) as { ms: string | number | null }[];
  if (ms === null) {
    return undefined;
  }
  let next = Math.max(0, Math.ceil(Number(ms)));
  return failed ? Math.max(next, DEVICE_SWEEP_RETRY_MS) : next;
}

// Signs out every Matrix device of the account but `keepDevice`, through the
// admin API, which deletes each device's access tokens with it.
async function signOutDevicesExcept(
  deps: SecureSessionDeps,
  user: string,
  keepDevice: string | undefined,
): Promise<void> {
  let listed = await adminRequest(deps, `${userPath(user)}/devices`);
  if (listed.status === 404) {
    return;
  }
  if (listed.status !== 200) {
    throw new Error(`listing the account's devices got HTTP ${listed.status}`);
  }
  let devices = ((listed.body.devices ?? []) as { device_id?: unknown }[])
    .map((device) => device.device_id)
    .filter(
      (device): device is string =>
        typeof device === 'string' && device !== keepDevice,
    );
  if (devices.length === 0) {
    return;
  }
  let deleted = await adminRequest(deps, `${userPath(user)}/delete_devices`, {
    method: 'POST',
    body: { devices },
  });
  if (deleted.status !== 200) {
    throw new Error(
      `deleting the account's devices got HTTP ${deleted.status}`,
    );
  }
}

// A request to the Matrix client API as a page would make it, answered with
// the Matrix server's status and body.
async function matrixClientRequest(
  matrixURL: URL,
  path: string,
  {
    method = 'POST',
    accessToken,
    body,
  }: {
    method?: 'GET' | 'POST';
    accessToken?: string;
    body?: Record<string, unknown>;
  },
): Promise<MatrixResult> {
  let response = await fetch(new URL(`_matrix/client/v3/${path}`, matrixURL), {
    method,
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json: Record<string, any> = {};
  try {
    json = (await response.json()) as Record<string, any>;
  } catch {
    // A response that isn't JSON is judged by its status alone.
  }
  return { status: response.status, body: json };
}

// Runs `fn` for the Matrix user a password attempt names, within the
// account's limit on failed attempts (see `sign-in-limiter.ts`): an account
// over it is refused before its password is checked, and only a wrong
// password or a name that matches no account counts. Failures are counted as
// the Matrix server counts failed logins: against the Matrix user id the
// account resolves to, however it was named, or against the name itself when
// it names no account.
async function withPasswordLimit<T>(
  deps: SecureSessionDeps,
  limiter: SignInLimiter,
  attempt: { username: string; password: string },
  fn: (user: string) => Promise<T>,
): Promise<T> {
  if (!attempt.username.trim() || !attempt.password) {
    throw invalidCredentials();
  }
  let user = await resolveMatrixUser(deps, attempt.username);
  let account = (user ?? attempt.username.trim()).toLowerCase();
  let check = limiter.start(account);
  if (!check.allowed) {
    throw rateLimited(check.retryAfterMs);
  }
  let failed = false;
  try {
    if (!user) {
      throw invalidCredentials();
    }
    return await fn(user);
  } catch (e) {
    failed =
      e instanceof SecureSessionError && e.code === 'invalid-credentials';
    throw e;
  } finally {
    limiter.finish(account, { failed });
  }
}

// Checks `password` against the account with the UIA check described above,
// and resolves to the UIA session that confirmed it.
async function confirmPassword(
  deps: SecureSessionDeps,
  user: string,
  password: string,
): Promise<string> {
  // The admin API mints a token for any user id, so a name that names no
  // account is caught here, before anything acts as it. Only "no such
  // account" is the account's answer; any other failure is the Matrix
  // server's, and isn't counted against the account.
  let account = await adminRequest(deps, userPath(user));
  if (account.status === 404) {
    throw invalidCredentials();
  }
  if (account.status !== 200) {
    log.error(
      `looking up a secure sign-in's account got HTTP ${account.status}`,
    );
    throw unavailable();
  }
  let request = {
    clientSecret: randomBytes(24).toString('hex'),
    sid: randomBytes(24).toString('hex'),
  };
  let matrixURL = deps.matrixClient.matrixURL;
  let started = await asUser(deps, user, (accessToken) =>
    attemptThreepidAdd(matrixURL, accessToken, request),
  );
  if (!started) {
    throw invalidCredentials();
  }
  if (started.status === 429) {
    throw rateLimited(started.retryAfterMs);
  }
  let uiaSession = started.body.session;
  if (started.status !== 401 || typeof uiaSession !== 'string') {
    log.error(
      `a secure sign-in got HTTP ${started.status} ${started.body.errcode ?? ''} instead of an auth challenge`,
    );
    throw unavailable();
  }
  let offersPassword = ((started.body.flows ?? []) as { stages?: string[] }[])
    .map((flow) => flow.stages ?? [])
    .some((stages) => stages.length === 1 && stages[0] === 'm.login.password');
  if (!offersPassword) {
    // An account with no password, as one made by signing in with Google.
    throw invalidCredentials();
  }
  let completed = await asUser(deps, user, (accessToken) =>
    attemptThreepidAdd(matrixURL, accessToken, request, {
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user },
      password,
      session: uiaSession,
    }),
  );
  if (!completed) {
    throw invalidCredentials();
  }
  if (completed.status === 429) {
    throw rateLimited(completed.retryAfterMs);
  }
  if (completed.status === 401) {
    throw invalidCredentials();
  }
  if (
    !(
      completed.status === 400 &&
      completed.body.errcode === 'M_THREEPID_AUTH_FAILED'
    )
  ) {
    log.error(
      `completing a secure sign-in got HTTP ${completed.status} ${completed.body.errcode ?? ''}`,
    );
    throw unavailable();
  }
  return uiaSession;
}

function googleRedirectURI(deps: SecureSessionDeps): string {
  if (!deps.secureOriginURL) {
    throw unavailable();
  }
  let base = deps.secureOriginURL.href.replace(/\/+$/, '');
  return `${base}/${GOOGLE_CALLBACK_PATH}`;
}

function googleConfig(deps: SecureSessionDeps): GoogleSignInConfig {
  if (!deps.googleSignIn) {
    throw new SecureSessionError(
      503,
      'google-unavailable',
      'signing in with Google is unavailable here',
    );
  }
  return deps.googleSignIn;
}

// What the secure window needs to send the user to Google: where, and as
// which client. The redirect URI is the server's own, never the caller's.
export async function googleSignInStart(deps: SecureSessionDeps): Promise<{
  authorizationEndpoint: string;
  clientId: string;
  redirectURI: string;
}> {
  let config = googleConfig(deps);
  let discovered = await discover(config);
  return {
    authorizationEndpoint: discovered.authorization_endpoint,
    clientId: config.clientId,
    redirectURI: googleRedirectURI(deps),
  };
}

// The answer the app's sign-in gives an account that can't sign in.
function cantSignIn(code: 'deactivated' | 'locked') {
  return new SecureSessionError(
    403,
    code,
    'Sign-in failed. Please check your credentials and try again.',
  );
}

// Refuses an account Synapse wouldn't sign in: a deactivated or locked one.
function refuseUnusable(account: Record<string, any>) {
  if (account.deactivated) {
    throw cantSignIn('deactivated');
  }
  if (account.locked) {
    throw cantSignIn('locked');
  }
}

// Signs in with an authorization code Google sent to the secure origin's
// callback. The Google identity resolves to an account exactly as it does
// when the app signs in through the Matrix server: the account linked to its
// subject, else the one account holding its verified email (which it is then
// linked to), else a new account (see `google-account.ts`). A user signing in
// to Boxel for the first time gets the setup the app's first sign-in does.
export async function signInWithGoogle(
  deps: SecureSessionDeps,
  {
    code,
    codeVerifier,
    nonce,
    client,
  }: {
    code: string;
    codeVerifier: string;
    nonce: string;
    client: SecureSessionClient;
  },
): Promise<SignedInSession> {
  let config = googleConfig(deps);
  let identity: GoogleIdentity;
  try {
    identity = await exchangeGoogleCode(config, {
      code,
      codeVerifier,
      nonce,
      redirectURI: googleRedirectURI(deps),
    });
  } catch (e) {
    if (e instanceof GoogleSignInError) {
      throw new SecureSessionError(401, e.code, e.message);
    }
    throw e;
  }
  let user = await userLinkedToGoogle(deps, config, identity.sub);
  if (user) {
    let account = await adminRequest(deps, userPath(user));
    if (account.status !== 200) {
      throw cantSignIn('deactivated');
    }
    refuseUnusable(account.body);
  } else {
    try {
      user = await linkOrCreateForGoogle(deps, config, identity);
    } catch (e) {
      if (e instanceof GoogleAccountRefusal) {
        throw new SecureSessionError(403, e.code, e.message);
      }
      throw e;
    }
  }
  if (!(await fetchSessionRoom(deps.dbAdapter, user))) {
    await setUpFirstSignIn(deps, user);
  }
  return await createSecureSession(deps, {
    user,
    client,
    proof: `google:${createHash('sha256').update(code).digest('hex')}`,
  });
}

// The account linked to a Google subject: the external id Boxel's OIDC
// mapping provider, or this module, stores under the Matrix server's name for
// the provider.
async function userLinkedToGoogle(
  deps: SecureSessionDeps,
  config: GoogleSignInConfig,
  sub: string,
): Promise<string | undefined> {
  let linked = await adminRequest(
    deps,
    `_synapse/admin/v1/auth_providers/${encodeURIComponent(synapseIdpId(config))}/users/${encodeURIComponent(sub)}`,
  );
  if (linked.status === 404) {
    return undefined;
  }
  if (linked.status !== 200 || typeof linked.body.user_id !== 'string') {
    throw new Error(`Google link lookup failed: HTTP ${linked.status}`);
  }
  return linked.body.user_id;
}

// How many times a sign-in resolves a Google identity again when another
// sign-in takes the account or localpart it chose first.
const MAX_RESOLVE_ATTEMPTS = 5;

// How many localparts a sign-in moves past when the Matrix server refuses them
// as in use. Each refusal names an account that exists, so the candidates run
// out of them as the mapping provider's do; this bounds only a Matrix server
// that refuses every localpart.
const MAX_REFUSED_LOCALPARTS = 100;

// What `createGoogleAccount` answers when the Matrix server refuses the
// localpart as in use: an account has it ignoring case.
const LOCALPART_IN_USE = Symbol('localpart in use');

// Links an unlinked Google identity to the one account holding its verified
// email, or makes it a new account, as the mapping provider does.
async function linkOrCreateForGoogle(
  deps: SecureSessionDeps,
  config: GoogleSignInConfig,
  identity: GoogleIdentity,
): Promise<string> {
  let serverName = await matrixServerName(deps);
  // Localparts this sign-in failed to make an account with. Synapse's
  // registration refuses a localpart that any account has ignoring case, as
  // the mapping provider's `check_user_exists` does, while the admin lookup
  // below matches only exactly. So an account that differs only in case
  // (`@Alice` for `alice`) shows up only as that refusal, and counting it as
  // taken moves on to the next candidate, as the mapping provider does.
  let refused = new Set<string>();
  let lookups: GoogleAccountLookups = {
    // The Matrix server stores an email address lowercased and gives each
    // address to one account, so the admin lookup by the lowercased address
    // finds the only account that can hold it. An address stored before
    // Synapse lowercased them keeps its own spelling, which the lookup
    // matches only exactly, so the address as Google spells it is looked up
    // too.
    usersByEmail: async (email) => {
      let spellings = new Set([email, identity.email?.trim() ?? email]);
      let users: string[] = [];
      for (let spelling of spellings) {
        let user = await userByEmail(deps, spelling);
        if (user) {
          users.push(user);
        }
      }
      return users;
    },
    localpartTaken: async (localpart) => {
      if (refused.has(localpart)) {
        return true;
      }
      let { status } = await adminRequest(
        deps,
        userPath(`@${localpart}:${serverName}`),
      );
      if (status !== 200 && status !== 404) {
        throw new Error(`account lookup failed: HTTP ${status}`);
      }
      return status === 200;
    },
  };
  let races = 0;
  while (
    races < MAX_RESOLVE_ATTEMPTS &&
    refused.size < MAX_REFUSED_LOCALPARTS
  ) {
    let resolved = await resolveGoogleAccount(identity, lookups);
    let user =
      resolved.kind === 'existing'
        ? await linkGoogle(deps, config, resolved.user, identity.sub)
        : await createGoogleAccount(deps, config, {
            user: `@${resolved.localpart}:${serverName}`,
            sub: identity.sub,
            email: resolved.email,
            displayName: resolved.displayName,
          });
    if (typeof user === 'string') {
      return user;
    }
    if (resolved.kind === 'new') {
      refused.add(resolved.localpart);
    }
    if (user !== LOCALPART_IN_USE) {
      races++;
    }
  }
  log.error(
    `a Google sign-in could not make or link an account: ${races} lost races, ${refused.size} localparts taken or refused`,
  );
  throw unavailable();
}

// The Google identity linked to `user` as well as any identities already
// linked to it. Undefined when another sign-in linked the identity first.
async function linkGoogle(
  deps: SecureSessionDeps,
  config: GoogleSignInConfig,
  user: string,
  sub: string,
): Promise<string | undefined> {
  let account = await adminRequest(deps, userPath(user));
  if (account.status !== 200) {
    throw new Error(`account lookup failed: HTTP ${account.status}`);
  }
  refuseUnusable(account.body);
  let externalIds = (
    (account.body.external_ids ?? []) as {
      auth_provider: string;
      external_id: string;
    }[]
  ).map(({ auth_provider, external_id }) => ({ auth_provider, external_id }));
  let linked = await adminRequest(deps, userPath(user), {
    method: 'PUT',
    body: {
      external_ids: [
        ...externalIds,
        { auth_provider: synapseIdpId(config), external_id: sub },
      ],
    },
  });
  if (linked.status === 409) {
    return await userLinkedToGoogle(deps, config, sub);
  }
  if (linked.status !== 200) {
    throw new Error(`linking Google failed: HTTP ${linked.status}`);
  }
  return user;
}

// Makes the account a new Google user gets: the Google identity's link, its
// display name, and its email address as a third-party id. `LOCALPART_IN_USE`
// when an account has the localpart ignoring case, and undefined when another
// sign-in took it after it was found free. Either way the caller resolves
// again past it.
async function createGoogleAccount(
  deps: SecureSessionDeps,
  config: GoogleSignInConfig,
  {
    user,
    sub,
    email,
    displayName,
  }: { user: string; sub: string; email: string; displayName?: string },
): Promise<string | typeof LOCALPART_IN_USE | undefined> {
  // An empty body creates the account, or changes nothing on an account that
  // appeared since the localpart was found free, so only a 201 means this
  // sign-in owns it.
  let created = await adminRequest(deps, userPath(user), {
    method: 'PUT',
    body: {},
  });
  if (created.body.errcode === 'M_USER_IN_USE') {
    return LOCALPART_IN_USE;
  }
  if (created.status === 200) {
    return undefined;
  }
  if (created.status !== 201) {
    throw new Error(
      `creating an account failed: HTTP ${created.status} ${created.body.errcode ?? ''}`,
    );
  }
  // The account is this sign-in's until it is complete. A failure part way
  // leaves it unlinked and deactivated, so the next sign-in resolves the
  // Google identity again rather than following a link into an account
  // without its email or name.
  try {
    // The link comes first: it is unique, so a concurrent first sign-in with
    // the same Google identity loses here, before it gives the new account
    // the email address.
    let linked = await adminRequest(deps, userPath(user), {
      method: 'PUT',
      body: {
        external_ids: [
          { auth_provider: synapseIdpId(config), external_id: sub },
        ],
      },
    });
    if (linked.status === 409) {
      await abandonAccount(deps, user);
      return await userLinkedToGoogle(deps, config, sub);
    }
    if (linked.status !== 200) {
      throw new Error(`linking Google failed: HTTP ${linked.status}`);
    }
    let profile = await adminRequest(deps, userPath(user), {
      method: 'PUT',
      body: {
        ...(displayName ? { displayname: displayName } : {}),
        threepids: [{ medium: 'email', address: email }],
      },
    });
    if (profile.status !== 200) {
      throw new Error(`setting up the account failed: HTTP ${profile.status}`);
    }
  } catch (e) {
    await abandonAccount(deps, user).catch((abandonError: any) =>
      log.error(
        `could not abandon an incomplete Google account: ${abandonError?.message ?? abandonError}`,
      ),
    );
    throw e;
  }
  return user;
}

// Unlinks and deactivates an account a sign-in made but couldn't finish.
async function abandonAccount(
  deps: SecureSessionDeps,
  user: string,
): Promise<void> {
  let abandoned = await adminRequest(deps, userPath(user), {
    method: 'PUT',
    body: { external_ids: [], deactivated: true },
  });
  if (abandoned.status !== 200) {
    throw new Error(`abandoning the account failed: HTTP ${abandoned.status}`);
  }
}

async function realmRegistered(
  dbAdapter: DBAdapter,
  url: string,
): Promise<boolean> {
  let rows = await query(dbAdapter, [
    `SELECT 1 FROM realm_registry WHERE url =`,
    param(url),
  ]);
  return rows.length > 0;
}

// The setup the app runs on a user's first sign-in to Boxel: their
// realm-server user (recording the invite code they registered with, if any)
// and its first credit grant, their personal realm, and the session room the
// realm server messages them in. The session room comes last, since it is
// what marks the setup done: a sign-in that fails part way sets up again.
async function setUpFirstSignIn(
  deps: SecureSessionDeps,
  user: string,
  registrationToken?: string,
): Promise<void> {
  if (!deps.createRealm) {
    throw unavailable();
  }
  let account = await adminRequest(deps, userPath(user));
  let displayName: string =
    typeof account.body.displayname === 'string' && account.body.displayname
      ? account.body.displayname
      : user.slice(1).split(':')[0];
  let createRealmDeps = deps.createRealm;
  await asUser(deps, user, async (accessToken) => {
    let { realms } = await fetchAccountData(
      deps.matrixClient.matrixURL,
      user,
      accessToken,
      APP_BOXEL_REALMS_EVENT_TYPE,
    );
    // The user's own personal realm, as the app judges it: a realm someone
    // else shared with the user before their first sign-in is in their
    // account data too, and doesn't count.
    let realmURL = realmURLFor(
      createRealmDeps.serverURL,
      user,
      PERSONAL_REALM_ENDPOINT,
    );
    if (Array.isArray(realms) && realms.includes(realmURL)) {
      return;
    }
    // A realm an earlier, unfinished sign-in made is recorded rather than
    // made again.
    if (!(await realmRegistered(deps.dbAdapter, realmURL))) {
      try {
        await createRealm(createRealmDeps, {
          ownerUserId: user,
          endpoint: PERSONAL_REALM_ENDPOINT,
          name: `${displayName}'s Workspace`,
          iconURL: iconURLFor(displayName),
          backgroundURL: getRandomBackgroundURL(),
        });
      } catch (e) {
        if (!(await realmRegistered(deps.dbAdapter, realmURL))) {
          throw e;
        }
      }
    }
    await appendRealmToUserAccountData({
      matrixURL: deps.matrixClient.matrixURL,
      userId: user,
      userAccessToken: accessToken,
      realmURL,
    });
  });
  await ensureLoggedIn(deps.matrixClient);
  await ensureSessionRoom(deps, user, registrationToken);
}

async function createSecureSession(
  deps: SecureSessionDeps,
  {
    user,
    client,
    proof,
  }: { user: string; client: SecureSessionClient; proof: string },
): Promise<SignedInSession> {
  // The room the realm server messages the user in, which their first sign-in
  // to Boxel creates (`setUpFirstSignIn`).
  let sessionRoom = await fetchSessionRoom(deps.dbAdapter, user);
  if (!sessionRoom) {
    throw new SecureSessionError(
      403,
      'no-boxel-account',
      'sign in to Boxel before signing in here',
    );
  }
  let id = randomUUID();
  let expiresAt = new Date(Date.now() + SECURE_SESSION_TTL_SECONDS * 1000);
  // Rows are swept once nothing could sign in with their proof again.
  await deps.dbAdapter.execute(
    `DELETE FROM secure_sessions WHERE expires_at < NOW() - ${PROOF_RETENTION}`,
  );
  let inserted = await deps.dbAdapter.execute(
    `INSERT INTO secure_sessions (id, user_id, client, sign_in_proof, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (sign_in_proof) DO NOTHING
       RETURNING id`,
    { bind: [id, user, client, proof, expiresAt.toISOString()] },
  );
  if (inserted.length === 0) {
    throw new SecureSessionError(
      409,
      'used',
      'this sign-in has already been used; start again',
    );
  }
  let token = createSecureSessionJWT(
    { user, sessionRoom, secureSession: id },
    deps.realmSecretSeed,
    SECURE_SESSION_TTL_SECONDS,
  );
  return { token, user, expiresAt: expiresAt.toISOString() };
}

// Whether a verified realm-server session was signed in on the secure origin
// and is still signed in: it carries the `secureSession` claim, and the row it
// names belongs to its user and hasn't expired.
export async function isSecureSession(
  dbAdapter: DBAdapter,
  token: RealmServerTokenClaim | undefined,
): Promise<boolean> {
  let id = token?.secureSession;
  if (!token?.user || typeof id !== 'string' || !isUUID(id)) {
    return false;
  }
  let rows = await dbAdapter.execute(
    `SELECT 1 FROM secure_sessions
      WHERE id = $1 AND user_id = $2 AND expires_at > NOW()`,
    { bind: [id, token.user] },
  );
  return rows.length > 0;
}

export interface LoginToken {
  loginToken: string;
  expiresInMs?: number;
}

// A single-use Matrix login token for the user a live secure session belongs
// to: the hand-off by which a sign-in on the secure origin signs the app, or
// the CLI, in to Matrix. The secure origin's page carries the token to its
// destination by a top-level navigation, and the destination redeems it with
// an `m.login.token` login, which makes a device of its own. The secure session
// itself never leaves the secure origin.
//
// The token comes from the Matrix server's own login-token request (MSC3882
// `login/get_token`), made with an access token minted for the user through
// the admin API and logged out straight after. So the Matrix server binds the
// token to the user, honours it once, and expires it after its
// `login_via_existing_session.token_timeout`. It allows one such request per
// user a minute; a request inside that minute is refused with when to try
// again.
export async function mintLoginToken(
  deps: SecureSessionDeps,
  token: RealmServerTokenClaim | undefined,
): Promise<LoginToken> {
  if (!token?.user || !(await isSecureSession(deps.dbAdapter, token))) {
    throw new SecureSessionError(
      401,
      'signed-out',
      'this session is signed out',
    );
  }
  let minted = await asUser(deps, token.user, async (accessToken) => {
    let response = await fetch(
      new URL('_matrix/client/v1/login/get_token', deps.matrixClient.matrixURL),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      },
    );
    let body: Record<string, any> = {};
    try {
      body = (await response.json()) as Record<string, any>;
    } catch {
      // Judged by its status alone.
    }
    if (response.status === 429) {
      let retryAfterMs = matrixRetryAfterMs(response, body);
      throw new SecureSessionError(
        429,
        'rate-limited',
        'a sign-in was handed over moments ago; try again shortly',
        {
          retryAfterMs:
            retryAfterMs !== undefined &&
            Number.isFinite(retryAfterMs) &&
            retryAfterMs >= 0
              ? Math.ceil(retryAfterMs)
              : undefined,
        },
      );
    }
    if (!response.ok || typeof body.login_token !== 'string') {
      log.error(
        `the Matrix server did not mint a login token: HTTP ${response.status} ${body.errcode ?? ''}`,
      );
      throw unavailable();
    }
    return {
      loginToken: body.login_token,
      ...(typeof body.expires_in_ms === 'number'
        ? { expiresInMs: body.expires_in_ms }
        : {}),
    };
  });
  if (!minted) {
    throw new SecureSessionError(
      401,
      'signed-out',
      'this session is signed out',
    );
  }
  return minted;
}

// Signs a secure session out by expiring its row. The row stays until it is
// swept, so the proof it records still can't sign in again.
export async function endSecureSession(
  dbAdapter: DBAdapter,
  token: RealmServerTokenClaim | undefined,
): Promise<boolean> {
  let id = token?.secureSession;
  if (!token?.user || typeof id !== 'string' || !isUUID(id)) {
    return false;
  }
  let rows = await dbAdapter.execute(
    `UPDATE secure_sessions SET expires_at = NOW()
      WHERE id = $1 AND user_id = $2 AND expires_at > NOW()
      RETURNING id`,
    { bind: [id, token.user] },
  );
  return rows.length > 0;
}

// Signs the user's secure windows out, in every browser, when they sign out of
// the app: the app page can neither read the window's storage nor reach the
// window, so only the server can end its session. Rows are expired, not
// deleted, as `endSecureSession` does. The CLI's sessions are left alone; the
// CLI usually runs on another machine, and `boxel keys sign-out` ends them.
export async function endWindowSessions(
  dbAdapter: DBAdapter,
  user: string,
): Promise<void> {
  await dbAdapter.execute(
    `UPDATE secure_sessions SET expires_at = NOW()
      WHERE user_id = $1 AND client = 'window' AND expires_at > NOW()`,
    { bind: [user] },
  );
}

function isUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}
