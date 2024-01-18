export function createResponse(
  unresolvedRealmURL: string,
  body?: BodyInit | null | undefined,
  init?: ResponseInit | undefined,
  relaxDocumentDomain?: boolean, // only use for CI!
): Response {
  return new Response(body, {
    ...init,
    headers: {
      ...init?.headers,
      'X-Boxel-Realm-Url': unresolvedRealmURL,
      vary: 'Accept',
      'Access-Control-Expose-Headers': 'X-Boxel-Realm-Url,Authorization',
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
