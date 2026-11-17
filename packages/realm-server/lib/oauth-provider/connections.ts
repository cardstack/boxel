// Connected apps (ADR 021 §1.9): the routes the secure origin's page calls to
// list the apps connected to the user's account, and to disconnect one. A
// connection is one OAuth grant (`grants.ts`), and disconnecting it ends that
// grant alone: two connections of the same app are ended apart.
//
// Both routes are behind the check consent is behind (`secure-window-user.ts`),
// and answer only for the signed-in user's own live grants: those that pass
// the grant checks (`GRANT_USABLE`). The list shows the live grants whose code
// has been exchanged; the disconnect ends any live grant, which also stops a
// code not yet exchanged. A grant ID naming anyone else's grant, or one that
// isn't live, is answered as unknown.
//
// What the access means comes from the registry, and the app's name from
// `appName`, as consent named it for a client identified by a metadata
// document or one that registered itself. A pre-registered client is shown by
// its client ID until pre-registered clients carry a name this list can read:
// none is registered yet (ADR 021's remediation lists the gap).

import type Koa from 'koa';
import type { DBAdapter } from '@cardstack/runtime-common';
import { OAUTH_PROVIDER_PATH } from '../request-telemetry.ts';
import { appName, type AppName } from './app-name.ts';
import { endGrant, GRANT_USABLE } from './grants.ts';
import type { OAuthResource } from './registry.ts';
import {
  respond,
  secureWindowUser,
  type SecureWindowDeps,
} from './secure-window-user.ts';

export const OAUTH_CONNECTIONS_PATH = `${OAUTH_PROVIDER_PATH}/connections`;

// One connection, as `GET /_oauth-provider/connections` lists it.
export interface Connection {
  // The grant's ID, which `DELETE /_oauth-provider/connections/:grantId`
  // takes. It is no bearer secret (ADR 021 §1.2): it ends a grant only under
  // its owner's secure window session.
  id: string;
  app: AppName;
  // Each resource the grant reaches, and the scopes approved there, with the
  // registry's short name and labels the page joins ("Read and change").
  resources: {
    id: string;
    name: string;
    scopes: { name: string; label: string }[];
  }[];
  // When the user consented.
  connectedAt: string;
  // When one of its tokens was last accepted at a resource, to the
  // granularity the lookup records it (`lookup.ts`); null when never.
  lastUsedAt: string | null;
  // When it ends unless the user disconnects it first.
  endsAt: string;
  // Whether the user chose to keep it (ADR 021 §1.9).
  renewing: boolean;
}

// The body of `GET /_oauth-provider/connections`.
export interface ConnectionsResponse {
  connections: Connection[];
}

export interface ConnectionsDeps extends SecureWindowDeps {
  registry: readonly OAuthResource[];
  preRegistered: ReadonlySet<string>;
}

interface ConnectionRow {
  id: string;
  client_id: string;
  client_name: string | null;
  redirect_uri: string | null;
  resources: Record<string, string[]> | string;
  renewing: boolean;
  created: string | number;
  last_used: string | number | null;
  expires: string | number;
}

// A user's live connections, newest first. A grant is listed while it is
// usable, by the same checks the token endpoint and the resources apply
// (`GRANT_USABLE`), and only once the app holds a token of it that
// hasn't expired. A grant whose flow was abandoned before its code was
// exchanged holds none, so the app never connected. A connection's tokens
// last until its grant expires (a renewing grant's refresh token, a
// non-renewing grant's access token), and are deleted early only when the
// grant ends.
export async function listConnections(
  dbAdapter: DBAdapter,
  { registry, preRegistered }: Omit<ConnectionsDeps, keyof SecureWindowDeps>,
  matrixUserId: string,
): Promise<Connection[]> {
  let rows = (await dbAdapter.execute(
    `SELECT g.id, g.client_id, g.redirect_uri, g.resources, g.renewing,
            c.metadata->>'client_name' AS client_name,
            extract(epoch FROM g.created_at) AS created,
            extract(epoch FROM g.last_used_at) AS last_used,
            extract(epoch FROM g.expires_at) AS expires
       FROM oauth_provider_grants AS g
       JOIN users AS u ON u.id = g.user_id
       LEFT JOIN oauth_provider_dynamic_clients AS c
         ON c.client_id = g.client_id
      WHERE u.matrix_user_id = $1
        AND ${GRANT_USABLE}
        AND EXISTS (
          SELECT 1 FROM oauth_provider_tokens AS t
           WHERE t.grant_id = g.id AND t.expires_at > now()
        )
      ORDER BY g.created_at DESC, g.id`,
    { bind: [matrixUserId] },
  )) as unknown as ConnectionRow[];
  return rows.map((row) => ({
    id: row.id,
    app: appName({
      clientId: row.client_id,
      clientName: row.client_name ?? undefined,
      redirectUri: row.redirect_uri ?? undefined,
      preRegistered,
    }),
    resources: describeResources(registry, row.resources),
    connectedAt: isoTime(row.created),
    lastUsedAt: row.last_used == null ? null : isoTime(row.last_used),
    endsAt: isoTime(row.expires),
    renewing: row.renewing,
  }));
}

// The grant's resources as the registry names them, in the order the grant
// holds them, each scope in the registry's order. The registry can change
// between deployments, never while the server runs; a resource or scope it
// no longer declares is still shown, by its identifier, so no access the
// grant holds is left off the page.
function describeResources(
  registry: readonly OAuthResource[],
  stored: ConnectionRow['resources'],
): Connection['resources'] {
  let resources = (
    typeof stored === 'string' ? JSON.parse(stored) : stored
  ) as Record<string, string[]>;
  return Object.entries(resources).map(([id, approved]) => {
    let entry = registry.find((resource) => resource.id === id);
    let declared = (entry?.scopes ?? []).filter(({ name }) =>
      approved.includes(name),
    );
    let undeclared = approved.filter(
      (name) => !declared.some((scope) => scope.name === name),
    );
    return {
      id,
      name: entry?.name ?? id,
      scopes: [
        ...declared.map(({ name, label }) => ({ name, label })),
        ...undeclared.map((name) => ({ name, label: name })),
      ],
    };
  });
}

function isoTime(epochSeconds: string | number): string {
  return new Date(Number(epochSeconds) * 1000).toISOString();
}

// `GET /_oauth-provider/connections`.
export function connectionsListHandler(deps: ConnectionsDeps): Koa.Middleware {
  return async function handleConnectionsList(ctxt) {
    let user = await secureWindowUser(ctxt, deps);
    if (!user) {
      return;
    }
    let body: ConnectionsResponse = {
      connections: await listConnections(deps.dbAdapter, deps, user),
    };
    respond(ctxt, 200, body);
  };
}

// `DELETE /_oauth-provider/connections/:grantId`: ends the grant, with reason
// `user`, and deletes its tokens, so the app's next request with any of them
// is refused. Answers 204, or 404 when the ID names no live grant of the
// user's, whoever's it is.
export function connectionsDisconnectHandler(
  deps: ConnectionsDeps,
): Koa.Middleware {
  return async function handleConnectionsDisconnect(ctxt) {
    let user = await secureWindowUser(ctxt, deps);
    if (!user) {
      return;
    }
    let ended = await endGrant(deps.dbAdapter, ctxt.params.grantId, 'user', {
      owner: user,
    });
    if (!ended) {
      return respond(ctxt, 404, { error: 'not-found' });
    }
    respond(ctxt, 204, undefined);
  };
}
