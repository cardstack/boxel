---
name: oauth-connections
description: Operate and diagnose OAuth clients and connections — the `oauth-client` and `oauth-connection` key kinds, the `oauth_clients`, `platform_oauth_clients`, `oauth_connections` and `oauth_connect_requests` tables, connecting through a client from the secure window (`/_oauth/connections`, the vendor's redirect back to `/_oauth/callback`), how access tokens are minted and refreshed in memory, and what each refresh error means — `credential-rejected` with `meta.reason` `rejected` (`invalid_grant`), `needs-admin` (`invalid_client`, or a client deleted, unshared or suspended) and `unavailable` (5xx, timeouts, `temporarily_unavailable` after retries). Also the platform's own clients (`/_platform-oauth-clients`, operator token for `system-keys`) and why a token endpoint is never a grant's destination. Use when a user reports a connection that stopped working, a Reconnect they're asked for, a client every teammate's connection broke on, a sign-in that comes back with an error, when adding or rotating a platform client, or when changing `lib/oauth.ts`, `handlers/handle-oauth.ts` or `lib/outbound/token-endpoints.ts`.
---

# OAuth clients and connections (operators)

Many APIs authenticate a person by OAuth. Two kinds of key carry it:

- An **OAuth client** (`oauth-client`) is an app registered with a vendor. Its
  key value is the client secret; `oauth_clients` holds the client id, the
  grant (`authorization_code`, for people to sign in through, or
  `client_credentials`, which mints tokens with no person), the authorization
  and token endpoints, the scopes, how it authenticates at the token endpoint
  (`client_secret_post` or `client_secret_basic`) and the API hosts it serves.
  A client is shared into a realm like any key, so a realm's writer registers
  one app and each teammate connects their own account through it.
- An **OAuth connection** (`oauth-connection`) is one person's sign-in through a
  client. Its key value is the refresh token, or, for a vendor that issues none,
  the access token itself (`oauth_connections.token_kind`). It is a personal
  key: its owner approves operations to use it, and its tokens go only under its
  own grants.

Boxel's own clients — the **platform clients**, such as the read-only GitHub
App — are rows of `platform_oauth_clients`, with their secret sealed on the row
(field `platform_oauth_clients.secret`, bound to the row and its token
endpoint). Connect mode offers them to everyone.

The code is `packages/realm-server/lib/oauth.ts` (clients, connecting, minting)
and `handlers/handle-oauth.ts` (routes). Keys, grants and tickets are as the
`user-keys` skill describes; bindings as the `key-bindings` skill does.

**For GitHub, a client must be a GitHub App, not an OAuth App.** An OAuth App's
only scope that reaches private repositories, `repo`, can also write.

## Connecting

1. The secure window's `connect` page lists the clients a person may use
   (`GET /_oauth/clients?realm=&destination=`): the platform's (each with its
   `name`), the authorization-code clients shared into the realm (to anyone
   who can read it) and their own, each with the scopes it asks for. With a
   destination, only clients whose API hosts cover it. A client's secret and
   owner are never in the answer.
2. The window mints a key write ticket (`add`, or `replace` of the connection
   for a reconnect) and posts `POST /_oauth/connections` with its own secure
   session. The realm server spends the ticket, stores a connect request (the
   SHA-256 of a random `state`, who it is for, the client, the name; 10
   minutes), and answers with the vendor's authorization URL: `client_id`,
   `redirect_uri` (`<realm server>/_oauth/callback`, always the server's own),
   `state`, `scope` and an S256 PKCE challenge. The verifier is derived from
   the state with the realm secret seed, so nothing stored could finish the
   sign-in.
3. The vendor sends the person back to `GET /_oauth/callback?code&state`.
   The callback finishes nothing: it sends the window on to the secure
   origin's `connected` page with the code and `state` in the URL fragment,
   which never reaches a server. That page finishes the sign-in with its own
   secure session (`POST /_oauth/connections/complete`), and the realm server
   spends the request only for **the user who started it**, before it
   expires, then exchanges the code at the client's token endpoint and stores
   the connection. A sign-in link one person started and another approved at
   the vendor therefore never puts the second person's account under the
   first's. **No token ever passes through a browser**; only the one-use code
   does, and it is useless without the PKCE verifier and client secret.

From the terminal, `boxel keys add <name> --kind oauth-client …` adds a
client, `boxel keys clients [--realm]` lists the same connectable clients
(a platform client by its `name`, as `platform:<name>`), and
`boxel keys connect <name> --client …` signs in through one without the
browser holding a session of its own. The CLI listens on a loopback port and
starts the sign-in (step 2) with its own secure session, naming that listener
as `cli: {port, state}` (only a CLI session may name one, 400 otherwise); the
sign-in in progress records it (`oauth_connect_requests.cli_port`,
`cli_state`). In step 3 the callback reads it back by the `state` and adds
`cli_port` and `cli_state` to the `connected` page's fragment. The page then
finishes nothing and needs no session: once the user presses **Continue in
the terminal** it posts the code and `state` (or `oauth_error`) to the
listener, and the CLI finishes the sign-in with
`POST /_oauth/connections/complete` under its own secure session, which the
realm server accepts only for the user who started it. The CLI sees the
one-use code, which is useless without the PKCE verifier and client secret,
and never a token.

The callback's query string carries the authorization code. `/_oauth` is a key
route, so the request log and telemetry keep only its method and path; the load
balancer's access log does record the query string, which is tolerable only
because the code is single-use, PKCE-bound and useless without the client
secret, which only the realm server holds.

| `error`      | Means                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `expired`    | No such sign-in in progress for this user: unknown state, already used, older than 10 minutes, or started by someone else |
| `denied`     | The person (or the vendor) declined: the vendor sent `error=` back to the callback                                        |
| `failed`     | The code exchange failed, or the client is unavailable (see the refresh errors)                                           |
| `name-taken` | The person added a key of that name while signing in                                                                      |

## Minting and refreshing

Access tokens live **only in the realm server's memory**, keyed by the
connection (or the `client_credentials` client). Every use first reads what
the key is now: its state, its client (deleted, unshared, suspended or broken
stops it at once, not at its next refresh), an access-only token's expiry, and
the connection's **refresh generation**. A cached token is reused while it
isn't due (`min(60 s, half its lifetime)` before expiry) and no other process
has refreshed the connection since it was minted; one refresh per key runs at
a time in a process, and callers that arrive meanwhile share its result.

A refresh takes the connection's **refresh lease** (`refreshing_until`, 60 s)
first, so only one process spends a rotating refresh token, and holds no
database connection while the vendor answers (each token request has 15 s).
It stores the rotated refresh token and moves `generation` on together. A
process holding a token of an older generation mints again, since a vendor
such as GitHub revokes the previous access token on refresh; processes
serving one connection at the same moment may each refresh in turn. A lease
whose holder died lapses on its own.

A restart forgets every access token; each connection refreshes once on its
next call.

**A connection is pinned to the client its tokens were issued to.** It
records that client's id and token endpoint when the person signs in, and
mints only through a client that still has both. A share a writer swaps
another app into keeps serving connections only when the new key is the
same app (a rotated secret, or the same app stored by another writer); for
another app, the connections need an administrator and their refresh tokens
are never sent, so a client swapped into a share can't collect the refresh
tokens another app was issued.

**Grants of a minting key hold a marker, not a secret.** A refresh token
rotates on every refresh and only ever goes to a token endpoint, so a grant of
a connection (or a `client_credentials` client) seals a random marker bound to
the grant and its destination. Sending opens the marker under the grant's
destination — proving the grant was made by the realm server — and then
attaches the access token it mints. Reconnecting or rotating a refresh token
re-seals nothing on the grants.

**A token endpoint is the platform's alone.** No key, of any kind, is granted
a destination that covers a token endpoint: the fixed list in
`lib/outbound/token-endpoints.ts`, every platform client's, and the token URL
of the client the key itself mints through. Another person's client is never
consulted, since anyone can store a client naming any URL. A token request
never follows a redirect to another origin, since its body and headers carry
the client secret and refresh token. An authorization-code client is never granted
anything: it only signs people in.

## Refresh errors

A refresh (or a code exchange) the token endpoint refuses is classified once,
and every call through the key is refused **`credential-rejected`, 424**, with
`meta.reason`, `meta.slot` and `meta.destination`. Nothing is sent to the API.

| `meta.reason` | Token endpoint said                                                                                    | What changed                                                                                                  | Who fixes it                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `rejected`    | `invalid_grant` (revoked, expired, or a refresh token spent elsewhere)                                 | `user_keys.state = 'rejected'`, `oauth_connections.rejected_at`; later calls are refused without asking       | The connection's owner: Reconnect in the secure window (signs in through the client again; same key, grants, bindings) |
| `needs-admin` | `invalid_client` / `unauthorized_client`, or a bare 401                                                | `oauth_clients.state` (or `platform_oauth_clients.state`) = `broken`; every connection through it is affected | The client's owner replaces its secret (`PATCH /_user-keys/:id`), or an operator replaces a platform client's          |
| `needs-admin` | — (not asked: the client is gone, its share is suspended or unshared, or its share's key was deleted)  | nothing; the connection's client reference is null, or its share isn't active                                 | A direct writer resumes the share, or swaps in a key for the same app (the same client id and token endpoint)          |
| `unavailable` | 5xx, a timeout, a dropped connection or `temporarily_unavailable`, after the retries (0.5 s, then 2 s) | nothing                                                                                                       | Nobody: the next call tries again                                                                                      |

GitHub answers a refused grant with **200** and an `error` in the body; that is
classified the same way.

The realm server logs on `realm:oauth`: `OAuth connection <id> was refused as
invalid_grant`, `an OAuth client (key <id> | platform <id>) was refused by its
token endpoint as invalid_client …`, and `token request failed: token endpoint
answered <status> <error>`. None carries a token, a secret or the vendor's
`error_description`.

```sql
-- A user's connections, and the client each mints through.
SELECT k.id, k.name, k.state, n.client_kind, n.client_key_id, n.client_share_id,
       n.platform_client_id, n.token_kind, n.rejected_at
FROM user_keys k JOIN oauth_connections n ON n.key_id = k.id
WHERE k.owner = '@someone:boxel.ai';

-- Clients that are broken, theirs and the platform's.
SELECT key_id, client_id, token_url, broken_at FROM oauth_clients WHERE state = 'broken';
SELECT name, client_id, token_url, broken_at FROM platform_oauth_clients WHERE state = 'broken';

-- Every connection a broken client stopped.
SELECT n.key_id FROM oauth_connections n
LEFT JOIN key_shares s ON s.id = n.client_share_id
WHERE n.client_key_id = '<client key id>' OR s.key_id = '<client key id>';
```

The tables are withheld from `readonly_role`, like `user_keys`; query them as
the application role, and select metadata columns only.

## Platform clients

Managed with an operator token for `system-keys` (see the `system-keys`
skill for minting one):

| Route                                   | Does                                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `GET /_platform-oauth-clients`          | List them, without secrets                                                                                          |
| `POST /_platform-oauth-clients`         | Add: `{name, label, secret, oauth: {clientId, authorizeUrl, tokenUrl, scopes, tokenAuth?, apiHosts}}`               |
| `PATCH /_platform-oauth-clients/:name`  | Replace the secret (`{secret}`), which also clears `broken`                                                         |
| `DELETE /_platform-oauth-clients/:name` | Delete; its connections stay and need an administrator, and a client re-added under the name doesn't take them back |

A platform client is always `authorization_code`. Its `apiHosts` decide where
connect mode offers it (`https://api.github.com/` for the GitHub App). A
client's endpoints never change once stored; register a new client to move
them.

## Tests

- `packages/realm-server/tests/oauth-connections-test.ts` — end to end against
  the stub OAuth vendor (`tests/helpers/stub-oauth-provider.ts`): connect,
  approve, call, refresh near expiry, concurrent refresh minting once,
  `invalid_grant` then reconnect, `invalid_client` then secret rotation,
  retries and `unavailable`, a shared client giving per-user connections and
  following its share, no token in anything the browser sees, no grant of a
  token endpoint, `client_credentials`, a platform client, a sign-in finishing
  only for the person who started it, GitHub's error codes, another person's
  client fencing off nothing, a cached token stopping with its client, minting
  again after another process's refresh, access-only expiry, reconnecting
  through the same client, and fresh grant markers on reconnect.
