---
status: proposed
date: 2026-10-27
scope:
  - packages/secure-origin/src/telemetry/**
  - packages/secure-origin/src/shell/telemetry.ts
  - packages/secure-origin/src/shell/app.gts
  - packages/secure-origin/src/shell/keys/keys-window.gts
  - packages/secure-origin/src/security/session.js
  - packages/secure-origin/src/security/matrix.js
  - packages/secure-origin/tests/telemetry.test.ts
  - packages/secure-origin/tests/helpers/telemetry-secrets.ts
  - packages/secure-origin/tests/integration/telemetry-test.gts
  - packages/realm-server/handlers/handle-client-telemetry.ts
  - packages/realm-server/routes.ts
---

# 014. Beacon the secure origin's telemetry to the realm server, and let no secret into it

The secure origin's pages (sign-in, registration, the key pages) report what
they do the way the host app does: batched beacons to the realm server's
`/_client-telemetry`, one `boxel:client-perf` log line per event. Its pages
beacon before anyone has signed in there, and they exist to hold secrets, so
this ADR records where the beacons go, how an unsigned beacon is admitted, and
the rule that the instrument is built so it can't carry a secret, rather than
merely not doing so.

## 1. Decision

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this
document are to be interpreted as described in BCP 14 (RFC 2119, RFC 8174) when,
and only when, they appear in all capitals, as shown here.

### 1.1. Where beacons go

The secure origin's pages MUST beacon to the realm server's
`/_client-telemetry`, the origin its policy already names in `connect-src`.
The secure origin MUST NOT gain a telemetry route of its own (ADR 008 §1.7:
it serves its pages and nothing else). Each batch MUST name
`client_app: 'secure-origin'`, and the realm server MUST write a batch's
`client_app` on every line it emits, `host` when the batch names none or one
it doesn't know.

### 1.2. Who a beacon is attributed to

A beacon MUST carry the window's own secure session as its bearer token when
the window has one, never the app's, and its body MUST NOT name a user. The
realm server MUST attribute a beacon to the user of the session it carries,
and MUST attribute a beacon without a session it honours to nobody, whatever
user the body names. The realm server MUST accept a beacon without a session,
so sign-in is observable. It MUST write such a beacon as the secure origin's
whatever app it names, so unauthenticated input never reaches the host's
lines, and MUST rate limit its events by the caller's network (an IPv4
address, or an IPv6 /64), sized for the busiest page's traffic.

### 1.3. Nothing sensitive leaves a page

The instrument MUST record a request only as an endpoint label from a fixed
list, its method, status, timing, size and correlation id. It MUST NOT read a
request's or response's body, nor any header but the response's
`Content-Length`, which gives its size. A path segment that can carry an id
MUST be matched, never copied, and a query string MUST NOT be read. A page
MUST be named by a label from a fixed list, never by its address. An error's
message MUST be scrubbed before it is recorded: a refused request's message
replaced by its status and code, and anything quoted, any URL and any Matrix
ID or email address cut. Its stack MUST keep only its frames. A main-thread
freeze MUST be attributed only by each blocking script's URL, reduced to its
origin and path and dropped unless the path is a script file's, its function
name and the type of what invoked it, never by the invoker itself, which can
name an element or a URL with its query. Tests MUST drive every page that
takes a credential, a secret or a private name (the key pages, sign-in, the CLI
pages, registration and password reset) with known values, and check that no
beacon carries what was typed, sent or answered.

### 1.4. Telemetry never fails a page

A failed beacon MUST be dropped, and every hook MUST swallow its own errors.
Until the shell starts the instrument, requests MUST go out exactly as given,
so the credential fields, which load the same request module, are unaffected.

## 2. Rationale

One sink keeps one dashboard and one diagnosis path for both apps. The realm
server's `/_client-telemetry` already caps body size and event count, already
stamps the authenticated user over a self-reported one, and is reachable from
the secure origin without widening its policy. A route on the secure origin
would add a server endpoint to the origin ADR 008 keeps to its pages alone.

The realm server's route required a session before the secure origin existed,
because the host only beacons once it has one. The secure origin's blind spot
is exactly the time before a session: a sign-in that fails, or a Matrix server
that doesn't answer. So an unsigned beacon is admitted, but nothing in it is
believed about who sent it, and the instrument that bounds the harm of an open
log endpoint is a rate limit per caller, not a login.

Redaction by convention fails the first time someone adds a field. The origin
holds key values, passwords and session tokens, and also names that are
private to their owner (key names, share labels, workspace names and URLs). A
fixed label list and a message scrub can't emit a value they were never
written to copy, and the test with known secrets catches a new path that
does.

## 3. Considered options

- **The realm server's route, open to unsigned beacons and rate limited
  (chosen).**
- **Hold beacons until the window signs in.** Sign-in failures, the cases the
  origin most needs to see, would never be sent.
- **A same-origin route on the secure origin.** It still has to accept
  unsigned beacons, and it adds an endpoint to the origin ADR 008 keeps to its
  pages.
- **Send only `message_key` for errors.** The key is derived from the message,
  so it would carry the same quoted text unless scrubbed first.
- **Redact known secrets with `security/redact.js`.** It needs the secret
  values in hand; the instrument would have to be handed every key value and
  name, which is the opposite of keeping them out of it.

## 4. Sources

1. [ADR 008](008-build-the-secure-origins-pages-as-their-own-ember-app.md)
   §1.6 and §1.7.
2. `.claude/skills/client-perf-diagnosis/SKILL.md`, the host's telemetry.
3. `.claude/skills/rate-limit-store/SKILL.md`, the store the limit uses.

## 5. Remediation

No known gaps.
