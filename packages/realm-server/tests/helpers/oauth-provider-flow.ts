// Driving the OAuth provider's flows in tests: a realm server with the
// provider on, a registered client, and a flow started the way an app starts
// one.

import { createHash, randomBytes } from 'crypto';
import { join } from 'path';
import { dirSync } from 'tmp';
import fsExtra from 'fs-extra';
import supertest from 'supertest';
import type { PgAdapter } from '@cardstack/postgres';
import type { QueuePublisher, QueueRunner } from '@cardstack/runtime-common';
import {
  createVirtualNetwork,
  fixtureDir,
  matrixURL,
  runTestRealmServer,
} from './index.ts';
import {
  testOAuthProviderConfig,
  testOAuthSecureOriginURL,
} from './oauth-provider.ts';
import type { CallerLimit } from '../../lib/oauth-provider/caller-limit.ts';
import type { OAuthResourceDefinition } from '../../lib/oauth-provider/registry.ts';
import type { TokenLimit } from '../../lib/oauth-provider/token-limit.ts';
import type { RealmHttpServer as Server } from '../../server.ts';

const { copySync, ensureDirSync } = fsExtra;

export const OAUTH_TEST_SERVER_URL = new URL('http://127.0.0.1:0/');
export const OAUTH_TEST_ISSUER = 'http://127.0.0.1:0';
export const OAUTH_TEST_MCP = `${OAUTH_TEST_ISSUER}/mcp`;
export const OAUTH_TEST_WEB_REDIRECT_URI =
  'https://app.connector.example.co.uk/callback';
export const OAUTH_TEST_STATE = 'state-marker-7c2e';

// Limits no test reaches, for modules that aren't testing them.
export const ROOMY_LIMIT: CallerLimit = {
  perAddress: { requests: 1000, windowSeconds: 600 },
  perNetwork: { requests: 1000, windowSeconds: 600 },
  overall: { requests: 1000, windowSeconds: 600 },
  alertAfter: 999,
};

// Token endpoint limits no test reaches, for modules that aren't testing them.
export const ROOMY_TOKEN_LIMIT: TokenLimit = {
  perGrant: { requests: 1000, windowSeconds: 600 },
  failuresPerAddress: { requests: 1000, windowSeconds: 600 },
};

// The verifier every flow these helpers start proves its code with, and the
// S256 challenge it starts with.
export const OAUTH_TEST_CODE_VERIFIER = 'test-verifier-'.padEnd(64, 'v');
export const OAUTH_TEST_CODE_CHALLENGE = createHash('sha256')
  .update(OAUTH_TEST_CODE_VERIFIER)
  .digest('base64url');

// A realm server with the provider on, serving a fresh copy of the `simple`
// fixture realm at its root.
export async function startOAuthProviderServer(
  {
    dbAdapter,
    publisher,
    runner,
  }: {
    dbAdapter: PgAdapter;
    publisher: QueuePublisher;
    runner: QueueRunner;
  },
  name: string,
  {
    tokenLimit,
    testResources,
  }: {
    tokenLimit?: TokenLimit;
    testResources?: OAuthResourceDefinition[];
  } = {},
): Promise<Server> {
  let realmsRootPath = join(dirSync().name, name);
  let testRealmDir = join(realmsRootPath, 'root');
  ensureDirSync(testRealmDir);
  copySync(fixtureDir('simple'), testRealmDir);
  let { testRealmHttpServer } = await runTestRealmServer({
    virtualNetwork: createVirtualNetwork(),
    testRealmDir,
    realmsRootPath,
    realmURL: OAUTH_TEST_SERVER_URL,
    dbAdapter,
    publisher,
    runner,
    matrixURL,
    secureOriginURL: testOAuthSecureOriginURL,
    clientAddress: { trustedProxyHops: 0, infraAddresses: [] },
    oauthProvider: testOAuthProviderConfig(),
    oauthNewClientLimit: ROOMY_LIMIT,
    oauthAuthorizationLimit: ROOMY_LIMIT,
    oauthTokenLimit: tokenLimit ?? ROOMY_TOKEN_LIMIT,
    ...(testResources ? { oauthTestResources: testResources } : {}),
  });
  return testRealmHttpServer;
}

// Registers a client by dynamic client registration, and answers its ID.
export async function registerOAuthClient(
  server: Server,
  {
    redirectUri = OAUTH_TEST_WEB_REDIRECT_URI,
    clientName = 'Test App',
    grantTypes,
  }: {
    redirectUri?: string;
    clientName?: string;
    grantTypes?: string[];
  } = {},
): Promise<string> {
  let response = await supertest(server)
    .post('/_oauth-provider/reg')
    .set('Host', OAUTH_TEST_SERVER_URL.host)
    .set('Content-Type', 'application/json')
    .send(
      JSON.stringify({
        client_name: clientName,
        redirect_uris: [redirectUri],
        ...(grantTypes ? { grant_types: grantTypes } : {}),
      }),
    );
  if (response.status !== 201) {
    throw new Error(`registration failed: ${JSON.stringify(response.body)}`);
  }
  return response.body.client_id as string;
}

// What sends requests: `supertest(server)`, which keeps no cookies, or
// `supertest.agent(server)`, a browser that keeps them.
export interface OAuthRequester {
  get(url: string): supertest.Test;
}

// Starts a flow the way an app does, and answers its interaction ID.
export async function startOAuthFlow(
  requester: OAuthRequester,
  clientId: string,
  {
    redirectUri = OAUTH_TEST_WEB_REDIRECT_URI,
    scope = 'boxel:read',
    resources = [OAUTH_TEST_MCP],
    codeChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  }: {
    redirectUri?: string;
    scope?: string;
    resources?: string[];
    codeChallenge?: string;
  } = {},
): Promise<string> {
  let query = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope,
    state: OAUTH_TEST_STATE,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  for (let resource of resources) {
    query.append('resource', resource);
  }
  let response = await requester
    .get(`/_oauth-provider/auth?${query}`)
    .set('Host', OAUTH_TEST_SERVER_URL.host);
  if (response.status !== 303) {
    throw new Error(`the flow didn't start: ${response.status}`);
  }
  return interactionUid(response.headers.location);
}

export function interactionUid(location: string): string {
  let prefix = `${OAUTH_TEST_ISSUER}/_oauth-provider/interaction/`;
  if (!location?.startsWith(prefix)) {
    throw new Error(`not the interaction route: ${location}`);
  }
  return location.slice(prefix.length);
}

// The user's decision on a flow, posted by the authorize page under their
// secure session (`Authorization` header), and the ticket it answers.
export async function decideOAuthFlow(
  server: Server,
  uid: string,
  session: string,
  {
    decision = 'allow',
    renew = true,
  }: { decision?: 'allow' | 'deny'; renew?: boolean } = {},
): Promise<string> {
  let response = await supertest(server)
    .post(`/_oauth-provider/consent/${uid}`)
    .set('Host', OAUTH_TEST_SERVER_URL.host)
    .set('Origin', testOAuthSecureOriginURL.origin)
    .set('Authorization', session)
    .set('Content-Type', 'application/json')
    .send(JSON.stringify({ decision, renew }));
  if (response.status !== 201) {
    throw new Error(`the decision wasn't recorded: ${response.status}`);
  }
  return response.body.ticket as string;
}

// Finishes a decided flow in the browser that started it, follows the
// library's resume, and answers the code the app is sent.
export async function finishOAuthFlow(
  browser: OAuthRequester,
  uid: string,
  ticket: string,
): Promise<string> {
  let finished = await browser
    .get(
      `/_oauth-provider/interaction/${uid}/finish?${new URLSearchParams({ ticket })}`,
    )
    .set('Host', OAUTH_TEST_SERVER_URL.host);
  let resume = finished.headers.location as string | undefined;
  if (finished.status !== 303 || !resume) {
    throw new Error(`the flow didn't finish: ${finished.status}`);
  }
  let resumed = await browser
    .get(new URL(resume).pathname)
    .set('Host', OAUTH_TEST_SERVER_URL.host);
  let landed = resumed.headers.location as string | undefined;
  let code = landed ? new URL(landed).searchParams.get('code') : null;
  if (!code) {
    throw new Error(`the app got no code: ${landed}`);
  }
  return code;
}

// Runs a whole flow for a client, from its start to the code the app is
// sent, with the user allowing it under their secure session. The flow
// proves its code with `OAUTH_TEST_CODE_VERIFIER`.
export async function codeForOAuthClient(
  server: Server,
  clientId: string,
  session: string,
  {
    renew = true,
    scope = 'boxel:read',
    resources,
    redirectUri,
  }: {
    renew?: boolean;
    scope?: string;
    resources?: string[];
    redirectUri?: string;
  } = {},
): Promise<string> {
  let browser = supertest.agent(server);
  let uid = await startOAuthFlow(browser, clientId, {
    scope,
    codeChallenge: OAUTH_TEST_CODE_CHALLENGE,
    ...(resources ? { resources } : {}),
    ...(redirectUri ? { redirectUri } : {}),
  });
  let ticket = await decideOAuthFlow(server, uid, session, { renew });
  return await finishOAuthFlow(browser, uid, ticket);
}

// A request to the token endpoint, as an app sends one.
export function tokenRequest(
  server: Server,
  params: Record<string, string>,
  { origin }: { origin?: string } = {},
): supertest.Test {
  let request = supertest(server)
    .post('/_oauth-provider/token')
    .set('Host', OAUTH_TEST_SERVER_URL.host)
    .set('Content-Type', 'application/x-www-form-urlencoded');
  if (origin) {
    request = request.set('Origin', origin);
  }
  return request.send(new URLSearchParams(params).toString());
}

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

// Exchanges a code from `codeForOAuthClient` for tokens.
export function exchangeOAuthCode(
  server: Server,
  clientId: string,
  code: string,
  {
    verifier = OAUTH_TEST_CODE_VERIFIER,
    redirectUri = OAUTH_TEST_WEB_REDIRECT_URI,
    resource,
  }: { verifier?: string; redirectUri?: string; resource?: string } = {},
): supertest.Test {
  return tokenRequest(server, {
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
    ...(resource ? { resource } : {}),
  });
}

// Exchanges a refresh token for new tokens.
export function refreshOAuthTokens(
  server: Server,
  clientId: string,
  refreshToken: string,
): supertest.Test {
  return tokenRequest(server, {
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: refreshToken,
  });
}

// A user with a row in `users` and a secure window session, for a flow's
// consent.
export interface OAuthTestUser {
  // The Matrix user ID the secure session names.
  matrixId: string;
  // The internal ID (`users.id`) a grant stores.
  id: string;
  // The secure window session's `Authorization` header.
  session: string;
}

export function randomMatrixId(prefix: string): string {
  return `@${prefix}-${randomBytes(6).toString('hex')}:localhost`;
}
