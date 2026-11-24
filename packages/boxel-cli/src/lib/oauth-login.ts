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

async function tokenRequest(
  provider: BoxelApiProvider,
  params: Record<string, string>,
  fetchFn: typeof fetch,
): Promise<TokenResponse & { status: number }> {
  let response = await fetchFn(provider.tokenEndpoint, {
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
