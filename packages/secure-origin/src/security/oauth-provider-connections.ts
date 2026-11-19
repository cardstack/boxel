// What the Connected apps page asks of Boxel's OAuth provider on the realm
// server (ADR 021 §1.7): the apps connected to the user's account, and ending
// one of those connections. Both go under the window's own session
// (`authorizedRequest`), never the app's, so card code on the app's origin can
// neither read the list nor disconnect anything.
//
// A connection's ID names the grant it ends. It isn't a bearer secret, but it
// is put in the path only encoded, so it can never name another of the realm
// server's routes.

import { authorizedRequest, SecureSessionError } from './session.js';
import type { AppName } from './oauth-provider.ts';

type Config = { realmServerURL: URL };

export interface ConnectionResource {
  id: string;
  name: string;
  // The registry's short labels for the scopes approved there ("Read",
  // "Change").
  labels: string[];
}

export interface Connection {
  id: string;
  app: AppName;
  resources: ConnectionResource[];
  connectedAt: string;
  // Null until one of the connection's tokens has been used.
  lastUsedAt: string | null;
  endsAt: string;
  renewing: boolean;
}

const KINDS = new Set(['pre-registered', 'metadata-document', 'dynamic']);

function malformed(): SecureSessionError {
  return new SecureSessionError(
    502,
    'failed',
    'Something went wrong. Try again.',
  );
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function time(value: unknown): string | undefined {
  let iso = text(value);
  return iso && !Number.isNaN(Date.parse(iso)) ? iso : undefined;
}

function readApp(value: unknown): AppName | undefined {
  let app = record(value);
  let kind = text(app?.kind);
  let shown = text(app?.shown);
  if (!app || !kind || !KINDS.has(kind) || !shown) {
    return undefined;
  }
  let claimedName = text(app.claimedName);
  return {
    kind: kind as AppName['kind'],
    shown,
    verified: app.verified === true,
    ...(claimedName ? { claimedName } : {}),
  };
}

function readResource(value: unknown): ConnectionResource | undefined {
  let resource = record(value);
  let id = text(resource?.id);
  let name = text(resource?.name);
  if (!resource || !id || !name || !Array.isArray(resource.scopes)) {
    return undefined;
  }
  let labels = resource.scopes
    .map((scope) => text(record(scope)?.label))
    .filter((label): label is string => label !== undefined);
  return labels.length > 0 ? { id, name, labels } : undefined;
}

function readConnection(value: unknown): Connection | undefined {
  let connection = record(value);
  if (!connection) {
    return undefined;
  }
  let id = text(connection.id);
  let app = readApp(connection.app);
  let connectedAt = time(connection.connectedAt);
  let endsAt = time(connection.endsAt);
  let lastUsedAt =
    connection.lastUsedAt === null ? null : time(connection.lastUsedAt);
  let resources = Array.isArray(connection.resources)
    ? connection.resources
        .map(readResource)
        .filter((r): r is ConnectionResource => r !== undefined)
    : [];
  if (
    !id ||
    !app ||
    !connectedAt ||
    !endsAt ||
    lastUsedAt === undefined ||
    resources.length === 0
  ) {
    return undefined;
  }
  return {
    id,
    app,
    resources,
    connectedAt,
    lastUsedAt,
    endsAt,
    renewing: connection.renewing === true,
  };
}

// The connections as the page shows them: only the fields it knows, each of
// the type it expects, so nothing else in a response ever reaches the page. A
// connection the page can't read is left out rather than shown in part; a
// body that isn't a list of connections at all is a failure.
export function readConnections(json: unknown): Connection[] {
  let connections = record(json)?.connections;
  if (!Array.isArray(connections)) {
    throw malformed();
  }
  return connections
    .map(readConnection)
    .filter((c): c is Connection => c !== undefined);
}

// The path that ends one connection.
export function connectionPath(id: string): string {
  if (!id) {
    throw new SecureSessionError(400, 'bad-request', 'This link is not valid.');
  }
  return `_oauth-provider/connections/${encodeURIComponent(id)}`;
}

// `GET /_oauth-provider/connections`: the user's live connections.
export async function listConnections(config: Config): Promise<Connection[]> {
  return readConnections(
    await authorizedRequest(config, '_oauth-provider/connections', {
      method: 'GET',
    }),
  );
}

// `DELETE /_oauth-provider/connections/:id`: ends one connection and deletes
// its tokens. The server answers done for a connection of the user's that has
// already ended, and refuses an ID that names none of theirs.
export async function disconnectConnection(
  config: Config,
  id: string,
): Promise<void> {
  await authorizedRequest(config, connectionPath(id), { method: 'DELETE' });
}
