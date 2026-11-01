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
produced, carried over plain HTTP as server-sent events and as a cacheable
"changes since" poll, and followed by re-reads that shared caches can serve.
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
a signed-in page does.

### 1.2. Filtered once, by the realm's permissions and policy

The feed MUST carry only changes to cards its audience may read under the
realm's permissions and policy, so a private realm whose policy opens some
cards has a feed of those cards and no others. The audience it serves is
callers who aren't signed in. The realm MUST decide this
once per change, where the event is produced. The server MUST NOT evaluate
policy per subscriber, and a client MUST NOT be trusted to filter.

### 1.3. Plain HTTP, two readings of one feed

The feed MUST be served over HTTP as `text/event-stream`, each event's `id`
being its sequence position, and MUST resume from `Last-Event-ID`. The same
feed MUST also be readable as a bounded "changes since N" response that is
cacheable for about a second, so a shared cache can collapse a crowd's polls
into one origin request. A client SHOULD use the stream and SHOULD fall back
to the poll when the stream cannot connect.

### 1.4. No per-reader state at the origin

The realm server MUST NOT keep any state for a feed subscriber beyond its
open response. A deployment MUST work without a stateful edge service. An
edge fan-out service MAY sit in front when it serves the same wire format.

### 1.5. Re-reads a shared cache can serve

A response to a signed-out read of a card the policy admits MUST be cacheable
by shared caches, since every signed-out visitor gets the same document. A
client re-reading after an event MUST ask for the card at the event's
revision, so the URL is the same for every reader of that revision. A client
SHOULD spread its re-read over a short random delay. A signed-out read at a
revision the feed named MUST NOT count against the realm's anonymous rate
limit: the feed asked for it, and every visitor behind one address asks for
the same immutable document.

### 1.6. One connection per browser, into the existing reactivity path

The host MUST hold at most one feed connection per browser, shared between
its tabs. It MUST deliver each event through the same path as Matrix realm
events (`MessageService`), so live searches and resources need no second
mechanism. Signed-in sessions MUST keep receiving realm events through
Matrix.

### 1.7. A refresh request, for what a re-read can't bring in

A realm writer MAY ask every page following the feed to reload, for a change
no re-read carries, such as a new build of the app. The request MUST travel
as a feed event of its own kind that names nothing but its position. The
realm MUST accept it only from a writer of the realm, and MUST refuse one
that arrives within a minute of the last. It MUST NOT stand in for a change
to cards or modules, which reach a page as invalidations. A page MUST be
offered the request as a cancelable notice first, so an app can tell its
visitors an update is ready and reload when it suits them. A page whose app
does not take the notice MUST reload, after a random delay of a few seconds
so a room of screens doesn't reload at once.

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
- **Reloading every page on each code change.** Rejected for the refresh
  request: a module change already rebuilds a page in place, and a reload
  per save would put the whole audience back through the page's first load.
  The refresh request is for the rare change that rebuild can't apply.

## 4. Remediation

Known gaps are listed in [remediation/020.md](remediation/020.md).
