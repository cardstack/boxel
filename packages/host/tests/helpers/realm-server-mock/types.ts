import type { RealmAction } from '@cardstack/runtime-common';

export type EnsureSessionRoom = (
  realmURL: string,
  userId: string,
) => Promise<void> | void;

export type RealmServerMockState = {
  handler: (req: Request) => Promise<Response | null>;
  realmPermissions: Map<string, RealmAction[]>;
  // Realms archived via POST /_archive-realm, keyed by normalized URL. The
  // value carries the archived-at timestamp surfaced by GET /_archived-realms.
  archivedRealms: Map<string, { archivedAt: string }>;
  mountedVirtualNetwork?: unknown;
  ensureSessionRoom?: EnsureSessionRoom;
  // When true, `_realm-auth` responds 503 — used to simulate a trusted realm
  // server that's unreachable during boot assembly.
  failRealmAuth?: boolean;
};

export type RealmServerMockRouteHandler = (
  req: Request,
  url: URL,
  state: RealmServerMockState,
) => Promise<Response | null>;

export type RealmServerMockRoute = {
  path: string;
  handler: RealmServerMockRouteHandler;
};
