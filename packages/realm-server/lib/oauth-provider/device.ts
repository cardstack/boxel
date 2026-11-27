// Device sign-in (RFC 8628; ADR 021 §1.4, §1.7): an app on a computer with no
// browser, such as boxel-cli over SSH, asks for a device code and shows the
// user a short user code. The user types it into the secure origin's `device`
// page, on any device, under the secure window's session, and sees the same
// consent as on the authorize page. The app polls the token endpoint until the
// user decides.
//
// Someone can start a sign-in and send its code to a victim, who would sign
// the sender's app in as themselves. So:
// - only a pre-registered app whose grant types list it may start one;
// - starting one counts against the authorization limit, since it starts a
//   flow and stores a code;
// - a code lasts 10 minutes (`DEVICE_CODE_TTL_SECONDS`), and entering one is
//   limited per user and per address (`BOXEL_OAUTH_DEVICE_CODE_RATE_LIMIT`);
// - no address with the code already in it is ever offered (`provider.ts`),
//   so the user types the code their own terminal shows;
// - the page names the app and tells the user to enter only a code from their
//   own terminal.
//
// The library's own pages for entering and confirming a code are never
// served. The page's lookup and decision are Boxel's routes, which answer
// only the secure origin and the secure window's session, like consent's.
// Allowing creates the grant, as finishing a browser flow does, and writes
// the user and grant into the device code (`decideDeviceCode`), which the
// library reads when the app next polls. ADR 021 §1.7's rule that a flow
// finishes only in the browser that started it is the authorization code
// flow's: a device flow has no browser that started it, and the user code is
// what ties the user to it.

import type Koa from 'koa';
import type Provider from 'oidc-provider';
import {
  CLIENT_IP_HEADER,
  counterKey,
  isRateLimitUnavailable,
  logger,
  parseRateLimitSpec,
  type AnonymousRateLimit,
  type DBAdapter,
  type RateLimitStore,
} from '@cardstack/runtime-common';
import { getUserByMatrixUserId } from '@cardstack/billing/billing-queries';
import { OAUTH_PROVIDER_PATH } from '../request-telemetry.ts';
import type { AccountContact } from '../secure-session.ts';
import { appName } from './app-name.ts';
import { findClient } from './authorization.ts';
import {
  CallerLimitAlert,
  callerLimitFormat,
  parseCallerLimit,
  takeFromCallerLimit,
  tokenBucket,
  type CallerLimit,
  type CallerLimitOutcome,
} from './caller-limit.ts';
import {
  consentDetails,
  readJSONObject,
  renewalOffered,
  type AccountContactLookup,
} from './consent.ts';
import { clientIdForLogs } from './client-metadata-document.ts';
import { logOAuthEvent, networkOf, userPseudonym } from './events.ts';
import { createGrant, deleteGrant } from './grants.ts';
import {
  decideDeviceCode,
  findDeviceCodeByUserCode,
  normalizeUserCode,
  type DeviceCodeLookup,
} from './objects.ts';
import {
  deviceFlowClient,
  type PreRegisteredClients,
} from './pre-registered-clients.ts';
import type { OAuthResource, OAuthScope } from './registry.ts';
import { respond, secureWindowUser } from './secure-window-user.ts';
import {
  readForm,
  respond as respondOAuthError,
  type FormParam,
} from './token-limit.ts';

const log = logger('boxel:oauth-provider');

export const OAUTH_DEVICE_LOOKUP_PATH = `${OAUTH_PROVIDER_PATH}/device/lookup`;
export const OAUTH_DEVICE_DECISION_PATH = `${OAUTH_PROVIDER_PATH}/device/decision`;

export const OAUTH_DEVICE_CODE_RATE_LIMIT_VAR =
  'BOXEL_OAUTH_DEVICE_CODE_RATE_LIMIT';

// The limit on entering user codes on the `device` page: per user, then as a
// caller limit (`caller-limit.ts`) per address, per network and overall. Both
// the lookup and the decision count, so a sign-in costs two. A user code is
// 8 letters from 20, so even the overall limit leaves guessing a live code
// hopeless within its 10 minutes.
export interface DeviceCodeLimit {
  perUser: AnonymousRateLimit;
  caller: CallerLimit;
}

export const DEFAULT_DEVICE_CODE_LIMIT: DeviceCodeLimit = Object.freeze({
  perUser: Object.freeze({ requests: 20, windowSeconds: 600 }),
  caller: Object.freeze({
    perAddress: Object.freeze({ requests: 30, windowSeconds: 600 }),
    perNetwork: Object.freeze({ requests: 150, windowSeconds: 600 }),
    overall: Object.freeze({ requests: 2000, windowSeconds: 600 }),
    alertAfter: 1000,
  }),
});

// Comma-separated named parts, each optional, with the default for any left
// out: `user` as `requests/windowSeconds`, and the caller limit's parts as
// `parseCallerLimit` reads them, for example
// `user=20/600,address=30/600,network=150/600,all=2000/600,alert=1000`.
// Undefined when a part is unknown, repeated or malformed.
export function parseDeviceCodeLimit(
  spec: string,
): DeviceCodeLimit | undefined {
  let perUser: AnonymousRateLimit = DEFAULT_DEVICE_CODE_LIMIT.perUser;
  let callerParts: string[] = [];
  let userSeen = false;
  for (let part of spec.split(',')) {
    let [name, value, ...rest] = part.split('=').map((text) => text.trim());
    if (name !== 'user') {
      callerParts.push(part);
      continue;
    }
    if (userSeen || value === undefined || rest.length > 0) {
      return undefined;
    }
    userSeen = true;
    let bucket = parseRateLimitSpec(value);
    if (!bucket) {
      return undefined;
    }
    perUser = bucket;
  }
  let caller =
    callerParts.length === 0
      ? DEFAULT_DEVICE_CODE_LIMIT.caller
      : parseCallerLimit(
          callerParts.join(','),
          DEFAULT_DEVICE_CODE_LIMIT.caller,
        );
  return caller ? { perUser, caller } : undefined;
}

export function deviceCodeLimitFormat(): string {
  let { requests, windowSeconds } = DEFAULT_DEVICE_CODE_LIMIT.perUser;
  return `user=${requests}/${windowSeconds}, then ${callerLimitFormat(
    DEFAULT_DEVICE_CODE_LIMIT.caller,
  )}`;
}

// The parameters a device authorization request may carry.
const DEVICE_AUTHORIZATION_PARAMETERS: ReadonlySet<string> = new Set([
  'client_id',
  'scope',
  'resource',
]);

// A scope list as RFC 6749 §3.3 spells one, single spaces between scopes.
const SCOPE_LIST = /^[\x21\x23-\x5B\x5D-\x7E]+(?: [\x21\x23-\x5B\x5D-\x7E]+)*$/;

// Why a device authorization request was refused, by a fixed label.
type DeviceAuthorizationRefusal =
  | 'unsupported-parameter'
  | 'client-not-allowed'
  | 'unknown-resource'
  | 'unknown-scope'
  | 'missing-scope';

// The handler for `POST` on the device authorization endpoint, before the
// library: the limit, then the request's parameters, its client, its one
// resource and its scopes. `next` hands the request to the library, which
// stores the device code and answers it (`provider.ts` rewrites the answer).
export function deviceAuthorizationHandler({
  provider,
  registry,
  preRegistered,
  rateLimitStore,
  limit,
}: {
  provider: Provider;
  registry: readonly OAuthResource[];
  preRegistered: PreRegisteredClients;
  rateLimitStore: RateLimitStore;
  // The authorization limit: starting a device sign-in is starting a flow.
  limit: CallerLimit;
}): Koa.Middleware {
  let alert = new CallerLimitAlert(
    limit,
    ({ overall, alertAfter }) =>
      `more than ${alertAfter} OAuth flows started within ${overall.windowSeconds} seconds; ` +
      `starting one is refused for everyone at ${overall.requests}`,
  );
  return async function handleDeviceAuthorization(ctxt, next) {
    let address = ctxt.req.headers[CLIENT_IP_HEADER];
    let admitted = await takeFromCallerLimit(
      rateLimitStore,
      'oauth-authorization',
      typeof address === 'string' ? address : undefined,
      limit,
    );
    alert.note(admitted);
    if (!admitted.admitted) {
      log.info(`device authorization refused by the limit: ${admitted.reason}`);
      return refuseCaller(
        ctxt,
        admitted,
        'temporarily_unavailable',
        (status, body) => respondOAuthError(ctxt, status, body),
      );
    }

    let form = await readForm({
      ctxt,
      provider,
      // Already counted above.
      charge: async () => true,
      endpoint: 'device authorization',
    });
    if (!form) {
      return;
    }
    let client = deviceFlowClient(preRegistered, form.param('client_id'));
    let check = checkDeviceAuthorization(form, client !== undefined, registry);
    if (check.refused) {
      let clientName = client ? client.metadata.client_id : 'unknown';
      logOAuthEvent(
        'info',
        {
          event: 'authorization-refused',
          reason: check.reason,
          error: check.error,
          client: clientIdForLogs(clientName),
          network: networkOf(ctxt),
          flow: 'device',
        },
        `device authorization refused: ${check.reason}, client ${clientName}`,
      );
      return respondOAuthError(ctxt, check.status, {
        error: check.error,
        error_description: check.description,
      });
    }
    log.info(
      `device authorization started: resource ${check.resource.id}, client ${client!.metadata.client_id}`,
    );
    // The library reads `req.body` when the request stream has been read,
    // as it now has.
    (ctxt.req as typeof ctxt.req & { body?: unknown }).body = form.body;
    await next();
  };
}

function checkDeviceAuthorization(
  form: {
    param: FormParam;
    named: (name: string) => boolean;
    names(): string[];
  },
  clientAllowed: boolean,
  registry: readonly OAuthResource[],
):
  | { refused: false; resource: OAuthResource }
  | {
      refused: true;
      reason: DeviceAuthorizationRefusal;
      status: number;
      error: string;
      description: string;
    } {
  let refuse = (
    reason: DeviceAuthorizationRefusal,
    error: string,
    description: string,
    status = 400,
  ) => ({ refused: true as const, reason, status, error, description });

  if (form.names().some((name) => !DEVICE_AUTHORIZATION_PARAMETERS.has(name))) {
    return refuse(
      'unsupported-parameter',
      'invalid_request',
      'a device authorization request takes only client_id, scope and resource',
    );
  }
  if (!clientAllowed) {
    return refuse(
      'client-not-allowed',
      'unauthorized_client',
      "only Boxel's own apps may use device sign-in",
    );
  }
  // Exactly one resource, named once: the token the app gets is bound to it.
  let resourceId = form.param('resource');
  let resource = resourceId
    ? registry.find((entry) => entry.id === resourceId)
    : undefined;
  if (!resource) {
    return refuse(
      'unknown-resource',
      'invalid_target',
      'a device authorization request must name one resource the provider serves',
    );
  }
  let scope = form.param('scope');
  if (!scope || !SCOPE_LIST.test(scope)) {
    return refuse(
      'missing-scope',
      'invalid_scope',
      'a device authorization request must name its scopes',
    );
  }
  let scopes = scope.split(' ');
  if (scopes.some((name) => !resource.scopes.some((s) => s.name === name))) {
    return refuse(
      'unknown-scope',
      'invalid_scope',
      'a scope is not one the resource offers',
    );
  }
  return { refused: false, resource };
}

export interface DeviceDeps {
  provider: Provider;
  registry: readonly OAuthResource[];
  preRegistered: PreRegisteredClients;
  dbAdapter: DBAdapter;
  rateLimitStore: RateLimitStore;
  limit: DeviceCodeLimit;
  secureOriginURL: URL;
  realmSecretSeed: string;
  accountContact: AccountContactLookup;
}

// The body of `POST /_oauth-provider/device/decision`.
export interface DeviceDecisionRequest {
  userCode: string;
  decision: 'allow' | 'deny';
  renew: boolean;
}

// A device code waiting for its decision, as the page's routes need it.
interface DeviceFlow {
  key: string;
  client: NonNullable<Awaited<ReturnType<typeof findClient>>>;
  resource: OAuthResource;
  scopes: OAuthScope[];
}

// The `device` page's two routes.
//
// `POST /_oauth-provider/device/lookup`, `{ user_code }`: the consent for the
// device code the user code names, as the authorize page's consent route
// answers it. 404 `unknown-code`, 410 `expired` and 409 `decided` say why there
// is none.
//
// `POST /_oauth-provider/device/decision`, `{ user_code, decision, renew }`:
// Allow or Deny. Answers 200 `{ decision }` once the device code holds it; the
// app's next poll gets its tokens or `access_denied`. A code is decided once:
// a second decision is 409 `decided`.
//
// Both count against the entry limit before they read anything, and answer
// 429 `rate-limited` over it.
export function deviceHandlers(deps: DeviceDeps): {
  handleDeviceLookup: Koa.Middleware;
  handleDeviceDecision: Koa.Middleware;
} {
  let alert = new CallerLimitAlert(
    deps.limit.caller,
    ({ overall, alertAfter }) =>
      `more than ${alertAfter} device codes entered within ${overall.windowSeconds} seconds; ` +
      `entering one is refused for everyone at ${overall.requests}`,
  );
  let perUser = tokenBucket(deps.limit.perUser);

  // The user, once the request is the secure window's and within the limit;
  // undefined once it has been answered.
  async function admit(ctxt: Koa.Context): Promise<string | undefined> {
    let user = await secureWindowUser(ctxt, deps);
    if (!user) {
      return undefined;
    }
    let byUser = await deps.rateLimitStore.take(
      counterKey('oauth-device-code', 'user', user),
      perUser,
    );
    let outcome: CallerLimitOutcome;
    if (!byUser.admitted) {
      outcome = isRateLimitUnavailable(byUser)
        ? { admitted: false, reason: 'unavailable' }
        : {
            admitted: false,
            reason: 'limited',
            retryAfterSeconds: byUser.retryAfterSeconds,
          };
    } else {
      let address = ctxt.req.headers[CLIENT_IP_HEADER];
      outcome = await takeFromCallerLimit(
        deps.rateLimitStore,
        'oauth-device-code',
        typeof address === 'string' ? address : undefined,
        deps.limit.caller,
      );
      alert.note(outcome);
    }
    if (!outcome.admitted) {
      log.info(`device code refused by the limit: ${outcome.reason}`);
      refuseCaller(ctxt, outcome, 'rate-limited', (status, body) =>
        respond(ctxt, status, { error: body.error }),
      );
      return undefined;
    }
    return user;
  }

  // The pending device code a user code names, or undefined once the
  // request has been answered with why there is none.
  async function findFlow(
    ctxt: Koa.Context,
    user: string,
    userCode: string,
  ): Promise<DeviceFlow | undefined> {
    let found = await findDeviceCodeByUserCode(deps.dbAdapter, userCode);
    let flow =
      found.state === 'pending' ? await flowOf(deps, found) : undefined;
    if (!flow) {
      let state = found.state === 'pending' ? 'unknown' : found.state;
      logOAuthEvent(
        'info',
        {
          event: 'device-code-refused',
          reason: state,
          user: await userPseudonym(deps.dbAdapter, user),
          network: networkOf(ctxt),
        },
        `device code refused: ${state}`,
      );
      let [status, body] = NO_FLOW[state];
      respond(ctxt, status, body);
      return undefined;
    }
    return flow;
  }

  // A decision on the device page, as the consent event the authorize page's
  // decision logs too (`consent.ts`), marked as a device flow's.
  async function logDeviceConsent(
    ctxt: Koa.Context,
    flow: DeviceFlow,
    user: string,
    outcome: 'allowed' | 'denied',
    renew?: boolean,
  ): Promise<void> {
    logOAuthEvent(
      'info',
      {
        event: 'consent',
        outcome,
        client: clientIdForLogs(flow.client.clientId),
        user: await userPseudonym(deps.dbAdapter, user),
        network: networkOf(ctxt),
        renew: renew ?? false,
        flow: 'device',
      },
      `device consent ${outcome}: ${describe(flow)}${
        renew === undefined ? '' : `, renew ${renew}`
      }`,
    );
  }

  return {
    async handleDeviceLookup(ctxt) {
      let user = await admit(ctxt);
      if (!user) {
        return;
      }
      let body = await readJSONObject(ctxt);
      let userCode = body?.user_code;
      if (typeof userCode !== 'string' || userCode.length > MAX_USER_CODE) {
        return respond(ctxt, 400, { error: 'bad-request' });
      }
      let flow = await findFlow(ctxt, user, userCode);
      if (!flow) {
        return;
      }
      let account: AccountContact;
      try {
        account = await deps.accountContact(user);
      } catch (error) {
        log.error(
          `device consent unavailable: the account lookup failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return respond(ctxt, 503, { error: 'unavailable' });
      }
      log.info(`device code entered: ${describe(flow)}`);
      respond(
        ctxt,
        200,
        consentDetails({
          app: nameOf(flow, deps.preRegistered),
          client: flow.client,
          resources: [{ resource: flow.resource, scopes: flow.scopes }],
          account,
          // The code the user typed, in the form their terminal shows it,
          // for them to check once more before they answer.
          confirmationCode: shownUserCode(userCode),
        }),
      );
    },

    async handleDeviceDecision(ctxt) {
      let user = await admit(ctxt);
      if (!user) {
        return;
      }
      let request = readDeviceDecision(await readJSONObject(ctxt));
      if (!request) {
        return respond(ctxt, 400, { error: 'bad-request' });
      }
      let flow = await findFlow(ctxt, user, request.userCode);
      if (!flow) {
        return;
      }
      if (request.decision === 'deny') {
        let decided = await decideDeviceCode(deps.dbAdapter, flow.key, {
          error: 'access_denied',
          errorDescription: 'the user denied the sign-in',
        });
        if (!decided) {
          return respond(ctxt, 409, { error: 'decided' });
        }
        await logDeviceConsent(ctxt, flow, user, 'denied');
        return respond(ctxt, 200, { decision: 'deny' });
      }

      let userId = (await getUserByMatrixUserId(deps.dbAdapter, user))?.id;
      if (!userId) {
        return respond(ctxt, 404, { error: 'unknown-user' });
      }
      let renew = request.renew && renewalOffered(flow.client);
      let consentedAt = new Date();
      let scopes = flow.scopes.map(({ name }) => name);
      let grantId = await createGrant(deps.dbAdapter, {
        userId,
        clientId: flow.client.clientId,
        resources: { [flow.resource.id]: scopes },
        renewing: renew,
        consentedAt,
      });
      if (!grantId) {
        return respond(ctxt, 404, NO_FLOW.unknown[1]);
      }
      // A grant no device code names never connected the app: another
      // decision, or the code's expiry, got there first.
      let decided = false;
      try {
        decided = await decideDeviceCode(deps.dbAdapter, flow.key, {
          accountId: userId,
          grantId,
          authTime: Math.floor(consentedAt.getTime() / 1000),
          scope: scopes.join(' '),
          resource: flow.resource.id,
        });
      } finally {
        if (!decided) {
          await deleteGrant(deps.dbAdapter, grantId);
        }
      }
      if (!decided) {
        return respond(ctxt, 409, { error: 'decided' });
      }
      await logDeviceConsent(ctxt, flow, user, 'allowed', renew);
      respond(ctxt, 200, { decision: 'allow' });
    },
  };
}

// A user code as the CLI shows it, `XXXX-XXXX` (the provider's mask).
function shownUserCode(typed: string): string {
  let code = normalizeUserCode(typed);
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

// Longer than any user code, with room for spaces and a dash typed into it.
const MAX_USER_CODE = 32;

const NO_FLOW = {
  unknown: [404, { error: 'unknown-code' }],
  expired: [410, { error: 'expired' }],
  decided: [409, { error: 'decided' }],
} as const satisfies Record<
  Exclude<DeviceCodeLookup['state'], 'pending'>,
  readonly [number, { error: string }]
>;

// The device code's client, resource and scopes, while its client may still
// use device sign-in and its request still names what the registry serves.
async function flowOf(
  { provider, registry, preRegistered }: DeviceDeps,
  found: Extract<DeviceCodeLookup, { state: 'pending' }>,
): Promise<DeviceFlow | undefined> {
  if (!deviceFlowClient(preRegistered, found.clientId)) {
    return undefined;
  }
  let client = await findClient(provider, found.clientId);
  let resource = registry.find(({ id }) => id === found.params.resource);
  let asked = new Set(
    typeof found.params.scope === 'string' ? found.params.scope.split(' ') : [],
  );
  let scopes = resource?.scopes.filter(({ name }) => asked.has(name)) ?? [];
  if (!client || !resource || scopes.length === 0) {
    return undefined;
  }
  return { key: found.key, client, resource, scopes };
}

function nameOf(flow: DeviceFlow, preRegistered: PreRegisteredClients) {
  return appName({
    clientId: flow.client.clientId,
    clientName: flow.client.clientName,
    redirectUri: undefined,
    preRegistered,
  });
}

// A device code for the log: its client and the scopes it asks for. Never a
// code, and never the user.
function describe(flow: DeviceFlow): string {
  return `client ${flow.client.clientId}, scopes ${flow.resource.id} [${flow.scopes
    .map(({ name }) => name)
    .join(' ')}]`;
}

function readDeviceDecision(
  body: Record<string, unknown> | undefined,
): DeviceDecisionRequest | undefined {
  if (!body) {
    return undefined;
  }
  let { user_code: userCode, decision, renew } = body;
  if (
    typeof userCode !== 'string' ||
    userCode.length > MAX_USER_CODE ||
    (decision !== 'allow' && decision !== 'deny') ||
    typeof renew !== 'boolean'
  ) {
    return undefined;
  }
  return { userCode, decision, renew };
}

// Answers a request a limit didn't admit: 403 when the caller's address can't
// be worked out, 503 when the limit's store couldn't be read, and 429 with
// `Retry-After` over the limit, as `limitedError`.
function refuseCaller(
  ctxt: Koa.Context,
  outcome: Exclude<CallerLimitOutcome, { admitted: true }>,
  limitedError: string,
  answer: (
    status: number,
    body: { error: string; error_description: string },
  ) => void,
) {
  switch (outcome.reason) {
    case 'unknown-address':
      return answer(403, {
        error: 'access_denied',
        error_description: 'requests are refused from this address',
      });
    case 'unavailable':
      return answer(503, {
        error: 'temporarily_unavailable',
        error_description: 'try again later',
      });
    case 'limited':
      ctxt.set('Retry-After', String(outcome.retryAfterSeconds));
      return answer(429, {
        error: limitedError,
        error_description: 'too many requests; try again later',
      });
  }
}
