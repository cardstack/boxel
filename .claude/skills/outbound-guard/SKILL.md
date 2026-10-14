---
name: outbound-guard
description: Operate and diagnose the realm server's guarded outbound client (`packages/realm-server/lib/outbound/`) — the one client every call that sends a stored credential to an outside vendor goes through (`_request-forward`, the OpenRouter passthrough, and later callApi, token minting and pipelines). Covers what the guard refuses (non-HTTPS, private / loopback / link-local / metadata / IPv4-mapped addresses, `X-Boxel-*` headers, redirect hops into any of those), the local development allowlist and the startup self-check that refuses it on a deployed server, the connect and total timeouts, how a refusal reaches the caller (400 / 502 / 504), reading the response size cap's observe-mode logs to choose enforced cap values, the pre-substitution invariant (every recorded URL is the origin and path of the one the caller sent, never the one with the credential attached, and never the caller's query string), and finding a send-path error by the key's name in logs and Sentry. Use when a forward fails with 502 "Destination refused" or 504, when the realm server won't boot with "Outbound guard self-check failed", when tracing a send-path error back to the key it used, when adding a destination to `proxy_endpoints`, when pointing a local stack at a local vendor, or when deciding the enforced response size caps.
---

# Outbound guard (operators)

Every realm-server call that carries a stored credential to an outside vendor
goes through `outboundFetch` in `packages/realm-server/lib/outbound/client.ts`.
Today that is `POST /_request-forward` (including streamed calls) and
`POST /_openrouter/chat/completions`. The guard is always on, in every
environment; local development gets a short allowlist, never an off switch.

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
  scrub matches the value raw, percent-encoded in both hex cases,
  form-encoded, base64/base64url at every alignment, and JSON-escaped; a
  removed value reads `[REDACTED]`.
- **Sentry's fetch instrumentation skips guarded requests.** With tracing on
  it would record each outgoing URL and its query string as a breadcrumb; with
  tracing off it adds `sentry-trace` / `baggage` headers to the request. A
  guarded request gets neither (`guardedFetchIntegration` in
  `lib/outbound/sentry.ts`, installed by `instrument.ts`). Every other fetch
  the server makes is instrumented as before.
- A vendor's error body on a streamed call is scrubbed before it is logged or
  framed back to the caller.

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

## Settings

Read once at startup from the environment by `startOutboundGuard` in `main.ts`:

| Variable                                 | Default  | Meaning                                                                    |
| ---------------------------------------- | -------- | -------------------------------------------------------------------------- |
| `OUTBOUND_DEV_ALLOWLIST`                 | empty    | comma-separated host names that may use `http:` and resolve locally        |
| `OUTBOUND_CONNECT_TIMEOUT_MS`            | 10000    | per connection                                                             |
| `OUTBOUND_TOTAL_TIMEOUT_MS`              | 600000   | whole exchange, body included                                              |
| `OUTBOUND_RESPONSE_CAP_SYSTEM_KEY_BYTES` | 33554432 | observe-mode cap for the system-key path (`_request-forward`, passthrough) |
| `OUTBOUND_RESPONSE_CAP_CALL_API_BYTES`   | 10485760 | observe-mode cap for `callApi`                                             |

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
