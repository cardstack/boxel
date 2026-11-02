# ADR event-feed remediation

Places where the code does not meet
[ADR event-feed](../event-feed.md)
yet (ADR 001 §1.6). Each entry names a file by its path from the repository
root, in backticks, and the requirement it breaks.

`packages/runtime-common/event-feed.ts`:

- `RealmEventFeed#pathOf` skips every path with an extension, so a change to
  a module a visitor's page loads is never announced. Breaks §1.1.
- Announcements a process has judged but not yet recorded in the store are
  lost when the process dies, and nothing announces a reset for them, since a
  process starting no longer resets the feed. Breaks §1.1 for those writes;
  the write's own response still carries its position.
- No reset is announced when a linked card a grant reads changes; a change to
  the policy card or to a definition its rules name resets the feed. Breaks
  §1.2.
- A card is recorded as readable only when the feed announces it. A card that
  was readable before its realm's feed existed, or that a permission or policy
  change made readable (announced as a reset, not per card), has no record
  until its next change, so its removal or withdrawal before then is not
  announced; a client finds it only on a later reset. Breaks §1.2.
- There are no subscriptions to a `query` operation's results; a page follows
  the whole realm or one card's live channel. Breaks §1.6.
- There is no personal lane, so a subscription whose grant reads `actor()` is
  refused rather than served per caller. Breaks §1.6 and §1.7.

`packages/runtime-common/realm.ts`:

- A host-mode page's server-rendered document carries no feed position the
  page can open from, so a page that reads nothing more opens the feed from
  its head. Breaks §1.1.
- A reset reaches only the live channels this process has open; a channel
  only another process has open misses it until that process resets. Breaks
  §1.2.
- A card that links across realms has no revision, so it is re-read whole
  rather than by revision. Breaks §1.4.
- Grants can't be marked private to keep their reads out of shared caches.
  The flag belongs on `OperationGrant`, which the catalog owns, so it needs a
  paired boxel-catalog change. Breaks §1.4.
- A channel is followed only as a caller who isn't signed in, so a signed-in
  page (operator mode included) can't follow the channel of a card in a realm
  that doesn't open the card to such callers: the stream and the poll answer
  404, and the page hears no messages. Breaks §1.5 for private realms; the
  personal lane (§1.7) is where such a caller would follow it.
- The cacheable poll answers the channel's ordered window only, so a page
  following on the poll, while its stream is down or where streams are
  unavailable, hears no presence and starts without the unexpired messages.
  Breaks §1.6.
- An emit's guard is ordered with a `collect` on the same card only within one
  process: across processes, a message whose guard held can still land after
  another process's `collect` read the channel. Breaks §1.6.
- A transform's `collect` reads only keyed messages from the last five minutes
  (`COLLECT_WINDOW_MS`), not the latest per key however old. A stopgap: the
  window belongs in the `collect` declaration, so an operation that needs
  older messages can say so. Breaks §1.6.

`packages/runtime-common/event-feed-store.ts`:

- The latest message for each key is kept however old, so a channel whose
  keys keep changing (a key per round, per team, per visitor) grows its rows
  without bound, and loading it reads them all. Nothing removes a realm's
  `realm_feeds`, `realm_feed_events` or `realm_feed_visible` rows when the
  realm is deleted, so a realm created again at the same URL continues the old
  feed's epoch and positions, and a page that held the old realm's position
  resumes as though nothing had changed. Breaks §1.3 (a reset means
  revalidate; a new realm is not announced as one).

`packages/host/app/services/event-feed.ts`:

- Follows a card's live channel from each tab on a connection of its own,
  rather than over the browser's one connection. Breaks §1.5.
- Opens one connection per realm rather than one per site at the site's
  mount, and never closes a realm's feed when nothing watches it. Breaks
  §1.5.
- A browser without Web Locks or BroadcastChannel gives each tab its own
  feeds. Breaks §1.5.
- Treats a reset as "re-read everything", relayed as a full index event,
  rather than revalidating what it holds with conditional reads. The relay is
  spread over the time the realm sizes to its audience. Breaks §1.3.
- Ignores the `types` an event names, so every change still re-runs every
  live search. Using them needs the realm-relative keys turned into the keys
  the live-search gate compares, through the site's alias. Departs from the
  SHOULD in §1.1.
- Follows a refresh request only on a host-mode page; a page signed in
  through Matrix never hears one. Breaks §1.8.

The writes a crowd makes (§1.9):

- `packages/runtime-common/card-operations/gate.ts` refuses an operation on a
  card the realm has stored but not yet indexed, because it judges the card by
  its index row. A flow that creates a card and then invokes an operation on
  it waits on indexing. Breaks §1.9.
- `packages/runtime-common/card-operations/client.ts` (`skipIndexWait`) leaves
  waiting to each caller; no declaration can say an operation never waits on
  its index pass. Departs from the SHOULD in §1.9.
- `packages/runtime-common/card-operations/lowering.ts` has no durable
  unordered record: an unordered `emit` always expires. Departs from the SHOULD
  in §1.9.
