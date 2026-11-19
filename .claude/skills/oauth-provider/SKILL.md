---
name: oauth-provider
description: Operate and diagnose Boxel as an OAuth provider — outside apps (an MCP client such as Claude, a CLI, a connector) signing in to Boxel and calling it with a Boxel access token. Boxel signing in to outside vendors is the other direction, in the `oauth-connections` skill. Covers the provider's routes under `/_oauth-provider` and the discovery documents, its tables (`oauth_provider_dynamic_clients`, `oauth_provider_objects`, `oauth_provider_grants`, `oauth_provider_tokens`, `users.oauth_grants_revoked_at`) and which values are stored only as a hash, the `BOXEL_OAUTH_PROVIDER_ENABLED` flag, `BOXEL_OAUTH_CONFIG` (`cookieKeys`, `jwks`), the three rate-limit settings and the daily cleanup, every line on the `boxel:oauth-provider` log channel and what to do about it, tracing a connection that failed at registration, authorize, consent, finish, token, refresh or a call, ending a user's connections (the Connected apps routes, the operator's session revocation, or one grant by hand), and rotating `cookieKeys` and `jwks`. Use when a user reports an app that can't connect to Boxel or stopped working, a "Something went wrong" on the authorize page, an OAuth token a resource refused, an alert from the provider's rate limits, when turning the provider on in an environment, or when changing anything in `packages/realm-server/lib/oauth-provider/`.
---

# Boxel's OAuth provider (operators)

Boxel runs an OAuth 2.1 authorization server inside the realm server, so an
outside app can act for a Boxel user with a token the user approved. ADR 021
is the design and its requirements (`docs/adr/021-…`); its remediation file
lists what isn't built yet. Code is in `packages/realm-server/lib/oauth-provider/`,
built on the `oidc-provider` library, with every endpoint going through
Boxel's own checks first (`serve.ts` says which).

This is the opposite direction from `oauth-connections`, where Boxel is the
OAuth client of GitHub, Google and others. Nothing is shared between the two
but the word: different tables, routes, log channel and tokens.

## Where it runs

The provider is on only where `BOXEL_OAUTH_PROVIDER_ENABLED=true`. Off, the
realm server reads none of its settings and serves none of its routes,
discovery documents included. On, the server also needs:

- `BOXEL_OAUTH_CONFIG`: JSON `{"cookieKeys": [...], "jwks": {"keys": [...]}}`.
  Missing or malformed stops the server at start with a message naming what
  is wrong, never the value (`config.ts`).
- A secure origin (`secureOriginURL`): the authorize page and its error page
  are served there (the `secure-origin` skill). So will the Connected apps
  page be, which isn't built yet (ADR 021's remediation file lists it).

A development stack turns it on by default (`mise-tasks/services/realm-server`;
`BOXEL_DEV_OAUTH_PROVIDER=false` turns it off) with keys made once by
`scripts/oauth-provider-dev-config.ts` and kept in the gitignored
`packages/realm-server/.oauth-provider-dev-config.json`; delete that file for
new keys. A deployed server takes both variables from its task definition in
the infra repo. The realm server logs `OAuth provider on: issuer <url>,
resources <ids>` at start when it is on: no such line means it is off.

The issuer is the realm server's own origin. Every route answers only on the
issuer's host; the same path on a published site's host goes on to realm
routing.

## Routes

| Route                                                  | Who calls it                   | What it does                                                                                                                     |
| ------------------------------------------------------ | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `GET /.well-known/oauth-authorization-server`          | an app                         | The authorization server's metadata (RFC 8414)                                                                                   |
| `GET /.well-known/oauth-protected-resource/<path>`     | an app                         | A resource's metadata (RFC 9728), named in its 401 challenge                                                                     |
| `POST /_oauth-provider/reg`                            | an app                         | Dynamic client registration (RFC 7591); no client secret is ever issued                                                          |
| `GET /_oauth-provider/auth`                            | the user's browser             | Starts a flow; on success sends the browser to the interaction route, on a refusal to the authorize page with an error reference |
| `GET /_oauth-provider/interaction/:uid`                | the user's browser             | Sends the browser to the secure origin's authorize page                                                                          |
| `GET`/`POST /_oauth-provider/consent/:uid`             | the authorize page             | The flow's details, and the user's Allow or Deny (answers a ticket); secure window session only                                  |
| `GET /_oauth-provider/interaction/:uid/finish?ticket=` | the user's browser             | Finishes a decided flow, then the library's resume (`/_oauth-provider/auth/:uid`) sends the code                                 |
| `GET /_oauth-provider/error/:reference`                | the authorize page             | What went wrong with a flow that was refused; readable again until the reference expires (10 minutes)                            |
| `GET /_oauth-provider/error/:reference/return`         | the user's browser             | The error page's "Return to …": sends the error to the app's redirect URI and spends the reference                               |
| `POST /_oauth-provider/token`                          | an app                         | Code exchange and refresh                                                                                                        |
| `POST /_oauth-provider/token/revocation`               | an app                         | Revocation (RFC 7009); either token of a grant ends the whole grant                                                              |
| `GET /_oauth-provider/connections`                     | Connected apps (not built yet) | The user's live grants whose code was exchanged; secure window session only                                                      |
| `DELETE /_oauth-provider/connections/:grantId`         | Connected apps (not built yet) | Ends one of the user's live grants; secure window session only                                                                   |

The resources an access token may be used at are listed in `registry.ts`
(today the MCP endpoint, `<issuer>/mcp`). A resource's routes check the token
through its controller (`resource.ts`), which calls the one lookup
(`lookup.ts`). Tokens are issued for the MCP resource, but nothing serves
`/mcp` yet and its scopes map no routes: only the resources tests add mount
the controller. So in production today no call with an OAuth token reaches
a resource, and an app's failing call isn't reaching an OAuth resource at
all. The rest of the realm server doesn't accept an OAuth token either (the
remediation file lists where): see the `realm-auth` skill.

Lifetimes (`provider.ts`, `grants.ts`): an interaction and the library's
session last 10 minutes, a code 60 seconds. A grant lasts 30 days if the user
chose to keep the connection (renewing), else 60 minutes. An access token
lasts 10 minutes on a renewing grant and 60 on one that isn't, never past the
grant. Only a renewing grant gets a refresh token (and only for a client
registered for the `refresh_token` grant); it lasts as long as its grant, and
is rotated on every use. A used refresh token may be presented again within 30 seconds of its
first use (an app that retried), as long as no token its use issued has been
used yet; any other second use ends the grant (`reuse`).

## Tables

| Table                            | One row per                                                                                    | Found by                         | Read-only role | Notes                                                                                                                                                                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `oauth_provider_dynamic_clients` | client that registered itself                                                                  | `client_id`                      | yes            | `metadata` is its redirect URIs, grant types and name. A client ID metadata document is never stored; pre-registered clients are in code                                                                                                |
| `oauth_provider_objects`         | interaction, library session, authorization code, consent decision and ticket, error reference | `kind`, SHA-256 of the value     | no             | Minutes long. The value is never stored, only its hash                                                                                                                                                                                  |
| `oauth_provider_grants`          | consent                                                                                        | `id`                             | yes            | `user_id` (internal, not the Matrix ID), `client_id`, `resources` (resource to scopes approved), `renewing`, `expires_at`, `redirect_uri`, `exchanged_at`, `last_used_at` (written at most every 5 minutes), `ended_at`, `ended_reason` |
| `oauth_provider_tokens`          | access or refresh token                                                                        | SHA-256 of the token (`id_hash`) | yes            | `kind`, `grant_id`, `resource`, `scope`, `expires_at`; a refresh token's `rotation`, `consumed_at`, `revoked_at`. Deleted when its grant ends                                                                                           |

`users.oauth_grants_revoked_at` is when the user's OAuth grants were last
revoked: a grant created at or before it is refused whether or not its row
was ended.

No row holds a token, code, verifier, ticket, interaction ID or error
reference readable (ADR 021 §1.2), and neither the request log, the
provider's channel nor Sentry names one, or a grant ID.
`tests/oauth-provider-secrecy-test.ts` drives two whole connections with
known values and checks every `oauth_provider_*` table at each step, the
`realm:requests` and `boxel:oauth-provider` lines at info level, and Sentry.

So a value a user pastes can't be looked up as itself. Hash it on your own
machine, never in SQL, where it would land in shell history and, with
statement logging on, in Postgres's log: `read -rs t; printf %s "$t" |
sha256sum`, then `WHERE id_hash = decode('<hex>', 'hex')`. Ask for a value
only when nothing else will do, and treat a token a user pasted anywhere (a
support channel, say) as exposed: end its grant (below).

`ended_reason` is `user` (the user disconnected it, through the Connected
apps route), `client` (the app revoked a token), `reuse` (a code or a rotated
refresh token was used again, which ends the grant as a precaution),
`sessions-revoked` (the user's sessions were revoked, or their password
changed), or `operator` (ended by hand, below). `operator` isn't one of the
code's `GrantEndReason` values: nothing reads `ended_reason` as a fixed set
today, but code that branches on it must allow for rows ended by hand.

A grant that ended or expired is kept 90 days, then the daily
`oauth-provider-cleanup` job deletes it with its tokens. It also deletes
expired objects and tokens, and a self-registered client 7 days after it
registered if it never connected, or 30 days after its last connection
ended; such a client must register again. Nothing depends on the cleanup
for correctness: an expired or ended row already reads as missing.
`OAUTH_PROVIDER_CLEANUP_CRON_SCHEDULE` (default `15 3 * * *`) and
`OAUTH_PROVIDER_CLEANUP_CRON_TZ` (default `America/New_York`) set when it
runs, in the worker's environment.

## Rate limits

Three limits, each read only when the provider is on; a value that doesn't
parse stops the server.

| Setting                                | Guards                                                         | Default                                                                                                      |
| -------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `BOXEL_OAUTH_CLIENT_RATE_LIMIT`        | registration, and a flow naming a new metadata-document client | `address=20/3600,network=100/3600,all=2000/3600,alert=500`                                                   |
| `BOXEL_OAUTH_AUTHORIZATION_RATE_LIMIT` | starting a flow                                                | `address=30/600,network=150/600,all=2000/600,alert=1000`                                                     |
| `BOXEL_OAUTH_TOKEN_RATE_LIMIT`         | the token and revocation endpoints                             | `grant=60/3600,address=60/600,network=300/600,all=3000/600,alert=1500` (all but `grant` count failures only) |

Each part is optional and `requests/windowSeconds`. `address` is the caller's
IPv4 address or IPv6 /64, `network` its IPv4 /24 or IPv6 /48 (`caller-limit.ts`). Past `alert` in the window, the server warns once a
while on the log channel and to Sentry, before the limit is reached.

## The log channel

Every line is on the `boxel:oauth-provider` logger, plain text. The channel
name is not part of the line, so in Loki you filter on the line's own text
(the `tail-logs` skill); the channel name is what `LOG_LEVELS` takes, e.g.
`LOG_LEVELS="boxel:oauth-provider=debug"` to also log each accepted token.
Request log lines (`realm:requests`) show the provider's paths with every
interaction ID, error reference and grant ID replaced by a label
(`/_oauth-provider/interaction/:uid`, `…/connections/:grantId`), and Sentry
gets the same.

A client is named by its ID, with one difference for a client ID metadata
document: the authorization, consent, revocation and `grant ended` lines name
it `metadata document on <host>`, while the token, `flow finished`, `flow
cancelled` and resource lines give its client ID URL in full. Some lines name
no client: `flow not finished`, `resume refused`, `token refused: <reason>,
resource …`, `grants ended` and the reuse lines. A user, token or grant is
never named.

| Line                                                                               | Level | Means                                                                                                                                                 | Next                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OAuth provider on: issuer …, resources …`                                         | info  | Started with the provider on                                                                                                                          | —                                                                                                                                                                                               |
| `client metadata document: outcome=… reason=… host=…`                              | info  | A metadata-document client's document was downloaded, or failed to be                                                                                 | `reason` says why; the `outbound-guard` skill for refused hosts                                                                                                                                 |
| `authorization started: resources …, client …`                                     | info  | A flow passed every check                                                                                                                             | —                                                                                                                                                                                               |
| `authorization given its resource from its scopes, client …`                       | info  | The app named no `resource`; the flow took it from the scopes                                                                                         | —                                                                                                                                                                                               |
| `authorization refused: <reason> (<error>), client …`                              | info  | A flow was refused; the browser went to the authorize page's error, or the app's redirect                                                             | `reason` names the check (`authorization.ts`); fix the app's request                                                                                                                            |
| `authorization refused by the limit: <reason>` / `…by the new-client limit`        | info  | Over a rate limit                                                                                                                                     | Rate limits above                                                                                                                                                                               |
| `authorization error returned to the client: <reason>, client …`                   | info  | An error was sent to the app's own redirect URI                                                                                                       | —                                                                                                                                                                                               |
| `resume refused (<error>)`                                                         | info  | The library's resume was asked for a flow Boxel hadn't finished                                                                                       | A browser reloaded or replayed a step; the user starts over                                                                                                                                     |
| `consent shown: …` / `consent allowed: …, renew …` / `consent denied: …`           | info  | The authorize page read the flow, and the user's decision                                                                                             | —                                                                                                                                                                                               |
| `consent details unavailable: the account lookup failed: …`                        | error | Matrix couldn't answer who the user is; the page shows an error                                                                                       | Synapse health                                                                                                                                                                                  |
| `flow finished: allowed, client …, renewing …` / `flow finished: denied, client …` | info  | The browser came back with its ticket, and the app was sent its code or `access_denied`                                                               | —                                                                                                                                                                                               |
| `flow not finished: <reason>` / `flow cancelled: client …`                         | info  | The finish step refused, and the browser got the expired-request page; or the user cancelled (`?cancel=1`)                                            | `no-interaction`: over 10 minutes, or another browser. `no-ticket`/`ticket-mismatch`: a spent or wrong ticket. `deleted-client`: the cleanup deleted the client mid-flow. Others in `finish.ts` |
| `token issued: client …` / `token refreshed: client …`                             | info  | A code exchange or refresh succeeded                                                                                                                  | —                                                                                                                                                                                               |
| `token refused: <error>, client …`                                                 | info  | The token endpoint refused an exchange or refresh (`invalid_grant`, `invalid_client`, …)                                                              | `invalid_grant` after a while: the grant ended or expired; read the grant row                                                                                                                   |
| `token not stored: grant ended`                                                    | info  | A token was being issued as its grant ended; the request fails                                                                                        | —                                                                                                                                                                                               |
| `token refreshed: grace window`                                                    | info  | A used refresh token was presented again within its 30-second grace                                                                                   | Normal for an app that retried                                                                                                                                                                  |
| `authorization code reused` / `refresh token reused` / `<what> reused`             | info  | A spent code, or a used refresh token outside its grace, came back: the grant is ended (`reuse`)                                                      | The app mishandles tokens, or a token leaked; the user connects again                                                                                                                           |
| `revocation refused: <error>, client …`                                            | info  | The revocation endpoint refused the request                                                                                                           | —                                                                                                                                                                                               |
| `grant ended: <reason>, client …`                                                  | info  | One grant ended: `user`, `client`, `reuse`, or `sessions-revoked` when a lookup ends a grant a revocation covered                                     | —                                                                                                                                                                                               |
| `grants ended: sessions-revoked, <count>`                                          | info  | A session revocation or password change ended the user's grants                                                                                       | —                                                                                                                                                                                               |
| `token accepted: resource …, client …, <ms>ms`                                     | debug | A resource accepted a token                                                                                                                           | —                                                                                                                                                                                               |
| `token refused: <reason>, resource …, <ms>ms`                                      | info  | A resource refused a token: `unknown`, `expired`, `wrong-resource`, `revoked`                                                                         | Tracing below                                                                                                                                                                                   |
| `token refused: not in the header, resource …`                                     | info  | A token sent in the query string or a form body, answered 400 `invalid_request`. A request with no token at all logs nothing (401 with the challenge) | The app must send `Authorization: Bearer`                                                                                                                                                       |
| `token refused: route not mapped, …` / `token refused: insufficient scope, …`      | info  | A route no scope maps (401, as an unknown token), or a scope the grant lacks (403 `insufficient_scope`)                                               | `insufficient scope`: the user consents again with the scope                                                                                                                                    |
| `request refused: form body over … bytes, resource …`                              | info  | A form body too large for the controller to read a token from (413)                                                                                   | —                                                                                                                                                                                               |
| `<endpoint> request refused: rate limit, …` / `…unknown address`                   | info  | Token or revocation endpoint over its limit (429), or the caller's address couldn't be read (403)                                                     | `unknown address` for every caller: check the realm server's client-address settings against the load balancer                                                                                  |
| `<endpoint> request refused: rate limit unavailable`                               | warn  | The rate-limit store failed; requests are answered 503 `temporarily_unavailable`                                                                      | The `rate-limit-store` skill                                                                                                                                                                    |
| a limit's alert (names the limit and its window)                                   | warn  | Traffic past `alert`; also sent to Sentry                                                                                                             | Look for one client or network behind it                                                                                                                                                        |
| `failed to mark a grant exchanged: …`                                              | error | The code exchange succeeded but `exchanged_at` wasn't written; the token was stored, and the cleanup counts a grant with tokens as exchanged          | Database health                                                                                                                                                                                 |
| `OAuth provider error`                                                             | error | The library raised something Boxel didn't handle                                                                                                      | The Sentry event                                                                                                                                                                                |

## Tracing a failed connection

Ask the user for the app's name, roughly when, and what they saw. Never ask
for a token or the URL they were sent to.

1. **Is the provider on?** `OAuth provider on:` at the last start, and
   `GET /.well-known/oauth-authorization-server` answers 200.
2. **Did the app register?** For a self-registered client, its row in
   `oauth_provider_dynamic_clients` (by `metadata->>'client_name'` and
   `created_at`). A client deleted by the cleanup is refused as unknown until
   it registers again. For a metadata-document client, the
   `client metadata document:` line.
3. **Did the flow start?** `authorization started` or `authorization
refused: <reason>` near the time. The user saw "Something went wrong" on
   the authorize page for a refusal; `reason` is the check.
4. **Did the user decide?** `consent shown`, then `consent allowed`/`denied`.
   Shown but no decision: the user left, or the page failed (the
   `secure-origin` skill).
5. **Did it finish?** `flow finished: allowed`, or `flow not finished:
<reason>`. A finish more than 10 minutes after the start fails: the
   interaction expired.
6. **Did the app exchange the code?** `token issued`, or `token refused:
<error>`. A code lasts 60 seconds, needs the same `redirect_uri` and the
   PKCE verifier that matches the challenge. The grant row has
   `exchanged_at` once it did.
7. **Does the call fail?** No production resource serves calls yet (see
   Routes). Where one does, `token refused: <reason>, resource …`. The
   lookup checks the grant before the token:
   - `unknown`: no such token. Usually its grant ended, which deletes its
     tokens: go to step 8. Suspect a token from another environment only
     when the user's grant is live.
   - `revoked`: the grant expired (a grant that isn't renewing does after 60
     minutes), was created at or before the user's revocation cutoff (this
     lookup then ends it), or no longer holds the resource.
   - `expired`: the token passed its own expiry while its grant is live. On
     a renewing grant the app should have refreshed; a grant that isn't
     renewing has no refresh token.
   - `wrong-resource`: the token was issued for another resource (its
     `resource` column).
8. **Did it stop later?** The user's grants, newest first:

```sql
SELECT g.id, g.client_id, g.created_at, g.expires_at, g.renewing,
       g.exchanged_at, g.last_used_at, g.ended_at, g.ended_reason,
       g.created_at <= u.oauth_grants_revoked_at AS revoked_by_cutoff
  FROM oauth_provider_grants AS g JOIN users AS u ON u.id = g.user_id
 WHERE u.matrix_user_id = '@example-user:example.com'
 ORDER BY g.created_at DESC;
```

An ended or expired grant doesn't come back: the user connects the app
again. A grant that wasn't renewing ends after 60 minutes by design.

## Ending connections

- **The user, one app**: `DELETE /_oauth-provider/connections/:grantId`,
  which the secure origin's Connected apps page will call. The page isn't
  built yet, so today a user can't end one app's connection themselves: an
  operator ends it by hand (below). The route needs the user's own secure
  window session, so an operator can't call it for them.
- **An operator, every app of a user**: revoking the user's sessions
  (`POST /_grafana-revoke-user-sessions?user=<matrix id>`, or the Users
  dashboard's button) also sets `users.oauth_grants_revoked_at` and ends
  every grant with `sessions-revoked`, and so does a password change (the
  `realm-auth` and `secure-session` skills). Grants made afterwards work.
- **An operator, one grant**: by hand, with a database session that can
  write (the read-only role can't). End the grant and delete its tokens,
  as `endGrant` does, in this order:

```sql
UPDATE oauth_provider_grants
   SET ended_at = now(), ended_reason = 'operator'
 WHERE id = '<grant id>' AND ended_at IS NULL;
DELETE FROM oauth_provider_tokens WHERE grant_id = '<grant id>';
```

Ending a grant by hand writes no `grant ended` line. The app's next
refresh shows as `token refused: invalid_grant, client …`, and its next
call as `token refused: unknown, resource …`.

## Rotating keys

**`cookieKeys`** sign the library's cookies, which carry a flow from its
start to its finish (10 minutes at most). The first key signs; every key
verifies. Every replica must hold the same list.

During a rolling deploy, old and new replicas serve together, so a key
must verify everywhere before any replica signs with it:

1. Add the new key at the end of the list, where it only verifies, and
   deploy.
2. Once every replica runs that list, move the new key to the front and
   deploy.
3. Once every replica runs that list and 10 minutes have passed, remove the
   old key and deploy.

Skipping a step only fails flows in progress, those that cross replicas
during the rollout: their users see the authorize page's error and start
again. No connection is affected.

**`jwks`** is the library's own signing key set. Nothing the provider issues
is signed (tokens are opaque) and the library's key route isn't served, so
no app ever sees it: it is set only so the library doesn't fall back to the
development keys it ships. Replace it in one deploy with a new key (an RSA
private JWK with `kid`, `use: "sig"`, `alg: "RS256"`, as
`scripts/oauth-provider-dev-config.ts` makes).

## Tests

All in `packages/realm-server/tests/`, named `oauth-provider-*-test.ts`, one
per endpoint or concern (registration, authorization, consent, finish,
token, token-lookup, revocation, connections, cleanup, discovery, client
checks, client metadata, mock client). `oauth-provider-secrecy-test.ts` is
the whole-connection secrecy check: every table at each step, the
request log and the provider's channel at info level, and Sentry. `tests/helpers/oauth-provider-flow.ts`
drives each step; `tests/helpers/oauth-provider-secrets.ts` captures logs and
Sentry (`telemetryDuring`) and checks values against them
(`assertNoSecrets`). An endpoint test that hands out a new kind of value
adds it to its own secrecy check and to the whole-connection one.
