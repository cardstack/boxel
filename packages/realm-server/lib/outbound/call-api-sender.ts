import {
  logger,
  type CallApiResponse,
  type DBAdapter,
} from '@cardstack/runtime-common';
import {
  OperationFailure,
  type CallApiCredential,
  type CallApiGrantUse,
  type CallApiRequest,
  type CallApiSender,
} from '@cardstack/runtime-common/card-operations';
import { fillSlots } from '../key-bindings.ts';
import {
  clearGrantRejection,
  credentialRejected,
  DEFAULT_PROBE_INTERVAL_MS,
  emitKeyGrantEvent,
  hostOf,
  markGrantRejected,
  recordVendorForbidden,
} from '../key-grant-rejection.ts';
import { secretsKeyring } from '../secrets-at-rest/index.ts';
import {
  OutboundRefusedError,
  OutboundTimeoutError,
  describeOutboundError,
  outboundFetch,
  sendContext,
} from './client.ts';
import { CredentialScrubber } from './scrubber.ts';
import { scrubError } from './scrub-error.ts';

const log = logger('call-api');

// The response headers a `callApi` hands back to the card. Each describes the
// body, how long it may be kept, or how the vendor asks to be called again;
// none describes the vendor's infrastructure or carries a session. Anything
// else — `set-cookie` above all — stays on the server.
const SAFE_RESPONSE_HEADERS = new Set([
  'cache-control',
  'content-disposition',
  'content-language',
  'content-type',
  'etag',
  'expires',
  'last-modified',
  'link',
  'location',
  'retry-after',
  'www-authenticate',
]);

// The rate-limit headers vendors send, under both the standard names and the
// `x-` spellings most of them still use.
const RATE_LIMIT_HEADER = /^(x-)?ratelimit(-|$)/;

export function safeResponseHeaders(headers: Headers): Record<string, string> {
  let safe: Record<string, string> = {};
  for (let [name, value] of headers) {
    let lower = name.toLowerCase();
    if (SAFE_RESPONSE_HEADERS.has(lower) || RATE_LIMIT_HEADER.test(lower)) {
      safe[lower] = value;
    }
  }
  return safe;
}

// Fills a `callApi` request's slots from the bindings approved for it, and
// sends it through the guarded outbound client.
//
// Each slot is filled from its binding's grant (`lib/key-bindings.ts`), and
// nothing is filled for a slot no binding serves. The request arrives as declared, every credential slot still a token, and
// that is the request the guard checks and every record describes. The
// credentials are filled in by the client after its destination check, are
// registered with the scrubber first so the vendor cannot echo them back, and
// are never carried across a redirect to another origin.
//
// Whatever the vendor answers is the answer: a 404 or a 500 is a response the
// card reads. Only a refusal by the guard, a timeout, or a send that broke
// before any response arrived is a refusal of the operation — and a 401 to a
// request that carried a credential, which rejects the grants it was sent
// under and is refused `credential-rejected` (see `key-grant-rejection.ts`).
export function createCallApiSender(
  dbAdapter: DBAdapter,
  {
    // How long a grant the vendor rejected waits between probes.
    probeIntervalMs = DEFAULT_PROBE_INTERVAL_MS,
  }: { probeIntervalMs?: number } = {},
): CallApiSender {
  return {
    fill: (lookup) =>
      fillSlots(dbAdapter, secretsKeyring, lookup, { probeIntervalMs }),
    send: async (request, credentials) => {
      let grants = grantsOf(credentials);
      let response: CallApiResponse;
      try {
        response = await sendCallApiRequest(request, credentials);
      } catch (error) {
        for (let grant of grants.filter(({ probe }) => probe)) {
          emitKeyGrantEvent({
            event: 'probe',
            grant: grant.id,
            host: hostOf(request.url),
            status: null,
          });
        }
        throw error;
      }
      await actOnVendorAnswer(dbAdapter, request, grants, response.status);
      return response;
    },
  };
}

// The grants a request's credentials were opened under, each once.
function grantsOf(credentials: CallApiCredential[]): CallApiGrantUse[] {
  let grants = new Map<string, CallApiGrantUse>();
  for (let { grant } of credentials) {
    if (grant && !grants.has(grant.id)) {
      grants.set(grant.id, grant);
    }
  }
  return [...grants.values()];
}

// What the vendor's status means for the grants the request was sent under.
// A 401 rejects every one of them: the vendor doesn't say which credential it
// refused, and each was sent to the destination it answered for. A 403 is
// recorded and changes nothing. A probe the vendor answers below 400 clears its
// grant; any other answer leaves it as it was.
async function actOnVendorAnswer(
  dbAdapter: DBAdapter,
  request: CallApiRequest,
  grants: CallApiGrantUse[],
  status: number,
): Promise<void> {
  let host = hostOf(request.url);
  emitKeyGrantEvent({ event: 'vendor-outcome', host, status });
  for (let grant of grants.filter(({ probe }) => probe)) {
    emitKeyGrantEvent({ event: 'probe', grant: grant.id, host, status });
  }
  if (grants.length === 0) {
    return;
  }
  if (status === 401) {
    // The card is told the key was rejected whether or not recording it
    // succeeds; a failure to record only means the next call reaches the
    // vendor and is refused again.
    try {
      for (let grant of grants) {
        await markGrantRejected(dbAdapter, {
          grantId: grant.id,
          realmURL: grant.realmURL,
          ...(grant.shareId ? { shareId: grant.shareId } : {}),
          copy: grant.copy,
        });
      }
    } catch (error) {
      log.error(
        `could not record the vendor's 401 for grants ${grants.map(({ id }) => id).join(', ')}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    throw credentialRejected(undefined, grants[0].slot, grants[0].destination);
  }
  // Neither of these may cost the card the answer it already has.
  try {
    if (status === 403) {
      for (let grant of grants) {
        await recordVendorForbidden(dbAdapter, grant.id, host);
      }
    } else if (status < 400) {
      for (let grant of grants.filter(({ probe }) => probe)) {
        await clearGrantRejection(dbAdapter, grant.id);
      }
    }
  } catch (error) {
    log.error(
      `could not record the vendor's ${status} for grants ${grants.map(({ id }) => id).join(', ')}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function sendCallApiRequest(
  request: CallApiRequest,
  credentials: CallApiCredential[],
): Promise<CallApiResponse> {
  let scrubber = new CredentialScrubber();
  for (let { value, raw } of credentials) {
    scrubber.register(value);
    if (raw !== undefined) {
      scrubber.register(raw);
    }
  }
  let context = sendContext(undefined, request.url);
  try {
    let response = await outboundFetch({
      url: request.url,
      method: request.method,
      headers: request.headers,
      ...(request.body !== undefined ? { body: request.body } : {}),
      sizePath: 'call-api',
      scrubber,
      ...(credentials.length > 0
        ? {
            substitutions: credentials.map(({ token, value }) => ({
              token,
              value,
            })),
          }
        : {}),
    });
    let text = await response.text();
    return {
      status: response.status,
      headers: safeResponseHeaders(response.headers),
      body: bodyOf(text, response.headers.get('content-type')),
    };
  } catch (error) {
    scrubError(error, scrubber);
    throw refusalFor(error, describeOutboundError(error, context));
  }
}

function bodyOf(text: string, contentType: string | null) {
  if (text.length === 0) {
    return null;
  }
  if (contentType && /[/+]json\b/i.test(contentType)) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function refusalFor(error: unknown, described: string): OperationFailure {
  if (error instanceof OutboundRefusedError) {
    log.warn(
      `callApi stopped by the outbound guard: ${error.message} (${described})`,
    );
    return new OperationFailure({
      status: error.reason === 'forbidden-header' ? 400 : 502,
      code: 'guard-refused',
      title: 'Destination refused',
      detail: error.message,
      meta: { reason: error.reason },
    });
  }
  if (error instanceof OutboundTimeoutError) {
    log.warn(`callApi timed out: ${error.message} (${described})`);
    return new OperationFailure({
      status: 504,
      code: 'upstream-timeout',
      title: 'Upstream timeout',
      detail: error.message,
      meta: { phase: error.phase },
    });
  }
  log.error(
    `callApi send failed (${described}): ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  return new OperationFailure({
    status: 502,
    code: 'internal-error',
    title: 'Upstream failed',
    detail: `the request could not be completed: the connection to the destination failed before it answered`,
  });
}
