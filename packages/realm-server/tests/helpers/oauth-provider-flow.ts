// Driving the OAuth provider's flows in tests: a realm server with the
// provider on, a registered client, and a flow started the way an app starts
// one.

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
  }: { redirectUri?: string; scope?: string } = {},
): Promise<string> {
  let query = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope,
    resource: OAUTH_TEST_MCP,
    state: OAUTH_TEST_STATE,
    code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    code_challenge_method: 'S256',
  });
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
