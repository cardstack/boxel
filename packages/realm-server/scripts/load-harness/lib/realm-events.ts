// Subscribe to a realm's index events the way the host does.
//
// The realm server broadcasts `app.boxel.realm-event` into each user's DM
// session room over Matrix, and the host relays what arrives there into its
// live-search resources. A driver that wants to behave like a browser has to
// listen on that channel rather than infer invalidation from its own writes —
// which is the difference between modelling the fan-out and measuring it.
//
// Long-polls `/sync` directly rather than using `matrix-js-sdk`: the harness
// stays dependency-free so it can be copied into a CloudShell session or an
// ECS task and run there.

const REALM_EVENT_TYPE = 'app.boxel.realm-event';

export interface RealmEvent {
  eventName?: string;
  realmURL?: string;
  invalidatedTypes?: unknown;
  [key: string]: unknown;
}

interface SyncResponse {
  next_batch?: string;
  rooms?: {
    invite?: Record<string, unknown>;
    join?: Record<
      string,
      { timeline?: { events?: { type?: string; content?: RealmEvent }[] } }
    >;
  };
}

// Accepts any pending room invites, and reports how many rooms this user is in.
//
// `_realm-auth` creates a DM session room per user and *invites* them to it,
// then broadcasts index events into it. An invited-but-not-joined user receives
// nothing: the room is theirs, they are simply not in it. A browser joins as
// part of its Matrix startup, so a driver has to join explicitly — otherwise it
// sits in silence and reads that as "no events happened", which is the shape of
// a result that looks like a fix working.
export async function joinInvitedRooms({
  matrixUrl,
  accessToken,
}: {
  matrixUrl: string;
  accessToken: string;
}): Promise<{ joined: number; accepted: number }> {
  let base = matrixUrl.replace(/\/$/, '');
  let response = await fetch(`${base}/_matrix/client/v3/sync?timeout=0`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`sync before join failed: ${response.status}`);
  }
  let body = (await response.json()) as SyncResponse;
  let invited = Object.keys(body.rooms?.invite ?? {});
  for (let roomId of invited) {
    let join = await fetch(
      `${base}/_matrix/client/v3/join/${encodeURIComponent(roomId)}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: '{}',
      },
    );
    if (!join.ok) {
      throw new Error(`join ${roomId} failed: ${join.status}`);
    }
  }
  return {
    joined: Object.keys(body.rooms?.join ?? {}).length + invited.length,
    accepted: invited.length,
  };
}

export async function initialSyncToken({
  matrixUrl,
  accessToken,
}: {
  matrixUrl: string;
  accessToken: string;
}): Promise<string> {
  // A one-event timeline limit keeps the first sync small: this call wants the
  // token, not the backlog.
  let filter = encodeURIComponent(
    JSON.stringify({ room: { timeline: { limit: 1 } } }),
  );
  let response = await fetch(
    `${matrixUrl.replace(/\/$/, '')}/_matrix/client/v3/sync?filter=${filter}&timeout=0`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) {
    throw new Error(`initial sync failed: ${response.status}`);
  }
  return ((await response.json()) as SyncResponse).next_batch ?? '';
}

// Calls `onEvent` for every realm event visible to this user until `signal`
// aborts. Errors are reported and retried: a dropped sync is a reconnect, not
// the end of the run.
export async function streamRealmEvents({
  matrixUrl,
  accessToken,
  since,
  signal,
  onEvent,
  onError,
}: {
  matrixUrl: string;
  accessToken: string;
  since: string;
  signal: AbortSignal;
  onEvent: (event: RealmEvent) => void;
  onError?: (e: Error) => void;
}): Promise<void> {
  let token = since;
  while (!signal.aborted) {
    try {
      let url =
        `${matrixUrl.replace(/\/$/, '')}/_matrix/client/v3/sync` +
        `?since=${encodeURIComponent(token)}&timeout=20000`;
      let response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal,
      });
      if (!response.ok) {
        throw new Error(`sync ${response.status}`);
      }
      let body = (await response.json()) as SyncResponse;
      token = body.next_batch ?? token;
      for (let room of Object.values(body.rooms?.join ?? {})) {
        for (let event of room.timeline?.events ?? []) {
          if (event.type === REALM_EVENT_TYPE && event.content) {
            onEvent(event.content);
          }
        }
      }
    } catch (e) {
      if (signal.aborted) {
        return;
      }
      onError?.(e instanceof Error ? e : new Error(String(e)));
      // Back off a moment so a persistent failure does not spin.
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

// Whether an event lets a query skip its re-run.
//
// This mirrors the host's `#indexEventCannotMatch`: an index event names the
// types it invalidated, and a query whose types are disjoint from that set
// cannot have gained or lost a member. Conservative in the same places the host
// is — an event carrying no type information (a realm server that predates the
// field, a full reindex, a pass that failed to report) re-runs unconditionally,
// and so does a query whose types cannot be named.
//
// ONE DIFFERENCE, AND IT DECIDES WHAT A RESULT MEANS. The host resolves a
// query's type keys through its module loader, so a filter that names a type
// through a re-exporting module still matches rows stamped with that type's
// canonical defining-module spelling. The harness has no loader: it compares
// the literal `module/name` the workload file gave it. On a realm whose queries
// name their types directly the two agree. On a realm that filters through a
// re-export, the harness skips where a browser re-runs, and understates the
// traffic. Check which kind of realm you are pointed at before trusting a low
// re-run count.
export function eventCannotMatch(
  event: RealmEvent | undefined,
  queryTypeKeys: Set<string> | undefined,
): boolean {
  if (event?.eventName !== 'index') {
    return true; // not an index event: no membership change to consider
  }
  let types = event.invalidatedTypes;
  if (!Array.isArray(types)) {
    return false; // no type information — re-run, as the host does
  }
  if (!queryTypeKeys || queryTypeKeys.size === 0) {
    return false;
  }
  return !types.some((type) => queryTypeKeys.has(type as string));
}
