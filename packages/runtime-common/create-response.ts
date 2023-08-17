export function createResponse(
  body?: BodyInit | null | undefined,
  init?: ResponseInit | undefined,
): Response {
  return new Response(body, {
    ...init,
    headers: {
      ...init?.headers,
      vary: 'Accept',
    },
  });
}
