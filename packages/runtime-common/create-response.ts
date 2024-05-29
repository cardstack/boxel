import { RequestContext } from './realm';

interface CreateResponseArgs {
  body?: BodyInit | null | undefined;
  init?: ResponseInit | undefined;
  relaxDocumentDomain?: boolean; // only use for CI!
  requestContext: RequestContext;
}

export function createResponse({
  body,
  init,
  relaxDocumentDomain,
  requestContext,
}: CreateResponseArgs): Response {
  return new Response(body, {
    ...init,
    headers: {
      ...init?.headers,
      'X-Boxel-Realm-Url': requestContext.realm.url,
      ...(requestContext.realm.isPublicReadable && {
        'X-Boxel-Realm-Public-Readable': 'true',
      }),
      vary: 'Accept',
      'Access-Control-Expose-Headers':
        'X-Boxel-Realm-Url,X-Boxel-Realm-Public-Readable,Authorization',
      ...(relaxDocumentDomain
        ? {
            // we use this header to permit cross origin communication to
            // support testing via an iframe. This should only ever be used in
            // CI
            // https://developer.chrome.com/blog/immutable-document-domain/#as-a-last-resort-send-the-origin-agent-cluster-0-header
            'Origin-Agent-Cluster': '?0',
          }
        : {}),
    },
  });
}
