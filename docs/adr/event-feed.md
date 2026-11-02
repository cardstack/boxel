---
status: proposed
date: 2026-11-01
scope:
  - packages/runtime-common/realm.ts
  - packages/runtime-common/event-feed.ts
  - packages/runtime-common/event-feed-store.ts
  - packages/runtime-common/capability-token.ts
  - packages/runtime-common/anonymous-admission.ts
  - packages/runtime-common/card-operations/lowering.ts
  - packages/runtime-common/card-operations/dispatch.ts
  - packages/runtime-common/card-operations/gate.ts
  - packages/runtime-common/card-operations/client.ts
  - packages/realm-server/lib/realm-feed-events-listener.ts
  - packages/realm-server/node-realm.ts
  - packages/realm-server/tests/event-feed-test.ts
  - packages/host/app/services/message-service.ts
  - packages/host/app/services/event-feed.ts
  - packages/host/app/lib/live-card-context.ts
---

# Push realm changes to visitors as policy-filtered, cacheable HTTP invalidations

A visitor who isn't signed in has no Matrix account, so the realm events that
keep a signed-in host live never reach them. Each realm gives that audience an
event feed of invalidations. An event says what changed, never what it
changed to. The realm filters each event by its policy once, where the event
is produced, and serves the feed over plain HTTP, so a CDN can answer a crowd.
Cards also get live channels: messages that named operations emit, that the
realm writes nowhere, and that a personal lane can keep to one caller. The
design target is a ticket on-sale, with millions of readers and no
per-reader state at the origin.

## 1. Decision

### 1.1. Events

A realm MUST give each change a position in a per-realm sequence that only
increases. It MUST store the position, with its epoch, where every process
serving the realm reads it. It MUST announce a change as `written` when the
write lands, and as `indexed`, with the revision to re-read, for each card an
index pass changes. An event MUST name only the path, kind and position, and
metadata relative to the realm. It MUST NOT carry content, an actor,
parameters or an absolute URL. Only a channel message carries a body. A client
SHOULD re-run only the searches an event's card types could affect. A module
the audience may load MUST be announced as a card is. Every read the audience
may make, and every operation response, MUST carry the feed position
(`Boxel-Feed-Position`). A client MUST open the feed from the earliest
position it holds.

### 1.2. Filtered once, by policy

The feed MUST carry only changes the audience may read under the realm's
permissions and policy. The realm MUST decide this once per change, where the
event is produced, never per subscriber and never on the client. A change to
anything that decides readability MUST be announced as a `reset`: the
permissions, the `policy` pointer, the policy card, or a card a grant's
condition reads. The realm MUST store which cards its feed announced as
readable, so any process can announce a later removal or withdrawal. A
process starting MUST NOT announce a reset.

### 1.3. Two readings of one feed

The realm MUST serve the feed at `{realm}/_live`, as a resumable
`text/event-stream` and as its latest window in JSON. The window MUST be
shared-cacheable for about a second. A client older than the window resets.
The realm server MUST keep no per-subscriber state beyond the open response
and a personal lane's subscriptions. It MUST cap open streams per realm per
process. A deployment MUST work without a stateful edge service; one MAY sit
in front if it serves the same wire. A `reset` MUST mean "revalidate what you
hold", spread over a delay that grows with the audience. The wire MUST carry
a version (`v`), and a client MUST ignore fields and kinds it doesn't know.

### 1.4. Re-reads a shared cache can serve

A signed-out read of a card the policy admits MUST be cacheable by shared
caches, varying on `Authorization`. A client re-reading after an event MUST
ask for the event's revision (`?rev=`). A card's revision MUST change when
the policy or permissions admitting it change, and MUST cover every realm its
document draws on. A grant's condition can withdraw a card without changing
its revision, so a revision read MUST be shared-cached only briefly. A read
whose only query is `rev`, at the card's current revision, MUST NOT count
against the anonymous rate limit. Any other query MUST count, so the
exemption can't be used to bust caches. A shared cache MAY answer a caller the
anonymous blocklist or rate limit would refuse. A grant whose content must be
refused per address MUST be marked private, and its reads MUST NOT be
shared-cached.

### 1.5. One connection, into the existing reactivity path

The host MUST hold at most one feed connection per site in a browser, shared
by the site's tabs. That stream MUST follow every realm the site draws on, at
the site's mount (`{site}/_live?realm=<alias>`, ADR site-boundary §1.2). The
host MUST stop following a realm nothing on the page watches. It MUST deliver
events through `MessageService`, the path Matrix realm events take.
Signed-in sessions MUST keep realm events on Matrix. Every page MUST follow
live channels through the feed.

### 1.6. Subscriptions and channels are granted operations

A page MUST subscribe only to the whole feed, to a card's live channel as its
grant of `read` on the card allows, or to the live results of a `query`
operation a card type declares, as its grant allows. A subscription MAY be
shared on the broadcast lane only when its grant reads nothing about the
caller beyond `actor() == "anonymous"`. Otherwise it MUST go on the caller's
personal lane (§1.7) or be refused.

A channel message MUST be sent only by an `emit` operation the card type
declares and the policy grants. An emit MUST write nothing to the realm. The
latest message per key MUST replace earlier ones, so a late joiner hears where
things stand. A channel MUST answer not found for a card the audience may not
read. What must last MUST be written to a card by the realm. A transform MAY
`collect` an emit's latest messages, and a caller MUST NOT supply them. An
emit MAY `assert` a condition over the stored card and the clock, and MUST be
refused when it fails. Presence (`ordered: false`) MUST be stored as the
expiring latest message per key, with no position and without waiting on
other messages. A new follower MUST hear every unexpired key.

### 1.7. Two lanes

A personal lane MUST be opened as a caller the realm can name: a signed-in
user, or the holder of a capability an operation handed out. It MUST carry the
broadcast sequence, with each event filtered for that caller, so the two lanes
share positions. A capability MUST be signed by the realm with a key of its
own, MUST name one card and one subject, and MUST expire. An operation MUST
hand one out only through a declared `capability` clause, after its write
lands. A message whose emit declares an `audience` MUST be sent only with a
capability that names its card and subject. Followers holding such a
capability MUST hear the message whole. Every other follower MUST hear it
with its body withheld. A personal lane's answers MUST NOT be shared-cached. A
client MUST start on the broadcast lane. When a personal lane is refused or
closes, the client MUST fall back to broadcast and learn its own outcomes from
operation responses.

### 1.8. Refresh requests

A realm writer MAY ask following pages to reload, for a change no re-read
carries. The realm MUST rate-limit these requests across processes. It MUST
send one after a published copy is republished and indexed. A refresh request
MUST NOT stand in for an invalidation. A page MUST follow the realm that owns
its site for refresh requests, and MUST ignore one from any other realm. The
host MUST offer a refresh request to the page's cards through the card
context. When no card takes it, the page MUST reload after a random delay of a
few seconds.

### 1.9. A crowd's writes wait on nothing they don't need

A write whose order carries no meaning MUST NOT be ordered. Such a write is
replaced by a later one with the same key, and nothing reads its position, so
it is an `emit` with `ordered: false` and a `key` (§1.6). A write whose
outcome depends on earlier writes, such as a seat hold or a transform that
`collect`s, is ordered and waits on its card's write lock. A caller that reads
nothing back through the index MUST NOT wait for the write's index pass
(`skipIndexWait`). It SHOULD read what it just wrote from the card's stored
source.

A flow a crowd runs at once, such as an on-sale, a vote or a live quiz, MUST
NOT depend on indexing at any step. In such a flow, a caller MUST NOT create a
card and then invoke an operation on it, because the gate judges a card by its
index row. A record the crowd produces SHOULD be written into a card the flow
already writes, in the same write. Cards that need the index, such as
receipts, SHOULD be made from those records after the crowd has gone. Hot
state SHOULD be split across cards, so ordered writes contend only within one
card. A module MUST NOT be deployed while the flow runs, because the deploy
re-indexes every card that uses it.

## 2. Rationale

The host's reactivity already runs on realm events; only the source is
missing for a signed-out visitor. Before the feed, the Fairway storefront
re-ran its search every 15 seconds, and an edit to a loaded product never
reached its visitors. An event with no content, covering only what the visitor
could read, discloses nothing that polling wouldn't. Filtering once makes a
change cost the same however many people watch.

At on-sale scale, a one-second cacheable window lets a CDN answer a million
pollers with one origin request per location, and revision URLs let it absorb
the re-reads that follow. Stored positions and readable-card records close
the gaps a restart or a second replica would leave. One stream per site keeps
a site under HTTP/1.1's six connections per host: a few open tabs of the
Chorus social app left new tabs hanging [1].

A live pub quiz was the first crowd [2]. A room of phones behind one address
spent the anonymous rate limit on re-reads, and a code fix reached the
signed-in desk but never the TV. Picks first went out on the broadcast lane,
so every phone heard every pick, and any phone could pick for another team. A
capability from `join` and an `audience` on `select` now keep each pick to its
team, while the TV still counts what arrived. The lanes share one sequence, so
neither has a gap the other fills.

The ticket sale is what the rest is sized for. Ordered presence once queued a
thousand heartbeats under one row lock and held every pooled connection,
starving the holds and checkouts. Indexing is for quiet times: one worker
re-renders cards in turn, and under a crowd its queue grows by minutes. A
checkout that created a card and then operated on it waited on that queue, so
the purchase is now recorded in the write that sells the seats.

## 3. Considered options

- **Policy-filtered invalidations over HTTP (chosen).**
- **Matrix guest accounts or sliding sync.** An account and a sync loop per
  visitor, for a signal the size of a URL.
- **A required stateful edge, such as Durable Objects.** It ties every
  deployment to one vendor.
- **No shared caching.** At a ticket sale, the origin can't answer every
  reader.
- **WebSockets or WebTransport.** A CDN can't cache or collapse them.
- **One stream per reader with no poll, or a personal lane for everyone.**
  Origin connections grow with the audience.
- **A personal lane numbered apart from broadcast.** A client on both would
  have two cursors, and an event only one lane carries leaves a gap in the
  other.
- **Polling each card.** There is no shared revision for a CDN to collapse on.
- **Reloading on every code change.** A module change already rebuilds in
  place.

## 4. Sources

1. 0c1dab64da, filtered by policy, not a public feed; 5946caf38e, the protocol
   review.
2. 2a705ce29a, what a live pub quiz taught the feed.
3. One draft folded in here: "Push realm changes as cacheable HTTP
   invalidations, filtered by policy", proposed in 0147d4d53e, with
   83c65f5911 (the feed) and 17075efa64 (refresh requests, now §1.8). Its last
   text is at b00efcf485.

## 5. Remediation

Known gaps are listed in [remediation/event-feed.md](remediation/event-feed.md).
