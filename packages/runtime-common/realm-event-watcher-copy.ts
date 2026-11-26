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
// content verbatim. The watcher's own writes go in narrowed to what they may
// read, so their host recognises its own write, and a card another writer
// also changed in the pass is taken out of what theirs authored, so their
// host re-reads it rather than keep its own copy over the other write.
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

// The request-id members of a watcher's copy: the event's own
// `clientRequestId` and `clientAuthored` when the watcher made that write, and
// `coalescedWrites` holding only their own entries, each narrowed to the
// cards in `readable`.
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

  let members: Pick<
    IncrementalIndexEventContent,
    'clientRequestId' | 'clientAuthored' | 'coalescedWrites'
  > = {};
  let ownsAnId = false;
  let { write } = completion;
  if (write && isOwn(write.actor)) {
    members.clientRequestId = write.clientRequestId;
    if (write.clientAuthored) {
      members.clientAuthored = authoredByWatcher(write.clientAuthored);
    }
    ownsAnId ||= typeof write.clientRequestId === 'string';
  }
  let own = (completion.coalescedWrites ?? []).filter(({ actor }) =>
    isOwn(actor),
  );
  if (own.length > 0) {
    members.coalescedWrites = own.map(
      ({ clientRequestId, changed, clientAuthored }) => ({
        clientRequestId,
        changed: changed ? changed.filter((url) => readableSet.has(url)) : null,
        // Stated even where the write made no report once another writer
        // shared the pass: absent, a host would read every card in `changed`
        // as this write's own content, including one the other writer also
        // changed.
        ...(clientAuthored || foreign.length > 0
          ? {
              clientAuthored: authoredByWatcher(
                clientAuthored ?? changed ?? [],
              ),
            }
          : {}),
      }),
    );
    ownsAnId ||= own.some(
      ({ clientRequestId }) => typeof clientRequestId === 'string',
    );
  }
  return { members, ownsAnId };
}
