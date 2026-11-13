// Which pages a browser may call the provider's client-facing endpoints from
// (`clientBasedCORS`): only a page on the origin of one of the client's
// redirect URIs, and only for a public client. Shared by the library's
// setting and the answers Boxel writes itself on those routes.

export interface CORSClient {
  clientAuthMethod?: string;
  redirectUris?: readonly string[];
}

export function browserOriginAllowed(
  origin: string,
  client: CORSClient,
): boolean {
  return (
    origin !== 'null' &&
    client.clientAuthMethod === 'none' &&
    (client.redirectUris ?? []).some((uri) => URL.parse(uri)?.origin === origin)
  );
}
