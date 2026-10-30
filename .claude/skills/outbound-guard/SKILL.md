---
name: outbound-guard
description: Operate and diagnose the realm server's guarded outbound client (`packages/realm-server/lib/outbound/`) — the one client every call that sends a stored credential to an outside vendor goes through (`_request-forward`, the OpenRouter passthrough, the OpenRouter generation-cost lookup, and `callApi` card operations). Covers what the guard refuses (non-HTTPS, private / loopback / link-local / metadata / IPv4-mapped addresses, `X-Boxel-*` headers, redirect hops into any of those), the local development allowlist and the startup self-check that refuses it on a deployed server, the connect and total timeouts, how a refusal reaches the caller (400 / 502 / 504), reading the response size cap's observe-mode logs to choose enforced cap values, the pre-substitution invariant (every recorded URL is the origin and path of the one the caller sent, never the one with the credential attached, and never the caller's query string), what a Sentry event keeps of the incoming request (only the method and path on the proxy routes, and never the Authorization header or cookies on any route), and finding a send-path error by the key's name in logs and Sentry. Also covers the response scrubber (`lib/outbound/scrubber.ts`) that removes every registered credential from a response's headers and decompressed body as a stream — what it matches, its hold-back window, and how a caller registers a value. Use when a forward fails with 502 "Destination refused" or 504, when the realm server won't boot with "Outbound guard self-check failed", when tracing a send-path error back to the key it used, when a response comes back with `[REDACTED]` in it, when adding a new path that sends a credential and must register it, when adding a destination to `proxy_endpoints`, when pointing a local stack at a local vendor, or when deciding the enforced response size caps.
---

# Outbound guard (operators)

Every realm-server call that carries a stored credential to an outside vendor
goes through `outboundFetch` in `packages/realm-server/lib/outbound/client.ts`.
Today that is `POST /_request-forward` (including streamed calls),
`POST /_openrouter/chat/completions`, the generation-cost lookup either of
them makes when a response carried a generation id but no inline cost
(`OpenRouterCreditStrategy` in `lib/credit-strategies.ts`), every `callApi`
card operation (`lib/outbound/call-api-sender.ts`; see the `call-api` skill),
and the token exchanges that mint a key's access tokens: a Google service
account's at Google's token endpoint (`lib/outbound/google-service-account.ts`,
which registers the private key and the signed assertion with the scrubber;
see the `user-keys` skill) and an OAuth client's or connection's at its
client's (see the `oauth-connections` skill).
A `callApi` carries no `credential`: its credentials are `substitutions`,
filled into the request after the destination check and never followed across
a redirect to another origin. A substitution may not change the URL's origin,
and one filled into the path stays within its segment: a value holding `/` or
`\`, or one the URL would resolve away as a dot segment, is refused
`invalid-url` (502) before anything is sent. The guard is
always on, in every environment; local development gets a short allowlist, never an off switch.

## What it refuses

| Refusal                     | When                                                                                                                                                                                                              | Caller sees                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `scheme`                    | the URL (or a redirect hop) is not `https:`, and its host is not on the development allowlist                                                                                                                     | 502 `Destination refused: Only https URLs …`      |
| `address`                   | the host is, or resolves to, a non-public address: private, loopback, link-local, CGNAT, multicast, reserved, IPv4-mapped/embedded forms of those, and the metadata addresses `169.254.169.254` / `fd00:ec2::254` | 502 `Destination refused: … private or reserved`  |
| `forbidden-header`          | a header named `X-Boxel-*` in the forwarded `headers`                                                                                                                                                             | 400, before any credit slot is taken              |
| `too-many-redirects`        | more than 5 redirect hops                                                                                                                                                                                         | 502                                               |
| timeout (`connect`/`total`) | no connection in 10 s, or the whole exchange (every hop and the body) not done in 10 min                                                                                                                          | 504; mid-stream, an SSE error frame then `[DONE]` |

Every hostname is resolved inside the socket's own lookup and the socket
connects to exactly the addresses that were checked, so a DNS answer that
changes between check and connect cannot slip through. A redirect to another
origin drops the credential header.

A host that resolves to several addresses is refused if **any** of them is not
public. A vendor that publishes a private address in its DNS is refused as a
whole; that is deliberate.

Incoming request headers are never forwarded: the vendor receives exactly the
body's `headers` field plus the credential (and fetch's own `accept`,
`user-agent`, `accept-encoding`, …).

Refusals and timeouts log at `warn` as
`… stopped by the outbound guard: <message> (key=<name> url=<origin and path>)`:
on `request-forward` or `openrouter-passthrough` for a non-streamed call, and on
`proxy-forward` for a streamed one (`stream: true`). The message callers see
names the host, never the full URL.

## Credentials never reach what is recorded

The client attaches the credential itself. A caller hands `outboundFetch` the
URL and headers **without** the key, plus a `credential` (the key's name, its
value, and where it goes: a header with an optional scheme, or a query
parameter). The URL with the key in it exists only inside the client, between
attaching it and sending.

**The pre-substitution invariant.** Every URL that is recorded — log lines,
errors, Sentry, Grafana — is the origin and path of the URL the caller sent,
before the credential was attached (`recordedURL` in `lib/outbound/client.ts`).
A `url-parameter` system key is never in a recorded URL, and neither is the
caller's own query string or userinfo, which can carry a token or user
content. If you ever find a recorded URL with a key or a query string in it,
that is a leak to report, not a format to parse.

What enforces it:

- **Errors are scrubbed before anything sees them.** Each attached form of the
  credential (the value, and e.g. `Bearer <value>`) is registered with a
  `CredentialScrubber`. Every error the client throws, and every error the
  proxy handlers catch, is scrubbed in place — message, stack, `cause`, and
  every other property a logger or Sentry prints — before it is logged,
  reported or answered with. Node quotes its input in `new Headers`, `new URL`
  (on `.input`) and `JSON.parse` errors; those are the usual carriers. The
  scrub is the same one every response goes through, matching every form
  listed under [Response scrubbing](#response-scrubbing-developers); a removed
  value reads `[REDACTED]`.
- **Sentry's fetch instrumentation skips guarded requests.** With tracing on
  it would record each outgoing URL and its query string as a breadcrumb; with
  tracing off it adds `sentry-trace` / `baggage` headers to the request. A
  guarded request gets neither (`guardedFetchIntegration` in
  `lib/outbound/sentry.ts`, installed by `instrument.ts`). Every other fetch
  the server makes is instrumented as before.
- A vendor's error body on a streamed call is scrubbed before it is logged or
  framed back to the caller.

## What a Sentry event carries of the incoming request

Sentry's HTTP instrumentation attaches the request in flight to every event
raised while it is: by default its headers, cookies, query string, URL and
body (up to 1 MB, when the handler reads it through `data` listeners), each
kept up to 8,192 characters. The realm server's `beforeSend` /
`beforeSendTransaction` hook (`scrubRequestTelemetry` in
`lib/request-telemetry.ts`, installed by `instrument.ts`) cuts that down:

| Request                                                                       | What the event keeps                                                                                                                  |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /_request-forward`, `POST /_openrouter/chat/completions`, secure origin | The method, and the URL's origin and path. No body, headers, cookies or query string.                                                 |
| Any other route                                                               | Everything Sentry records, except the credential headers and the parsed cookies, with a `token` query parameter masked as `REDACTED`. |

On every event, a breadcrumb that names a proxy route's URL loses that URL's
query string. The request log line (`<-- POST … /_request-forward?…`) is the
one that does: Sentry's console integration keeps each log line written during
a request as a breadcrumb on that request's events.

The credential headers are `Authorization`, `Proxy-Authorization`, `Cookie`,
`Set-Cookie`, the two request signatures (`X-Boxel-Worker-Request-Signature`
and `X-Boxel-Delegation-Signature`), and any header whose name contains
`signature`, `token`, `secret` or `api-key`. The name rule covers the webhook
routes: `/_stripe-webhook` checks `Stripe-Signature`, and an incoming webhook
checks whichever header its configuration names, such as
`X-Hub-Signature-256`. A signature is replayable with its body, so it counts
as a credential. One predicate, `isCredentialHeader` in
`lib/request-telemetry.ts`, decides both what an event's request context drops
and what the request log masks.

With `realm:requests` at debug, the request log also writes each request's
headers as a JSON line when the response finishes. That line carries no more
than an event raised during the request may:

- On the secure origin and the proxy routes it lists the header names only.
  `keepsMethodAndPathOnly` decides this for both the line and the event.
- Elsewhere it names every header, and prints each credential header's value
  as `REDACTED`.

The line is masked when it is written, not by the `beforeSend` hook, so the
token and cookies never reach Loki, or a breadcrumb on an event raised after
the line. `request-telemetry-test.ts` pins this for the log and for Sentry.
The prerender server, the prerender manager and the worker manager write the
same debug header line through `withCredentialHeadersMasked`, so a credential
header sent to any of them is masked too. A new log line that dumps request
headers goes through it as well.

Why: a proxy route's body is the caller's own content — a forwarded request's
URL (query string included), headers and body, or a whole prompt — and its
`Authorization` header is the caller's realm-server session token. A token in
Sentry is no help in triage and a liability once stored, so it is dropped on
every route, whatever level the request log runs at, along with the `?token=` a capture URL or a `_download-realm`
link carries (the request log masks the same parameter). The secure origin is
where credentials are typed.

Sentry buffers a request body only when the handler reads it through `data`
listeners. The proxy handlers read theirs through the stream's async iterator
(`nodeStreamToText` in `stream.ts`), which Sentry doesn't see, so a forwarded
image or a prompt is never copied into Sentry's buffer, even for the length of
a streamed completion. `request-forward-test.ts` pins this; a change to how
those handlers read their body has to keep it.

So an event from a failed forward still has the route, the method and the
stack, but not what the caller sent. The log line logged with it
(`Error in request forward handler (key=<name> url=<url>)`) names the key and
the origin and path of the destination.

### Transactions

With tracing on, each incoming request is also a transaction, and a
transaction records the URL in more places than `event.request`. The server
span's attributes (`http.url`, `http.target`, `http.query`, and the like)
become the trace context's `data`, and each child span carries its own.
Sentry's fetch instrumentation also records an outgoing request's URL and
query as a breadcrumb's `data` (`url`, `http.query`). The same hook applies the
table above to every one of these URL attributes:

- On a transaction or event for a proxy route or the secure origin, each keeps
  only its origin and path. `http.query`, `url.query` and the fragment
  attributes are dropped.
- On any other, each keeps its query with a `token` parameter masked as
  `REDACTED`.
- A URL attribute that itself names a proxy route or the secure origin keeps
  only its origin and path either way.

The transaction's name and each span's description are the method and path
alone (`POST /_request-forward`), and its status, op and timing are untouched.
So a transaction still says which route was hit, how it ended and how long it
took. A guarded request records no span at all (`guardedFetchIntegration`, as
above), so the destination URL a caller asked to forward to never appears as a
child span.

The rules key on attribute names, listed in `lib/request-telemetry.ts`
(`fullURLAttributes`, `pathAndQueryAttributes`, `queryAttributes`,
`fragmentAttributes`). An instrumentation that records a URL under a new name
needs that name added there. Any other string attribute only loses a proxy
route's query string, the same as a breadcrumb message.

`tests/helpers/sentry-capture.ts` with `tracing: true` and
`incomingRequests: true` records real incoming transactions in a test. The
tracer provider it needs is registered once per process and stays: the HTTP
instrumentation keeps the first tracer it is given. Its sampler samples only
while a capture with both options is running, so every other capture, before
or after, still records no spans.

## Finding a send-path error by key name

Every error from a send carries the key's name and the origin and path of the
URL the caller sent, never the value:

- A refusal or timeout keeps the message callers see, and the log line gains
  `(key=<name> url=<url>)`.
- Any other failure — a stored value Node refuses as a header, a connection
  reset, a broken body stream — is an `OutboundSendError`:
  `Sending to <url> with key <name> failed: <Node's reason, scrubbed>`, with
  Node's original error, scrubbed, as its `cause`. It logs at `error` as
  `Error in request forward handler (key=<name> url=<url>): …` (or
  `Error in streaming request …` on `proxy-forward`, or
  `Error in openrouter-passthrough handler …`) and goes to Sentry.

A system key is named `system:<proxy_endpoints.url>` — the configured endpoint,
not the request URL. To find every failure on one key:

```
./scripts/tail-logs.sh --env production --service realm-server --filter 'key=system:https://openrouter.ai/api/v1' --since 1d --no-follow --confirm
```

A failure after the vendor answered — a body that isn't JSON — is logged the
same way, with the same `(key=<name> url=<url>)`, though the error itself is
Node's (`SyntaxError`, scrubbed). In Sentry, search for `OutboundSendError`
or for the URL's origin and path; the log line is the faster way in by key
name.

A `Headers.append: "[REDACTED]" is an invalid header value` reason means the
stored value itself is malformed — most often a key pasted with a trailing
line break inside it. Re-enter the key; the scrubbed message is all you get,
by design.

The generation-cost lookup runs after the response has gone back to the
client, so a refusal there reaches nobody and logs differently. It is not
retried, and the usage goes uncharged. Search for these, in order:

- `Attempt 1 to fetch generation cost failed (generationId: gen-…)` at `warn`
  on `ai-billing`, with the `OutboundRefusedError` naming the host;
- `Fetching generation cost failed in a way retrying cannot fix` at `error` on
  `ai-billing`;
- `Failed to fetch generation cost for user … credit deduction skipped` at
  `warn` on `credit-strategies`.

## Settings

Read once at startup from the environment by `startOutboundGuard` in `main.ts`:

| Variable                                 | Default  | Meaning                                                                                            |
| ---------------------------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `OUTBOUND_DEV_ALLOWLIST`                 | empty    | comma-separated host names that may use `http:` and resolve locally                                |
| `OUTBOUND_CONNECT_TIMEOUT_MS`            | 10000    | per connection                                                                                     |
| `OUTBOUND_TOTAL_TIMEOUT_MS`              | 600000   | whole exchange, body included                                                                      |
| `OUTBOUND_RESPONSE_CAP_SYSTEM_KEY_BYTES` | 33554432 | observe-mode cap for the system-key path (`_request-forward`, passthrough, generation-cost lookup) |
| `OUTBOUND_RESPONSE_CAP_CALL_API_BYTES`   | 10485760 | observe-mode cap for `callApi`                                                                     |

The boot log carries one line with the effective settings:

```
outbound guard: deployed=true devAllowlist=(none) connectTimeoutMs=10000 totalTimeoutMs=600000 maxRedirects=5 responseSizeCap.system-key=33554432 responseSizeCap.call-api=10485760 responseSizeCapMode=observe
```

### The development allowlist and the self-check

- An allowlisted host may be reached over plain HTTP and may resolve to a
  loopback or private address. The metadata addresses stay refused even then.
- Entries are exact host names (`localhost`, `127.0.0.1`, `vendor.localhost`).
  A wildcard, path, port or space anywhere refuses startup.
- **A deployed server refuses to start with any entry.** "Deployed" means the
  server's own `--serverURL` host is not `localhost`, `*.localhost` or a
  non-public IP literal, so a deployment can't pass as development by leaving
  a flag unset. The process exits with
  `Outbound guard self-check failed: OUTBOUND_DEV_ALLOWLIST must be empty on a deployed server, …`.
  The fix is to remove the variable from the task definition, never to widen
  the check.

To point a local stack at a vendor stub on loopback, start the realm server
with `OUTBOUND_DEV_ALLOWLIST=localhost,127.0.0.1` and add the stub's
`http://127.0.0.1:<port>/` to `proxy_endpoints`.

## Reading the response size cap (observe mode)

Nothing is refused for size yet. Every response logs its decompressed size
when its body ends, on the `outbound` channel at `info`:

```
outbound response size: path=system-key destination=https://openrouter.ai/api/v1/chat/completions status=200 cap=33554432 bytes=48211 outcome=complete
```

`outcome` is `complete`, `cancelled` (the caller stopped reading, e.g. the
browser left), or `error`. `overCap=true` is appended when the body passed the
cap. Two `warn` lines say what an enforced cap would have refused:

- `wouldRefuse=declared-length` — the `Content-Length` was already over the cap
  (an enforced cap refuses before reading). With compression this is the
  compressed length.
- `wouldRefuse=stream-reached-cap` — the decompressed byte count passed the cap
  mid-body (an enforced cap ends the stream with `response-too-large`). A
  small compressed response that trips this is a decompression bomb, or a very
  repetitive payload.

The `destination` is the origin + path of the URL the caller sent, with no
query string; on a redirected call it is still the original URL.

To choose enforced values, pull the sizes per path over a representative
window with the `tail-logs` skill and take the largest real responses:

```
./scripts/tail-logs.sh --env production --service realm-server --filter 'outbound response size: path=system-key' --since 2d --no-follow --confirm
./scripts/tail-logs.sh --env production --service realm-server --filter 'wouldRefuse=' --since 2d --no-follow --confirm
```

Any `wouldRefuse` line at the current caps names a real response the
enforced cap would break; raise the cap above it or account for it before
switching to enforcement.

## Diagnosing a failing forward

1. `400 Header x-boxel-… may not be forwarded` — the card sent a Boxel header
   in `headers`; remove it from the card's call.
2. `502 Destination refused: <host> resolves to a private or reserved address`
   — check what the host resolves to from the task (`dig +short <host>`). A
   `proxy_endpoints` row pointing at an internal service is not supported.
3. `502 Destination refused: Only https URLs are allowed` — the row (or a
   vendor redirect) uses `http:`. Fix the row; vendors that redirect to HTTP
   are refused by design.
4. `504` — the vendor did not connect in 10 s or finish in 10 min. Compare
   with the vendor's status page before touching the timeouts.

## Response scrubbing (developers)

Any vendor may echo a credential back: in a body, a header, an error or a
redirect. `outboundFetch` registers each form of the `credential` it attaches
with the request's `CredentialScrubber`
(`packages/realm-server/lib/outbound/scrubber.ts`), and returns a `Response`
whose status text, headers and body have already had every registered value
replaced with `[REDACTED]`. The body is scrubbed after decompression and after the size
count. Nothing upstream of the scrubber sees the response.

### Registering a value

An attached `credential` is registered for you. Anything else that carries a
credential into the request (a value substituted into a body template, the
output of a transform) is registered by the caller, on the scrubber it passes:

```ts
let scrubber = new CredentialScrubber();
// A transform's output is a credential too:
scrubber.register(Buffer.from(`${user}:${password}`).toString('base64'));
await outboundFetch({ ..., credential, scrubber });
```

- Register **every value that goes into the request and every transform of
  one**, and nothing around it. Never register a `Bearer <value>` header
  value: partial runs of the scheme and the key's public prefix
  (`Bearer sk-`) would redact text that holds no credential, and the value
  inside it is matched anyway.
- A scrubber with nothing registered is a no-op: the response comes back
  untouched.

### What it matches

- the value's vendor prefix plus its first 10 secret bytes, matched whole and
  ignoring ASCII case (a short value is matched whole, at any length; base64
  forms only from 8 characters up). This overlaps the partial runs below, so
  any echo with at least 10 secret bytes is removed in one piece, prefix
  included;
- any run at least `MIN_PARTIAL_LENGTH` (10) bytes long of the value after its
  vendor prefix, ignoring ASCII case. A vendor's `sk-****<last 12>` hint is
  removed; a shorter run is left alone. Vendor prefixes are a fixed list in
  `scrubber.ts` (`PUBLIC_PREFIXES`: `sk-or-v1-`, `sk-ant-api03-`, `sk-proj-`,
  `ghp_`, `xoxb-`, `AIza`, …), matched longest first. They identify no one,
  so text about a key format passes through. They are listed rather than
  recognized by shape: a
  pattern would also take the start of a random base64url tail (`Ab3dE_…`)
  for a prefix. A key from a vendor that isn't listed simply has no prefix,
  so every run of it counts. To add a vendor, add its fixed prefix to the
  list;
- percent-encoding in either hex case (mixed with literal characters), JSON
  `\uXXXX` and short escapes, HTML numeric and named entities. These are
  decoded into a second view of the text, and that view is searched too;
- base64 and base64url at each of the three byte alignments the value can sit
  at inside a longer encoded run, in full or as a partial run of at least 10
  characters.

A response with no match passes through byte for byte, binary included. The
scrubber works on bytes and never decodes the body as a string. A match is
replaced as a whole with one `[REDACTED]`, even when the stream splits it
across chunks, so the body's length changes, and the returned headers drop
`content-length`.

### The window

At a chunk boundary the stream holds back only the tail that could still be
the start of a match. That is the trailing run of bytes that can appear in a
registered value (in any of its forms) or in an escape sequence, and it is
never longer than `holdbackBytes`: 12 bytes (the longest escape sequence)
times one more than the longest whole needle, which is at most the longest
vendor prefix plus 10 characters, so about 170–300 bytes whatever the key's
length. A byte that can't belong
to a match releases everything before it. An SSE event ends in `\n\n`, so a
streamed generation is delivered event by event without waiting for the next
one. The stream also keeps the last `holdbackBytes` it delivered as lookbehind,
so a match split across any number of chunks is still recognized. Memory stays
bounded by the chunk in hand plus the window.

When the source stream fails partway (a dropped connection, or a size cap that
ends the stream), the held tail is **discarded, never flushed**. Everything the
caller received had already cleared the window, so no partial credential
leaks.

### Diagnosing `[REDACTED]` in a response

The vendor echoed something that matches a registered value. If the vendor
wasn't echoing a credential, the likeliest cause is that a short or
low-entropy value was registered and is matching ordinary text: check what the
path registers. Never raise `MIN_PARTIAL_LENGTH` or skip registration to make
it go away.
