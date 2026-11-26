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
// someone else started and sent them (the secure origin's
// `security/confirmation-code.js`).
//
// Only a client here may use device sign-in (RFC 8628; ADR 021 §1.4), and only
// one whose grant types list it. Its tokens go to whichever computer holds the
// device code, not this one: the user code, which the user reads from their
// terminal and types into the secure origin's `device` page, stands in for the
// confirmation code (`device.ts`).

import type { ClientMetadata } from 'oidc-provider';

// The device authorization grant's type (RFC 8628 §3.4).
export const DEVICE_CODE_GRANT_TYPE =
  'urn:ietf:params:oauth:grant-type:device_code';

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
    // Device sign-in, for a terminal with no browser (`device.ts`).
    grant_types: [
      'authorization_code',
      'refresh_token',
      DEVICE_CODE_GRANT_TYPE,
    ],
    token_endpoint_auth_method: 'none',
  },
  place: 'this-computer',
};

export const PRE_REGISTERED_CLIENTS: PreRegisteredClients = byId([BOXEL_CLI]);

// The pre-registered client a device authorization request names, when it may
// use device sign-in.
export function deviceFlowClient(
  clients: PreRegisteredClients,
  clientId: string | undefined,
): PreRegisteredClient | undefined {
  let client = clientId === undefined ? undefined : clients.get(clientId);
  return client?.metadata.grant_types?.includes(DEVICE_CODE_GRANT_TYPE)
    ? client
    : undefined;
}

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

// The metadata the library's `clients` setting takes. The library stores a
// clone of each entry, never the entry itself.
export function libraryClients(
  clients: PreRegisteredClients,
): ClientMetadata[] {
  return [...clients.values()].map(({ metadata }) => metadata);
}
