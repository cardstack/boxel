---
name: outbound-guard
description: Operate and diagnose the realm server's guarded outbound client (`packages/realm-server/lib/outbound/`) — the one client every call that sends a stored credential to an outside vendor goes through (`_request-forward`, the OpenRouter passthrough, the OpenRouter generation-cost lookup, and later callApi, token minting and pipelines). Covers what the guard refuses (non-HTTPS, private / loopback / link-local / metadata / IPv4-mapped addresses, `X-Boxel-*` headers, redirect hops into any of those), the local development allowlist and the startup self-check that refuses it on a deployed server, the connect and total timeouts, how a refusal reaches the caller (400 / 502 / 504), and reading the response size cap's observe-mode logs to choose enforced cap values. Use when a forward fails with 502 "Destination refused" or 504, when the realm server won't boot with "Outbound guard self-check failed", when adding a destination to `proxy_endpoints`, when pointing a local stack at a local vendor, or when deciding the enforced response size caps.
---

# Outbound guard (operators)

Every realm-server call that carries a stored credential to an outside vendor
goes through `outboundFetch` in `packages/realm-server/lib/outbound/client.ts`.
Today that is `POST /_request-forward` (including streamed calls),
`POST /_openrouter/chat/completions`, and the generation-cost lookup either of
them makes when a response carried a generation id but no inline cost
(`OpenRouterCreditStrategy` in `lib/credit-strategies.ts`). The guard is
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

Refusals and timeouts log at `warn` as `… stopped by the outbound guard: <message>`:
on `request-forward` or `openrouter-passthrough` for a non-streamed call, and on
`proxy-forward` for a streamed one (`stream: true`). The message names the host, never
the full URL (a `url-parameter` credential sits in the query string).

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

The `destination` is origin + path only: no query string.

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
