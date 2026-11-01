---
status: proposed
date: 2026-01-08
recorded: 2026-10-18
retroactive: true
scope:
  - packages/realm-server/**
  - packages/runtime-common/realm-auth-client.ts
  - packages/runtime-common/matrix-backend-authentication.ts
  - packages/runtime-common/matrix-client.ts
  - packages/runtime-common/matrix-server-name.ts
  - packages/runtime-common/tasks/**
  - packages/runtime-common/worker.ts
  - packages/runtime-common/realm-permission-checker.ts
  - packages/runtime-common/db-queries/realm-permission-queries.ts
  - packages/runtime-common/realm.ts
  - packages/host/app/services/realm-server.ts
  - packages/host/app/services/matrix-service.ts
  - packages/host/app/services/realm.ts
  - packages/host/app/services/store.ts
  - packages/host/app/services/host-mode-service.ts
  - packages/boxel-cli/src/lib/profile-manager.ts
  - packages/boxel-cli/src/lib/seed-auth.ts
  - packages/matrix/support/synapse/**
---

# 004. Federate realm servers, each paired with its own Matrix homeserver

Boxel is designed as a federation of independent realm servers. Each realm
server is paired with exactly one Matrix homeserver, which provides identity
for that server. A user of one homeserver can be granted access to realms on
another realm server, and that realm server verifies the user against the
user's own homeserver through Matrix federation. Federation is not built yet,
and the host still allows only one realm server. This ADR records the target
design and the rules that keep new code compatible with it. The `users`-row
rule in §1.4, and §1.5, §1.6, and §1.9, were decided when this ADR was
recorded, not on its `date`. The second paragraph of §1.3, and the first
sentence of §1.4, were decided after it was recorded.

## 1. Decision

### 1.1. One homeserver per realm server

Each realm server MUST be paired with exactly one Matrix homeserver. The realm
server's own Matrix users MUST be registered on that homeserver. A host app
MUST use the homeserver paired with the realm server that serves it.

### 1.2. Users are identified by full Matrix ids

Code MUST identify a user by the full Matrix user id (`@localpart:server`).
Code MUST NOT key, store, or compare users by localpart alone. Code MUST NOT
derive a Matrix server name from a hostname. It MUST use the configured server
name (`MATRIX_SERVER_NAME`).

### 1.3. Identity is verified by the user's own homeserver

A realm server MUST verify a user's OpenID token with the homeserver that
issued it, named by the token's `matrix_server_name`, through
`/_matrix/federation/v1/openid/userinfo`. Each realm server MUST issue and
verify its own session tokens. A realm server MUST NOT accept another realm
server's session token as proof of identity.

A realm server MUST NOT send a request to a homeserver that a token names,
unless that homeserver is the paired one or its operator lists it in
`MATRIX_FEDERATION_ALLOWLIST`. It MUST refuse a token that names any other
homeserver. It MUST refuse a token when the user that the homeserver returns
is not a user of that homeserver.

### 1.4. Realm permissions decide access

A realm server SHOULD accept users from every homeserver it verifies tokens
with (§1.3). Realm permissions and policies MUST decide what each user can do.
A realm MAY limit access by homeserver in its policy, by matching the
`:server` suffix of the user id.

A realm's `users` permission row MUST grant access only to users of the
paired homeserver. A user of another homeserver MUST be granted access by full
id or by a policy rule.

### 1.5. Realm paths for users of other homeservers

A realm created by a user of the paired homeserver MAY keep the path
`/<localpart>/<endpoint>/`. A realm created by a user of another homeserver
MUST get a path that includes that user's server name, so that two users with
the same localpart cannot claim the same path. This ADR does not set the path
format.

### 1.6. Each realm server serves its own infrastructure realms

Each realm server SHOULD serve its own copy of the infrastructure realms
(base, catalog, and skills). What a prefix means in content read from another
realm server is an open question (§5).

### 1.7. Each realm server answers only for its own realms

A realm server endpoint MUST answer only for the realms that server serves.
The client SHOULD split a query over realms on several realm servers into one
request to each server, made with the client's session on that server. The
client SHOULD merge the results. It SHOULD report a server it cannot reach
instead of failing the whole query.

### 1.8. The host has one home realm server

The host SHOULD treat the realm server that serves it as its home realm
server. It SHOULD reach each realm server, the home one included, through a
per-server object that holds that server's session token and makes that
server's auth and search calls.

### 1.9. No new single-server assumptions

New code MUST NOT add an `assertOwnRealmServer` call site, or another
assumption that only one realm server exists, unless a TODO at that site cites
this ADR.

## 2. Rationale

Federation lets organizations and individuals run their own realm server and
homeserver, and keep their data and identity under their own control. As with
email and Matrix, no single operator controls the network [10].

The pairing dates from the first realm authentication, which proved a user's
identity through Matrix [1]. In 2026 it was stated as an established rule:
"each realm server has a matrix server that is providing identity for their
respective realm server" [2]. Matrix is the root identity authority: minting
any Boxel token requires proving control of a Matrix account [4]. Verifying a
user with their own homeserver keeps that true across realm servers. Trust
between realm servers would be a second identity system that competes with
Matrix [10].

A token's `matrix_server_name` comes from a caller the realm server has not
authenticated yet. Without a bound, any caller could make the realm server
send discovery and userinfo requests to hosts of the caller's choice, so a
realm server contacts only the homeservers its operator lists [14]. The name
is only the caller's claim, so a homeserver may vouch only for its own users.
Otherwise a homeserver that a caller runs could vouch for a user of the paired
homeserver [14].

A localpart is unique only on one homeserver, so only the full id names a
user. A server name cannot be derived from a hostname, because Matrix
delegation lets the two differ: the server name `stack.cards` is served by a
host on a subdomain [5]. Policies already treat the `:server` suffix as an
authorization boundary [8], so realm permissions decide access rather than a
server-level allowlist [10]. A realm's `users` row keeps meaning users with an
account on the paired homeserver, so opening a realm to the whole federation
takes an explicit rule [10]. Users of other homeservers get server-qualified
realm paths because localparts collide [10].

Each server serves its own infrastructure realms [10]. Each VirtualNetwork
maps the `@cardstack/<realm>/` prefixes to the realms its own environment
names (ADR 002 §1.4) [9]. That makes card JSON portable between environments,
but not between realm servers (§5).

A cross-server query fans out from the client because each server applies its
own permissions to its own realms, with the caller's own session on that
server. A proxy would need the home server to act as the user on other
servers, and no delegation model for that exists. A client that fans out can
still show the results it has when one server is unreachable [10], as boot
already does for a user's trusted realm servers [7]. The home-realm-server
split was proposed because the single `realm-server` service "is going to
continue to attract federation-unfriendly code and callers" [2].

The single-server checks are a deliberate stopgap: "`assertOwnRealmServer()`
preserves the single-server invariant" [6]. Each existing call site carries a
TODO to remove it once federated identity exists. §1.9 keeps new ones as easy
to find [10].

## 3. Considered options

- **Federated realm servers, each paired with its own homeserver (chosen).**
- **One central realm server and homeserver.** This gives up self-hosting
  and an open network [10].
- **Realm servers trust each other's session tokens**, for example through
  published signing keys. This makes a second identity authority beside
  Matrix [10].
- **A per-server allowlist of homeservers that decides what their users may
  do.** Realm permissions and policies already express this per realm [10].
  The list in §1.3 bounds only which homeservers a realm server sends
  requests to [14].
- **Verify tokens with any homeserver, sending each request through the
  outbound guard's destination check.** The guard refuses private and
  reserved addresses, but a caller would still choose which public hosts the
  realm server sends requests to [14].
- **One shared deployment of the infrastructure realms.** Each server serves
  its own copy instead [10].
- **The home realm server proxies cross-server queries.** This needs
  delegated identity, which does not exist [10].

## 4. Consequences

Beyond the gaps under Remediation, federation needs this work:

- The host's `assertOwnRealmServer` call sites go away once the host reaches
  each realm server through its own per-server object (§1.8).
- `assume-user`, prerender tokens, and account-data writes through the
  Synapse admin API reach only the local server's realms and users.
- Every test realm server shares one homeserver.

## 5. Open questions

- **What does a prefix mean in content read from another realm server?** The
  host maps each prefix to its own server's realm and serves base from its own
  bundle [11, 12]. So a host paired with server A resolves a
  `@cardstack/catalog/` link in a card from server B to A's catalog, and runs
  B's card definitions against A's base. The leading candidate treats base as
  part of the platform: the reader's copy, under a compatibility rule that
  servers in a federation follow. Catalog and skills would then resolve
  against the server the content came from, as URLs, which needs module
  imports resolved by the importing module's server. Ask Luke Melia, and
  `@backspace`, who designed prefix resolution [13].

## 6. Sources

1. #967 (`1a296c8936`, `0bc38061ed`), which added realm authentication over
   Matrix.
2. #3804, merged 2026-01-08: Hassan Abdel-Rahman's statement of the 1:1
   pairing, and Luke Melia's review proposing per-server fan-out and a
   `home-realm-server` service.
3. #3672, which moved realm-server authentication to OpenID tokens;
   `verifyOpenIdToken` in `packages/runtime-common/matrix-client.ts`.
4. `.claude/skills/realm-auth/SKILL.md`: "Matrix is the root authority."
5. #4253, which added `MATRIX_SERVER_NAME`; #1002, which first separated the
   server name from the homeserver hostname.
6. #5285, which assembles a user's realms from their trusted realm servers.
7. #5381, which degrades gracefully when a trusted realm server is
   unreachable.
8. `skills/realm-policy-authoring/SKILL.md` in cardstack/boxel-skills, on
   `actor() | endswith(":school.example")`.
9. ADR 002 §1.4 and §2.
10. Luke Melia, answering this ADR's questions, 2026-10-18.
11. `packages/host/app/services/network.ts`, which registers each prefix
    against the realm the host's own config names.
12. `shimBundledBase` in `packages/host/app/lib/bundled-base.ts`, which serves
    `@cardstack/base/*` from the host bundle.
13. `docs/realm-resource-identifiers.md`, added in #5720.
14. #7085, which verifies OpenID tokens with their issuing homeserver, and its
    review, which weighed the allowlist against the outbound guard.

## 7. Remediation

Known gaps are listed in [remediation/004.md](remediation/004.md).
