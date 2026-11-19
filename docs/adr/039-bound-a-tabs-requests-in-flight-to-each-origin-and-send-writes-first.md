---
status: proposed
date: 2026-11-18
scope:
  - packages/host/app/services/**
  - packages/host/app/lib/**
---

# 039. Bound a tab's requests in flight to each origin, and send writes first

The interactive host sends its requests to a realm server through one limiter
that holds a fixed number in flight to each origin and queues the rest, with
writes and auth ahead of reads. Without it, a tab that refreshes many searches
and cards at once opens more requests than its connection carries, and the
browser then holds a session request or a card write behind every read queued
before it, for minutes, though the server answers it in milliseconds.

## 1. Decision

### 1.1. One path to the realm server

A request from the interactive host to a realm server MUST be sent through
`NetworkService`'s network (`network.fetch`, `network.authedFetch`, or the
loader), so that the limiter counts it. The exception is a `keepalive` request
sent while the page is being hidden, which MAY use the global `fetch`, because
a request queued then is lost.

### 1.2. The bound

The limiter MUST hold a tab's requests in flight to one origin to a fixed
number, and MUST queue the excess rather than refuse it. The number MUST stay
well below the stream limit an HTTP/2 server advertises (128 at an AWS load
balancer), so the browser's own queue stays empty.

### 1.3. Order

A request whose method is not GET, HEAD, OPTIONS or QUERY MUST be sent before a
waiting request whose method is. Part of the bound MUST be kept for those
requests, so one finds a free slot while reads fill the rest.

### 1.4. Holding a slot

A slot MUST be held until the response body ends (read to the end, cancelled,
or failed). A streamed response (`text/event-stream`) and a response with no
body MUST release their slot at the headers. A slot whose body has not ended a
fixed time after its headers MUST be released, so a caller that drops a
response cannot hold a slot for the life of the tab.

### 1.5. Abandoned requests

A request whose signal aborts while it waits MUST leave the queue unsent.

### 1.6. Prerender

The limiter MUST NOT apply in a prerender tab. An interactive tab's own index render is not a
prerender tab: its requests share the tab's connection, and the limiter MUST
count them.

## 2. Rationale

The host already bounds the searches a card starts (`SEARCH_CONCURRENCY_CAP`),
but not the host's own searches, card and module reads, session requests or
model calls. When many users write to one realm, every open view refreshes its
live searches after each write, and one tab was measured with 186 requests in
flight, above the 128 streams the load balancer allows. Requests to the same
server then waited minutes in the browser before they were sent. The bound
sits where every request passes, below the auth and telemetry middleware, so
it counts each attempt once and sees the method it was sent with.

The bound decides the order requests are sent in, not how fast the reads
finish. On a slow connection the streams stay open because their bodies
download slowly, so the reads wait about as long in this queue as they did in
the browser's. What changes is that a write, a session request or a model call
no longer waits behind them. Making the reads faster means sending fewer
bytes, which this ADR does not cover.

## 3. Considered options

- **One limiter around the native fetch in `NetworkService`, per origin, two
  classes.** Chosen: every host request to a realm server already passes
  there, and HTTP/2 multiplexes one connection per origin.
- **More per-caller caps like `SEARCH_CONCURRENCY_CAP`.** Rejected: each cap
  bounds one caller, and the sum of the callers is what fills the connection.
- **Release the slot at the headers.** Rejected: the stream stays open while
  the body downloads, so the browser's queue would fill again.
- **A third class that puts searches below card reads.** Rejected for now: two
  classes are enough to keep writes and auth moving, and a search the user
  started would wait behind background reads.
- **One bound for the whole origin, across tabs, in the auth service worker.**
  Not chosen for now: a browser shares one HTTP/2 connection per origin
  between tabs, so several busy tabs can still pass the stream limit with a
  bound per tab. The incident this ADR comes from was one tab filling the
  connection, and a request passes through the worker only while it controls
  the page (a hard reload bypasses it).
- **Bound only on the server (per-realm admission).** Rejected as the only
  measure: the server answered these requests in milliseconds; the wait was in
  the browser.

## 4. Sources

- `packages/host/app/lib/request-limiter.ts`
- `packages/host/app/services/network.ts` (`limitedFetch`)

## 5. Remediation

Known gaps are listed in [remediation/039.md](remediation/039.md).
