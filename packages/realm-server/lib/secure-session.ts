import { createHash, randomBytes, randomUUID } from 'crypto';
import {
  fetchSessionRoom,
  logger,
  type DBAdapter,
} from '@cardstack/runtime-common';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import {
  getMatrixAdminToken,
  impersonateAsMatrixAdmin,
  logoutMatrixAccessToken,
  resolveAdminCreds,
} from '../synapse.ts';
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
import { GOOGLE_CALLBACK_PATH } from './secure-origin.ts';

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
  constructor(
    status: SecureSessionError['status'],
    code: string,
    message: string,
  ) {
    super(message);
    this.status = status;
    this.code = code;
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

function rateLimited() {
  return new SecureSessionError(
    429,
    'rate-limited',
    'too many attempts; wait a moment and try again',
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

// The realm server's own Matrix client signs in on first use.
async function ensureLoggedIn(matrixClient: MatrixClient): Promise<void> {
  if (!matrixClient.isLoggedIn()) {
    await matrixClient.login();
  }
}

async function adminGet(
  deps: SecureSessionDeps,
  path: string,
): Promise<{ status: number; body: Record<string, any> }> {
  let admin = adminCreds(deps);
  let response = await fetch(new URL(path, admin.matrixURL), {
    headers: { Authorization: `Bearer ${await getMatrixAdminToken(admin)}` },
  });
  let body: Record<string, any> = {};
  try {
    body = (await response.json()) as Record<string, any>;
  } catch {
    // Judged by its status alone.
  }
  return { status: response.status, body };
}

// The Matrix user a password sign-in names: a full Matrix id as given, an
// email address by the account it is bound to, or a bare username on this
// realm server's Matrix server. Undefined when there is no such account.
async function resolveMatrixUser(
  deps: SecureSessionDeps,
  username: string,
): Promise<string | undefined> {
  let name = username.trim();
  if (name.startsWith('@')) {
    return /^@[^:\s]+:\S+$/.test(name) ? name : undefined;
  }
  if (name.includes('@')) {
    let { status, body } = await adminGet(
      deps,
      `_synapse/admin/v1/threepid/email/users/${encodeURIComponent(name.toLowerCase())}`,
    );
    if (status === 404) {
      return undefined;
    }
    if (status !== 200) {
      throw new Error(`email lookup failed: HTTP ${status}`);
    }
    return typeof body.user_id === 'string' ? body.user_id : undefined;
  }
  await ensureLoggedIn(deps.matrixClient);
  let serverName = deps.matrixClient.getUserId()?.split(':').slice(1).join(':');
  if (!serverName) {
    throw new Error(`the realm server's Matrix user id names no server`);
  }
  return `@${name}:${serverName}`;
}

interface MatrixResult {
  status: number;
  body: Record<string, any>;
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
  return { status: response.status, body };
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
// described above.
export async function signInWithPassword(
  deps: SecureSessionDeps,
  {
    username,
    password,
    client,
  }: { username: string; password: string; client: SecureSessionClient },
): Promise<SignedInSession> {
  if (!username.trim() || !password) {
    throw invalidCredentials();
  }
  let user = await resolveMatrixUser(deps, username);
  if (!user || !(await fetchSessionRoom(deps.dbAdapter, user))) {
    throw invalidCredentials();
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
    throw rateLimited();
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
    throw rateLimited();
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
  return await createSecureSession(deps, {
    user,
    client,
    proof: `uia:${uiaSession}`,
  });
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

// Signs in with an authorization code Google sent to the secure origin's
// callback, for the account linked to that Google identity.
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
  let sub: string;
  try {
    sub = await exchangeGoogleCode(config, {
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
  let linked = await adminGet(
    deps,
    `_synapse/admin/v1/auth_providers/${encodeURIComponent(synapseIdpId(config))}/users/${encodeURIComponent(sub)}`,
  );
  let user = linked.body.user_id;
  if (linked.status !== 200 || typeof user !== 'string') {
    throw new SecureSessionError(
      403,
      'not-linked',
      'this Google account isn’t linked to Boxel; sign in to Boxel with Google first, or use your password',
    );
  }
  let account = await adminGet(
    deps,
    `_synapse/admin/v2/users/${encodeURIComponent(user)}`,
  );
  if (account.status !== 200 || account.body.deactivated) {
    throw new SecureSessionError(
      403,
      'deactivated',
      'this Boxel account can’t sign in',
    );
  }
  return await createSecureSession(deps, {
    user,
    client,
    proof: `google:${createHash('sha256').update(code).digest('hex')}`,
  });
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
  // to Boxel creates. A secure session is for someone who already uses Boxel,
  // so it never creates one.
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
