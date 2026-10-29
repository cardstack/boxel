import { param, query, type DBAdapter } from '@cardstack/runtime-common';
import type { Querier } from '@cardstack/runtime-common/expression';
import { destinationCovers } from '@cardstack/runtime-common/card-operations';

// Token endpoints are the platform's alone. A key that mints its access
// tokens (an OAuth connection, a `client_credentials` client) sends its
// minting secret — a client secret, a refresh token — only to a token
// endpoint, and only the realm server makes that call. No key is granted a
// destination that covers a token endpoint, so no `callApi` carries a
// credential to one, whatever the declaration says.
//
// The endpoints are the fixed ones below, for credential kinds whose token
// endpoint is the vendor's, every platform client's, and — for a key that
// mints through a client a person stored — that client's own. Another
// person's client is never consulted: anyone can store a client naming any
// URL as its token endpoint, so their clients fence off nothing for anyone
// else's keys.
export const FIXED_TOKEN_ENDPOINTS: readonly string[] = [];

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
    ...FIXED_TOKEN_ENDPOINTS,
    ...rows.map((row) => row.token_url as string),
  ];
  return endpoints.find((endpoint) => destinationCovers(destination, endpoint));
}
