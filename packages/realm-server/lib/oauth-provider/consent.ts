// A flow's consent (ADR 021 §1.7): what the secure origin's authorize page
// shows, and the user's answer.
//
// The page calls these routes from the secure origin under the secure
// window's session, without the provider's cookies, so they read the flow by
// its interaction ID (`Interaction.find`), never through the cookie. Card code
// on the app's origin can't reach the secure window's session, so it can
// neither read a flow's details nor decide one. A decision changes nothing in
// the provider: it is stored with the user, and the page gets a ticket that
// finishes the flow only in the browser holding the flow's interaction
// cookie.
//
// What the access means comes from the registry, never from the client. The
// client's own metadata reaches the page only as `appName` names it.

import type Koa from 'koa';
import type Provider from 'oidc-provider';
import { logger, type DBAdapter } from '@cardstack/runtime-common';
import { AuthenticationError } from '@cardstack/runtime-common/router';
import { OAUTH_PROVIDER_PATH } from '../request-telemetry.ts';
import { secureSessionClient, type AccountContact } from '../secure-session.ts';
import { retrieveUserSessionClaim } from '../../utils/jwt.ts';
import { appName, type AppName } from './app-name.ts';
import { FIXED_ERROR_PAGES } from './authorization.ts';
import {
  CONSENT_TICKET_TTL_SECONDS,
  createConsentDecision,
  storeConsentTicket,
} from './objects.ts';
import type { OAuthResource, OAuthScope } from './registry.ts';

const log = logger('boxel:oauth-provider');

export const OAUTH_CONSENT_PATH = `${OAUTH_PROVIDER_PATH}/consent`;

// Far larger than a decision needs.
const MAX_BODY_BYTES = 1024;

export type AccountContactLookup = (user: string) => Promise<AccountContact>;

// What consent says about one resource the flow asks for: the registry's
// text, and the scopes asked for there, each as the registry describes it.
export interface ConsentResourceDetails {
  id: string;
  name: string;
  description: string;
  coverage: string;
  scopes: {
    name: string;
    description: string;
    label: string;
    caution: boolean;
  }[];
}

// The body of `GET /_oauth-provider/consent/:uid`.
export interface ConsentDetails {
  app: AppName;
  // An app other than Boxel's own, whose use of the data is governed by its
  // own terms, which the page says.
  outsideApp: boolean;
  resources: ConsentResourceDetails[];
  // The signed-in account, shown only to itself.
  account: AccountContact;
  // Whether the page offers to keep the connection for 30 days: only when
  // the client may use the refresh grant.
  renewalOffered: boolean;
}

// The body of `POST /_oauth-provider/consent/:uid`.
export interface ConsentDecisionRequest {
  decision: 'allow' | 'deny';
  renew: boolean;
}

interface LibraryClient {
  clientId: string;
  clientName?: string;
  grantTypes?: readonly string[];
}

// A flow awaiting its decision, as the provider holds it.
interface Flow {
  client: LibraryClient;
  redirectUri: string | undefined;
  resources: { resource: OAuthResource; scopes: OAuthScope[] }[];
  // Seconds until the interaction expires.
  remainingSeconds: number;
}

export interface ConsentDeps {
  provider: Provider;
  registry: readonly OAuthResource[];
  preRegistered: ReadonlySet<string>;
  dbAdapter: DBAdapter;
  secureOriginURL: URL;
  realmSecretSeed: string;
  accountContact: AccountContactLookup;
}

// `GET /_oauth-provider/consent/:uid`.
export function consentDetailsHandler(deps: ConsentDeps): Koa.Middleware {
  return async function handleConsentDetails(ctxt) {
    let user = await secureWindowUser(ctxt, deps);
    if (!user) {
      return;
    }
    let flow = await findFlow(deps, ctxt.params.uid);
    if (!flow) {
      return respond(ctxt, 404, { error: FIXED_ERROR_PAGES.expired });
    }
    let account: AccountContact;
    try {
      account = await deps.accountContact(user);
    } catch (error) {
      log.error(
        `consent details unavailable: the account lookup failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return respond(ctxt, 503, { error: 'unavailable' });
    }
    let app = nameOf(flow, deps.preRegistered);
    let details: ConsentDetails = {
      app,
      outsideApp: app.kind !== 'pre-registered',
      resources: flow.resources.map(({ resource, scopes }) => ({
        id: resource.id,
        name: resource.name,
        description: resource.description,
        coverage: resource.coverage,
        scopes: scopes.map(({ name, description, label, caution }) => ({
          name,
          description,
          label,
          caution,
        })),
      })),
      account,
      renewalOffered: renewalOffered(flow.client),
    };
    log.info(`consent shown: ${describe(flow, app)}`);
    respond(ctxt, 200, details);
  };
}

// `POST /_oauth-provider/consent/:uid`: Allow or Deny, and whether to renew.
// Answers a ticket that finishes the flow. A flow is decided once.
export function consentDecisionHandler(deps: ConsentDeps): Koa.Middleware {
  return async function handleConsentDecision(ctxt) {
    let user = await secureWindowUser(ctxt, deps);
    if (!user) {
      return;
    }
    let request = await readDecision(ctxt);
    if (!request) {
      return respond(ctxt, 400, { error: 'bad-request' });
    }
    let flow = await findFlow(deps, ctxt.params.uid);
    if (!flow) {
      return respond(ctxt, 404, { error: FIXED_ERROR_PAGES.expired });
    }
    let allowed = request.decision === 'allow';
    let renew = allowed && request.renew && renewalOffered(flow.client);
    let decided = await createConsentDecision(
      deps.dbAdapter,
      ctxt.params.uid,
      {
        user,
        allowed,
        renew,
        clientId: flow.client.clientId,
        scopes: Object.fromEntries(
          flow.resources.map(({ resource, scopes }) => [
            resource.id,
            scopes.map(({ name }) => name),
          ]),
        ),
      },
      flow.remainingSeconds,
    );
    if (!decided) {
      return respond(ctxt, 409, { error: 'decided' });
    }
    let ticket = await storeConsentTicket(
      deps.dbAdapter,
      ctxt.params.uid,
      Math.min(CONSENT_TICKET_TTL_SECONDS, flow.remainingSeconds),
    );
    log.info(
      `consent ${allowed ? 'allowed' : 'denied'}: ${describe(
        flow,
        nameOf(flow, deps.preRegistered),
      )}, renew ${renew}`,
    );
    respond(ctxt, 201, { ticket });
  };
}

// The secure window's user, or undefined once the request has been answered.
// Only the secure origin's pages are answered: a browser always sends
// `Origin` on these requests, and page script can't change it. Only the
// secure window's own session is accepted, never the app's session, and never
// the CLI's, whose requests can claim any `Origin`.
async function secureWindowUser(
  ctxt: Koa.Context,
  { dbAdapter, secureOriginURL, realmSecretSeed }: ConsentDeps,
): Promise<string | undefined> {
  if (ctxt.get('Origin') !== secureOriginURL.origin) {
    respond(ctxt, 403, { error: 'forbidden' });
    return undefined;
  }
  let authorization = ctxt.get('Authorization');
  if (authorization) {
    try {
      let token = await retrieveUserSessionClaim(
        authorization,
        realmSecretSeed,
        dbAdapter,
      );
      if ((await secureSessionClient(dbAdapter, token)) === 'window') {
        return token.user;
      }
    } catch (error) {
      if (!(error instanceof AuthenticationError)) {
        throw error;
      }
    }
  }
  respond(ctxt, 401, { error: 'signed-out' });
  return undefined;
}

// The flow an interaction ID names, while it can still be decided. Its
// request passed Boxel's checks before the library saved it, so it names at
// least one resource and a scope at each; a flow that doesn't is treated as
// gone rather than shown.
async function findFlow(
  { provider, registry }: ConsentDeps,
  uid: string,
): Promise<Flow | undefined> {
  let interaction = await provider.Interaction.find(uid);
  if (!interaction?.params) {
    return undefined;
  }
  let remainingSeconds = (interaction.exp ?? 0) - Math.floor(Date.now() / 1000);
  if (remainingSeconds <= 0) {
    return undefined;
  }
  let params = interaction.params as Record<string, unknown>;
  let client = await findClient(provider, params.client_id);
  if (!client) {
    return undefined;
  }
  let asked = new Set(
    typeof params.scope === 'string' ? params.scope.split(' ') : [],
  );
  let named =
    typeof params.resource === 'string'
      ? [params.resource]
      : Array.isArray(params.resource)
        ? params.resource
        : [];
  let resources: Flow['resources'] = [];
  for (let id of new Set(named)) {
    let resource = registry.find((entry) => entry.id === id);
    let scopes = resource?.scopes.filter(({ name }) => asked.has(name)) ?? [];
    if (!resource || scopes.length === 0) {
      return undefined;
    }
    resources.push({ resource, scopes });
  }
  if (resources.length === 0) {
    return undefined;
  }
  return {
    client,
    redirectUri:
      typeof params.redirect_uri === 'string' ? params.redirect_uri : undefined,
    resources,
    remainingSeconds,
  };
}

async function findClient(
  provider: Provider,
  clientId: unknown,
): Promise<LibraryClient | undefined> {
  if (typeof clientId !== 'string' || clientId.length === 0) {
    return undefined;
  }
  try {
    return (await provider.Client.find(clientId)) as LibraryClient | undefined;
  } catch {
    // A stored client the library can no longer load is no client.
    return undefined;
  }
}

function nameOf(flow: Flow, preRegistered: ReadonlySet<string>): AppName {
  return appName({
    clientId: flow.client.clientId,
    clientName: flow.client.clientName,
    redirectUri: flow.redirectUri,
    preRegistered,
  });
}

function renewalOffered(client: LibraryClient): boolean {
  return client.grantTypes?.includes('refresh_token') ?? false;
}

// A flow for the log: the client and how it is named, and the scopes asked
// for at each resource. Never the interaction ID, and never the name a client
// gave itself, which is whatever text it chose.
function describe(flow: Flow, app: AppName): string {
  let scopes = flow.resources
    .map(
      ({ resource, scopes }) =>
        `${resource.id} [${scopes.map(({ name }) => name).join(' ')}]`,
    )
    .join(', ');
  return `client ${flow.client.clientId} (${app.kind}, shown as ${app.shown}), scopes ${scopes}`;
}

async function readDecision(
  ctxt: Koa.Context,
): Promise<ConsentDecisionRequest | undefined> {
  if (!ctxt.is('application/json')) {
    return undefined;
  }
  let chunks: Buffer[] = [];
  let received = 0;
  for await (let chunk of ctxt.req) {
    let buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buffer.length;
    if (received > MAX_BODY_BYTES) {
      return undefined;
    }
    chunks.push(buffer);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return undefined;
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return undefined;
  }
  let { decision, renew } = body as Record<string, unknown>;
  if (
    (decision !== 'allow' && decision !== 'deny') ||
    typeof renew !== 'boolean'
  ) {
    return undefined;
  }
  return { decision, renew };
}

function respond(ctxt: Koa.Context, status: number, body: object) {
  ctxt.status = status;
  ctxt.set('Cache-Control', 'no-store');
  ctxt.body = body;
}
