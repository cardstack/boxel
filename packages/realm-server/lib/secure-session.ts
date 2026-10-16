import { createHash, randomBytes, randomUUID } from 'crypto';
import jsonwebtoken from 'jsonwebtoken';
import {
  fetchSessionRoom,
  logger,
  type DBAdapter,
} from '@cardstack/runtime-common';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import {
  impersonateAsMatrixAdmin,
  logoutMatrixAccessToken,
  resolveAdminCreds,
  getMatrixAdminToken,
} from '../synapse.ts';
import {
  createSecureSessionJWT,
  type RealmServerTokenClaim,
} from '../utils/jwt.ts';

// A session signed in on the secure origin: the credential that minting a key
// write ticket requires, which card code can't reach.
//
// Card code runs in the app page with the user's realm-server session and
// Matrix access token, and can carry both out of the browser. The Matrix
// server lets any access token mint a login token for a fresh device, so a
// Matrix sign-in, however it was made, proves nothing card code couldn't
// produce. What it can't produce is the user re-authenticating: a Matrix
// user-interactive auth (UIA) stage, typing the account's password or
// confirming with its single sign-on provider.
//
// So signing in here runs a UIA check the realm server drives itself:
//
// 1. `startSignIn` mints a short-lived Matrix token for the user through the
//    admin "log in as user" API and makes a request that requires UIA and is
//    never exempted by a recent sign-in: adding a third-party identifier, with
//    a validation session that doesn't exist. Matrix answers with a UIA
//    session and the stages the user can complete. The token is logged out
//    straight away; a UIA session isn't tied to the token that started it.
// 2. The user completes the stage: the secure window sends the password here,
//    or opens the Matrix server's single sign-on confirmation for the session.
// 3. `completeSignIn` repeats the request under a fresh admin-minted token,
//    with the session. Matrix runs the request only once the user has passed
//    the stage, and the request then fails on the made-up validation session
//    — `M_THREEPID_AUTH_FAILED` — having changed nothing. That failure is the
//    proof. The session is recorded as used, so one check signs in once.
//
// The result is a realm-server session carrying the `secureSession` claim,
// which names a `secure_sessions` row. The claim is honoured only while that
// row exists and hasn't expired, so signing out deletes the row.

const log = logger('realm:secure-session');

// How long a secure session lasts. Key changes are occasional, so a session is
// meant to cover a sitting, not to stay signed in.
export const SECURE_SESSION_TTL_SECONDS = 8 * 60 * 60;
// How long a sign-in may take between being started and completed.
export const SIGN_IN_TTL_SECONDS = 10 * 60;

export type SecureSessionClient = 'window' | 'cli';
export type SignInStage = 'password' | 'sso';

const STAGE_TYPES: Record<string, SignInStage> = {
  'm.login.password': 'password',
  'm.login.sso': 'sso',
};

export class SecureSessionError extends Error {
  readonly status: 400 | 401 | 403 | 409 | 503;
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
}

// What a started sign-in hands back to the secure window: an opaque token
// naming the sign-in, which the window presents to complete it, and the
// stages the user may complete it with.
export interface StartedSignIn {
  signIn: string;
  user: string;
  stages: SignInStage[];
  // Where the user confirms with their single sign-on provider, when that is
  // one of the stages.
  ssoURL?: string;
  expiresAt: string;
}

export interface SignedInSession {
  token: string;
  user: string;
  expiresAt: string;
}

// The claims of a sign-in token. It is signed with a key derived for this
// purpose alone, so it never verifies as a realm-server session, and a session
// never verifies as one of these.
interface SignInClaims {
  purpose: 'secure-sign-in';
  user: string;
  uiaSession: string;
  clientSecret: string;
  sid: string;
  client: SecureSessionClient;
}

function signInKey(realmSecretSeed: string): string {
  return createHash('sha256')
    .update(`secure-sign-in:${realmSecretSeed}`)
    .digest('hex');
}

function adminCreds(deps: SecureSessionDeps) {
  let creds = resolveAdminCreds(
    deps.matrixClient.matrixURL,
    deps.matrixAdminUsername,
    deps.matrixAdminPassword,
  );
  if (!creds.ok) {
    log.error(`secure sign-in is unavailable: ${creds.reason}`);
    throw new SecureSessionError(
      503,
      'unavailable',
      'signing in to the secure window is unavailable',
    );
  }
  return {
    matrixURL: deps.matrixClient.matrixURL,
    adminUsername: creds.username,
    adminPassword: creds.password,
  };
}

// The Matrix user a sign-in is for: a full Matrix id as given, an email
// address by the account it is bound to, or a bare username on this realm
// server's Matrix server.
export async function resolveMatrixUser(
  deps: SecureSessionDeps,
  username: string,
): Promise<string> {
  let name = username.trim();
  if (!name) {
    throw new SecureSessionError(400, 'bad-request', 'a username is required');
  }
  if (name.startsWith('@')) {
    if (!/^@[^:\s]+:\S+$/.test(name)) {
      throw new SecureSessionError(
        400,
        'bad-request',
        `'${name}' is not a Matrix user id`,
      );
    }
    return name;
  }
  if (name.includes('@')) {
    let admin = adminCreds(deps);
    let adminToken = await getMatrixAdminToken(admin);
    let response = await fetch(
      new URL(
        `_synapse/admin/v1/threepid/email/users/${encodeURIComponent(name.toLowerCase())}`,
        admin.matrixURL,
      ),
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    if (response.status === 404) {
      throw new SecureSessionError(
        401,
        'unknown-user',
        'no account matches that username or email address',
      );
    }
    if (!response.ok) {
      throw new Error(`email lookup failed: HTTP ${response.status}`);
    }
    let { user_id } = (await response.json()) as { user_id?: string };
    if (!user_id) {
      throw new SecureSessionError(
        401,
        'unknown-user',
        'no account matches that username or email address',
      );
    }
    return user_id;
  }
  await ensureLoggedIn(deps.matrixClient);
  let serverName = deps.matrixClient.getUserId()?.split(':').slice(1).join(':');
  if (!serverName) {
    throw new Error(`the realm server's Matrix user id names no server`);
  }
  return `@${name}:${serverName}`;
}

// The realm server's own Matrix client signs in on first use.
async function ensureLoggedIn(matrixClient: MatrixClient): Promise<void> {
  if (!matrixClient.isLoggedIn()) {
    await matrixClient.login();
  }
}

interface MatrixResult {
  status: number;
  body: Record<string, any>;
}

// The request whose UIA check signs a user in. It adds a third-party
// identifier from a validation session that doesn't exist, so once the check
// passes it fails without changing the account.
async function attemptThreepidAdd(
  matrixURL: URL,
  accessToken: string,
  claims: Pick<SignInClaims, 'clientSecret' | 'sid'>,
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
        client_secret: claims.clientSecret,
        sid: claims.sid,
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
// API, and logs the token out afterwards.
async function asUser<T>(
  deps: SecureSessionDeps,
  user: string,
  fn: (accessToken: string) => Promise<T>,
): Promise<T> {
  let admin = adminCreds(deps);
  let accessToken: string;
  try {
    accessToken = await impersonateAsMatrixAdmin({ ...admin, userId: user });
  } catch (e: any) {
    if (e?.status === 404 || e?.status === 400) {
      throw new SecureSessionError(
        401,
        'unknown-user',
        'no account matches that username or email address',
      );
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

export async function startSignIn(
  deps: SecureSessionDeps,
  { username, client }: { username: string; client: SecureSessionClient },
): Promise<StartedSignIn> {
  let user = await resolveMatrixUser(deps, username);
  await sessionRoomFor(deps, user);
  let request = {
    clientSecret: randomBytes(24).toString('hex'),
    sid: randomBytes(24).toString('hex'),
  };
  let result = await asUser(deps, user, (accessToken) =>
    attemptThreepidAdd(deps.matrixClient.matrixURL, accessToken, request),
  );
  let uiaSession = result.body.session;
  if (result.status !== 401 || typeof uiaSession !== 'string') {
    log.error(
      `starting a secure sign-in got HTTP ${result.status} ${result.body.errcode ?? ''} instead of an auth challenge`,
    );
    throw new SecureSessionError(
      503,
      'unavailable',
      'signing in to the secure window is unavailable',
    );
  }
  // Only flows of a single stage this window can complete are offered.
  let stages = [
    ...new Set(
      ((result.body.flows ?? []) as { stages?: string[] }[])
        .filter((flow) => flow.stages?.length === 1)
        .map((flow) => STAGE_TYPES[flow.stages![0]])
        .filter(Boolean),
    ),
  ];
  if (stages.length === 0) {
    throw new SecureSessionError(
      403,
      'no-stage',
      'this account has no way to confirm it is you here',
    );
  }
  let claims: SignInClaims = {
    purpose: 'secure-sign-in',
    user,
    uiaSession,
    client,
    ...request,
  };
  let signIn = jsonwebtoken.sign(claims, signInKey(deps.realmSecretSeed), {
    expiresIn: SIGN_IN_TTL_SECONDS,
  });
  let ssoURL = stages.includes('sso')
    ? new URL(
        `_matrix/client/v3/auth/m.login.sso/fallback/web?session=${encodeURIComponent(uiaSession)}`,
        deps.matrixClient.matrixURL,
      ).href
    : undefined;
  return {
    signIn,
    user,
    stages,
    ...(ssoURL ? { ssoURL } : {}),
    expiresAt: new Date(Date.now() + SIGN_IN_TTL_SECONDS * 1000).toISOString(),
  };
}

function verifySignIn(deps: SecureSessionDeps, signIn: unknown): SignInClaims {
  if (typeof signIn !== 'string' || !signIn) {
    throw new SecureSessionError(400, 'bad-request', 'a sign-in is required');
  }
  let claims: SignInClaims;
  try {
    claims = jsonwebtoken.verify(
      signIn,
      signInKey(deps.realmSecretSeed),
    ) as SignInClaims;
  } catch (e) {
    if (e instanceof jsonwebtoken.TokenExpiredError) {
      throw new SecureSessionError(
        401,
        'expired',
        'this sign-in has expired; start again',
      );
    }
    throw new SecureSessionError(
      400,
      'bad-request',
      'this sign-in is not recognized',
    );
  }
  if (claims.purpose !== 'secure-sign-in') {
    throw new SecureSessionError(
      400,
      'bad-request',
      'this sign-in is not recognized',
    );
  }
  return claims;
}

// Completes a sign-in. With a password, submits it for the password stage;
// without one, checks whether the user has completed single sign-on, and
// answers `pending` (409) until they have.
export async function completeSignIn(
  deps: SecureSessionDeps,
  { signIn, password }: { signIn: unknown; password?: unknown },
): Promise<SignedInSession> {
  let claims = verifySignIn(deps, signIn);
  if (password !== undefined && typeof password !== 'string') {
    throw new SecureSessionError(400, 'bad-request', 'password must be text');
  }
  let auth: Record<string, unknown> = password
    ? {
        type: 'm.login.password',
        identifier: { type: 'm.id.user', user: claims.user },
        password,
        session: claims.uiaSession,
      }
    : { session: claims.uiaSession };
  let result = await asUser(deps, claims.user, (accessToken) =>
    attemptThreepidAdd(deps.matrixClient.matrixURL, accessToken, claims, auth),
  );
  if (result.status === 401) {
    if (password) {
      throw new SecureSessionError(
        401,
        'invalid-password',
        'that password is not right',
      );
    }
    throw new SecureSessionError(
      409,
      'pending',
      'waiting for you to confirm it is you',
    );
  }
  if (
    !(result.status === 400 && result.body.errcode === 'M_THREEPID_AUTH_FAILED')
  ) {
    log.error(
      `completing a secure sign-in got HTTP ${result.status} ${result.body.errcode ?? ''}`,
    );
    throw new SecureSessionError(
      401,
      'not-confirmed',
      'signing in could not be confirmed; start again',
    );
  }
  return await createSecureSession(deps, claims);
}

// The room the realm server messages the user in, which their first sign-in
// to Boxel creates. A secure session is for someone who already uses Boxel,
// so it never creates one.
async function sessionRoomFor(
  deps: SecureSessionDeps,
  user: string,
): Promise<string> {
  let room = await fetchSessionRoom(deps.dbAdapter, user);
  if (!room) {
    throw new SecureSessionError(
      403,
      'no-boxel-account',
      'sign in to Boxel before signing in here',
    );
  }
  return room;
}

async function createSecureSession(
  deps: SecureSessionDeps,
  claims: SignInClaims,
): Promise<SignedInSession> {
  let id = randomUUID();
  let expiresAt = new Date(Date.now() + SECURE_SESSION_TTL_SECONDS * 1000);
  // Expired sessions are swept as new ones are made.
  await deps.dbAdapter.execute(
    `DELETE FROM secure_sessions WHERE expires_at < NOW()`,
  );
  let inserted = await deps.dbAdapter.execute(
    `INSERT INTO secure_sessions (id, user_id, client, uia_session, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (uia_session) DO NOTHING
       RETURNING id`,
    {
      bind: [
        id,
        claims.user,
        claims.client,
        claims.uiaSession,
        expiresAt.toISOString(),
      ],
    },
  );
  if (inserted.length === 0) {
    throw new SecureSessionError(
      409,
      'used',
      'this sign-in has already been used; start again',
    );
  }
  let sessionRoom = await sessionRoomFor(deps, claims.user);
  let token = createSecureSessionJWT(
    { user: claims.user, sessionRoom, secureSession: id },
    deps.realmSecretSeed,
    SECURE_SESSION_TTL_SECONDS,
  );
  return { token, user: claims.user, expiresAt: expiresAt.toISOString() };
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

// Signs a secure session out. Returns whether there was one to sign out.
export async function endSecureSession(
  dbAdapter: DBAdapter,
  token: RealmServerTokenClaim | undefined,
): Promise<boolean> {
  let id = token?.secureSession;
  if (!token?.user || typeof id !== 'string' || !isUUID(id)) {
    return false;
  }
  let rows = await dbAdapter.execute(
    `DELETE FROM secure_sessions WHERE id = $1 AND user_id = $2 RETURNING id`,
    { bind: [id, token.user] },
  );
  return rows.length > 0;
}

function isUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}
