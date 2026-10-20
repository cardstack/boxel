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

// The realm server's own Matrix client signs in on first use.
async function ensureLoggedIn(matrixClient: MatrixClient): Promise<void> {
  if (!matrixClient.isLoggedIn()) {
    await matrixClient.login();
  }
}

async function adminRequest(
  deps: SecureSessionDeps,
  path: string,
  { method = 'GET', body }: { method?: 'GET' | 'PUT'; body?: unknown } = {},
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
// every account it resolves by localpart is on too.
async function matrixServerName(deps: SecureSessionDeps): Promise<string> {
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
// described above. Only failures count against the account's limit (see
// `sign-in-limiter.ts`), and an account over it is refused before its
// password is checked. Failures are counted as the Matrix server counts failed
// logins: against the Matrix user id the account resolves to, however it was
// named, or against the name itself when it names no account.
export async function signInWithPassword(
  deps: SecureSessionDeps,
  limiter: SignInLimiter,
  attempt: { username: string; password: string; client: SecureSessionClient },
): Promise<SignedInSession> {
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
    return await checkPassword(deps, user, attempt);
  } catch (e) {
    failed =
      e instanceof SecureSessionError && e.code === 'invalid-credentials';
    throw e;
  } finally {
    limiter.finish(account, { failed });
  }
}

async function checkPassword(
  deps: SecureSessionDeps,
  user: string | undefined,
  { password, client }: { password: string; client: SecureSessionClient },
): Promise<SignedInSession> {
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

// Links an unlinked Google identity to the one account holding its verified
// email, or makes it a new account, as the mapping provider does.
async function linkOrCreateForGoogle(
  deps: SecureSessionDeps,
  config: GoogleSignInConfig,
  identity: GoogleIdentity,
): Promise<string> {
  let serverName = await matrixServerName(deps);
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
  for (let attempt = 0; attempt < MAX_RESOLVE_ATTEMPTS; attempt++) {
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
    if (user) {
      return user;
    }
  }
  log.error(
    `a Google sign-in lost ${MAX_RESOLVE_ATTEMPTS} races for its account`,
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
// display name, and its email address as a third-party id. Undefined when the
// localpart was taken after it was found free, so the caller resolves again.
async function createGoogleAccount(
  deps: SecureSessionDeps,
  config: GoogleSignInConfig,
  {
    user,
    sub,
    email,
    displayName,
  }: { user: string; sub: string; email: string; displayName?: string },
): Promise<string | undefined> {
  // An empty body creates the account, or changes nothing on an account that
  // appeared since the localpart was found free, so only a 201 means this
  // sign-in owns it.
  let created = await adminRequest(deps, userPath(user), {
    method: 'PUT',
    body: {},
  });
  if (created.status === 200 || created.body.errcode === 'M_USER_IN_USE') {
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
// realm-server user, their personal realm, and the session room the realm
// server messages them in. The session room comes last, since it is what
// marks the setup done: a sign-in that fails part way sets up again.
async function setUpFirstSignIn(
  deps: SecureSessionDeps,
  user: string,
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
  await ensureSessionRoom(deps, user);
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
  // to Boxel creates. Only a Google sign-in can be someone's first sign-in
  // (`setUpFirstSignIn`); every other secure session is for someone who
  // already uses Boxel.
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

function isUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}
