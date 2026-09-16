import type { RequestContext } from './realm.ts';

interface CreateResponseArgs {
  body?: BodyInit | null | undefined;
  init?: ResponseInit | undefined;
  requestContext: RequestContext;
  // Request headers this response's body depends on, beyond `Accept`. A
  // handler cannot set `vary` through `init` — the value below is written
  // after the `init` headers are spread, so it would be silently discarded —
  // and a caller that leaves this out gets the `Accept`-only default.
  varyOn?: string[];
}

export function createResponse({
  body,
  init,
  requestContext,
  varyOn,
}: CreateResponseArgs): Response {
  return new Response(body, {
    ...init,
    headers: {
      ...init?.headers,
      'X-Boxel-Realm-Url': requestContext.realm.url,
      ...(requestContext.permissions['*']?.includes('read') && {
        'X-Boxel-Realm-Public-Readable': 'true',
      }),
      // `Accept` always: these routes serve different representations of one
      // URL by content type. Anything else a response's body turns on has to
      // join it, because a shared cache keys on exactly this list — a
      // validator that encodes the difference keeps a client from *being told*
      // its stale copy is fresh, but it does not stop a cache from collapsing
      // two requests that differ only on an unlisted header and answering one
      // of them with the other's representation.
      vary: ['Accept', ...(varyOn ?? [])].join(', '),
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
