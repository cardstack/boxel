import type { RequestContext } from './realm.ts';

interface CreateResponseArgs {
  body?: BodyInit | null | undefined;
  init?: ResponseInit | undefined;
  requestContext: RequestContext;
}

export function createResponse({
  body,
  init,
  requestContext,
}: CreateResponseArgs): Response {
  return new Response(body, {
    ...init,
    headers: {
      ...init?.headers,
      'X-Boxel-Realm-Url': requestContext.realm.url,
      ...(requestContext.permissions['*']?.includes('read') && {
        'X-Boxel-Realm-Public-Readable': 'true',
      }),
      vary: 'Accept',
      // This list is the one that reaches the wire. The realm-server also
      // configures `@koa/cors` with its own Expose-Headers, but the middleware
      // copies a handler's Response headers onto the Koa context wholesale, so
      // whatever is set here replaces rather than merges with it. Anything koa
      // means to expose has to be repeated here or it is silently dropped —
      // which is why `Retry-After` appears below: readiness pairs it with
      // `X-Boxel-Not-Ready` on a 503, and a cross-origin caller that could read
      // the stage but not the retry hint would only have half the answer.
      'Access-Control-Expose-Headers':
        'X-Boxel-Realm-Url,X-Boxel-Realm-Public-Readable,X-Boxel-Realm-Archived,X-Boxel-Canonical-Path,X-Boxel-Not-Ready,Authorization,Cache-Control,ETag,Retry-After',
    },
  });
}
