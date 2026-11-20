// Boxel's own apps, registered in code (ADR 021 §1.4): a fixed client ID, no
// registration endpoint and no table. The library finds them before any
// stored client (its `clients` setting), and consent names each by the name
// listed here, as Boxel's own app.
//
// A client ID here can't be taken by an openly registered client: dynamic
// registration only gives IDs of its own form (`dynamic-client-id.ts`), and a
// client ID metadata document's ID is an `https://` URL.
//
// Every client here is public, so a request naming one could come from any
// program that knows its ID: nothing proves it is Boxel's app. A client that
// runs on the user's computer redirects only to loopback, so its code reaches
// only that computer, and each flow carries a confirmation code the app shows
// and consent repeats, so the user can tell their own sign-in from one
// someone else started and sent them (`confirmation-code.ts`).

import type { ClientMetadata } from 'oidc-provider';

export interface PreRegisteredClient {
  // The library's client metadata, as its `clients` setting takes it.
  metadata: Readonly<ClientMetadata> & {
    client_id: string;
    client_name: string;
  };
  // Where the app runs. An app on the user's own computer (a native client
  // with a loopback redirect) must send a confirmation code with each flow.
  place: 'this-computer';
}

export type PreRegisteredClients = ReadonlyMap<string, PreRegisteredClient>;

export const BOXEL_CLI_CLIENT_ID = 'boxel-cli';

const BOXEL_CLI: PreRegisteredClient = {
  metadata: {
    client_id: BOXEL_CLI_CLIENT_ID,
    client_name: 'Boxel CLI',
    // A native client's loopback redirect matches on any port (RFC 8252
    // §7.3), which the CLI picks when it starts listening.
    application_type: 'native',
    redirect_uris: ['http://127.0.0.1/callback'],
    response_types: ['code'],
    // No device-code grant: the library refuses a client with one while the
    // device flow is off (`provider.ts`).
    grant_types: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_method: 'none',
  },
  place: 'this-computer',
};

export const PRE_REGISTERED_CLIENTS: PreRegisteredClients = byId([BOXEL_CLI]);

function byId(clients: readonly PreRegisteredClient[]): PreRegisteredClients {
  let map = new Map<string, PreRegisteredClient>();
  for (let client of clients) {
    let { client_id } = client.metadata;
    if (map.has(client_id)) {
      throw new Error(`OAuth client ${client_id} is pre-registered twice`);
    }
    map.set(client_id, client);
  }
  return map;
}

// The metadata the library's `clients` setting takes. The library keeps the
// objects it is given, so each is a copy.
export function libraryClients(
  clients: PreRegisteredClients,
): ClientMetadata[] {
  return [...clients.values()].map(({ metadata }) => ({
    ...metadata,
    redirect_uris: [...(metadata.redirect_uris ?? [])],
    response_types: [...(metadata.response_types ?? [])],
    grant_types: [...(metadata.grant_types ?? [])],
  }));
}
