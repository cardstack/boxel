import { param, query, type DBAdapter } from '@cardstack/runtime-common';
import type { Querier } from '@cardstack/runtime-common/expression';
import { destinationCovers } from '@cardstack/runtime-common/card-operations';
import {
  GOOGLE_TOKEN_ENDPOINT,
  googleTokenEndpoint,
} from './google-service-account.ts';

// Token endpoints are the platform's alone. A key that mints its access
// tokens (an OAuth connection, a `client_credentials` client) sends its
// minting secret — a client secret, a refresh token — only to a token
// endpoint, and only the realm server makes that call. No key is granted a
// destination that covers a token endpoint, so no `callApi` carries a
// credential to one, whatever the declaration says.
//
// The endpoints are the fixed ones below, for credential kinds whose token
// endpoint is the vendor's (Google's, where a service account's signed
// assertion is exchanged), every platform client's, and — for a key that
// mints through a client a person stored — that client's own. Another
// person's client is never consulted: anyone can store a client naming any
// URL as its token endpoint, so their clients fence off nothing for anyone
// else's keys.
export const FIXED_TOKEN_ENDPOINTS: readonly string[] = [GOOGLE_TOKEN_ENDPOINT];

// The fixed endpoints, with the one Google's tokens are minted at now, which
// a test points at a stub.
function fixedTokenEndpoints(): string[] {
  return [...new Set([...FIXED_TOKEN_ENDPOINTS, googleTokenEndpoint()])];
}

export async function tokenEndpointCoveredBy(
  db: DBAdapter | Querier,
  destination: string,
  { keyId }: { keyId?: string } = {},
): Promise<string | undefined> {
  let run = (expression: Parameters<Querier>[0]) =>
    typeof db === 'function' ? db(expression) : query(db, expression);
  let rows = await run([
    `SELECT token_url FROM platform_oauth_clients`,
    ...(keyId
      ? [
          // The key's own client, a connection's client however it is
          // named, or a share's current key's client.
          ` UNION SELECT c.token_url FROM oauth_clients c WHERE c.key_id = `,
          param(keyId),
          ` UNION SELECT c.token_url FROM oauth_connections n
              JOIN oauth_clients c ON c.key_id = n.client_key_id
             WHERE n.key_id = `,
          param(keyId),
          ` UNION SELECT c.token_url FROM oauth_connections n
              JOIN key_shares s ON s.id = n.client_share_id
              JOIN oauth_clients c ON c.key_id = s.key_id
             WHERE n.key_id = `,
          param(keyId),
        ]
      : []),
  ]);
  let endpoints = [
    ...fixedTokenEndpoints(),
    ...rows.map((row) => row.token_url as string),
  ];
  return endpoints.find((endpoint) => destinationCovers(destination, endpoint));
}

// Other addresses where Google exchanges the same signed assertion. They are
// refused as a `callApi`'s address, but never fenced off from grants: a grant
// covering `https://www.googleapis.com/` is how Google's other APIs there are
// reached.
const GOOGLE_TOKEN_ENDPOINT_ALIASES: readonly string[] = [
  'https://www.googleapis.com/oauth2/v4/token',
  'https://accounts.google.com/o/oauth2/token',
];

// The token endpoint a `callApi` is addressed to, if it is one of the
// platform's: the fixed endpoints, Google's other token addresses, and the
// platform's own OAuth clients' token URLs. Such a request is refused before
// it is sent, key or no key. A user's own OAuth client is never consulted: any
// user may store one with any token URL, and a URL one user stores must not
// refuse another user's requests. The check is made on the address the
// operation declares; a redirect from elsewhere is followed by the outbound
// client's own rules, and carries no credential across origins.
export async function tokenEndpointAt(
  db: DBAdapter,
  url: string,
): Promise<string | undefined> {
  let rows = await query(db, [`SELECT token_url FROM platform_oauth_clients`]);
  let endpoints = [
    ...fixedTokenEndpoints(),
    ...GOOGLE_TOKEN_ENDPOINT_ALIASES,
    ...rows.map((row) => row.token_url as string),
  ];
  return endpoints.find((endpoint) => isAt(url, endpoint));
}

function isAt(url: string, endpoint: string): boolean {
  let request: URL;
  let target: URL;
  try {
    request = new URL(url);
    target = new URL(endpoint);
  } catch {
    return false;
  }
  if (request.origin !== target.origin) {
    return false;
  }
  let path = target.pathname.replace(/\/+$/, '');
  return (
    request.pathname === path ||
    request.pathname === `${path}/` ||
    request.pathname.startsWith(`${path}/`)
  );
}
