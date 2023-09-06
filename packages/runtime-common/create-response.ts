export function createResponse(
  unresolvedRealmURL: string,
  body?: BodyInit | null | undefined,
  init?: ResponseInit | undefined,
): Response {
  return new Response(body, {
    ...init,
    headers: {
      ...init?.headers,
      'X-Boxel-Realm-Url': unresolvedRealmURL,
      vary: 'Accept',
      'Access-Control-Expose-Headers': 'X-Boxel-Realm-Url',
    },
  });
}
