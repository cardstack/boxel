import { query, type DBAdapter } from '@cardstack/runtime-common';
import type { Querier } from '@cardstack/runtime-common/expression';
import { destinationCovers } from '@cardstack/runtime-common/card-operations';

// Token endpoints are the platform's alone. A key that mints its access
// tokens (an OAuth connection, a `client_credentials` client) sends its
// minting secret — a client secret, a refresh token — only to a token
// endpoint, and only the realm server makes that call. No key is ever granted
// a destination that covers one, so no `callApi` can carry a credential to a
// token endpoint, whatever the declaration says.
//
// The endpoints are the token URL of every OAuth client anyone has stored,
// their own or the platform's, plus the fixed endpoints below for credential
// kinds whose token endpoint is the vendor's and not a client's.
export const FIXED_TOKEN_ENDPOINTS: readonly string[] = [];

export async function tokenEndpointCoveredBy(
  db: DBAdapter | Querier,
  destination: string,
): Promise<string | undefined> {
  let sql = [
    `SELECT token_url FROM oauth_clients UNION SELECT token_url FROM platform_oauth_clients`,
  ];
  let rows = typeof db === 'function' ? await db(sql) : await query(db, sql);
  let endpoints = [
    ...FIXED_TOKEN_ENDPOINTS,
    ...rows.map((row) => row.token_url as string),
  ];
  return endpoints.find((endpoint) => destinationCovers(destination, endpoint));
}
