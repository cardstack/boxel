---
status: proposed
date: 2026-11-01
supersedes: '020'
scope:
  - packages/runtime-common/realm.ts
  - packages/runtime-common/event-feed.ts
  - packages/runtime-common/event-feed-store.ts
  - packages/runtime-common/anonymous-admission.ts
  - packages/runtime-common/card-operations/lowering.ts
  - packages/realm-server/lib/realm-feed-events-listener.ts
  - packages/realm-server/node-realm.ts
  - packages/realm-server/tests/event-feed-test.ts
  - packages/host/app/services/message-service.ts
  - packages/host/app/services/event-feed.ts
  - packages/host/app/lib/live-card-context.ts
---

# 023. Push realm changes to visitors as policy-filtered, cacheable HTTP invalidations

A visitor who isn't signed in has no Matrix account, so the realm events that
keep a signed-in host live never reach them. Each realm gives that audience an
event feed of content-free invalidations, filtered by policy once where they
are produced, and served over plain HTTP so a CDN can collapse it. The design
target is a ticket on-sale: millions of readers, no per-reader state at the
origin.

## 1. Decision

### 1.1. Events

A realm MUST give each change a position in a per-realm sequence that only
increases, stored with its epoch where every process serving the realm reads
it. It MUST announce a change as `written` when the write lands, and as
`indexed`, with the revision to re-read, for each card indexing changes. An
event MUST name only the path, kind and position, plus metadata relative to
the realm, and MUST NOT carry content, an actor, parameters or an absolute
URL; only a channel message carries a body, what its emit sent. A client
SHOULD re-run only the searches an event's types could affect. A module the audience may load MUST be announced like a card. Every read
the audience may make and every operation response MUST carry the feed
position (`Boxel-Feed-Position`), and a client MUST open the feed from the
earliest position it holds.

### 1.2. Filtered once, by policy

The feed MUST carry only changes the audience may read under the realm's
permissions and policy, decided once per change where the event is produced,
never per subscriber and never by the client. A change to anything that
decides readability (permissions, the `policy` pointer, the policy card, a
card a grant's condition reads) MUST be announced as a reset. The realm MUST
store which cards its feed announced as readable, so a later removal or
withdrawal is announced from any process however long after. A process
starting MUST NOT announce a reset.

### 1.3. Two readings of one feed

The feed MUST be served at `{realm}/_live` as a resumable `text/event-stream`
and as its latest window in JSON, shared-cacheable for about a second; a
client older than the window resets. The realm server MUST keep no
per-subscriber state beyond the open response and, for a personal lane, the
subscriptions it names, and MUST cap open streams per
realm per process. A deployment MUST work without a stateful edge service,
though one MAY sit in front serving the same wire. A reset MUST mean
"revalidate what you hold", spread over a delay that grows with the audience.
The wire is versioned (`v`), and a client MUST ignore fields and kinds it
doesn't know.

### 1.4. Re-reads a shared cache can serve

A signed-out read of a card the policy admits MUST be cacheable by shared
caches, varying on `Authorization`, and a client re-reading after an event
MUST ask for the event's revision (`?rev=`). A card's revision MUST change when the policy or
permissions admitting it change, and MUST cover every realm its document
draws on; since a grant's condition can still withdraw a card without
changing its revision, a revision read MUST be shared-cached only briefly. A
card read whose only query is `rev`, at the card's current revision as its
index row shows before the read runs, MUST NOT count against the anonymous
rate limit; any other query keeps it counted, so the exemption can't be used
to bust caches. A shared cache MAY answer a caller the anonymous
blocklist or rate limit would refuse; a grant whose content must be refused
per address MUST be marked private and is then never shared-cached.

### 1.5. One connection, into the existing reactivity path

The host MUST hold at most one feed connection per site in a browser, shared
by its tabs, following every realm a site draws on over one stream at the
site's mount (`{site}/_live?realm=<alias>`, ADR 022), and MUST stop following
a realm nothing on the page watches.
It MUST deliver events through `MessageService`, the path Matrix realm events
take. Signed-in sessions MUST keep realm events on Matrix; every page MUST
follow live channels through the feed.

### 1.6. Subscriptions and channels are granted operations

A page MUST subscribe only to the live results of a `query` operation a card
type declares, as the policy's grant of that operation allows; to a card's
live channel, as its grant of `read` on the card allows; or to the whole feed. A subscription MAY be
shared on the broadcast lane only when its grant ignores who the caller is
beyond `actor() == "anonymous"`; otherwise it MUST go on the caller's
personal lane or be refused.

A channel message MUST be sent only by an `emit` operation the card type
declares and the policy grants; it writes nothing to the realm. The latest
message per key MUST replace earlier ones, so a late joiner hears where
things stand. A channel MUST answer not found for a card the audience may not
read. What must last MUST be written to a card by the realm: a transform MAY
`collect` an emit's latest messages, and a caller MUST NOT supply them. An
emit MAY `assert` a condition over the stored card and the clock, such as a
deadline, and MUST be refused when it fails. Presence (`ordered: false`) MUST
be stored as the expiring latest per key, without a position and without
serializing behind other messages, so a missed one is never a gap to resume
from; a new follower MUST hear every unexpired key.

### 1.7. Two lanes

A personal lane MUST be opened as a caller the realm can name (a signed-in
user, or a capability an operation handed out), MUST filter each event for
that caller, and MUST number its events apart from the broadcast sequence. A
client MUST start on the broadcast lane and, when a personal lane is refused
or closes, fall back to it, learning its own outcomes from operation
responses.

### 1.8. Refresh requests

A realm writer MAY ask following pages to reload, for a change no re-read
carries; the realm MUST rate-limit these across processes and MUST send one
after a republish is indexed. It MUST NOT stand in for an invalidation. A
page MUST follow the realm that owns its site for these, though it may read
nothing from it, and MUST ignore one from any other realm. It MUST
offer an honoured one to the page's cards through the card context and, when
none takes it, reload after a random few-second delay.

## 2. Rationale

The host's reactivity already runs on realm events; only the source is
missing for a signed-out visitor. Signed-in sessions stay on Matrix because
the feed carries only what the anonymous audience may read. An event with no
content, covering only what the visitor could read, discloses nothing polling
wouldn't, and filtering once makes a change cost the same however many watch.
At on-sale scale a one-second cacheable window lets a CDN answer a million
pollers with one origin request per location, and revision URLs let it
absorb the re-read rush. Stored positions, readable-card records and the
read-position header close the gaps a restart, a replica or a read before the
feed opened would leave; a per-process reset sent every client back for
everything at each deploy. One stream per site keeps a multi-realm site under
HTTP/1.1's six connections per host.

In a live pub quiz, a room sharing one address spent the anonymous rate limit
within a minute on per-change re-reads. A refresh from any writer of a shared source realm
reloaded every site drawing on it. Ordered presence took the channel's next
position under one row lock, so a waiting room's heartbeats queued and
starved holds and checkouts.

A subscription is an operation because the realm already declares, grants and
runs named queries; watching is the same grant. A grant that reads the caller
can't be filtered once, so it can't be broadcast.

## 3. Considered options

- **Policy-filtered invalidations over HTTP (chosen).**
- **Matrix guest accounts or sliding sync:** an account, a sync loop and a
  credential per visitor for a URL-sized signal.
- **A required stateful edge (Durable Objects):** vendor lock-in.
- **WebSockets or WebTransport:** not cacheable or collapsible by a CDN.
- **One stream per reader, no poll; or a personal lane for everyone:** origin
  connections grow with the audience.
- **The broadcast lane alone:** per-caller exchanges (queue place, hold
  timer) cost a poll per caller per tick.
- **Polling each card:** no shared revision to collapse on.
- **Topics by path prefix or type:** can't express "this game", and need a
  permission model of their own.
- **Reloading on every code change:** a module change already rebuilds in
  place.

## 4. Remediation

Known gaps are listed in [remediation/023.md](remediation/023.md).
