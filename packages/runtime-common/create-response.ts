import { logger } from './log.ts';
import type { RequestContext } from './realm.ts';

const log = logger('realm:error-stacks');

interface CreateResponseArgs {
  body?: BodyInit | null | undefined;
  init?: ResponseInit | undefined;
  requestContext: RequestContext;
  // Whether this response's body depends on the request's `Accept`. Nearly
  // every realm route content-negotiates, so this defaults to true and the
  // response declares `Vary: Accept`.
  //
  // A route whose body is a pure function of its URL passes false, and the
  // header is omitted — not as a micro-optimization but because declaring a
  // `Vary` a response does not honor actively breaks its own caching. A
  // browser cache keeps one stored variant per URL: a request whose `Accept`
  // differs from the stored one both misses AND replaces that entry, so two
  // consumers spelling `Accept` differently evict each other's copy on every
  // request and neither ever reads from cache. For a long-lived `immutable`
  // response that is the difference between zero round-trips and one per
  // page load, per URL.
  varyOnAccept?: boolean;
  // Further request headers this response's body depends on, beyond `Accept`.
  // The same rule decides membership in both directions: a header a route
  // honors has to be listed or a shared cache will treat two representations
  // as one, and a header it ignores must not be, or the list fragments the
  // route's own cache for nothing.
  //
  // A handler cannot set `vary` through `init` — the value is written after
  // the `init` headers are spread, so it would be discarded silently.
  varyOn?: string[];
}

export function createResponse({
  body,
  init,
  requestContext,
  varyOnAccept = true,
  varyOn,
}: CreateResponseArgs): Response {
  let varyMembers = [...(varyOnAccept ? ['Accept'] : []), ...(varyOn ?? [])];
  if (withholdsErrorStacks(init, requestContext)) {
    body = withoutErrorStacks(body, init, requestContext);
  }
  return new Response(body, {
    ...init,
    headers: {
      ...init?.headers,
      'X-Boxel-Realm-Url': requestContext.realm.url,
      ...(requestContext.permissions['*']?.includes('read') && {
        'X-Boxel-Realm-Public-Readable': 'true',
      }),
      // A cache keys on exactly this list, so everything the body turns on
      // belongs in it. A validator that encodes a difference is not a
      // substitute: it keeps a client from *being told* its stale copy is
      // fresh, but it does not stop a cache collapsing two requests that
      // differ only on an unlisted header and answering one with the other's
      // representation. An empty list omits the header entirely rather than
      // sending an empty one.
      ...(varyMembers.length > 0 && { vary: varyMembers.join(', ') }),
      // This list is the one that reaches the wire. The realm-server also
      // configures `@koa/cors` with its own Expose-Headers, but the middleware
      // copies a handler's Response headers onto the Koa context wholesale, so
      // whatever is set here replaces rather than merges with it. Anything koa
      // means to expose has to be repeated here or it is silently dropped —
      // which is why `Retry-After` appears below: readiness pairs it with
      // `X-Boxel-Not-Ready` on a 503, and a cross-origin caller that could read
      // the stage but not the retry hint would only have half the answer.
      // Content-Range/Accept-Ranges must be exposed because the host's auth
      // service worker hands the CORS-filtered Response from its own fetch()
      // straight to the media element via respondWith. A header absent from
      // this list is pruned from that filtered Response, so it is invisible
      // to the player's loading stack, not just to app JS. Content-Length is
      // CORS-safelisted and survives regardless; it is named alongside the
      // pair so the range trio reads as one unit. Content-Disposition carries
      // a served capture's save-as filename, which a host download control
      // reads off a cross-origin capture response.
      'Access-Control-Expose-Headers':
        'X-Boxel-Realm-Url,X-Boxel-Realm-Public-Readable,X-Boxel-Realm-Archived,X-Boxel-Canonical-Path,X-Boxel-Not-Ready,Authorization,Cache-Control,ETag,Retry-After,Content-Range,Accept-Ranges,Content-Length,Content-Disposition',
    },
  });
}

// A server stack names the realm-server's internal file layout, functions and
// dependency versions. A published realm is a public site, so its error
// documents keep that only for a caller it can identify — a verified session,
// such as a signed-in user or the prerender indexing the realm — and for its
// own in-process dispatches. Everyone else (crawlers, link-preview bots,
// scanners) gets the error without it.
function withholdsErrorStacks(
  init: ResponseInit | undefined,
  requestContext: RequestContext,
): boolean {
  return (
    requestContext.realm.isPublished === true &&
    !requestContext.realmInternal &&
    requestContext.authenticatedUser === undefined &&
    (init?.status ?? 200) >= 400
  );
}

function withoutErrorStacks(
  body: BodyInit | null | undefined,
  init: ResponseInit | undefined,
  requestContext: RequestContext,
): BodyInit | null | undefined {
  if (typeof body !== 'string') {
    return body;
  }
  let doc: unknown;
  try {
    doc = JSON.parse(body);
  } catch {
    return body;
  }
  if (
    !doc ||
    typeof doc !== 'object' ||
    !Array.isArray((doc as { errors?: unknown }).errors)
  ) {
    return body;
  }
  let stacks: string[] = [];
  removeStacks((doc as { errors: unknown[] }).errors, stacks);
  if (stacks.length === 0) {
    return body;
  }
  // A 4xx stack only says where the refusal was raised. A 5xx stack is the
  // diagnosis, and the response no longer carries it, so it is logged.
  let status = init?.status ?? 200;
  if (status >= 500) {
    log.error(
      `${status} from ${requestContext.realm.url} answered without its stack:\n${stacks.join('\n\n')}`,
    );
  }
  return JSON.stringify(doc);
}

// Error documents nest stacks at several depths — the error itself, its
// `meta`, each of its `additionalErrors` — so every `stack` key in the tree
// goes.
function removeStacks(value: unknown, stacks: string[]): void {
  if (Array.isArray(value)) {
    for (let item of value) {
      removeStacks(item, stacks);
    }
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  let record = value as Record<string, unknown>;
  if ('stack' in record) {
    if (typeof record.stack === 'string') {
      stacks.push(record.stack);
    }
    delete record.stack;
  }
  for (let child of Object.values(record)) {
    removeStacks(child, stacks);
  }
}
