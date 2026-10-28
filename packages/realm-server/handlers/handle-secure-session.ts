import type Koa from 'koa';
import { logger, SupportedMimeType } from '@cardstack/runtime-common';
import type { SignInLimiter } from '../lib/sign-in-limiter.ts';
import {
  sendResponseForError,
  setContextResponse,
} from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import type { CreateRealmDeps } from './create-realm.ts';
import type { RealmServerTokenClaim } from '../utils/jwt.ts';
import {
  changePassword,
  endSecureSession,
  endWindowSessions,
  googleSignInStart,
  isSecureSession,
  matrixServerName,
  mintLoginToken,
  renewSecureSession,
  resumeDeviceSweeps,
  SecureSessionError,
  secureSignInConfigured,
  signInWithGoogle,
  signInWithPassword,
  type PasswordChange,
  type SecureSessionClient,
  type SecureSessionDeps,
} from '../lib/secure-session.ts';

// Signing in on the secure origin (see `lib/secure-session.ts`). A sign-in is
// answered only for the secure origin's own pages: a browser always sends
// `Origin` on a POST and page script can't change it, so card code in the app
// page can't drive a sign-in through the user's browser. A request body here
// carries a password, an authorization code or a session, so nothing here
// logs a body, and the request log and telemetry keep only the method and
// path of these routes.

const log = logger('realm:secure-session');

// Far larger than a username, a password or an authorization code needs.
const MAX_BODY_LENGTH = 8 * 1024;

type Handler = (ctxt: Koa.Context, next: Koa.Next) => Promise<void>;

const CLIENTS = new Set<SecureSessionClient>(['window', 'cli']);

function deps(
  args: CreateRoutesArgs,
  createRealm?: CreateRealmDeps,
): SecureSessionDeps {
  return {
    dbAdapter: args.dbAdapter,
    matrixClient: args.matrixClient,
    realmSecretSeed: args.realmSecretSeed,
    matrixAdminUsername: args.matrixAdminUsername,
    matrixAdminPassword: args.matrixAdminPassword,
    secureOriginURL: args.secureOriginURL,
    googleSignIn: args.googleSignIn,
    createRealm,
  };
}

async function sendJSON(
  ctxt: Koa.Context,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  await setContextResponse(
    ctxt,
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': SupportedMimeType.JSONAPI, ...headers },
    }),
  );
}

function requireSecureOrigin(ctxt: Koa.Context, secureOriginURL?: URL) {
  if (!secureOriginURL || ctxt.get('Origin') !== secureOriginURL.origin) {
    throw new SecureSessionError(
      403,
      'forbidden',
      'this sign-in can’t be used here',
    );
  }
}

async function readAttributes(
  ctxt: Koa.Context,
  type: string,
): Promise<Record<string, unknown>> {
  let declared = Number(ctxt.get('Content-Length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_LENGTH) {
    throw new SecureSessionError(400, 'bad-request', 'the body is too large');
  }
  let chunks: Buffer[] = [];
  let received = 0;
  for await (let chunk of ctxt.req) {
    let buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buffer.length;
    if (received > MAX_BODY_LENGTH) {
      throw new SecureSessionError(400, 'bad-request', 'the body is too large');
    }
    chunks.push(buffer);
  }
  let json: any;
  try {
    json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new SecureSessionError(400, 'bad-request', 'the body is not JSON');
  }
  let attributes = json?.data?.attributes;
  if (
    json?.data?.type !== type ||
    !attributes ||
    typeof attributes !== 'object' ||
    Array.isArray(attributes)
  ) {
    throw new SecureSessionError(
      400,
      'bad-request',
      `the body is a '${type}' resource`,
    );
  }
  return attributes;
}

function clientOf(attributes: Record<string, unknown>): SecureSessionClient {
  let { client } = attributes;
  if (!CLIENTS.has(client as SecureSessionClient)) {
    throw new SecureSessionError(
      400,
      'bad-request',
      `client is 'window' or 'cli'`,
    );
  }
  return client as SecureSessionClient;
}

function textOf(attributes: Record<string, unknown>, name: string): string {
  let value = attributes[name];
  if (typeof value !== 'string' || !value) {
    throw new SecureSessionError(400, 'bad-request', `${name} is required`);
  }
  return value;
}

// Answers a `SecureSessionError` with its status, message and code, and
// anything else with a bare 500. A 429 that knows when to try again says so in
// `Retry-After`, and to the millisecond in the error's `meta.retryAfterMs`,
// which the secure window shows as the app does. Only an error's name and
// message are logged, never the request.
function secureSessionHandler(
  fn: (ctxt: Koa.Context) => Promise<void>,
): Handler {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    try {
      await fn(ctxt);
    } catch (e: any) {
      if (e instanceof SecureSessionError) {
        let { retryAfterMs } = e;
        await sendJSON(
          ctxt,
          e.status,
          {
            errors: [
              {
                status: String(e.status),
                code: e.code,
                detail: e.message,
                ...(retryAfterMs === undefined
                  ? {}
                  : { meta: { retryAfterMs } }),
              },
            ],
          },
          retryAfterMs === undefined
            ? {}
            : { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) },
        );
        return;
      }
      log.error(
        `${ctxt.method} ${ctxt.path} failed: ${e?.name ?? 'Error'}: ${e?.message ?? e}`,
      );
      await sendResponseForError(
        ctxt,
        500,
        'System Error',
        'Internal server error',
      );
    }
  };
}

async function sendSession(ctxt: Koa.Context, session: unknown) {
  await sendJSON(ctxt, 201, {
    data: { type: 'secure-session', attributes: session },
  });
}

// An optional text attribute: undefined when absent or empty.
function optionalTextOf(
  attributes: Record<string, unknown>,
  name: string,
): string | undefined {
  let value = attributes[name];
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new SecureSessionError(400, 'bad-request', `${name} is text`);
  }
  return value;
}

// POST /_secure-session: signs in with a username, email address or Matrix id
// and the account's password. Failed sign-ins are limited per account, with the
// Matrix server's default limit on failed logins to the app, by `limiter`. An
// account's first sign-in to Boxel makes its personal realm, hence the realm
// deps, and records the invite code it registered with (`registrationToken`).
export function handlePasswordSignIn(
  args: CreateRoutesArgs,
  createRealm: CreateRealmDeps,
  limiter: SignInLimiter,
): Handler {
  return secureSessionHandler(async (ctxt) => {
    requireSecureOrigin(ctxt, args.secureOriginURL);
    let attributes = await readAttributes(ctxt, 'secure-session');
    let { username, password } = attributes;
    await sendSession(
      ctxt,
      await signInWithPassword(deps(args, createRealm), limiter, {
        username: typeof username === 'string' ? username : '',
        password: typeof password === 'string' ? password : '',
        client: clientOf(attributes),
        registrationToken: optionalTextOf(attributes, 'registrationToken'),
      }),
    );
  });
}

// POST /_secure-sessions/password-change: sets an account's password on the
// Matrix server, and then ends every secure session of the account, the CLI's
// included (`changePassword`). The secure origin's pages send it in place of
// the Matrix request: a reset with `sid`, `clientSecret` and the `email` the
// reset was sent to, or a change with `accessToken` and `currentPassword`;
// either with `newPassword`. Answered only for the secure origin, with the
// Matrix server's status and body, alike whether or not a session ended.
export function handlePasswordChange(args: CreateRoutesArgs): Handler {
  return secureSessionHandler(async (ctxt) => {
    requireSecureOrigin(ctxt, args.secureOriginURL);
    let attributes = await readAttributes(ctxt, 'password-change');
    let newPassword = textOf(attributes, 'newPassword');
    let accessToken = optionalTextOf(attributes, 'accessToken');
    let change: PasswordChange = accessToken
      ? {
          kind: 'change',
          newPassword,
          accessToken,
          currentPassword: textOf(attributes, 'currentPassword'),
        }
      : {
          kind: 'reset',
          newPassword,
          sid: textOf(attributes, 'sid'),
          clientSecret: textOf(attributes, 'clientSecret'),
          email: optionalTextOf(attributes, 'email'),
        };
    let result = await changePassword(deps(args), change);
    await setContextResponse(
      ctxt,
      new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
}

// Runs the device sweeps of password changes (`changePassword`) that a realm
// server stopped before running, and arms the rest, as the routes are set up.
export function resumePasswordChangeDeviceSweeps(args: CreateRoutesArgs): void {
  resumeDeviceSweeps(deps(args));
}

// GET /_secure-session/google: where the secure window sends the user to sign
// in with Google, and as which client. 503 when this server has no Google
// client.
export function handleGoogleSignInStart(args: CreateRoutesArgs): Handler {
  return secureSessionHandler(async (ctxt) => {
    await sendJSON(ctxt, 200, {
      data: {
        type: 'google-sign-in',
        attributes: await googleSignInStart(deps(args)),
      },
    });
  });
}

// POST /_secure-session/google: signs in with the authorization code Google
// sent to the secure origin's callback, with the PKCE verifier and nonce the
// window started the sign-in with. A user's first sign-in to Boxel makes their
// personal realm, hence the realm deps.
export function handleGoogleSignIn(
  args: CreateRoutesArgs,
  createRealm: CreateRealmDeps,
): Handler {
  return secureSessionHandler(async (ctxt) => {
    requireSecureOrigin(ctxt, args.secureOriginURL);
    let attributes = await readAttributes(ctxt, 'google-sign-in');
    await sendSession(
      ctxt,
      await signInWithGoogle(deps(args, createRealm), {
        code: textOf(attributes, 'code'),
        codeVerifier: textOf(attributes, 'codeVerifier'),
        nonce: textOf(attributes, 'nonce'),
        client: clientOf(attributes),
      }),
    );
  });
}

// DELETE /_secure-session: signs the presented secure session out, from the
// secure window or the CLI.
export function handleEndSecureSession({
  dbAdapter,
}: CreateRoutesArgs): Handler {
  return secureSessionHandler(async (ctxt) => {
    let token = ctxt.state.token as RealmServerTokenClaim | undefined;
    if (!token?.secureSession) {
      throw new SecureSessionError(
        400,
        'bad-request',
        'this is not a session signed in on the secure origin',
      );
    }
    await endSecureSession(dbAdapter, token);
    await setContextResponse(ctxt, new Response(null, { status: 204 }));
  });
}

// GET /_secure-session: whether the presented secure session is still signed
// in, so the secure window shows its sign-in rather than a session the server
// has ended. 204 when it is, 401 `signed-out` when it isn't.
export function handleCheckSecureSession({
  dbAdapter,
}: CreateRoutesArgs): Handler {
  return secureSessionHandler(async (ctxt) => {
    if (
      !(await isSecureSession(
        dbAdapter,
        ctxt.state.token as RealmServerTokenClaim | undefined,
      ))
    ) {
      throw new SecureSessionError(
        401,
        'signed-out',
        'this session is signed out',
      );
    }
    await setContextResponse(ctxt, new Response(null, { status: 204 }));
  });
}

// POST /_secure-session/login-token: a single-use Matrix login token for the
// presented secure session's user, which the secure origin's page hands to
// the app or the CLI by navigating there with it. Answered only for the secure
// origin, and only for a session signed in there: 401 `signed-out` otherwise,
// and 429 `rate-limited`, with when to try again, when the Matrix server has
// minted one for the user within the minute.
export function handleMintLoginToken(args: CreateRoutesArgs): Handler {
  return secureSessionHandler(async (ctxt) => {
    requireSecureOrigin(ctxt, args.secureOriginURL);
    await sendJSON(ctxt, 201, {
      data: {
        type: 'login-token',
        attributes: await mintLoginToken(
          deps(args),
          ctxt.state.token as RealmServerTokenClaim | undefined,
        ),
      },
    });
  });
}

// POST /_secure-session/renewal: the window's session again, with a fresh
// token, renewed while the app device it handed its sign-in to still exists
// (`renewSecureSession`). The token presented may have expired. Answered only
// for the secure origin, since only the window holds a session to renew: 401
// `signed-out` once its session has ended.
export function handleRenewSecureSession(args: CreateRoutesArgs): Handler {
  return secureSessionHandler(async (ctxt) => {
    requireSecureOrigin(ctxt, args.secureOriginURL);
    await sendSession(
      ctxt,
      await renewSecureSession(
        deps(args),
        ctxt.state.token as RealmServerTokenClaim | undefined,
      ),
    );
  });
}

// DELETE /_secure-sessions?client=window: signs the token user's secure
// windows out, for the app's own sign-out. Any of the user's sessions may call
// it, card code included; all it can do is sign the user out of key
// management, which signing in again undoes. It reads, lists and extends
// nothing, and answers 204 whether or not there was a session to end.
export function handleEndWindowSessions({
  dbAdapter,
}: CreateRoutesArgs): Handler {
  return secureSessionHandler(async (ctxt) => {
    let token = ctxt.state.token as RealmServerTokenClaim | undefined;
    if (!token?.user) {
      throw new SecureSessionError(401, 'unauthorized', 'sign in first');
    }
    if (ctxt.query.client !== 'window') {
      throw new SecureSessionError(400, 'bad-request', `client is 'window'`);
    }
    await endWindowSessions(dbAdapter, token.user);
    await setContextResponse(ctxt, new Response(null, { status: 204 }));
  });
}

// GET /_secure-origin: where this realm server's secure origin is, for a
// client outside the browser that has to send the user there, as the CLI does
// to sign in, the name of the Matrix server its accounts are on, which the
// secure origin's account creation shows usernames with, and whether its
// pages can sign a CLI profile in.
export function handleSecureOriginInfo({
  secureOriginURL,
  matrixClient,
  matrixAdminUsername,
  matrixAdminPassword,
}: CreateRoutesArgs): Handler {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    if (!secureOriginURL) {
      await sendResponseForError(
        ctxt,
        404,
        'Not Found',
        'this realm server has no secure origin',
      );
      return;
    }
    await sendJSON(ctxt, 200, {
      data: {
        type: 'secure-origin',
        attributes: {
          url: secureOriginURL.href,
          matrixServerName: await matrixServerName({ matrixClient }),
          // Its `cli-auth` page signs a CLI profile in, handing the CLI a
          // Matrix login token, whenever this server can sign anyone in
          // there. A CLI that finds this false or missing signs in on the
          // host app's own page instead.
          cliAuth: secureSignInConfigured({
            matrixURL: matrixClient.matrixURL,
            matrixAdminUsername,
            matrixAdminPassword,
          }),
        },
      },
    });
  };
}
