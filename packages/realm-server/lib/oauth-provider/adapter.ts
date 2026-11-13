// Where the OAuth provider keeps what it stores: a table for each kind of
// object the library hands its adapter, each arriving with the work that first
// stores it. A kind with no table yet is refused, never kept in memory, which
// would lose it on restart and differ between the realm server's processes.
// Short-lived objects share `oauth_provider_objects` (`objects.ts`).

import { randomBytes } from 'crypto';
import type { Adapter, AdapterPayload } from 'oidc-provider';
import type { DBAdapter } from '@cardstack/runtime-common';
import { InteractionAdapter } from './objects.ts';

// The ID dynamic client registration gives a client: 24 random bytes in
// base64url, so always 32 characters of that alphabet. A client ID metadata
// document's ID is an `https://` URL, which can never take this form.
const DYNAMIC_CLIENT_ID = /^[A-Za-z0-9_-]{32}$/;

export function newDynamicClientId(): string {
  return randomBytes(24).toString('base64url');
}

export function isDynamicClientId(id: string): boolean {
  return DYNAMIC_CLIENT_ID.test(id);
}

export class OAuthProviderStorageError extends Error {
  name = 'OAuthProviderStorageError';
}

// The library's `adapter` setting: called with each kind's name the first
// time the library stores or finds one of that kind. `interactionResumeURL`
// builds the URL an interaction resumes at, from the issuer.
export function oauthProviderAdapter(
  dbAdapter: DBAdapter,
  {
    interactionResumeURL,
  }: { interactionResumeURL?: (id: string) => string } = {},
): (name: string) => Adapter {
  return function adapterFor(name: string): Adapter {
    switch (name) {
      case 'Client':
        return new DynamicClientAdapter(dbAdapter);
      case 'Interaction':
        if (!interactionResumeURL) {
          break;
        }
        return new InteractionAdapter(dbAdapter, interactionResumeURL);
    }
    throw new OAuthProviderStorageError(
      `the OAuth provider has no storage for ${name}`,
    );
  };
}

// Clients registered by dynamic client registration, in
// `oauth_provider_dynamic_clients`. The library finds a client by its ID and
// stores one once, on registration: never a client identified by a metadata
// document, and never again under the same ID, since registration management
// is off. A second store under an ID fails rather than replacing the client.
// It never consumes a client, and finds none by grant, user code or
// interaction.
//
// The library looks here for every client ID it is sent before it turns to a
// metadata document, so an ID registration could not have given (a metadata
// document's URL, say) is not found without asking the database. No row can
// then stand in for a metadata document, whatever is in the table.
class DynamicClientAdapter implements Adapter {
  #dbAdapter: DBAdapter;

  constructor(dbAdapter: DBAdapter) {
    this.#dbAdapter = dbAdapter;
  }

  async upsert(id: string, payload: AdapterPayload): Promise<void> {
    await this.#dbAdapter.execute(
      `INSERT INTO oauth_provider_dynamic_clients (client_id, metadata)
         VALUES ($1, $2::jsonb)`,
      { bind: [id, JSON.stringify(payload)] },
    );
  }

  async find(id: string): Promise<AdapterPayload | undefined> {
    if (!isDynamicClientId(id)) {
      return undefined;
    }
    let [row] = (await this.#dbAdapter.execute(
      `SELECT metadata FROM oauth_provider_dynamic_clients WHERE client_id = $1`,
      { bind: [id] },
    )) as { metadata: AdapterPayload | string }[];
    if (!row) {
      return undefined;
    }
    return typeof row.metadata === 'string'
      ? (JSON.parse(row.metadata) as AdapterPayload)
      : row.metadata;
  }

  async destroy(id: string): Promise<void> {
    await this.#dbAdapter.execute(
      `DELETE FROM oauth_provider_dynamic_clients WHERE client_id = $1`,
      { bind: [id] },
    );
  }

  async findByUserCode(): Promise<never> {
    throw unused('findByUserCode');
  }

  async findByUid(): Promise<never> {
    throw unused('findByUid');
  }

  async consume(): Promise<never> {
    throw unused('consume');
  }

  async revokeByGrantId(): Promise<never> {
    throw unused('revokeByGrantId');
  }
}

function unused(method: string) {
  return new OAuthProviderStorageError(
    `the OAuth provider's clients have no ${method}`,
  );
}
