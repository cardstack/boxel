---
name: realm-auth
description: Architecture of realm and realm-server authentication — the token families (matrix access token, realm-server session, per-realm session, delegated, prerender), what each verification path actually enforces, the lifetimes and who else reasons about them, and the operator runbook for revoking a user's sessions (deactivate the matrix device FIRST, then revoke, or the client just re-mints). Use when touching any auth path — minting or verifying a JWT, changing a token lifetime or claim, adding an endpoint behind jwtMiddleware / multiRealmAuthorization, editing the permission-match or revocation checks — and when responding to a suspected leaked or misissued session. Triggers on `createJWT`, `verifyJWT`, `retrieveTokenClaim`, `isSessionRevoked`, `SESSION_TOKEN_TTL`, `_server-session`, `_realm-auth`, `_delegate-session`, "revoke sessions", "token expired", "PermissionMismatch", or a 401 whose cause isn't obvious.
---

# Realm auth — token families and their invariants

**The governing fact: every boxel token except the matrix access token is a
stateless bearer JWT.** Verification is a signature check, an expiry check, and
a small number of claim comparisons against live database state. There is no
session table and no token store, so nothing can be looked up, listed, or
counted — only signed and later re-derived. Every design consequence below
follows from that.

Matrix is the root authority. Minting any boxel token requires proving control
of a matrix account (an openid token exchange), and Synapse is the only party
that can genuinely revoke — its access tokens are real server-side sessions.
Boxel tokens are derived credentials with their own, weaker retirement story.

## The token families

| Token                | Minted by                                              | Claims                                                                                      | Lifetime                                                                   |
| -------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| matrix access token  | Synapse                                                | n/a                                                                                         | no expiry by default                                                       |
| realm-server session | `POST /_server-session`                                | `{user, sessionRoom}`                                                                       | `SESSION_TOKEN_TTL` (24h), or `EXTENDED_SESSION_TOKEN_TTL` (7d) on request |
| per-realm session    | `POST /_realm-auth`, and the realm's own session route | `{user, realm, permissions, sessionRoom, realmServerURL}`                                   | `SESSION_TOKEN_TTL`                                                        |
| delegated            | `POST /_delegate-session`                              | same, plus `delegated: true`, `permissions: ['read']`                                       | `DELEGATED_TOKEN_TTL` (30m)                                                |
| prerender service    | `buildCreatePrerenderAuth` (in-process)                | per-realm session shape, plus `realmAuthority: true` (see below)                            | `1d`                                                                       |
| publish-realm        | `handle-publish-realm` (in-process)                    | per-realm session shape                                                                     | `1h`                                                                       |
| diagnostic           | `POST /_diagnostic-render-token` (operator token)      | prerender shape, plus `diagnostic: {id, note, card, scope, realm}`, `permissions: ['read']` | `DIAGNOSTIC_SESSION_LIFETIME_SEC` (15m)                                    |

A **diagnostic session** is what an operator renders a live card under to see
it as the indexer does (`boxel realm-server render-token`; the
`indexing-diagnostics` skill has the recipe). The endpoint takes an operator
token for `diagnostic-render`, signed with the seed on the operator's machine,
and mints one session per realm the card's render reads — the owner's read set,
or the card's realm alone with `realmOnly` — each reading as the realm owner
with `realmAuthority`. `diagnostic.scope` is `realm` (the card's realm,
`diagnostic.realm`, alone) or `owner-read-set` (any realm the owner may read
when the session is used). The claim names the scope rather than listing the
realms, so a session's size does not grow with the owner's read set; a list
there would push a large read set past the request-header limit.
`diagnostic.id` is shared by a mint's sessions. The mint and every use log on the
`diagnostic-render` channel with the id and the operator note
(`packages/runtime-common/diagnostic-session.ts` is the leaf module both sides
share).

A prerender session carries `realmAuthority: true` when what it renders is kept
and served to others — indexing, the HTML render, a module's definition render,
skill validation, a capture that persists — and not when the result goes back
only to whoever asked (a command, a capture answered to its requester). The
search routes read a request as a realm-authority principal when its session
carries that claim **or** the request carries `x-boxel-during-prerender`: a
render tab marks every request it sends, whatever session it holds, including
one minted before its minter carried the claim. Such a principal's searches
find what the realm ACL grants it and nothing more — no policy scopes them, and
`policyQueryScope` throws `RealmAuthorityPolicyScopeError` if handed one. The
claim is read on the search paths only: a single-card read is judged by the
gate on its `user` like any other caller's. Both verification paths expose it —
`RequestContext.realmAuthority` on a realm, the `principal` in
`multiRealmAuthorization`'s state on the federated endpoints.

The two lifetimes a browser holds live in `packages/runtime-common/session-token.ts`
— a **leaf module with no imports**, so the CLI can read them without pulling the
runtime-common barrel. Keep it that way: the barrel drags in base-realm type
references that other packages can't resolve.

**Every session token above is signed with `REALM_SECRET_SEED`** — both families,
minted and verified with the same seed — except the diagnostic session, which is
signed under `diagnosticSessionSecret(seed)`, the seed with a family suffix.
Because of that, every verifier that doesn't ask for a diagnostic session by
name refuses it on its signature; a realm (`Realm.#verifySession`) and
`multiRealmAuthorization` pick the key from the token's own `diagnostic` claim,
and a token that claims it falsely fails verification. Don't confuse it with
`REALM_SERVER_SECRET_SEED`, a separate env var that signs the monitoring
auth token and no session token.

`REALM_SECRET_SEED` is consumed by realm-server, worker, **and** worker-manager,
so rotating it needs an atomic rollout across all three or prerender auth starts
failing mid-deploy. Rotation is the only way to invalidate every token at once,
and it is almost always disproportionate — see the runbook.

## What verification enforces

**Per-realm session** (`packages/runtime-common/realm.ts`, the request-auth
path). In order:

1. `verifyJWT` — signature and `exp`.
2. **Session revocation** — `isSessionRevoked(dbAdapter, token.user, token.iat)`.
   Deliberately placed on the token's _bearer_, before the delegated branch and
   before any `X-Boxel-Assume-User` indirection, so revoking a user also kills
   sessions delegated on their behalf.
3. **Delegated branch** (returns early): the token must name _this_ realm —
   without that check a token minted for realm A replays against realm B
   whenever the bound user can also read B, because delegated tokens are signed
   with the server-wide seed and skip the permission match. Read-only is
   enforced separately.
   A **diagnostic branch** sits beside it and also returns early: the session
   must cover this realm (`acceptedDiagnosticClaim`, which also bounds
   `exp - iat` to the family's lifetime), the request must need `read`
   only (anything else is an `AuthorizationError`, which no policy turns into
   an admission), and the owner it reads as must still have read. On the
   public path, a write presented with a token whose claim says it is a
   diagnostic session is refused before the token is verified and before any
   `X-Boxel-Assume-User` indirection, so it holds for an expired session too
   rather than falling through to an anonymous write; a read there takes the
   owner's identity only once the session passes the claim and revocation
   checks. A diagnostic session sets `RequestContext.diagnosticSession`, and
   `#captureReader` draws such a caller as no one, so a capture or a signed
   capture URL never carries the owner's identity past the session.
4. **Exact permission match**: `JSON.stringify(token.permissions?.sort()) !==
JSON.stringify(userPermissions.sort())` → `PermissionMismatch`.

`userPermissions` on that last line is the **effective** set, never the raw
per-username row: `effectiveRealmPermissions` unions the realm's `users` grant
(gated on the user holding a Boxel account: a row in the realm server's `users`
table, written on their first sign-in), its `*` grant, and the user's own row.
It is the single derivation — `RealmPermissionChecker.for` and
`fetchEffectiveRealmPermissions` both call it, each reading the `users` table
through `accountCheck`, so it needs only the database and never asks the
homeserver (whose profile endpoint ADR 011 §1.6 closes to users who share no
room with the subject). **Every mint site must produce that same union.**
Minting the bare row is the standing bug in this area: on a realm with a shared
grant it yields a token that can never match, and the failure is a flat
`PermissionMismatch` 401 with nothing pointing at the minter. `fetchUserPermissions` is _not_ a substitute — its wildcard arm drops the
`*` grant for any realm the user has a row in, and it ignores `users` rows
entirely — so the realms it enumerates for a multi-realm bundle still carry
row-only claims.

**Direct writers** are the opposite question: not "may this request write?" but
"is this person a writer of the realm in their own name?", asked before a realm
takes something on that a person answers for (sharing a key into it, scheduling
a pipeline they pay for). `isDirectWriter` / `fetchDirectWriters` in
`db-queries/realm-permission-queries.ts` answer it from the user's own row
alone. Wildcard rows (`*`, `users`) are excluded because they grant write to
everyone they match without naming anyone, so no one is accountable through
them. A bot account (`isBotAccount`, which matches the realm-user and
service-writer naming conventions) acts for the platform rather than a person,
and a policy grant admits a write without making its caller a writer of the
realm, so neither counts either. Never answer this question with the effective
set.

**Realm-server session**: `retrieveTokenClaim` (signature + `exp`) plus the same
revocation check, at each of `jwtMiddleware`, `multiRealmAuthorization`, and
`handle-download-realm`. There is **no** permission claim on this token, so the
permission-match invariant does not apply to it at all. A delegated session
verifies here too, since it is signed with the same seed, so each verifier also
decides what it may do. `jwtMiddleware` and `handle-download-realm` act as the
user in full and refuse it outright (401 `TokenInvalid`) through
`retrieveUserSessionClaim`. `multiRealmAuthorization` holds it to the one realm
it names. A diagnostic session verifies only at `multiRealmAuthorization`
(`retrieveDiagnosticSessionClaim`): a `realm`-scoped session only for a
request naming its realm alone, an `owner-read-set` session as the owner,
whose unreadable realms are judged as for any of the owner's sessions. Every
`jwtMiddleware` route refuses it.

Permissions and revocation state are both read **fresh from Postgres on every
request** — no memoization — because a change made against one replica has to
take effect on the others immediately.

### The permission match is not a revocation mechanism

A tempting incident response is to flip a user's permissions to invalidate their
outstanding tokens. It works only _while_ the live set differs from what the
token carries. Restore the user's access and the old token validates again, and
the vocabulary is only `read | write | realm-owner` — there is no inert flag to
toggle. Any set that blocks the stale token equally blocks the legitimate owner.
Use revocation instead.

## Revoking a user's sessions

`users.sessions_revoked_at` holds an epoch second. Any token whose `iat`
predates it is rejected, which covers **every** family uniformly — including
prerender and delegated — because the check reads `iat` and knows nothing about
lifetime or shape. A token with no `iat` is treated as revoked.

Operator action: `POST /_grafana-revoke-user-sessions?user=<matrix id>`, or the
"Revoke sessions" button on the Users dashboard.

**The order matters, and getting it wrong accomplishes nothing:**

1. **Deactivate the user's matrix device in Synapse.** This removes the ability
   to mint.
2. **Then revoke.** This retires what was already minted.

Revoke first and a client holding a live matrix session simply re-authenticates
and carries on. That is intended — matrix is the authority on whether the person
is still allowed in, and it is what lets a legitimate second device recover
silently instead of being logged out. Against a bearer who copied a JWT and has
**no** matrix session, revocation alone is a permanent cutoff, because minting
requires the openid exchange.

Revocation is per-user and immediate; it is not a sign-out and does not touch
the matrix session.

## Lifetimes have distant readers

Changing a TTL is not a local edit. Anything that reasons about how much life a
token has left must stay well inside the window:

- The CLI's `SERVER_TOKEN_EXPIRY_SAFETY_MARGIN_SEC` in `profile-manager.ts`. A
  margin **at or above** the TTL makes every freshly minted token look
  already-expired, so the CLI re-mints on every call — and where the matrix
  re-auth path can't run (no TTY, i.e. CI and scripted use) the command fails
  outright rather than using the valid token it holds. This shipped once when the
  server TTL moved to 24h against a 1-day margin.
- Consumers handed the **bare** token via `BoxelCLIClient.getServerToken()`,
  which use it outside any wrapper that could notice a 401. They cannot recover
  from expiry at all, which is why `_server-session` accepts
  `lifetime: "extended"` for a 7-day token. Any authenticated caller can ask, so
  the 24h default is a convention rather than an enforced ceiling; what bounds it
  is that minting still needs a live matrix session and revocation still applies.

When writing a test that asserts near-expiry behavior, **backdate the mint**. A
token inspected in the same second it was signed has exactly the full TTL
remaining, and the comparison is a strict `<`, so the obvious version of the
test passes even against a broken margin.

## Expiry recovery, and where it's thin

Three layers, in decreasing proactivity:

- `getOrRefreshServerToken` re-mints when near **or past** expiry (`exp - now`
  goes negative, which is trivially under any margin) — there is no distinct
  expired case.
- `authedRealmServerFetch` retries once on a 401 after refreshing, covering the
  race where a token lapses between the check and the request landing.
- `authedRealmFetch` (per-realm) has **no** proactive check; it recovers
  reactively on a 401 by clearing _all_ cached realm tokens plus the server token
  and re-fetching. Correct but blunt, and the thinnest of the three.

Re-minting needs the stored **matrix** access token, not the realm token — and
Synapse doesn't expire those by default, so recovery is silent. The interactive
`reAuthenticate()` path only fires on a `MatrixAuthError`, meaning Synapse
rejected the matrix token: device deleted, password changed, admin logout.

## Client-side token storage

Three separate keys persist a browser session, not one:

- `auth` — the matrix `LoginResponse`, including the access token.
- `boxel-session` — a `{realmURL: jwt}` map of per-realm tokens.
- `boxel-realm-server-session` — the single realm-server token.

The host's `logout()` clears all three and calls `client.logout(true)`, which
genuinely revokes the matrix token server-side. It does **not** revoke the realm
JWTs — logout discards the browser's copies, nothing more. A service worker
injects the per-realm token into cross-origin realm requests, and
`RealmService.reauthenticate()` (single-flighted per realm) re-mints on auth
failure, gated on `matrixService.isLoggedIn`.

That gate is the load-bearing security property of the whole recovery story: a
holder of only a copied realm JWT has no matrix session and therefore cannot
re-mint, while a legitimate device recovers without the user noticing.

## When changing any of this

- Add a new endpoint behind `jwtMiddleware` or `multiRealmAuthorization` and the
  revocation check comes with it. A handler that verifies its own token and
  acts as the user must call `retrieveUserSessionClaim`, which checks
  revocation and refuses a delegated session — `handle-download-realm` is the
  precedent. Calling `retrieveTokenClaim` alone accepts a delegated session as
  the user in full.
- Match the sync/async shape of any interface you implement exactly. A sync
  method declared async returns a coroutine, and storing its repr as an
  identifier (which embeds a reused heap address) can cross-link one user's
  external identity into another's account. Mocked unit tests cannot catch an
  interface-shape mismatch — assert the shape, or drive the real handler.
- Reads of the `users` row treat a missing row as _not_ revoked. That is safe
  only because `revokeUserSessions` upserts; preserve that pairing.
