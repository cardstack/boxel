import { query, type DBAdapter } from '@cardstack/runtime-common';
import type { Querier } from '@cardstack/runtime-common/expression';
import { destinationCovers } from '@cardstack/runtime-common/card-operations';
import {
  GOOGLE_TOKEN_ENDPOINT,
  googleTokenEndpoint,
} from './google-service-account.ts';

// Token endpoints are the platform's alone. A key that mints its access
// tokens (an OAuth connection, a `client_credentials` client) sends its
// minting secret — a client secret, a refresh token — only to a token
// endpoint, and only the realm server makes that call. No key is ever granted
// a destination that covers one, so no `callApi` can carry a credential to a
// token endpoint, whatever the declaration says.
//
// The endpoints are the token URL of every OAuth client anyone has stored,
// their own or the platform's, plus the fixed endpoints below for credential
// kinds whose token endpoint is the vendor's and not a client's: Google's,
// where a service account's signed assertion is exchanged.
export const FIXED_TOKEN_ENDPOINTS: readonly string[] = [GOOGLE_TOKEN_ENDPOINT];

// The fixed endpoints, with the one Google's tokens are minted at now, which
// a test points at a stub.
function fixedTokenEndpoints(): string[] {
  return [...new Set([...FIXED_TOKEN_ENDPOINTS, googleTokenEndpoint()])];
}

export async function tokenEndpointCoveredBy(
  db: DBAdapter | Querier,
  destination: string,
): Promise<string | undefined> {
  let sql = [
    `SELECT token_url FROM oauth_clients UNION SELECT token_url FROM platform_oauth_clients`,
  ];
  let rows = typeof db === 'function' ? await db(sql) : await query(db, sql);
  let endpoints = [
    ...fixedTokenEndpoints(),
    ...rows.map((row) => row.token_url as string),
  ];
  return endpoints.find((endpoint) => destinationCovers(destination, endpoint));
}

// The token endpoint a request is addressed to, if it is one. A request is at
// an endpoint when it has the endpoint's origin and its path is the
// endpoint's, or beneath it; the query string never matters. So a `callApi`
// with no key at all is refused there too, and nothing but the platform
// posts to a token endpoint.
export async function tokenEndpointAt(
  db: DBAdapter,
  url: string,
): Promise<string | undefined> {
  let rows = await query(db, [
    `SELECT token_url FROM oauth_clients UNION SELECT token_url FROM platform_oauth_clients`,
  ]);
  let endpoints = [
    ...fixedTokenEndpoints(),
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
