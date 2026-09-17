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
}

export function createResponse({
  body,
  init,
  requestContext,
  varyOnAccept = true,
}: CreateResponseArgs): Response {
  return new Response(body, {
    ...init,
    headers: {
      ...init?.headers,
      'X-Boxel-Realm-Url': requestContext.realm.url,
      ...(requestContext.permissions['*']?.includes('read') && {
        'X-Boxel-Realm-Public-Readable': 'true',
      }),
      ...(varyOnAccept && { vary: 'Accept' }),
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
      // pair so the range trio reads as one unit.
      'Access-Control-Expose-Headers':
        'X-Boxel-Realm-Url,X-Boxel-Realm-Public-Readable,X-Boxel-Realm-Archived,X-Boxel-Canonical-Path,X-Boxel-Not-Ready,Authorization,Cache-Control,ETag,Retry-After,Content-Range,Accept-Ranges,Content-Length',
    },
  });
}
