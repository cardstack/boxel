import type {
  CoalescedIndexWrite,
  IncrementalIndexEventContent,
  RealmEventContent,
} from '@cardstack/base/matrix-event';

// What a realm keeps of an index completion to build the copies its policy
// watchers are sent (see `realm-event-watcher-queries.ts`). It stays on the
// server: who made each write is what lets a watcher hear only of their own,
// and it is never sent.
export type WatcherCompletion =
  | {
      // A completion that names no cards: a full index, or a realm-wide one
      // whose list the realm doesn't hold.
      kind: 'unnamed';
      indexType: 'full' | 'incremental';
    }
  | ListedWatcherCompletion;

export interface ListedWatcherCompletion {
  kind: 'listed';
  // Everything the pass invalidated, even when the event itself had to go out
  // realm-wide.
  invalidations: string[];
  // The write the event's own `clientRequestId` and `clientAuthored`
  // describe. Absent when the event names none.
  write?: WatcherWrite;
  // Every write a shared pass carried, the announcer's among them. Absent for
  // a pass one write made.
  coalescedWrites?: (CoalescedIndexWrite & { actor: string | undefined })[];
}

export interface WatcherWrite {
  // The matrix user who made the write. Undefined when the realm can't say,
  // which shares the write with nobody.
  actor: string | undefined;
  clientRequestId: string | null;
  clientAuthored?: string[];
}

// What an event alone says of its completion, for one the realm knows nothing
// more about, such as an event bridged in from a worker. It names no writer,
// so its request ids go to nobody.
export function watcherCompletionOf(
  event: RealmEventContent,
): WatcherCompletion | undefined {
  if (event.eventName !== 'index') {
    return undefined;
  }
  if (event.indexType === 'full') {
    return { kind: 'unnamed', indexType: 'full' };
  }
  if (event.indexType !== 'incremental') {
    return undefined;
  }
  if ('realmWide' in event) {
    return { kind: 'unnamed', indexType: 'incremental' };
  }
  return { kind: 'listed', invalidations: event.invalidations };
}

// One watcher's copy of a listed completion, given the cards the policy lets
// them read. Undefined when they are sent nothing.
//
// The copy is assembled from an allowlist, so a member added to the event
// later never reaches a watcher by default. Another writer's request id never
// goes in: a host's id can carry private context, such as the room an
// assistant's write came from. Nor does whether another writer sent a card's
// content verbatim. See `ownRequestIds` for what the watcher's own writes
// carry.
//
// A copy naming no card is sent only when it carries the watcher's own
// request id, which tells them their own write landed. Otherwise an empty
// event would itself say that something they cannot read changed.
export function watcherListedCopy(
  completion: ListedWatcherCompletion,
  watcher: string,
  readable: string[],
  realmURL: string,
): IncrementalIndexEventContent | undefined {
  let ids = ownRequestIds(completion, watcher, readable);
  if (readable.length === 0 && !ids.ownsAnId) {
    return undefined;
  }
  return {
    eventName: 'index',
    indexType: 'incremental',
    invalidations: readable,
    ...ids.members,
    realmURL,
  };
}

// The request-id members of a watcher's copy, which take a shape that depends
// only on the watcher's own writes, so it never says whether another write
// shared the pass. One write of theirs goes in as `clientRequestId` with
// `clientAuthored`; several go in as `coalescedWrites` holding only theirs.
// Either way each write's authored cards are always stated, narrowed to
// `readable`, and leave out any card another write in the pass also changed,
// so the host re-reads that card rather than keep its own copy over the other
// write. A write that made no report of what it authored is stated as
// authoring every readable card it changed, or, where the realm doesn't say
// which those are, every readable card, which is what an absent report means.
// A write with no request id is left out: a host has nothing to match it by.
export function ownRequestIds(
  completion: ListedWatcherCompletion,
  watcher: string,
  readable: string[],
): {
  members: Pick<
    IncrementalIndexEventContent,
    'clientRequestId' | 'clientAuthored' | 'coalescedWrites'
  >;
  ownsAnId: boolean;
} {
  let isOwn = (actor: string | undefined) => actor === watcher;
  let readableSet = new Set(readable);
  let foreign = (completion.coalescedWrites ?? []).filter(
    ({ actor }) => !isOwn(actor),
  );
  let changedByOthers: Set<string> | null = foreign.some(
    ({ changed }) => changed === null,
  )
    ? null
    : new Set(foreign.flatMap(({ changed }) => changed ?? []));
  let authoredByWatcher = (urls: string[]) =>
    urls.filter(
      (url) =>
        readableSet.has(url) &&
        changedByOthers !== null &&
        !changedByOthers.has(url),
    );

  // Each of the watcher's writes once, by request id. The event's own write
  // appears among a shared pass's writes too, where the realm also says which
  // cards it changed.
  let own = new Map<
    string,
    { changed: string[] | null | undefined; clientAuthored?: string[] }
  >();
  let { write } = completion;
  if (
    write &&
    isOwn(write.actor) &&
    typeof write.clientRequestId === 'string'
  ) {
    own.set(write.clientRequestId, {
      changed: undefined,
      clientAuthored: write.clientAuthored,
    });
  }
  for (let entry of completion.coalescedWrites ?? []) {
    if (isOwn(entry.actor) && typeof entry.clientRequestId === 'string') {
      own.set(entry.clientRequestId, {
        changed: entry.changed,
        clientAuthored: entry.clientAuthored,
      });
    }
  }
  let authored = ({
    changed,
    clientAuthored,
  }: {
    changed: string[] | null | undefined;
    clientAuthored?: string[];
  }) => authoredByWatcher(clientAuthored ?? changed ?? readable);

  if (own.size === 0) {
    return { members: {}, ownsAnId: false };
  }
  if (own.size === 1) {
    let [[clientRequestId, ownWrite]] = [...own];
    return {
      members: { clientRequestId, clientAuthored: authored(ownWrite) },
      ownsAnId: true,
    };
  }
  return {
    members: {
      coalescedWrites: [...own].map(([clientRequestId, ownWrite]) => ({
        clientRequestId,
        changed: ownWrite.changed
          ? ownWrite.changed.filter((url) => readableSet.has(url))
          : null,
        clientAuthored: authored(ownWrite),
      })),
    },
    ownsAnId: true,
  };
}
