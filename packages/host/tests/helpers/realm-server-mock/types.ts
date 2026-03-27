import type { RealmAction } from '@cardstack/runtime-common';

export type EnsureSessionRoom = (
  realmURL: string,
  userId: string,
) => Promise<void> | void;

export type RealmServerMockState = {
  handler: (req: Request) => Promise<Response | null>;
  realmPermissions: Map<string, RealmAction[]>;
  mountedVirtualNetwork?: unknown;
  ensureSessionRoom?: EnsureSessionRoom;
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
