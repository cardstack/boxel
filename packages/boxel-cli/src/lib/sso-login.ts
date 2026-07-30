import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { MatrixAuth } from './auth.ts';

// The identity provider the host app's login screen uses. Synapse prefixes
// configured `idp_id: google` with `oidc-`, so this is what the homeserver
// advertises in its login flows.
export const GOOGLE_IDP_ID = 'oidc-google';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const CALLBACK_PATH = '/callback';

export interface LoginFlow {
  type: string;
  identity_providers?: { id: string; name?: string }[];
}

// The homeserver can't complete a browser login: it offers no SSO provider, or
// no `m.login.token` to redeem the result with. Callers fall back to password.
export class SsoNotSupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsoNotSupportedError';
  }
}

// The user never finished in the browser (or never got there).
export class SsoTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsoTimeoutError';
  }
}

export async function fetchLoginFlows(
  matrixUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<LoginFlow[]> {
  const response = await fetchFn(
    new URL('_matrix/client/v3/login', matrixUrl).href,
  );
  if (!response.ok) {
    throw new Error(
      `Could not read login flows from ${matrixUrl}: ${response.status}`,
    );
  }
  const json = (await response.json()) as { flows?: LoginFlow[] };
  return Array.isArray(json.flows) ? json.flows : [];
}

// Redeeming the browser's single-use token needs `m.login.token`; without it
// an SSO round trip would succeed and then have nowhere to land.
export function supportsTokenLogin(flows: LoginFlow[]): boolean {
  return flows.some((flow) => flow.type === 'm.login.token');
}

// Prefer the provider the web app uses so CLI and browser sessions land on the
// same account, but don't require it — a homeserver with a single non-Google
// provider is still perfectly usable.
export function selectSsoIdp(
  flows: LoginFlow[],
  preferredIdpId: string = GOOGLE_IDP_ID,
): string | undefined {
  const ssoFlow = flows.find((flow) => flow.type === 'm.login.sso');
  if (!ssoFlow) {
    return undefined;
  }
  const providers = ssoFlow.identity_providers ?? [];
  if (providers.some((p) => p.id === preferredIdpId)) {
    return preferredIdpId;
  }
  // No providers listed means the homeserver has exactly one SSO path and
  // exposes it through the un-suffixed redirect endpoint.
  return providers[0]?.id;
}

export function buildSsoRedirectUrl(
  matrixUrl: string,
  redirectUrl: string,
  idpId?: string,
): string {
  const path = idpId
    ? `_matrix/client/v3/login/sso/redirect/${encodeURIComponent(idpId)}`
    : '_matrix/client/v3/login/sso/redirect';
  const url = new URL(path, matrixUrl);
  url.searchParams.set('redirectUrl', redirectUrl);
  return url.href;
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

export interface LoopbackCallback {
  // Where Synapse should send the browser back to. Carries the state nonce, so
  // it must be handed to `buildSsoRedirectUrl` verbatim.
  redirectUrl: string;
  port: number;
  waitForToken(): Promise<string>;
  close(): void;
}

// Binds 127.0.0.1 on an ephemeral port. Bound before the browser opens so the
// redirect URL (and therefore the state nonce) is fixed up front.
export async function startLoopbackCallback(opts?: {
  state?: string;
  timeoutMs?: number;
}): Promise<LoopbackCallback> {
  const state = opts?.state ?? randomBytes(16).toString('hex');
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let resolveToken: (token: string) => void;
  let rejectToken: (err: Error) => void;
  const tokenPromise = new Promise<string>((resolve, reject) => {
    resolveToken = resolve;
    rejectToken = reject;
  });
  // The callback can arrive before anyone awaits `waitForToken`, and a bare
  // rejection there would surface as an unhandled rejection. Marking it handled
  // is safe: `waitForToken` races this same promise and still sees the error.
  tokenPromise.catch(() => {});

  const server = createServer((req, res) => {
    const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (requestUrl.pathname !== CALLBACK_PATH) {
      res.writeHead(404).end();
      return;
    }

    // A browser on this machine can reach any loopback port, so the nonce is
    // what distinguishes Synapse's redirect from anything else that happens to
    // knock on this port mid-login.
    if (requestUrl.searchParams.get('state') !== state) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(errorPage('This sign-in request was not recognized.'));
      rejectToken(
        new Error('SSO callback did not carry the expected state value'),
      );
      return;
    }

    const loginToken = requestUrl.searchParams.get('loginToken');
    if (!loginToken) {
      const reason =
        requestUrl.searchParams.get('error') ?? 'no login token was returned';
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(errorPage('The homeserver did not return a login token.'));
      rejectToken(new Error(`SSO sign-in did not complete: ${reason}`));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(successPage());
    resolveToken(loginToken);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const { port } = server.address() as AddressInfo;
  const redirectUrl = `http://127.0.0.1:${port}${CALLBACK_PATH}?state=${state}`;

  let timer: NodeJS.Timeout | undefined;
  const close = () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    server.close();
  };

  return {
    redirectUrl,
    port,
    close,
    waitForToken: () =>
      Promise.race([
        tokenPromise,
        new Promise<string>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new SsoTimeoutError(
                  `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for the browser sign-in to complete.`,
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

export interface SsoLoginOptions {
  matrixUrl: string;
  idpId?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  openBrowserFn?: (url: string) => Promise<boolean>;
  // Where to tell the user what's happening. Injected so tests stay quiet.
  log?: (message: string) => void;
}

// Full browser sign-in: discover the provider, listen on loopback, send the
// user to Synapse, then trade the returned single-use token for a session.
export async function ssoLogin(options: SsoLoginOptions): Promise<MatrixAuth> {
  const {
    matrixUrl,
    idpId: requestedIdpId,
    timeoutMs,
    fetchFn = fetch,
    openBrowserFn = openBrowser,
    log = console.log,
  } = options;

  const flows = await fetchLoginFlows(matrixUrl, fetchFn);
  const idpId = selectSsoIdp(flows, requestedIdpId ?? GOOGLE_IDP_ID);
  const ssoFlow = flows.some((flow) => flow.type === 'm.login.sso');

  if (!ssoFlow) {
    throw new SsoNotSupportedError(
      `${matrixUrl} does not offer browser sign-in (no m.login.sso flow).`,
    );
  }
  if (!supportsTokenLogin(flows)) {
    throw new SsoNotSupportedError(
      `${matrixUrl} offers browser sign-in but not m.login.token, so the CLI cannot complete it.`,
    );
  }

  const callback = await startLoopbackCallback({ timeoutMs });
  try {
    const ssoUrl = buildSsoRedirectUrl(matrixUrl, callback.redirectUrl, idpId);
    const opened = await openBrowserFn(ssoUrl);
    if (opened) {
      log('Opening your browser to sign in...');
      log(`If it didn't open, visit:\n  ${ssoUrl}`);
    } else {
      log(`Open this URL in your browser to sign in:\n  ${ssoUrl}`);
    }
    log('Waiting for you to finish signing in...');

    const loginToken = await callback.waitForToken();
    return await redeemLoginToken(matrixUrl, loginToken, fetchFn);
  } finally {
    callback.close();
  }
}
