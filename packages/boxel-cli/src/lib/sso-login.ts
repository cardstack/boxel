import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  CLI_AUTH_TIMEOUT_MS,
  describeDuration,
} from '@cardstack/runtime-common/cli-auth';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';

import type { MatrixAuth } from './auth.ts';

// The authorization page states this same window to the person waiting in it, so
// the two read it from one place.
export const DEFAULT_TIMEOUT_MS = CLI_AUTH_TIMEOUT_MS;
const CALLBACK_PATH = '/callback';

export { describeDuration };

// The user never finished in the browser (or never got there).
export class SsoTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsoTimeoutError';
  }
}

function successPage(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Boxel CLI</title></head>
<body style="font-family: system-ui, sans-serif; text-align: center; padding: 4rem;">
<h1>You're signed in</h1>
<p>Return to your terminal to continue. You can close this tab.</p>
</body></html>`;
}

function errorPage(message: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Boxel CLI</title></head>
<body style="font-family: system-ui, sans-serif; text-align: center; padding: 4rem;">
<h1>Sign-in failed</h1>
<p>${message}</p>
<p>Return to your terminal for details.</p>
</body></html>`;
}

// A session the authorizing page logged in for and handed over directly, as
// opposed to a single-use token this process still has to redeem.
export interface PostedSession {
  accessToken: string;
  deviceId: string;
  userId: string;
}

// The two ways a browser can finish the flow: Synapse redirecting back with a
// single-use token (the SSO branch), or the authorizing page POSTing a session
// it already obtained (the password branch).
export type LoopbackResult =
  | { kind: 'loginToken'; loginToken: string }
  | { kind: 'session'; session: PostedSession };

export interface LoopbackCallback {
  // Where the browser should come back to. The authorization page rebuilds this
  // from `port` and `state` rather than being handed it, so the two must agree
  // on CALLBACK_PATH.
  redirectUrl: string;
  port: number;
  state: string;
  waitForResult(): Promise<LoopbackResult>;
  close(): void;
}

const MAX_CALLBACK_BODY_BYTES = 8 * 1024;

// `Connection: close` so the browser doesn't hold the socket open after reading
// the page. A kept-alive socket outlives `server.close()` and keeps the CLI
// running after it has nothing left to do.
const HTML_RESPONSE_HEADERS = {
  'Content-Type': 'text/html',
  Connection: 'close',
};

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_CALLBACK_BODY_BYTES) {
      throw new Error('callback body too large');
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// Binds 127.0.0.1 on an ephemeral port. Bound before the browser opens so the
// redirect URL (and therefore the state nonce) is fixed up front.
export async function startLoopbackCallback(opts?: {
  state?: string;
  timeoutMs?: number;
}): Promise<LoopbackCallback> {
  const state = opts?.state ?? randomBytes(16).toString('hex');
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let resolveResult: (result: LoopbackResult) => void;
  let rejectResult: (err: Error) => void;
  const resultPromise = new Promise<LoopbackResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  // The callback can arrive before anyone awaits `waitForResult`, and a bare
  // rejection there would surface as an unhandled rejection. Marking it handled
  // is safe: `waitForResult` races this same promise and still sees the error.
  resultPromise.catch(() => {});

  // Settle only once the page has reached the browser. Settling is what triggers
  // `close()`, which tears sockets down — do it first and the user is left
  // looking at a failed navigation instead of the outcome.
  const fail = (res: ServerResponse, shown: string, thrown: string) => {
    res.writeHead(400, HTML_RESPONSE_HEADERS);
    res.end(errorPage(shown), () => rejectResult(new Error(thrown)));
  };

  const succeed = (res: ServerResponse, result: LoopbackResult) => {
    res.writeHead(200, HTML_RESPONSE_HEADERS);
    res.end(successPage(), () => resolveResult(result));
  };

  const server = createServer((req, res) => {
    void (async () => {
      const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (requestUrl.pathname !== CALLBACK_PATH) {
        res.writeHead(404, { Connection: 'close' }).end();
        return;
      }

      // The password branch POSTs a session it already obtained; the SSO branch
      // arrives as Synapse's redirect. Both carry the nonce.
      let posted: URLSearchParams | undefined;
      if (req.method === 'POST') {
        try {
          posted = new URLSearchParams(await readBody(req));
        } catch (err: any) {
          fail(res, 'That sign-in response was not readable.', err.message);
          return;
        }
      }

      // A browser on this machine can reach any loopback port, so the nonce is
      // what distinguishes this sign-in from anything else that happens to
      // knock on the port mid-flow.
      const seenState =
        posted?.get('state') ?? requestUrl.searchParams.get('state');
      if (seenState !== state) {
        fail(
          res,
          'This sign-in request was not recognized.',
          'callback did not carry the expected state value',
        );
        return;
      }

      if (posted) {
        const accessToken = posted.get('access_token');
        const deviceId = posted.get('device_id');
        const userId = posted.get('user_id');
        if (!accessToken || !deviceId || !userId) {
          fail(
            res,
            'That sign-in did not include a complete session.',
            'callback POST was missing access_token, device_id, or user_id',
          );
          return;
        }
        succeed(res, {
          kind: 'session',
          session: { accessToken, deviceId, userId },
        });
        return;
      }

      const loginToken = requestUrl.searchParams.get('loginToken');
      if (!loginToken) {
        const reason =
          requestUrl.searchParams.get('error') ?? 'no login token was returned';
        fail(
          res,
          'The homeserver did not return a login token.',
          `sign-in did not complete: ${reason}`,
        );
        return;
      }

      succeed(res, { kind: 'loginToken', loginToken });
    })().catch((err: unknown) => {
      // Without this, anything unexpected in the handler is an unhandled
      // rejection and the CLI waits out the whole timeout for a callback that
      // has already failed. Reject with what went wrong instead, so the command
      // exits on the real reason.
      const error = err instanceof Error ? err : new Error(String(err));
      // The terminal reports the rejection either way; what differs is whether
      // there is still a response left to write. Past `headersSent` a second
      // `writeHead` would throw from inside this handler, so the socket is
      // abandoned rather than answered.
      if (res.headersSent) {
        rejectResult(error);
        res.destroy();
        return;
      }
      fail(res, 'That sign-in could not be completed.', error.message);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const { port } = server.address() as AddressInfo;
  const redirectUrl = `http://127.0.0.1:${port}${CALLBACK_PATH}?state=${state}`;

  let timer: NodeJS.Timeout | undefined;
  // Callers close defensively — `waitForResult()` closes when it settles and
  // `browserLogin()` closes again in its own `finally` — so closing has to be
  // safe to repeat.
  let closed = false;
  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    server.close();
    // `close()` only stops listening; established sockets keep the event loop
    // alive, so the CLI would sit there having already finished. Closing only
    // *idle* sockets isn't enough — a browser follows the page with further
    // requests of its own (favicon, and whatever else it fancies), so the socket
    // often isn't idle at this moment. Every response is flushed before the flow
    // settles, so nothing in flight is lost by being blunt here.
    server.closeAllConnections();
  };

  return {
    redirectUrl,
    port,
    state,
    close,
    waitForResult: () =>
      Promise.race([
        resultPromise,
        new Promise<LoopbackResult>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new SsoTimeoutError(
                  `Timed out after ${describeDuration(timeoutMs)} waiting for ` +
                    'the browser sign-in to complete. Re-run with --no-browser ' +
                    'to sign in with a username and password instead.',
                ),
              ),
            timeoutMs,
          );
        }),
      ]).finally(close),
  };
}

interface MatrixLoginResponse {
  access_token: string;
  device_id: string;
  user_id: string;
}

export async function redeemLoginToken(
  matrixUrl: string,
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<MatrixAuth> {
  const response = await fetchFn(
    new URL('_matrix/client/v3/login', matrixUrl).href,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'm.login.token', token }),
    },
  );

  const json = (await response.json()) as MatrixLoginResponse;
  if (!response.ok) {
    throw new Error(
      `Matrix token login failed: ${response.status} ${JSON.stringify(json)}`,
    );
  }

  return {
    accessToken: json.access_token,
    deviceId: json.device_id,
    userId: json.user_id,
    matrixUrl,
  };
}

// Best-effort: a detached launch whose failure is reported to the caller so it
// can fall back to printing the URL. Never rejects.
export function openBrowser(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const [command, args] =
      process.platform === 'darwin'
        ? ['open', [url]]
        : process.platform === 'win32'
          ? ['cmd', ['/c', 'start', '', url]]
          : ['xdg-open', [url]];

    try {
      const child = spawn(command as string, args as string[], {
        stdio: 'ignore',
        detached: true,
      });
      child.once('error', () => resolve(false));
      child.once('spawn', () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

export const CLI_AUTH_PATH = 'cli-auth';

// The host app's authorization page, which offers the same sign-in choices as
// the web login: a password form and a Google button.
//
// The listener is identified by port rather than by handing over its URL. A URL
// in a query argument reads as an SSRF attempt to the WAF in front of deployed
// realm servers, which answers 403 (`EC2MetaDataSSRF_QUERYARGUMENTS`). Sending
// only the port is also tighter: the page can address nothing but loopback,
// so there is no supplied origin for it to have to distrust.
export function buildCliAuthUrl(
  hostUrl: string,
  callback: { port: number; state: string },
): string {
  const url = new URL(CLI_AUTH_PATH, ensureTrailingSlash(hostUrl));
  url.searchParams.set('port', String(callback.port));
  url.searchParams.set('state', callback.state);
  return url.href;
}

// The page is paired with one homeserver, so a session it returns should be
// valid on the homeserver this profile is being created against. Checking it
// here turns a host/homeserver mismatch into a clear message instead of a
// confusing failure later, when realm tokens are first requested.
async function verifySession(
  matrixUrl: string,
  session: PostedSession,
  fetchFn: typeof fetch,
): Promise<void> {
  const response = await fetchFn(
    new URL('_matrix/client/v3/account/whoami', matrixUrl).href,
    { headers: { Authorization: `Bearer ${session.accessToken}` } },
  );
  if (!response.ok) {
    throw new Error(
      `The browser returned a session that ${matrixUrl} does not recognize ` +
        `(${response.status}). Check that the host app and homeserver belong ` +
        'to the same environment.',
    );
  }
  const who = (await response.json()) as { user_id?: string };
  if (who.user_id !== session.userId) {
    throw new Error(
      `The browser returned a session for ${who.user_id ?? 'an unknown user'} ` +
        `but reported ${session.userId}.`,
    );
  }
}

export interface BrowserLoginOptions {
  matrixUrl: string;
  // Origin of the host app serving the authorization page.
  hostUrl: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  openBrowserFn?: (url: string) => Promise<boolean>;
  // Where to tell the user what's happening. Injected so tests stay quiet.
  log?: (message: string) => void;
}

// Sign in through the browser. The authorization page decides how the user
// authenticates, so this ends one of two ways: Google sends the browser back
// through Synapse with a single-use token to redeem, or the page signs in with
// a password and hands over the resulting session directly.
export async function browserLogin(
  options: BrowserLoginOptions,
): Promise<MatrixAuth> {
  const {
    matrixUrl,
    hostUrl,
    timeoutMs,
    fetchFn = fetch,
    openBrowserFn = openBrowser,
    log = console.log,
  } = options;

  const callback = await startLoopbackCallback({ timeoutMs });
  try {
    const authUrl = buildCliAuthUrl(hostUrl, callback);
    const opened = await openBrowserFn(authUrl);
    if (opened) {
      log('Opening your browser to sign in or create an account...');
      log(`If it didn't open, visit:\n  ${authUrl}`);
    } else {
      log(
        `Open this URL in your browser to sign in or create an account:\n  ${authUrl}`,
      );
    }
    log(
      `Waiting up to ${describeDuration(timeoutMs ?? DEFAULT_TIMEOUT_MS)} for ` +
        'you to finish in the browser. Press Ctrl-C to stop.',
    );

    const result = await callback.waitForResult();
    if (result.kind === 'loginToken') {
      return await redeemLoginToken(matrixUrl, result.loginToken, fetchFn);
    }
    await verifySession(matrixUrl, result.session, fetchFn);
    return { ...result.session, matrixUrl };
  } finally {
    callback.close();
  }
}
