import { RequestContext } from './realm';

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
      'Access-Control-Expose-Headers':
        'X-Boxel-Realm-Url,X-Boxel-Realm-Public-Readable,Authorization',
    },
  });
}
