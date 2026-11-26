import { createHash, randomBytes, randomInt } from 'node:crypto';

import { describeDuration } from '@cardstack/runtime-common/cli-auth';

import { openBrowser } from './open-browser.ts';
import {
  DEFAULT_TIMEOUT_MS,
  copyToClipboard,
  startLoopbackCallback,
  watchForCopyKey,
} from './sso-login.ts';

// boxel-cli's sign-in as an OAuth client of the realm server's provider: the
// authorization code flow with PKCE, returning to a loopback listener, for a
// token to the Boxel API (the realm server's own routes and those of every
// realm it serves).
//
// The realm server lists boxel-cli as a pre-registered public client: no
// secret, any port on `http://127.0.0.1/callback`, and a confirmation code it
// requires on every authorization request.

export const BOXEL_CLI_CLIENT_ID = 'boxel-cli';
export const BOXEL_API_SCOPES = ['boxel:read', 'boxel:write'];

// The device authorization grant's type (RFC 8628 §3.4).
export const DEVICE_CODE_GRANT_TYPE =
  'urn:ietf:params:oauth:grant-type:device_code';

// The provider matches a loopback redirect by everything but its port, so the
// host and path must be exactly these.
const REDIRECT_HOST = '127.0.0.1';
const REDIRECT_PATH = '/callback';

// The confirmation code: two groups of four letters from an alphabet without
// vowels or look-alikes, so it reads aloud and never spells a word. The
// consent page shows the code it was sent, and the user checks it against the
// one printed here.
export const CONFIRMATION_CODE_PARAM = 'boxel_confirmation_code';
const CONFIRMATION_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';

// A grant that renews lasts this long from consent, and no refresh extends it.
const RENEWING_GRANT_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export function makeConfirmationCode(
  pick: (max: number) => number = randomInt,
): string {
  let group = () =>
    Array.from(
      { length: 4 },
      () => CONFIRMATION_CODE_ALPHABET[pick(CONFIRMATION_CODE_ALPHABET.length)],
    ).join('');
  return `${group()}-${group()}`;
}

export interface Pkce {
  verifier: string;
  challenge: string;
}

export function makePkce(): Pkce {
  let verifier = randomBytes(32).toString('base64url');
  let challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// The realm server doesn't offer the Boxel API to OAuth clients: its provider
// is off, or it predates the Boxel API.
export class OAuthNotOfferedError extends Error {
  constructor(realmServerUrl: string, why: string) {
    super(
      `${realmServerUrl} doesn't offer OAuth sign-in for boxel-cli yet (${why}). ` +
        'Run `boxel profile add` without --oauth to sign in as usual.',
    );
    this.name = 'OAuthNotOfferedError';
  }
}

// Where to sign in for a token to a realm server's Boxel API, read from its
// discovery documents.
export interface BoxelApiProvider {
  // The Boxel API's resource identifier: the realm server's URL with no
  // trailing slash. Sent as `resource` on every request, since the MCP
  // endpoint declares the same scopes.
  resource: string;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint?: string;
  // Where to ask for a device code, for a sign-in with no browser here
  // (RFC 8628). Absent on a server that doesn't offer one.
  deviceAuthorizationEndpoint?: string;
}

export function boxelApiResource(realmServerUrl: string): string {
  return realmServerUrl.replace(/\/+$/, '');
}

async function readJson(
  url: string,
  fetchFn: typeof fetch,
): Promise<{ status: number; body?: Record<string, unknown> }> {
  let response = await fetchFn(url, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    return { status: response.status };
  }
  try {
    let body = (await response.json()) as unknown;
    return body && typeof body === 'object'
      ? { status: response.status, body: body as Record<string, unknown> }
      : { status: response.status };
  } catch {
    return { status: response.status };
  }
}

// Reads the Boxel API's protected-resource metadata and its authorization
// server's metadata. A realm server answers both only when its OAuth provider
// is on; one that doesn't offer the Boxel API throws `OAuthNotOfferedError`.
export async function discoverBoxelApi(
  realmServerUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<BoxelApiProvider> {
  let resource = boxelApiResource(realmServerUrl);
  let metadata = await readJson(
    `${resource}/.well-known/oauth-protected-resource`,
    fetchFn,
  );
  if (!metadata.body) {
    throw new OAuthNotOfferedError(
      realmServerUrl,
      `its resource metadata answered ${metadata.status}`,
    );
  }
  if (metadata.body.resource !== resource) {
    throw new OAuthNotOfferedError(
      realmServerUrl,
      `its resource metadata names ${String(metadata.body.resource)}`,
    );
  }
  let scopes = metadata.body.scopes_supported;
  if (
    !Array.isArray(scopes) ||
    !BOXEL_API_SCOPES.every((scope) => scopes.includes(scope))
  ) {
    throw new OAuthNotOfferedError(
      realmServerUrl,
      `the resource doesn't offer ${BOXEL_API_SCOPES.join(' and ')}`,
    );
  }
  let servers = metadata.body.authorization_servers;
  let issuer = Array.isArray(servers) ? servers[0] : undefined;
  if (typeof issuer !== 'string') {
    throw new OAuthNotOfferedError(
      realmServerUrl,
      'its resource metadata names no authorization server',
    );
  }

  let server = await readJson(
    `${issuer.replace(/\/+$/, '')}/.well-known/oauth-authorization-server`,
    fetchFn,
  );
  let body = server.body;
  if (!body) {
    throw new OAuthNotOfferedError(
      realmServerUrl,
      `its authorization server's metadata answered ${server.status}`,
    );
  }
  // RFC 8414 §3.3: the metadata must name the issuer it was fetched for.
  if (body.issuer !== issuer) {
    throw new Error(
      `The authorization server's metadata names ${String(body.issuer)} as its ` +
        `issuer, not ${issuer}, so the CLI won't sign in there.`,
    );
  }
  // The CLI accepts an authorization response only with the issuer it
  // discovered named in `iss` (RFC 9207). A server that doesn't say it sends
  // `iss` is turned away here, before the browser opens, rather than after
  // the user has allowed the sign-in.
  if (body.authorization_response_iss_parameter_supported !== true) {
    throw new OAuthNotOfferedError(
      realmServerUrl,
      "its authorization server doesn't say it names itself in its responses (RFC 9207 `iss`)",
    );
  }
  let methods = body.code_challenge_methods_supported;
  if (
    typeof body.authorization_endpoint !== 'string' ||
    typeof body.token_endpoint !== 'string' ||
    !Array.isArray(methods) ||
    !methods.includes('S256')
  ) {
    throw new OAuthNotOfferedError(
      realmServerUrl,
      "its authorization server's metadata is incomplete",
    );
  }
  return {
    resource,
    issuer,
    authorizationEndpoint: body.authorization_endpoint,
    tokenEndpoint: body.token_endpoint,
    ...(typeof body.revocation_endpoint === 'string'
      ? { revocationEndpoint: body.revocation_endpoint }
      : {}),
    ...(typeof body.device_authorization_endpoint === 'string'
      ? { deviceAuthorizationEndpoint: body.device_authorization_endpoint }
      : {}),
  };
}

export function redirectUriFor(port: number): string {
  return `http://${REDIRECT_HOST}:${port}${REDIRECT_PATH}`;
}

export function buildAuthorizeUrl(
  provider: BoxelApiProvider,
  request: {
    redirectUri: string;
    state: string;
    codeChallenge: string;
    confirmationCode: string;
  },
): string {
  let url = new URL(provider.authorizationEndpoint);
  let params = url.searchParams;
  params.set('client_id', BOXEL_CLI_CLIENT_ID);
  params.set('response_type', 'code');
  params.set('redirect_uri', request.redirectUri);
  params.set('scope', BOXEL_API_SCOPES.join(' '));
  params.set('resource', provider.resource);
  params.set('state', request.state);
  params.set('code_challenge', request.codeChallenge);
  params.set('code_challenge_method', 'S256');
  params.set(CONFIRMATION_CODE_PARAM, request.confirmationCode);
  return url.href;
}

// The tokens a sign-in keeps. Times are ISO 8601.
export interface OAuthTokens {
  accessToken: string;
  // Absent when the user didn't let the connection renew: it then ends with
  // its access token.
  refreshToken?: string;
  accessExpiresAt: string;
  // When the connection ends and the user has to sign in again. Counted from
  // the moment the sign-in began, which is before the provider made the grant,
  // so it is never later than the real end.
  connectionEndsAt: string;
  scope?: string;
}

interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  error?: unknown;
  error_description?: unknown;
}

// How long a token request may take, the response body included. A renewal
// runs under the profiles lock, which other commands take over as abandoned
// after a minute; a renewal still waiting then could see its refresh token
// sent a second time, so this stays well under that.
export const TOKEN_REQUEST_TIMEOUT_MS = 20_000;

async function tokenRequest(
  provider: Pick<BoxelApiProvider, 'resource' | 'tokenEndpoint'>,
  params: Record<string, string>,
  fetchFn: typeof fetch,
  timeoutMs = TOKEN_REQUEST_TIMEOUT_MS,
): Promise<TokenResponse & { status: number }> {
  let signal = AbortSignal.timeout(timeoutMs);
  try {
    return await sendTokenRequest(provider, params, fetchFn, signal);
  } catch (e) {
    if (signal.aborted) {
      throw new Error(
        `The realm server's token endpoint didn't answer within ${timeoutMs / 1000}s.`,
      );
    }
    throw e;
  }
}

async function sendTokenRequest(
  provider: Pick<BoxelApiProvider, 'resource' | 'tokenEndpoint'>,
  params: Record<string, string>,
  fetchFn: typeof fetch,
  signal: AbortSignal,
): Promise<TokenResponse & { status: number }> {
  let response = await fetchFn(provider.tokenEndpoint, {
    signal,
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: BOXEL_CLI_CLIENT_ID,
      resource: provider.resource,
      ...params,
    }).toString(),
  });
  let body: TokenResponse = {};
  try {
    body = (await response.json()) as TokenResponse;
  } catch {
    // An error page that isn't JSON: the status says enough.
  }
  return { ...body, status: response.status };
}

function describeTokenError(body: TokenResponse & { status: number }): string {
  let error = typeof body.error === 'string' ? body.error : `${body.status}`;
  return typeof body.error_description === 'string'
    ? `${error} (${body.error_description})`
    : error;
}

export async function exchangeCode(
  provider: BoxelApiProvider,
  exchange: { code: string; codeVerifier: string; redirectUri: string },
  {
    fetchFn = fetch,
    startedAt,
    now = Date.now,
  }: { fetchFn?: typeof fetch; startedAt: number; now?: () => number },
): Promise<OAuthTokens> {
  // The access token's lifetime is counted from before the request, which is
  // before the provider issues it, so the stored expiry is never later than
  // the real one however slow the response is.
  let requestedAt = now();
  let body = await tokenRequest(
    provider,
    {
      grant_type: 'authorization_code',
      code: exchange.code,
      code_verifier: exchange.codeVerifier,
      redirect_uri: exchange.redirectUri,
    },
    fetchFn,
  );
  return issuedTokens(body, { requestedAt, startedAt });
}

// The tokens a sign-in's token response issued. A connection that renews
// ends 30 days after consent, which came after `startedAt`, so counting from
// `startedAt` is never later than the real end.
function issuedTokens(
  body: TokenResponse & { status: number },
  { requestedAt, startedAt }: { requestedAt: number; startedAt: number },
): OAuthTokens {
  if (
    body.status !== 200 ||
    typeof body.access_token !== 'string' ||
    typeof body.expires_in !== 'number'
  ) {
    throw new Error(
      `The realm server didn't issue tokens for the sign-in: ${describeTokenError(body)}`,
    );
  }
  let accessExpiresAt = requestedAt + body.expires_in * 1000;
  let refreshToken =
    typeof body.refresh_token === 'string' ? body.refresh_token : undefined;
  return {
    accessToken: body.access_token,
    ...(refreshToken ? { refreshToken } : {}),
    accessExpiresAt: new Date(accessExpiresAt).toISOString(),
    connectionEndsAt: new Date(
      refreshToken ? startedAt + RENEWING_GRANT_LIFETIME_MS : accessExpiresAt,
    ).toISOString(),
    ...(typeof body.scope === 'string' ? { scope: body.scope } : {}),
  };
}

// The connection is over: the provider refused its refresh token, or it has
// none and its access token has run out. Only a new sign-in brings it back.
export class OAuthConnectionEndedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthConnectionEndedError';
  }
}

// Trades a refresh token for a new access token. The provider rotates refresh
// tokens, so the answer carries a new one, and the one sent can never be used
// again: presenting it a second time ends the whole connection. Callers must
// make sure no two refreshes of one connection run at once.
export async function refreshTokens(
  provider: Pick<BoxelApiProvider, 'resource' | 'tokenEndpoint'>,
  refreshToken: string,
  {
    fetchFn = fetch,
    now = Date.now,
    timeoutMs,
  }: { fetchFn?: typeof fetch; now?: () => number; timeoutMs?: number } = {},
): Promise<
  Pick<
    OAuthTokens,
    'accessToken' | 'refreshToken' | 'accessExpiresAt' | 'scope'
  >
> {
  // Counted from before the request, as in `exchangeCode`.
  let requestedAt = now();
  let body = await tokenRequest(
    provider,
    { grant_type: 'refresh_token', refresh_token: refreshToken },
    fetchFn,
    timeoutMs,
  );
  if (body.status === 400 && body.error === 'invalid_grant') {
    throw new OAuthConnectionEndedError(
      `The realm server ended this connection: ${describeTokenError(body)}`,
    );
  }
  if (
    body.status !== 200 ||
    typeof body.access_token !== 'string' ||
    typeof body.expires_in !== 'number'
  ) {
    throw new Error(
      `The realm server didn't renew the connection's tokens: ${describeTokenError(body)}`,
    );
  }
  return {
    accessToken: body.access_token,
    ...(typeof body.refresh_token === 'string'
      ? { refreshToken: body.refresh_token }
      : {}),
    accessExpiresAt: new Date(
      requestedAt + body.expires_in * 1000,
    ).toISOString(),
    ...(typeof body.scope === 'string' ? { scope: body.scope } : {}),
  };
}

// Ends the connection a token belongs to: the provider revokes the whole
// grant when any of its tokens is revoked. Best-effort, for a sign-in nobody
// will use; throws only on a network failure.
export async function revokeConnection(
  provider: Pick<BoxelApiProvider, 'revocationEndpoint'>,
  tokens: Pick<OAuthTokens, 'accessToken' | 'refreshToken'>,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  if (!provider.revocationEndpoint) {
    return false;
  }
  let [token, hint] = tokens.refreshToken
    ? [tokens.refreshToken, 'refresh_token']
    : [tokens.accessToken, 'access_token'];
  let response = await fetchFn(provider.revocationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: BOXEL_CLI_CLIENT_ID,
      token,
      token_type_hint: hint,
    }).toString(),
  });
  return response.ok;
}

export interface SignedInUser {
  userId: string;
  displayName?: string;
}

// The token response doesn't name the user, so the realm server is asked who
// the token belongs to. Its display-name route answers with the user's Matrix
// ID as the resource's `id`.
export async function fetchSignedInUser(
  realmServerUrl: string,
  accessToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<SignedInUser> {
  let response = await fetchFn(
    `${boxelApiResource(realmServerUrl)}/_user-display-name`,
    {
      headers: {
        Accept: 'application/vnd.api+json',
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  if (response.status === 404) {
    throw new Error(
      `${realmServerUrl} has no Boxel account for the user who signed in.`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `Could not read who signed in from ${realmServerUrl}: ${response.status}`,
    );
  }
  let body = (await response.json()) as {
    data?: { id?: unknown; attributes?: { displayName?: unknown } };
  };
  let userId = body.data?.id;
  if (typeof userId !== 'string' || !userId.startsWith('@')) {
    throw new Error(
      `${realmServerUrl} answered who signed in without a user ID.`,
    );
  }
  let displayName = body.data?.attributes?.displayName;
  return {
    userId,
    ...(typeof displayName === 'string' && displayName.trim()
      ? { displayName }
      : {}),
  };
}

export interface OAuthLoginOptions {
  realmServerUrl: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  openBrowserFn?: (url: string) => Promise<boolean>;
  copyToClipboardFn?: (text: string) => Promise<boolean>;
  log?: (message: string) => void;
  makeConfirmationCodeFn?: () => string;
  now?: () => number;
  // When no browser opens here, sign in with a code instead
  // (`oauthDeviceLogin`) rather than wait on a link the user can only follow
  // on this computer.
  deviceFallback?: boolean;
  // Waits between device sign-in polls; a test passes one that doesn't.
  sleep?: (ms: number) => Promise<void>;
}

export interface OAuthLoginResult {
  provider: BoxelApiProvider;
  tokens: OAuthTokens;
  user: SignedInUser;
}

// Signs in through the browser and answers the tokens and the user they
// belong to. A connection the CLI got tokens for but can't use (the realm
// server couldn't say who signed in) is revoked before this throws.
export async function oauthLogin(
  options: OAuthLoginOptions,
): Promise<OAuthLoginResult> {
  let {
    realmServerUrl,
    timeoutMs,
    fetchFn = fetch,
    openBrowserFn = openBrowser,
    copyToClipboardFn = copyToClipboard,
    log = console.log,
    makeConfirmationCodeFn = makeConfirmationCode,
    now = Date.now,
    deviceFallback = false,
  } = options;

  let provider = await discoverBoxelApi(realmServerUrl, fetchFn);
  let callback = await startLoopbackCallback({
    timeoutMs,
    oauthRedirect: true,
  });
  let stopCopyKey: (() => void) | undefined;
  try {
    let redirectUri = redirectUriFor(callback.port);
    let pkce = makePkce();
    let confirmationCode = makeConfirmationCodeFn();
    let startedAt = now();
    let authUrl = buildAuthorizeUrl(provider, {
      redirectUri,
      state: callback.state,
      codeChallenge: pkce.challenge,
      confirmationCode,
    });

    let opened = await openBrowserFn(authUrl);
    if (!opened && deviceFallback && provider.deviceAuthorizationEndpoint) {
      log(
        "Couldn't open a browser here, so you'll sign in with a code on any device instead.",
      );
      callback.close();
      // The code lasts as long as the provider says: `timeoutMs` is how long
      // to wait on this computer's browser, which isn't being waited on.
      return await oauthDeviceLogin({
        ...options,
        timeoutMs: undefined,
        provider,
      });
    }
    if (opened) {
      log('Opening your browser to sign in...');
      log(`If it didn't open, visit:\n  ${authUrl}`);
    } else {
      log(`Open this URL in your browser to sign in:\n  ${authUrl}`);
    }
    log(
      `\nCheck that the browser shows this code before you allow Boxel CLI:\n\n    ${confirmationCode}\n\n` +
        "If it shows a different code, or you didn't start this sign-in, choose Deny.",
    );
    stopCopyKey = watchForCopyKey(authUrl, { log, copyFn: copyToClipboardFn });
    log(
      `Waiting up to ${describeDuration(timeoutMs ?? DEFAULT_TIMEOUT_MS)} for ` +
        'you to finish in the browser. ' +
        (stopCopyKey
          ? 'Press c to copy the URL, or Ctrl-C to stop.'
          : 'Press Ctrl-C to stop.'),
    );

    let result = await callback.waitForResult();
    if (result.kind !== 'oauthRedirect') {
      throw new Error('The browser returned a different kind of sign-in.');
    }
    // RFC 9207: the response names the provider that sent it, so a code from
    // another authorization server is never sent to this one's token endpoint.
    if (result.iss !== provider.issuer) {
      throw new Error(
        `The sign-in came back from ${result.iss ?? 'an unnamed server'}, not ` +
          `${provider.issuer}, so the CLI didn't use it.`,
      );
    }

    let tokens = await exchangeCode(
      provider,
      { code: result.code, codeVerifier: pkce.verifier, redirectUri },
      { fetchFn, startedAt, now },
    );
    let user: SignedInUser;
    try {
      user = await fetchSignedInUser(
        realmServerUrl,
        tokens.accessToken,
        fetchFn,
      );
    } catch (e) {
      await revokeConnection(provider, tokens, fetchFn).catch(() => false);
      throw e;
    }
    return { provider, tokens, user };
  } finally {
    stopCopyKey?.();
    callback.close();
  }
}

const DEFAULT_DEVICE_POLL_INTERVAL_SECONDS = 5;
// RFC 8628 §3.5: each `slow_down` adds five seconds to the interval.
const SLOW_DOWN_SECONDS = 5;
// A poll that couldn't reach the realm server, or that it answered as busy,
// is tried again later rather than ending the sign-in: the wait doubles each
// time, up to this.
const MAX_BACKOFF_SECONDS = 60;

// A device code, as the provider answers a device authorization request.
interface DeviceAuthorization {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresInSeconds: number;
  intervalSeconds: number;
}

async function authorizeDevice(
  provider: BoxelApiProvider,
  endpoint: string,
  fetchFn: typeof fetch,
): Promise<DeviceAuthorization> {
  let response = await fetchFn(endpoint, {
    signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: BOXEL_CLI_CLIENT_ID,
      scope: BOXEL_API_SCOPES.join(' '),
      resource: provider.resource,
    }).toString(),
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    // An error page that isn't JSON: the status says enough.
  }
  if (
    !response.ok ||
    typeof body.device_code !== 'string' ||
    typeof body.user_code !== 'string' ||
    typeof body.verification_uri !== 'string' ||
    typeof body.expires_in !== 'number'
  ) {
    throw new Error(
      `The realm server didn't start a sign-in with a code: ${describeTokenError(
        { ...(body as TokenResponse), status: response.status },
      )}`,
    );
  }
  return {
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUri: body.verification_uri,
    expiresInSeconds: body.expires_in,
    intervalSeconds:
      typeof body.interval === 'number' && body.interval > 0
        ? body.interval
        : DEFAULT_DEVICE_POLL_INTERVAL_SECONDS,
  };
}

// Signs in with a code, for a computer with no browser, such as over SSH or in
// a cloud agent (RFC 8628). The CLI shows a short code and the address of the
// secure origin's `device` page; the user opens that on any device, signs in
// there, types the code, and allows the sign-in. The CLI polls the realm
// server meanwhile, and answers as `oauthLogin` does once it is allowed.
//
// Whoever types a code into that page signs this CLI in as themselves, so the
// CLI says to enter it only there, and never offers a link with the code
// already in it.
export async function oauthDeviceLogin(
  options: OAuthLoginOptions & { provider?: BoxelApiProvider },
): Promise<OAuthLoginResult> {
  let {
    realmServerUrl,
    timeoutMs,
    fetchFn = fetch,
    log = console.log,
    now = Date.now,
    sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = options;

  let provider =
    options.provider ?? (await discoverBoxelApi(realmServerUrl, fetchFn));
  if (!provider.deviceAuthorizationEndpoint) {
    throw new OAuthNotOfferedError(
      realmServerUrl,
      "it doesn't offer sign-in with a code; sign in on a computer with a browser",
    );
  }
  let startedAt = now();
  let device = await authorizeDevice(
    provider,
    provider.deviceAuthorizationEndpoint,
    fetchFn,
  );
  let expiresAt =
    startedAt + Math.min(device.expiresInSeconds * 1000, timeoutMs ?? Infinity);

  log(
    `To sign in, open this page on any device:\n\n    ${device.verificationUri}\n\n` +
      `and enter this code:\n\n    ${device.userCode}\n\n` +
      "Only enter it on that page. If anyone asks you for this code, don't share it.",
  );
  log(
    `Waiting up to ${describeDuration(expiresAt - startedAt)} for you to ` +
      'allow the sign-in. Press Ctrl-C to stop.',
  );

  let intervalSeconds = device.intervalSeconds;
  let tokens: OAuthTokens | undefined;
  while (!tokens) {
    await sleep(intervalSeconds * 1000);
    if (now() >= expiresAt) {
      throw new Error(
        'The code expired before the sign-in was allowed. Run the command again for a new one.',
      );
    }
    let requestedAt = now();
    let body: TokenResponse & { status: number };
    try {
      body = await tokenRequest(
        provider,
        {
          grant_type: DEVICE_CODE_GRANT_TYPE,
          device_code: device.deviceCode,
        },
        fetchFn,
      );
    } catch {
      // No answer: the network, or the realm server, is down for now.
      intervalSeconds = backedOff(intervalSeconds);
      continue;
    }
    if (isTransient(body)) {
      intervalSeconds = backedOff(intervalSeconds);
      continue;
    }
    if (body.status === 200) {
      tokens = issuedTokens(body, { requestedAt, startedAt });
      break;
    }
    switch (body.error) {
      case 'authorization_pending':
        continue;
      case 'slow_down':
        intervalSeconds += SLOW_DOWN_SECONDS;
        continue;
      case 'access_denied':
        throw new Error('The sign-in was denied.');
      case 'expired_token':
        throw new Error(
          'The code expired before the sign-in was allowed. Run the command again for a new one.',
        );
      default:
        throw new Error(
          `The realm server didn't issue tokens for the sign-in: ${describeTokenError(body)}`,
        );
    }
  }

  let user: SignedInUser;
  try {
    user = await fetchSignedInUser(realmServerUrl, tokens.accessToken, fetchFn);
  } catch (e) {
    await revokeConnection(provider, tokens, fetchFn).catch(() => false);
    throw e;
  }
  return { provider, tokens, user };
}

// A poll the realm server answered as busy or failing, which a later poll
// may get past.
function isTransient(body: TokenResponse & { status: number }): boolean {
  return (
    body.status === 429 ||
    body.status >= 500 ||
    body.error === 'temporarily_unavailable'
  );
}

function backedOff(intervalSeconds: number): number {
  return Math.min(intervalSeconds * 2, MAX_BACKOFF_SECONDS);
}
