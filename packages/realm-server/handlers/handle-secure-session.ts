import type Koa from 'koa';
import { logger, SupportedMimeType } from '@cardstack/runtime-common';
import {
  sendResponseForError,
  setContextResponse,
} from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import type { RealmServerTokenClaim } from '../utils/jwt.ts';
import {
  endSecureSession,
  googleSignInStart,
  SecureSessionError,
  signInWithGoogle,
  signInWithPassword,
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

function deps(args: CreateRoutesArgs): SecureSessionDeps {
  return {
    dbAdapter: args.dbAdapter,
    matrixClient: args.matrixClient,
    realmSecretSeed: args.realmSecretSeed,
    matrixAdminUsername: args.matrixAdminUsername,
    matrixAdminPassword: args.matrixAdminPassword,
    secureOriginURL: args.secureOriginURL,
    googleSignIn: args.googleSignIn,
  };
}

async function sendJSON(ctxt: Koa.Context, status: number, body: unknown) {
  await setContextResponse(
    ctxt,
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': SupportedMimeType.JSONAPI },
    }),
  );
}

function requireSecureOrigin(ctxt: Koa.Context, secureOriginURL?: URL) {
  if (!secureOriginURL || ctxt.get('Origin') !== secureOriginURL.origin) {
    throw new SecureSessionError(
      403,
      'forbidden',
      'signing in here is only for the secure window',
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
// anything else with a bare 500. Only an error's name and message are logged,
// never the request.
function secureSessionHandler(
  fn: (ctxt: Koa.Context) => Promise<void>,
): Handler {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    try {
      await fn(ctxt);
    } catch (e: any) {
      if (e instanceof SecureSessionError) {
        await sendJSON(ctxt, e.status, {
          errors: [
            { status: String(e.status), code: e.code, detail: e.message },
          ],
        });
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

// POST /_secure-session: signs in with a username, email address or Matrix id
// and the account's password.
export function handlePasswordSignIn(args: CreateRoutesArgs): Handler {
  return secureSessionHandler(async (ctxt) => {
    requireSecureOrigin(ctxt, args.secureOriginURL);
    let attributes = await readAttributes(ctxt, 'secure-session');
    let { username, password } = attributes;
    await sendSession(
      ctxt,
      await signInWithPassword(deps(args), {
        username: typeof username === 'string' ? username : '',
        password: typeof password === 'string' ? password : '',
        client: clientOf(attributes),
      }),
    );
  });
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
// window started the sign-in with.
export function handleGoogleSignIn(args: CreateRoutesArgs): Handler {
  return secureSessionHandler(async (ctxt) => {
    requireSecureOrigin(ctxt, args.secureOriginURL);
    let attributes = await readAttributes(ctxt, 'google-sign-in');
    await sendSession(
      ctxt,
      await signInWithGoogle(deps(args), {
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

// GET /_secure-origin: where this realm server's secure origin is, for a
// client outside the browser that has to send the user there, as the CLI does
// to sign in.
export function handleSecureOriginInfo({
  secureOriginURL,
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
        attributes: { url: secureOriginURL.href },
      },
    });
  };
}
