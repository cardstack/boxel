---
status: proposed
date: 2026-10-31
scope:
  - packages/runtime-common/realm.ts
  - packages/runtime-common/event-feed.ts
  - packages/runtime-common/anonymous-admission.ts
  - packages/realm-server/tests/event-feed-test.ts
  - packages/realm-server/node-realm.ts
  - packages/host/app/services/message-service.ts
  - packages/host/app/services/event-feed.ts
---

# 020. Push realm changes as cacheable HTTP invalidations, filtered by policy

A visitor who isn't signed in has no Matrix account, so the realm events that
keep a signed-in host live never reach them, and a published site can only
poll. We give each realm an event feed: one small invalidation per change to
a card the feed's audience may read under the realm's permissions and policy,
whether the realm itself is public or private, filtered once where it is
produced, carried over plain HTTP as server-sent events and as a cacheable poll, and
followed by re-reads that shared caches can serve. A page subscribes to the
live results of an operation a card type declares, so what a page may watch
is granted by the realm's policy the way everything else is.
The design target is a ticket on-sale: millions of readers, one writer
stream, no per-reader state at the origin and no stateful edge service.

## 1. Decision

### 1.1. One invalidation per change, at write time

A realm MUST give each change to a card a position in a per-realm sequence
that only increases. It MUST produce the change's feed event when the write
lands, not when indexing finishes. An event MUST name only the card URL, the
kind of change, and the sequence position. It MUST NOT carry card content.
A change to a module that a visitor who isn't signed in may load MUST be
announced the same way, so a page running that code rebuilds it in place as
a signed-in page does. An event MUST name the operation that produced the
change, by its name and base, and MUST NOT name its actor or its parameters;
a write that ran no named operation is named by its base. An event MAY name
the changed card's type relative to the realm, so a client re-runs only the
searches it could affect, and MUST NOT name a type by an absolute URL.

### 1.2. Filtered once, by the realm's permissions and policy

The feed MUST carry only changes to cards its audience may read under the
realm's permissions and policy, so a private realm whose policy opens some
cards has a feed of those cards and no others. The audience it serves is
callers who aren't signed in. The realm MUST decide this
once per change, where the event is produced. The server MUST NOT evaluate
policy per subscriber, and a client MUST NOT be trusted to filter. A change
to anything that decides what the audience may read MUST be announced as a
reset: the realm's permissions, the `policy` pointer in `realm.json`, the
policy card wherever it lives, and a linked card a grant's condition reads. A
feed that restarts MUST announce one reset, so a card removed or withdrawn
while it was down is found by every client's revalidation.

### 1.3. Plain HTTP, two readings of one feed

The feed MUST be served over HTTP as `text/event-stream`, each event's `id`
being its sequence position, and MUST resume from `Last-Event-ID`. The same
feed MUST also be readable as its latest window of events, a response that is
cacheable for about a second, so a shared cache can collapse a crowd's polls
into one origin request. A client SHOULD use the stream and SHOULD fall back
to the poll when the stream cannot connect. The sequence and its epoch MUST
be stored and shared by every process that serves the realm, so a restart or
another replica continues it. A reset MUST mean "revalidate what you hold",
and a client MUST spread its revalidation over a delay that grows with the
audience it may share the realm with. Every read the feed's audience may
make MUST carry the feed's position at the time of the read, and a client
MUST open the feed from the earliest position among what it holds. Every
operation response MUST carry the position of the change it made, and an
atomic batch MUST occupy a contiguous range of positions, so a caller knows
its own change when it arrives and can apply a batch whole.

### 1.4. No per-reader state at the origin

The realm server MUST NOT keep any state for a feed subscriber beyond its
open response. A deployment MUST work without a stateful edge service. An
edge fan-out service MAY sit in front when it serves the same wire format.
The realm server MUST cap the open streams per realm in each process. A
stream request over the cap MUST be answered 503 with a `Retry-After`, and a
client MUST then use the poll, which a shared cache absorbs.

### 1.5. Re-reads a shared cache can serve

A response to a signed-out read of a card the policy admits MUST be cacheable
by shared caches, since every signed-out visitor gets the same document. A
client re-reading after an event MUST ask for the card at the event's
revision, so the URL is the same for every reader of that revision. A client
SHOULD spread its re-read over a short random delay. A signed-out read at a
revision the feed named MUST NOT count against the realm's anonymous rate
limit when that revision is the card's current one: the feed asked for it,
and every visitor behind one address asks for the same document. A card's
revision MUST change when the policy or permissions that admit it change, and
MUST cover every realm its document draws on, so a card that links across
realms is re-read by revision like any other. A shared cache MAY answer a
signed-out caller whom the realm's anonymous blocklist or rate limit would
refuse: those controls protect the realm server, not the content. A grant
whose content must be refused per address MUST be marked private, and its
reads are then never shared-cached.

### 1.6. One connection per browser, into the existing reactivity path

The host MUST hold at most one feed connection per browser, shared between
its tabs, and MUST follow all the realms a site draws on over that one
connection, through the site's boundary (ADR 018). It MUST stop following a
realm when nothing on the page watches it. It MUST deliver each event through the same path as Matrix realm
events (`MessageService`), so live searches and resources need no second
mechanism. Signed-in sessions MUST keep receiving realm events through
Matrix.

### 1.7. A refresh request, for what a re-read can't bring in

A realm writer MAY ask every page following the feed to reload, for a change
no re-read carries, such as a new build of the app. The request MUST travel
as a feed event of its own kind that names nothing but its position. The
realm MUST accept it only from a writer of the realm, and MUST refuse one
that arrives within a minute of the last. It MUST NOT stand in for a change
to cards or modules, which reach a page as invalidations. A page MUST honour a refresh request only from the realm that owns
its site, so a writer of a realm many sites draw on can't reload them all.
The once-a-minute limit MUST hold across every process that serves the realm.
A page MUST be offered the request as a cancelable notice first, through the
card context rather than a global event, so an app can tell its visitors an
update is ready and reload when it suits them. A page whose app
does not take the notice MUST reload, after a random delay of a few seconds
so a room of screens doesn't reload at once.

### 1.8. A subscription is an operation

A page MUST subscribe to the live results of a `query` operation a card type
declares, or to everything the audience may read in the realm. Whether a
caller may subscribe MUST be decided by the policy's grant of that operation,
as it decides whether they may run it. A subscription MAY be served as one
shared, cacheable stream only when its grant admits callers without regard to
who they are: unconditionally, or by a condition that reads no `actor()`
beyond `actor() == "anonymous"`. A subscription whose grant reads the caller
MUST be refused on the feed: what it shows differs per caller, so it can't be
filtered once, and a signed-in caller hears it through Matrix. Each
subscription MUST have its own URL and window, so a shared cache holds it
apart from the rest of the realm.

### 1.9. The wire, written down and versioned

The feed's wire format is the protocol section below, version 1. A client
MUST ignore fields and kinds it doesn't know, so later versions can add them.

- Path: `{realm}/_live`, with `?operation=<Type>/<name>` and the operation's
  parameters for a subscription, and `{site}/_live?realm=...` for a site's
  realms over one connection (§1.6).
- Stream: `Accept: text/event-stream`. The server sends `retry: 3000`, a
  comment every 25 seconds, and each event as `id: <epoch>:<seq>`,
  `event: change`, `data: <event>`. A client resumes with `Last-Event-ID` or
  `?lastEventId=`.
- Poll: `Accept: application/json`, answered `{ "v": 1, "epoch", "head",
"events": [...] }`, the latest window, `Cache-Control: public, max-age=1,
stale-while-revalidate=1`.
- Event: `{ "v": 1, "seq", "kind", "path", "rev"?, "type"?, "operation"? }`,
  where `operation` is `{ "name", "base" }`.
- Kinds: `written` (the change landed; a client need do nothing), `indexed`
  (re-read `path`, at `rev` when given), `removed` (the card was deleted),
  `withdrawn` (the audience may no longer read it), `reset` (revalidate
  everything held from this realm), `refresh` (offer the page a reload, §1.7).
- Refresh: `POST {realm}/_live/refresh` by a realm writer, answered 202
  `{ "seq" }`, or 429 with `Retry-After` within a minute of the last.
- Revision read: `GET {card}?rev=<rev>`.
- Position on reads and operation responses: `Boxel-Feed-Position:
<epoch>:<seq>` (an atomic batch: `<epoch>:<first>-<last>`).

## 2. Rationale

The host's reactivity already runs on realm events: the store, live searches
and capability answers all listen in one place. Only the source is missing
for a visitor who isn't signed in. Giving that visitor Matrix would mean an
account, a sync loop and room membership to learn that a card changed, and a
credential in the path a signed-out page takes.

An event that carries no content and covers only cards a signed-out visitor
may read discloses nothing that visitor could not learn by polling the card.
Filtering where the event is produced keeps changes to a card the audience
may not read off the feed by construction, and keeps the cost of a change independent of
how many people are watching.

At ticket-sale scale the origin cannot hold a connection per reader. A
"changes since N" response cached for a second lets a CDN answer a million
pollers with one request per location. Revision-addressed re-reads let the
same cache absorb the rush that follows each change. The stream remains the
low-latency path for an ordinary site, and both readings share one sequence,
so a client moves between them without missing anything.

A live pub quiz, with a TV, a quizmaster and a table of phones on one site,
showed what the first version missed. A room of visitors shares one address:
the venue's network, or the proxy in front of the realm. The anonymous rate
limit counts per address, and every change sent every screen back for the
card, so the room used up the limit within a minute and the realm refused its
answers. Exempting the feed's own revision reads keeps the limit for what a
visitor chooses to do. The feed also carried no module changes, so a page
kept the code it first loaded for as long as it stayed open, and a fix
reached the quizmaster's signed-in desk but never the TV. Announcing module
changes lets a page rebuild in place; the refresh request (§1.7) remains for
what a rebuild can't apply.

A subscription is an operation (§1.8) because the realm already has the
machinery a topic needs: a card type declares a named `query`, the policy
grants it, and the server runs it. Watching its results is that operation in
reverse, so what a page may watch is decided by the same grant that decides
what it may search, and authors define topics in their card types rather
than the platform defining them. The one rule the platform adds follows from
§1.2: a grant that depends on the caller can't be filtered once, so it isn't
served as a shared stream. An event that names its operation (§1.1) lets an
app react to what happened, such as an answer landing or a batch admitted,
without diffing state, and a position on every operation response gives the
caller read-your-writes and is what an optimistic operation needs to be
confirmed or rolled back.

## 3. Considered options

- **Policy-filtered invalidations over HTTP, with cacheable polls and
  revision-addressed reads.** Chosen: no new infrastructure, works through
  any proxy or CDN, and scales with the cache rather than the origin.
- **Matrix for signed-out visitors** (guest accounts, sliding sync). Rejected:
  per-visitor accounts and sync for a URL-sized signal, and credentials in
  the path a signed-out page takes.
- **Durable Objects or another stateful edge fan-out as a requirement.**
  Rejected: ties the platform to one vendor's stateful product. §1.4 still
  lets a deployment add one.
- **WebSockets.** Rejected: the feed is one-way, a WebSocket cannot be cached
  or collapsed by a CDN, and it needs its own resume protocol.
- **WebTransport.** Rejected for now: uneven browser support and no general
  CDN or reverse-proxy pass-through.
- **One stream per reader from the realm server, with no cacheable poll.**
  Rejected: fine for a pub quiz, but at an on-sale the origin's open
  connections grow with the audience.
- **Polling each card.** Rejected: no shared revision to collapse on, and
  freshness costs a request per card per reader.
- **Topics by path prefix or card type.** Rejected for operation topics
  (§1.8): a prefix or type can't express "this game" or "my entry", needs a
  permission model of its own, and leaves topics to the platform rather than
  the author.
- **Reloading every page on each code change.** Rejected for the refresh
  request: a module change already rebuilds a page in place, and a reload
  per save would put the whole audience back through the page's first load.
  The refresh request is for the rare change that rebuild can't apply.

## 4. Remediation

Known gaps are listed in [remediation/020.md](remediation/020.md).
