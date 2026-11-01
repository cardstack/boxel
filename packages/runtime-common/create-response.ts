import type { RequestContext } from './realm.ts';

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
  if (withholdsErrorStacks(init?.status ?? 200, requestContext)) {
    body = withoutErrorStacks(body);
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
      // Boxel-Feed-Position is where a page opens a realm's event feed from
      // (ADR 023 §1.1).
      'Access-Control-Expose-Headers':
        'X-Boxel-Realm-Url,X-Boxel-Realm-Public-Readable,X-Boxel-Realm-Archived,X-Boxel-Canonical-Path,X-Boxel-Not-Ready,Authorization,Cache-Control,ETag,Retry-After,Content-Range,Accept-Ranges,Content-Length,Content-Disposition,Boxel-Feed-Position',
    },
  });
}

// A server stack names the realm-server's internal file layout, functions and
// dependency versions. A published realm is a public site, so it shows stacks
// only to a caller it can identify — any session the realm-server signed, such
// as a signed-in Boxel user or the prerender indexing the realm — and to its
// own in-process dispatches. On a public realm a token is checked only for its
// signature, so a session minted for another realm, or one revoked but not yet
// expired, still counts: the line is between Boxel accounts and everyone else.
// Everyone else (crawlers, link-preview bots, scanners) gets errors without
// them, and that holds wherever a stack would reach the body: an error
// response, or a stored error a 200 reports (`_indexing-errors`). The withheld
// stack is not lost: an errored card's is kept in its index entry, and a
// handler's unexpected exception is logged by the router.
export function withholdsStacksFrom(requestContext: RequestContext): boolean {
  return (
    requestContext.realm.isPublished === true &&
    !requestContext.realmInternal &&
    requestContext.authenticatedUser === undefined
  );
}

export function withholdsErrorStacks(
  status: number,
  requestContext: RequestContext,
): boolean {
  return status >= 400 && withholdsStacksFrom(requestContext);
}

function withoutErrorStacks(
  body: BodyInit | null | undefined,
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
  return removeStacks((doc as { errors: unknown[] }).errors)
    ? JSON.stringify(doc)
    : body;
}

// Error documents nest stacks at several depths — the error itself, its
// `meta`, each of its `additionalErrors` — so every `stack` key in the tree
// goes. Answers whether any was there.
export function removeStacks(value: unknown): boolean {
  if (Array.isArray(value)) {
    let removed = false;
    for (let item of value) {
      removed = removeStacks(item) || removed;
    }
    return removed;
  }
  if (!value || typeof value !== 'object') {
    return false;
  }
  let record = value as Record<string, unknown>;
  let removed = false;
  if ('stack' in record) {
    delete record.stack;
    removed = true;
  }
  for (let child of Object.values(record)) {
    removed = removeStacks(child) || removed;
  }
  return removed;
}
