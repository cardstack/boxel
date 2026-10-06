import {
  CLIENT_CLASS_HEADER,
  CLIENT_IP_HEADER,
  INFRA_CLIENT_CLASS,
  formatIP,
  parseIP,
  rangesContain,
  rateLimitKey,
  type AnonymousAccessSettings,
} from './anonymous-access.ts';
import type {
  AnonymousRateLimiter,
  AnonymousRateOutcome,
} from './anonymous-rate-limiter.ts';
import { errorsDocument } from './card-operations/envelope.ts';
import {
  emitAnonymousRequest,
  recordSafely,
  type AnonymousRequestEvent,
} from './card-operations/telemetry.ts';
import type { OperationError } from './card-operations/types.ts';
import { createResponse } from './create-response.ts';
import type { logger } from './log.ts';
import { X_BOXEL_LOGGING_CORRELATION_ID_HEADER } from './prerender-headers.ts';
import type { RequestContext } from './realm.ts';
import { SupportedMimeType } from './router.ts';
import type { ResponseWithNodeStream } from './virtual-network.ts';

// ============================================================================
// Callers who aren't signed in.
//
// A realm's policy can admit a request that authenticated nobody, through the
// grants that opt in to such callers (`OperationGrant.anonymous`), and the
// governed realm limits and blocks those callers by address
// (`anonymousRateLimit`, `anonymousBlocklist` in its `realm.json`). This is
// that half of the realm: deciding whether such a request is admitted to what
// its route would run, before anything about its target is resolved, and
// counting what it costs against its address's budget once it has run.
//
// The realm hands a request here only once its ACL refused it for want of
// credentials, on a route tagged with what it would run (`AnonymousDispatch`).
// Everything else about the request is the realm's: the gate decides what a
// grant admits, exactly as it does for a signed-in caller.
// ============================================================================

// What a route would run for a caller who isn't signed in: the operations, any
// one of which the realm's policy has to open to such callers for it to admit
// one there (empty means any at all), and whether a successful answer counts
// against the realm's anonymous rate limit.
export interface AnonymousDispatch {
  operations: readonly string[];
  charged: boolean;
}

// A request the realm's policy admitted though it authenticated nobody.
export interface AnonymousCaller {
  // What the route was admitted to, or `*` for a route that runs whatever its
  // request names.
  operation: string;
  // The caller's address in canonical form, or null where the realm server
  // could not work one out (only a caller of ours can be admitted then).
  clientIP: string | null;
  // What the caller is counted under (see `rateLimitKey`).
  rateLimitKey: string | undefined;
  // The caller is one of the platform's own services: counted in telemetry,
  // never limited or blocked.
  infra: boolean;
  charged: boolean;
  // Set where the request serves what it asked for: a card's document or
  // headers, or a file's bytes. Only such a request is counted, so a redirect
  // or a refusal costs the caller nothing whatever its status.
  served?: true;
  // What the caller is answered with in place of running the request, when
  // the realm can't count it: its address has used up the realm's limit, or
  // the count couldn't be read. Settled at admission, before anything runs.
  turnedAway?:
    | { kind: 'rate-limited'; retryAfterSeconds: number }
    | { kind: 'unavailable' };
}

// The card+json read: what an anonymous grant on `read` opens.
export const ANONYMOUS_CARD_READ: AnonymousDispatch = {
  operations: ['read'],
  charged: true,
};
// A data file's or a card's stored bytes: what a `readSource` grant opens.
export const ANONYMOUS_BYTES_READ: AnonymousDispatch = {
  operations: ['readSource'],
  charged: true,
};
// A stylesheet goes with the markup that references it, so it is served to an
// anonymous caller a policy would serve any card's markup to, and counts for
// nothing on its own: the read or search that drew the markup was counted.
export const ANONYMOUS_STYLESHEET: AnonymousDispatch = {
  operations: ['read', 'query'],
  charged: false,
};
// A capability check asks what the caller could invoke and invokes nothing, so
// it answers an anonymous caller in any realm whose policy opens anything to
// one. It is counted by the handler, one unit for each pair it asks about,
// before any is checked (see `AnonymousAdmission.count`).
export const ANONYMOUS_CAPABILITY_CHECK: AnonymousDispatch = {
  operations: [],
  charged: false,
};

// How long a caller the realm couldn't count is told to wait.
const COUNT_UNAVAILABLE_RETRY_SECONDS = 5;

// What a realm supplies to decide about and count its callers who aren't
// signed in, bound to its own `realm.json` and policy.
export interface AnonymousAdmissionEnvironment {
  realmURL: string;
  log: ReturnType<typeof logger>;
  limiter: AnonymousRateLimiter;
  // Whether the realm names a policy at all.
  hasPolicy(): Promise<boolean>;
  // The operations the realm's policy opens to such callers.
  openedOperations(): Promise<ReadonlySet<string>>;
  // The realm's limit and blocklist for such callers.
  access(): Promise<AnonymousAccessSettings>;
}

export class AnonymousAdmission {
  #env: AnonymousAdmissionEnvironment;

  constructor(env: AnonymousAdmissionEnvironment) {
    this.#env = env;
  }

  // The caller a request that authenticated nobody is, where the realm's
  // policy opens one of `dispatch`'s operations to such callers and the realm
  // doesn't refuse the caller's address: what it is admitted to, the address
  // it is counted under, and whether that address has budget left. Undefined
  // for every other request, which is refused as an unauthenticated request
  // always has been, before anything about its path is resolved: the question
  // reads the compiled policy's summary and the realm's own `realm.json`, and
  // loads no target and evaluates no predicate. A realm whose policy opens
  // nothing to such callers records nothing.
  //
  // The address is read only from the headers the realm server sets (see
  // `CLIENT_IP_HEADER`). A request without one, which is a request whose
  // address the server could not work out, is refused as a blocked one,
  // unless it is from the platform's own infrastructure, which is never
  // blocked.
  async callerFor(
    request: Request,
    dispatch: AnonymousDispatch,
  ): Promise<AnonymousCaller | undefined> {
    if (
      request.headers.has('Authorization') ||
      !(await this.#env.hasPolicy())
    ) {
      return undefined;
    }
    let opened = await this.#env.openedOperations();
    // A route that runs whatever its request names is admitted wherever the
    // policy opens anything to such callers, and recorded as `*`.
    let operation =
      dispatch.operations.length === 0
        ? opened.size > 0
          ? '*'
          : undefined
        : dispatch.operations.find((name) => opened.has(name));
    if (operation === undefined) {
      return undefined;
    }
    let ipText = request.headers.get(CLIENT_IP_HEADER);
    let address = ipText ? parseIP(ipText) : undefined;
    let caller: AnonymousCaller = {
      operation,
      clientIP: address ? formatIP(address) : null,
      rateLimitKey: address ? rateLimitKey(address) : undefined,
      infra: request.headers.get(CLIENT_CLASS_HEADER) === INFRA_CLIENT_CLASS,
      charged: dispatch.charged,
    };
    if (!caller.infra) {
      let access = await this.#env.access();
      let blockReason: AnonymousRequestEvent['blockReason'] =
        access.invalidBlocklistEntries.length > 0
          ? 'blocklist-invalid'
          : !address
            ? 'ip-undetermined'
            : rangesContain(access.blocklist, address)
              ? 'blocklist'
              : undefined;
      if (blockReason) {
        this.#record(request, caller, { outcome: 'blocked', blockReason });
        return undefined;
      }
      if (caller.charged) {
        caller.turnedAway = await this.#checkBudget(request, caller, access);
      }
    }
    return caller;
  }

  // The answer a caller the realm admitted without a session gets in place of
  // what it asked for, when its admission settled that it is turned away.
  turnedAway(
    requestContext: RequestContext,
  ): ResponseWithNodeStream | undefined {
    let turnedAway = requestContext.anonymousCaller?.turnedAway;
    if (!turnedAway) {
      return undefined;
    }
    return turnedAway.kind === 'rate-limited'
      ? this.#rateLimitedResponse(requestContext, turnedAway.retryAfterSeconds)
      : this.#countUnavailableResponse(requestContext);
  }

  // Counts a request the realm's policy admitted though it authenticated
  // nobody, once it has served what it asked for (see
  // `AnonymousCaller.served`), so a request no grant admits, a redirect, and a
  // target that isn't there cost the caller nothing. An address with no
  // budget left was turned away at admission, before the request ran; one
  // that spends its last unit concurrently with another request is answered
  // here in the served response's place. A caller of ours is recorded and
  // never counted.
  async charge(
    request: Request,
    requestContext: RequestContext,
    response: ResponseWithNodeStream,
  ): Promise<ResponseWithNodeStream> {
    let caller = requestContext.anonymousCaller;
    if (!caller || caller.turnedAway) {
      return response;
    }
    if (!caller.served) {
      if (response.status === 401 || request.method === 'HEAD') {
        this.#record(request, caller, { outcome: 'refused' });
      }
      return response;
    }
    if (!caller.charged) {
      return response;
    }
    let answer = await this.count(request, requestContext, 1);
    if (answer) {
      await discardBody(response);
      return answer;
    }
    return response;
  }

  // Counts `cost` invocations by a caller the realm admitted without a
  // session against its address's budget, and answers in their place when
  // they don't fit or can't be counted. A request whose cost is known before
  // it runs, such as a capability check asking about several pairs, is
  // counted here first, so one that doesn't fit runs nothing. A caller of
  // ours is recorded and never counted.
  async count(
    request: Request,
    requestContext: RequestContext,
    cost: number,
  ): Promise<ResponseWithNodeStream | undefined> {
    let caller = requestContext.anonymousCaller;
    if (!caller || cost < 1) {
      return undefined;
    }
    if (caller.infra) {
      this.#record(request, caller, { outcome: 'infra' });
      return undefined;
    }
    let { limit, limitFrom } = await this.#env.access();
    let outcome: AnonymousRateOutcome;
    try {
      outcome = await this.#env.limiter.charge({
        realmURL: this.#env.realmURL,
        clientIP: caller.rateLimitKey!,
        limit,
        cost,
      });
    } catch (e: unknown) {
      this.#recordCountFailure(request, caller, e);
      return this.#countUnavailableResponse(requestContext);
    }
    let recordedLimit = { ...limit, from: limitFrom };
    let costDetail = cost > 1 ? { cost } : {};
    if (outcome.admitted) {
      this.#record(request, caller, {
        outcome: 'admitted',
        limit: recordedLimit,
        count: outcome.count,
        ...costDetail,
      });
      return undefined;
    }
    this.#record(request, caller, {
      outcome: 'rate-limited',
      limit: recordedLimit,
      retryAfterSeconds: outcome.retryAfterSeconds,
      ...costDetail,
    });
    return this.#rateLimitedResponse(requestContext, outcome.retryAfterSeconds);
  }

  // Whether the caller's address has budget left for one more invocation,
  // asked before the invocation runs so that one over the limit costs the
  // realm nothing more than this question. The answer is the address's, not
  // the target's, so it says nothing about what the request names. A count
  // that can't be read turns the caller away rather than letting an
  // invocation through uncounted.
  async #checkBudget(
    request: Request,
    caller: AnonymousCaller,
    { limit, limitFrom }: AnonymousAccessSettings,
  ): Promise<AnonymousCaller['turnedAway']> {
    let outcome: AnonymousRateOutcome;
    try {
      outcome = await this.#env.limiter.remaining({
        realmURL: this.#env.realmURL,
        clientIP: caller.rateLimitKey!,
        limit,
      });
    } catch (e: unknown) {
      this.#recordCountFailure(request, caller, e);
      return { kind: 'unavailable' };
    }
    if (outcome.admitted) {
      return undefined;
    }
    this.#record(request, caller, {
      outcome: 'rate-limited',
      limit: { ...limit, from: limitFrom },
      retryAfterSeconds: outcome.retryAfterSeconds,
    });
    return {
      kind: 'rate-limited',
      retryAfterSeconds: outcome.retryAfterSeconds,
    };
  }

  #recordCountFailure(
    request: Request,
    caller: AnonymousCaller,
    e: unknown,
  ): void {
    this.#env.log.warn(
      `could not count a request to ${this.#env.realmURL} from a caller who isn't signed in, so it was turned away: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    this.#record(request, caller, { outcome: 'unavailable' });
  }

  // The answer to a request whose caller's address has used up the realm's
  // anonymous rate limit: nothing was done, and when to try again.
  #rateLimitedResponse(
    requestContext: RequestContext,
    retryAfterSeconds: number,
  ): ResponseWithNodeStream {
    return countRefusalResponse(requestContext, {
      status: 429,
      code: 'rate-limited',
      title: 'Too many requests',
      detail: `This address has made as many requests to this realm without signing in as it allows for now. Try again in ${retryAfterSeconds} second${retryAfterSeconds === 1 ? '' : 's'}.`,
      meta: { retryAfterSeconds },
    });
  }

  // The answer to a request from a caller who isn't signed in that the realm
  // couldn't count: nothing was done, and the caller may try again shortly.
  #countUnavailableResponse(
    requestContext: RequestContext,
  ): ResponseWithNodeStream {
    return countRefusalResponse(requestContext, {
      status: 503,
      code: 'rate-limit-unavailable',
      title: 'Service unavailable',
      detail: `This realm couldn't count this request, so it wasn't carried out. Try again in ${COUNT_UNAVAILABLE_RETRY_SECONDS} seconds.`,
      meta: { retryAfterSeconds: COUNT_UNAVAILABLE_RETRY_SECONDS },
    });
  }

  #record(
    request: Request,
    caller: AnonymousCaller,
    detail: Pick<
      AnonymousRequestEvent,
      | 'outcome'
      | 'blockReason'
      | 'limit'
      | 'count'
      | 'retryAfterSeconds'
      | 'cost'
    >,
  ): void {
    recordSafely('anonymous-request', () =>
      emitAnonymousRequest({
        kind: 'anonymous-request',
        realmURL: this.#env.realmURL,
        operation: caller.operation,
        route: `${request.method} ${new URL(request.url).pathname}`,
        clientIP: caller.clientIP,
        ...(caller.rateLimitKey ? { rateLimitKey: caller.rateLimitKey } : {}),
        correlationId: request.headers.get(
          X_BOXEL_LOGGING_CORRELATION_ID_HEADER,
        ),
        ...detail,
      }),
    );
  }
}

// Marks the request as having served what its caller asked for (see
// `AnonymousCaller.served`).
export function servedAnonymous(requestContext: RequestContext): void {
  if (requestContext.anonymousCaller) {
    requestContext.anonymousCaller.served = true;
  }
}

function countRefusalResponse(
  requestContext: RequestContext,
  error: OperationError,
): ResponseWithNodeStream {
  return createResponse({
    body: JSON.stringify(errorsDocument(error), null, 2),
    init: {
      status: error.status,
      headers: {
        'content-type': SupportedMimeType.JSONAPI,
        'Retry-After': String(error.meta!.retryAfterSeconds),
        'X-Boxel-Realm-Url': requestContext.realm.url,
      },
    },
    requestContext,
  });
}

// Releases a response that is answered in place of, so a file stream it holds
// is closed rather than left open.
async function discardBody(response: ResponseWithNodeStream): Promise<void> {
  response.nodeStream?.destroy();
  await response.body?.cancel().catch(() => {});
}
