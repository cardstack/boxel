import type { RealmAction } from '@cardstack/runtime-common';

export type EnsureSessionRoom = (
  realmURL: string,
  userId: string,
) => Promise<void> | void;

export type RealmServerMockState = {
  handler: (req: Request) => Promise<Response | null>;
  realmPermissions: Map<string, RealmAction[]>;
  // Realms anyone may read that the test user has no permission row of their
  // own for, keyed by normalized URL, with the display name `/_public-realms`
  // reports. `_realm-auth` leaves them out when asked with
  // `include-public=false`, as the real endpoint does.
  publicReadableRealms: Map<string, { name: string | null }>;
  // Realms archived via POST /_archive-realm, keyed by normalized URL. The
  // value carries the archived-at timestamp surfaced by GET /_archived-realms.
  archivedRealms: Map<string, { archivedAt: string }>;
  // The rooms `/_realm-event-rooms` answers with, keyed by normalized realm
  // URL. Empty unless a test sets one, so the host joins no room and every
  // realm's events keep arriving in its session room.
  realmEventRooms: Map<string, string>;
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
