// Where the OAuth provider keeps what it stores: a table for each kind of
// object the library hands its adapter, each arriving with the work that first
// stores it. Clients registered dynamically and grants have tables of their
// own. A kind with no table yet is refused, never kept in memory, which
// would lose it on restart and differ between the realm server's processes.
// Short-lived objects (interactions, sessions, authorization and device codes) share
// `oauth_provider_objects` (`objects.ts`); access and refresh tokens are in
// `oauth_provider_tokens` (`tokens.ts`).

import Provider, { type Adapter, type AdapterPayload } from 'oidc-provider';
import type { DBAdapter } from '@cardstack/runtime-common';
import {
  endGrant,
  GRANT_STATE_COLUMNS,
  grantUsable,
  type GrantState,
} from './grants.ts';
import {
  asRecord,
  AuthorizationCodeAdapter,
  DeviceCodeAdapter,
  InteractionAdapter,
  OAuthProviderAdapter,
  SessionAdapter,
} from './objects.ts';
import { grantEndReasonOnRoute, TokenAdapter } from './tokens.ts';
import { isDynamicClientId } from './dynamic-client-id.ts';

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
      case 'Session':
        return new SessionAdapter(dbAdapter);
      case 'AuthorizationCode':
        return new AuthorizationCodeAdapter(dbAdapter);
      case 'DeviceCode':
        return new DeviceCodeAdapter(dbAdapter);
      case 'AccessToken':
      case 'RefreshToken':
        return new TokenAdapter(dbAdapter, name);
      case 'Grant':
        return new GrantAdapter(dbAdapter);
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
// The daily cleanup deletes a client nothing has used for a while
// (`cleanup.ts`); it is not found from then on, and has to register again.
//
// The library looks here for every client ID it is sent before it turns to a
// metadata document, so an ID registration could not have given (a metadata
// document's URL, say) is not found without asking the database. No row can
// then stand in for a metadata document, whatever is in the table.
class DynamicClientAdapter extends OAuthProviderAdapter {
  #dbAdapter: DBAdapter;

  constructor(dbAdapter: DBAdapter) {
    super('clients');
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
    return row ? (asRecord(row.metadata) as AdapterPayload) : undefined;
  }

  async destroy(id: string): Promise<void> {
    await this.#dbAdapter.execute(
      `DELETE FROM oauth_provider_dynamic_clients WHERE client_id = $1`,
      { bind: [id] },
    );
  }
}

interface GrantRow extends GrantState {
  user_id: string;
  client_id: string;
  // The approved scopes by resource, as JSON or already parsed.
  resources: string | Record<string, string[]>;
  created: number | string;
  expires: number | string;
}

// The OAuth grants, in `oauth_provider_grants` (`grants.ts`). Boxel creates
// every grant itself when a flow finishes. The library saves one only in its
// development pages, which are off, so a grant the library tries to save is
// refused. It finds a grant that has neither ended nor expired, as the
// library's own payload: the user as `accountId`, and each resource's scopes
// as one space-separated string.
//
// Every code and refresh exchange reads its grant here, so this is where the
// token endpoint applies the grant checks (ADR 021 §1.5): a grant that has
// ended or expired is missing, and so is one created at or before the user's
// OAuth grants were last revoked, which is ended then (`sessions-revoked`).
// The revocation itself ends every grant it covers, so that last case is
// only a grant whose consent came before the revocation and whose flow
// finished after it.
//
// When the library revokes a grant, after a code or refresh token is used
// again, it is ended, not deleted: its row stays, with why it ended.

class GrantAdapter extends OAuthProviderAdapter {
  #dbAdapter: DBAdapter;

  constructor(dbAdapter: DBAdapter) {
    super('grants');
    this.#dbAdapter = dbAdapter;
  }

  async find(id: string): Promise<AdapterPayload | undefined> {
    let [row] = (await this.#dbAdapter.execute(
      `SELECT g.user_id, g.client_id, g.resources,
              floor(extract(epoch FROM g.created_at)) AS created,
              floor(extract(epoch FROM g.expires_at)) AS expires,
              ${GRANT_STATE_COLUMNS}
         FROM oauth_provider_grants AS g
         JOIN users AS u ON u.id = g.user_id
         WHERE g.id = $1`,
      { bind: [id] },
    )) as unknown as GrantRow[];
    if (!row || !(await grantUsable(this.#dbAdapter, id, row))) {
      return undefined;
    }
    let resources = asRecord(row.resources) as Record<string, string[]>;
    return {
      jti: id,
      kind: 'Grant',
      iat: Number(row.created),
      exp: Number(row.expires),
      accountId: row.user_id,
      clientId: row.client_id,
      resources: Object.fromEntries(
        Object.entries(resources).map(([resource, scopes]) => [
          resource,
          scopes.join(' '),
        ]),
      ),
    } as AdapterPayload;
  }

  async upsert(): Promise<never> {
    throw new OAuthProviderStorageError(
      `the OAuth provider's grants are created only when a flow finishes`,
    );
  }

  async destroy(id: string): Promise<void> {
    let reason = grantEndReasonOnRoute(Provider.ctx?.oidc?.route);
    if (!reason) {
      throw new OAuthProviderStorageError(
        `the OAuth provider ends a grant only on a reuse or a client's revocation`,
      );
    }
    await endGrant(this.#dbAdapter, id, reason);
  }
}
