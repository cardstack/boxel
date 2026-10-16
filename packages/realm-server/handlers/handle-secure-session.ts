import type Koa from 'koa';
import { logger, SupportedMimeType } from '@cardstack/runtime-common';
import {
  sendResponseForError,
  setContextResponse,
} from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import type { RealmServerTokenClaim } from '../utils/jwt.ts';
import {
  completeSignIn,
  endSecureSession,
  SecureSessionError,
  startSignIn,
  type SecureSessionClient,
  type SecureSessionDeps,
} from '../lib/secure-session.ts';

// Signing in on the secure origin (see `lib/secure-session.ts`). Starting and
// completing a sign-in are answered only for the secure origin's own pages:
// a browser always sends `Origin` on a POST and page script can't change it,
// so card code in the app page can't drive a sign-in through the user's
// browser. A request body here carries a password or a session, so nothing
// here logs a body, and the request log and telemetry keep only the method and
// path of these routes.

const log = logger('realm:secure-session');

// Far larger than a username, a password and a sign-in token need.
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

// POST /_secure-session/sign-in: starts a sign-in for a username, email
// address or Matrix id, and answers with the stages that can complete it.
export function handleStartSecureSignIn(args: CreateRoutesArgs): Handler {
  return secureSessionHandler(async (ctxt) => {
    requireSecureOrigin(ctxt, args.secureOriginURL);
    let attributes = await readAttributes(ctxt, 'secure-sign-in');
    let { username, client } = attributes;
    if (typeof username !== 'string') {
      throw new SecureSessionError(
        400,
        'bad-request',
        'a username is required',
      );
    }
    if (!CLIENTS.has(client as SecureSessionClient)) {
      throw new SecureSessionError(
        400,
        'bad-request',
        `client is 'window' or 'cli'`,
      );
    }
    let started = await startSignIn(deps(args), {
      username,
      client: client as SecureSessionClient,
    });
    await sendJSON(ctxt, 201, {
      data: { type: 'secure-sign-in', attributes: started },
    });
  });
}

// POST /_secure-session: completes a sign-in, with the password for the
// password stage or, after single sign-on, without one. Answers with the
// session, or 409 while single sign-on is still to be confirmed.
export function handleCompleteSecureSignIn(args: CreateRoutesArgs): Handler {
  return secureSessionHandler(async (ctxt) => {
    requireSecureOrigin(ctxt, args.secureOriginURL);
    let attributes = await readAttributes(ctxt, 'secure-session');
    let session = await completeSignIn(deps(args), {
      signIn: attributes.signIn,
      password: attributes.password,
    });
    await sendJSON(ctxt, 201, {
      data: { type: 'secure-session', attributes: session },
    });
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
