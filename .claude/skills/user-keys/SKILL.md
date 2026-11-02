---
name: user-keys
description: Operate and diagnose the keys that belong to people — the `user_keys` table, the signed-in user's write-only management API (`/_user-keys`), and the key write tickets (`/_key-write-tickets`) that adding, replacing or deleting a key must present. Covers what the table holds and how its values are sealed and bound (field, owner, id), that a key records no destination, why no API, log line, Sentry event or read-only database role can ever read a value back, who may mint a ticket (a session signed in on the secure origin, from the secure window or the CLI — never the app's session) and how that is decided, ticket lifetime, single use and the one change each ticket is minted for, and every refusal the API answers with. Also covers Google service-account keys — the key file, subject and scopes they are entered with, what is sealed, and how `lib/outbound/google-service-account.ts` mints, caches and classifies failures of their access tokens. Also covers grants — where a key may be sent, one `user_key_grants` row per destination its owner approved, each holding its own sealed copy of the key — the master and grant copies and which code opens each, how a grant is created or reused from an operation's lowered destination, why a grant row added by hand sends nothing, and the `/_user-key-grants` routes. Use when a user reports a key they can't add, replace or delete, when a key change or a grant is refused with 403, when reading or querying `user_keys` / `key_write_tickets` / `user_key_grants` as an operator, when a key's value or a grant's copy fails to open with SecretDecryptionError, or when changing `lib/user-keys.ts`, `lib/user-key-grants.ts`, `handlers/handle-user-keys.ts` or `handlers/handle-user-key-grants.ts`.
---

# User keys (operators)

A key is a credential stored for one user, its **owner**: the Matrix user id
of the session that added it. Only the owner lists, shows, replaces or
deletes it. A key is only its secret: it records no destination. Where it may
be sent is a set of grants, one per destination (see [Grants](#grants)). The code is `packages/realm-server/lib/user-keys.ts` (storage,
tickets, sealing) and `packages/realm-server/handlers/handle-user-keys.ts`
(the routes).

**No value is ever readable.** No route returns one, nothing logs one, the
request log and telemetry keep only the method and path of these routes, the
read-only database role can't select the tables, and the stored value is
ciphertext under the secrets-at-rest data key (see the `secrets-at-rest`
skill). There is no operator path to a key's value, by design; a user who
has lost track of a value replaces it.

## The tables

`user_keys` — one row per key:

| Column                                                                                                     | Holds                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                                                                                       | UUID, minted by the realm server before sealing (the value is bound to it)                                                                                                                                                    |
| `owner`                                                                                                    | The owner's Matrix user id                                                                                                                                                                                                    |
| `name`                                                                                                     | A label for people, unique among the owner's keys (`user_keys_owner_name_key`); two owners may share a name                                                                                                                   |
| `kind`                                                                                                     | `static`; `google-service-account` (see [Google service accounts](#google-service-accounts)); `oauth-client` or `oauth-connection` (see the `oauth-connections` skill)                                                        |
| `state`                                                                                                    | `active`, or `rejected` for a connection its vendor refused to refresh or a service-account key Google refused (see [Rejected keys](#rejected-keys))                                                                          |
| `rejected_at`, `last_probe_at`                                                                             | For a rejected service-account key: when Google refused it, and when a call was last let through to Google as its probe                                                                                                       |
| `value_ciphertext`, `value_nonce`, `value_tag`, `value_key_id`                                             | The sealed value                                                                                                                                                                                                              |
| `service_account_email`, `service_account_subject`, `service_account_scopes`, `service_account_details_at` | A `google-service-account` key's email, the user it acts as (null for itself) and its scopes, none of them secret, and the `updated_at` they were written with; null for every other kind (`user_keys_service_account_check`) |
| `created_at`, `updated_at`                                                                                 | `timestamptz`                                                                                                                                                                                                                 |

`key_write_tickets` — one row per unused ticket: `ticket_sha256`, `owner`,
`action` (`add`, `replace`, `delete`, `share`, `swap` or `resume`), `key_id`
(the key a replace, delete, share or swap uses; null for an add or a resume),
`realm_url` (the realm a share puts the key into; null otherwise), `share_id`
(the share a swap puts the key into, or a resume resumes; null otherwise) and
`expires_at`.
`key_write_tickets_action_key_id_check` enforces which action names what. Only the SHA-256
is stored; the ticket itself exists only in the response that minted it.

Both are excluded from the SQLite schema dump and withheld from
`readonly_role` and its members. Query them as the application role, and
select metadata columns only:

```sql
SELECT id, owner, name, kind, state, service_account_email, service_account_scopes, value_key_id, created_at, updated_at
FROM user_keys WHERE owner = '@someone:boxel.ai' ORDER BY name;
```

## Sealing and binding

Each value is sealed with field `user_keys.value`, the owner and the row's
id.

`user_keys.value` is registered in `SEALED_COLUMNS`
(`lib/secrets-at-rest/rotation.ts`), so rotating the data key re-seals every
key, and the sealed census counts them as
`sealed census: user_keys.value rowsByKeyId=…`.

A value moved to another row or owner by a database writer does not open:
`SecretDecryptionError`, which names none of the inputs.

## Key write tickets

A key is added, replaced, deleted, shared into a realm or swapped into a
share only with a ticket: minted for the signed-in user and for one change,
valid for 10 minutes, single use. A ticket names its change when it is
minted: `add`; `replace` or `delete` of one of the user's keys; `share` of one
of them into one realm; `swap` of one of them into one share; or `resume` of
one share a writer suspended (see the `key-shares` skill). It spends only on that change, so a ticket that leaks can't
be put to a different one: a ticket to add a key replaces or deletes nothing,
and a ticket to replace or delete one key does nothing to another, nor the
other action to the same key, and a ticket to share a key into one realm,
swap it into one share or resume one share does nothing elsewhere. A ticket for a key the user
doesn't have is refused with 404 at minting, as for no key.

The change consumes the ticket in the same transaction, so a change refused
for another reason (a duplicate name, an unknown key, the wrong ticket for
it) leaves the ticket usable for its own change, and of two concurrent uses of
one ticket exactly one succeeds. Expired tickets are swept whenever a ticket
is minted.

**Who may mint one.** `POST /_key-write-tickets` mints only for a session
signed in on the secure origin — one carrying the `secureSession` claim,
whose `secure_sessions` row belongs to the token's user and hasn't expired
(see the `secure-session` skill) — and only for a request with no `Origin`
header (the CLI) or whose `Origin` is the secure origin's. Anything else is
refused with 403. The app's session never carries the claim, so it can't
mint a ticket from any origin, nor can the CLI's ordinary session; the CLI
gets a secure session with `boxel keys sign-in`. ADR 005 records why (§2) and
the rules a change here must keep (§1.1, §1.2).

## The API

All routes take the user's realm-server session (`Authorization: Bearer`),
refuse a delegated session with 401 (the shared session check) and a
realm-authority session with 403. Bodies are JSON:API with type `user-key`, and
the ticket goes in `meta`. A body is at most
64 KiB, refused with 413 as soon as its declared length or the bytes received
exceed that. A query string on these routes is ignored, and left out of the
request log line and Sentry breadcrumbs.

| Route                      | Does                                                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /_key-write-tickets` | Mint a ticket for one change: type `key-write-ticket`, `attributes.{action, keyId?, realm?, shareId?}`; answers `attributes.{ticket, expiresAt}`                                      |
| `GET /_user-keys`          | List the user's keys' metadata, by name, each with its `grants`, `usedWith` and `sharedInto`                                                                                          |
| `GET /_user-keys/:id`      | One key's metadata, with its `grants`, `usedWith` and `sharedInto`                                                                                                                    |
| `POST /_user-keys`         | Add: `attributes.{name, kind?, value, subject?, scopes?}`, `meta.{ticket}` (a ticket to `add`); `subject` and `scopes` only for a `google-service-account`                            |
| `PATCH /_user-keys/:id`    | Replace the value: `attributes.{value, subject?, scopes?}`, `meta.{ticket}` (a ticket to `replace` this key), as the key's own kind; re-seals every grant's copy                      |
| `DELETE /_user-keys/:id`   | Delete: `meta.{ticket}` (a ticket to `delete` this key); revokes its own bindings, deletes its grants, suspends every share holding it (`GET /_key-shares?key=<id>` lists them first) |

An attribute other than these, such as a `destination`, is refused with 400.

A listed or shown key says where it is used, so the key page draws every key's
tile from the one listing. `usedWith` is the services its grants send to, each
grant's destination host reduced to its registrable domain (`registrableDomain`
in `lib/secure-window.ts`, the one the key pages show for a destination), each
once, sorted. `sharedInto` is the realms the key's shares put it in
(`listOwnSharedRealms` in `lib/key-shares.ts`), each once as
`{url, name, shares: [{id, label, state}]}`, sorted by name and then address,
so a page can unshare it from one realm without asking more. A suspended share
still counts: the key is still what it holds. `name` is the realm's indexed
`realm.json` name, given only while the owner can read the realm by a
permission row of their own or a public one (`*`, `users`). A share outlives
its owner's access, so an owner removed from a realm keeps its address and
their shares there, never its current name. `name` is also null before the
realm's `realm.json` is indexed.
The answers to adding and replacing a key carry neither.

From the terminal, `boxel keys` (`packages/boxel-cli/src/commands/keys/`)
calls these routes, the shares routes (see the `key-shares` skill) and the
OAuth routes (see the `oauth-connections` skill). A command that only reads
(`list`, `show`, `shares`, `clients`), and `unshare`, uses the profile's
ordinary session. A command that changes a key or a share in a way that needs
a ticket (`add`, `replace`, `delete`, `share`, `swap`, `connect`) makes all of
its requests with the profile's secure session, signing in through the
browser first when the profile has none, and mints a ticket for that one
change. It prints a refusal as `Refused (HTTP <status>):
<reason>`, and under `--json` passes the response's `errors` through
unchanged, so a user's report carries the server's own words. `approve`,
`revoke`, `pending` and `ungrant` (`commands/keys/approve.ts`) manage the
bindings and grants (see the `key-bindings` skill, _From the terminal_): an
approval or a swap that would give a key a destination none of its grants
covers is confirmed in the secure window, never created from the terminal.

| Status | Means                                                                                                                                                                                  |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | Malformed body, a missing or over-long name or value, an attribute that can't be set, a ticket request with no valid action or with the wrong `keyId`, `realm` or `shareId` for it     |
| 401    | No session, an invalid one, or a delegated one                                                                                                                                         |
| 403    | No valid ticket (missing, used, expired, another user's, or minted for a different change); a ticket asked for without a secure session, or by the app page; a realm-authority session |
| 404    | No such key — also what another user's key answers, including when a ticket is asked for to change it                                                                                  |
| 409    | The owner already has a key of that name                                                                                                                                               |
| 413    | The body is larger than 64 KiB                                                                                                                                                         |

A failure that isn't one of these is a 500 logged on `realm:user-keys` with
the error's name and message only, never the request.

## Google service accounts

A `google-service-account` key is a Google service account's JSON key file.
What reaches a Google API is an access token the realm server mints from it,
never the key file. The code is `lib/outbound/google-service-account.ts`.

- **What the owner enters.** `value` is the JSON key file, as Google issues
  it; `subject` is the user to act as, for domain-wide delegation (optional,
  an email address); `scopes` is a list of scope names or URLs, at least one.
  The secure window's add-a-key page takes the file from disk, and
  `boxel keys add <name> --kind google-service-account --key-file <path>
--scope <scope> [--subject <email>]` takes it from a file or `--stdin`.
- **Checked when entered.** The file must be `"type": "service_account"`
  with a `client_email` and an RSA private key in PEM form, or it is refused
  with 400. The refusal names what is wrong and never quotes the file (the
  JSON parser's own message does, so it is never passed on). A `static` key
  given a `subject` or `scopes` is refused 400. A replace takes the key's own
  kind and needs the whole set again: file, scopes and subject. The routes
  default none of it; the key page, the `replace-key` page a card's
  Reconnect opens (from `GET /_user-keys/:id`) and `boxel keys replace` start
  from the key's current scopes and subject, so leaving them as they are keeps
  them (`replace --no-subject` acts as the service account itself). A key file for another service account keeps neither: the CLI then needs `--scope` and `--subject` or `--no-subject`, and both pages say the account changed.
- **What is sealed.** The key file's `client_email`, `private_key_id` and
  `private_key`, with the subject and scopes, as one JSON value in a fixed
  member order (`serializeGoogleServiceAccount`). The file's own `token_uri`
  is dropped: the token endpoint is the platform's to choose.
- **What is shown.** The email, subject and scopes are also written, in the
  clear, to the `service_account_*` columns in the same statement that seals
  the value, so the key listing, `GET /_user-keys/:id` and the answers to an
  add or replace carry them as `serviceAccount: {email, subject, scopes}`.
  Minting reads only the sealed value. `service_account_details_at` is the
  `updated_at` of the statement that wrote them, and they are returned only
  while it equals the row's `updated_at`: a revision that seals a new value
  without writing them (one still serving during a rollout, or after a
  rollback) moves `updated_at`, and the key then lists without
  `serviceAccount` until it is replaced again. The key file, its private key and its
  `private_key_id` are never returned. The key page's tile and
  `boxel keys show` show them.
- **Its grants hold markers.** A service account is a minting kind
  (`MINTING_KINDS`): each grant seals a marker bound to its destination, never
  the key file. Sending opens the grant's marker to prove the grant real, then
  `serviceAccountAccessToken` (`lib/google-service-account-keys.ts`) opens the
  key's own sealed value and mints. The private key goes only to the token
  endpoint; `https://oauth2.googleapis.com/token` is in
  `FIXED_TOKEN_ENDPOINTS`, so no grant covers it, and `createCallApiSender`
  refuses any `callApi` addressed to it or to Google's other token addresses
  (see the `call-api` skill).
- **Minting.** `googleAccessToken(keyId, credential)` signs an RS256 JWT
  (issuer the service account, `sub` the subject when there is one, `scope`
  the scopes, `aud` the token endpoint, one hour) and exchanges it at
  `https://oauth2.googleapis.com/token` through the guarded outbound client,
  with the private key and the assertion registered with the scrubber.
  The access token is kept in memory only, keyed by the key and a hash of the
  credential it was minted from (so a replaced key never serves the old one's
  token), until
  five minutes before Google's `expires_in` (half the life of a token shorter
  than ten minutes). Concurrent calls for one key share one exchange.
- **Failures.** An `invalid_grant`, `invalid_client`, `unauthorized_client`,
  `access_denied` or `invalid_scope` answer, or any other 4xx but 429, is
  `GoogleServiceAccountRejectedError`: not retried, and logged on
  `google-service-account` with Google's error code and the service account's
  email, never Google's description, which can quote the request. A 5xx, a
  429, `temporarily_unavailable`, a timeout or a broken connection is retried
  after 250 ms and 1 s, then `GoogleTokenEndpointUnavailableError`. Neither
  is cached in memory. `fillSlots` answers both as `credential-rejected`
  (424) with `meta.reason` `rejected` or `unavailable`, and nothing reaches
  the API. An unavailable endpoint leaves the key as it is, so the next call
  asks Google again; a refusal makes the key `rejected` (see
  [Rejected keys](#rejected-keys)).

## Grants

A **grant** is the owner's approval for one key to be sent to one
destination: an `https:` origin (or an `http:` one whose host is on the
outbound guard's development allowlist, the only `http:` hosts it sends to)
and a path prefix ending in `/`, stored as the URL parser's `href`. One key reaches several hosts, or several path prefixes
on one host, through one grant each (`api.openai.com/v1/` and
`eu.api.openai.com/v1/`, or `/v1/` and `/v1beta/`), and its secret is entered
once. The code is `lib/user-key-grants.ts` and
`handlers/handle-user-key-grants.ts`.

`user_key_grants` — one row per key and destination:

| Column                                                         | Holds                                                                                                                          |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `id`                                                           | UUID, minted by the realm server before sealing                                                                                |
| `key_id`                                                       | The key; deleting it deletes its grants                                                                                        |
| `owner`                                                        | The key's owner, who approved the grant                                                                                        |
| `destination`                                                  | The normalized destination; unique per key                                                                                     |
| `state`                                                        | `active`, or `rejected` (see [Rejected grants](#rejected-grants))                                                              |
| `approved_at`, `approved_via`                                  | When, and the secure session's client: `window` or `cli`                                                                       |
| `rejected_at`, `last_probe_at`                                 | When the vendor rejected the key here (set exactly while `rejected`), and when a call under it was last let through as a probe |
| `last_forbidden_at`, `last_forbidden_host`                     | The latest 403 the vendor answered under the grant, which changes no state                                                     |
| `value_ciphertext`, `value_nonce`, `value_tag`, `value_key_id` | The grant's own sealed copy of the key's value                                                                                 |

Withheld from `readonly_role` and its members, and excluded from the SQLite
schema dump, like `user_keys`. Query the metadata only:

```sql
SELECT id, key_id, destination, state, approved_at, approved_via, value_key_id
FROM user_key_grants WHERE owner = '@someone:boxel.ai' ORDER BY key_id, destination;
```

### The master copy and the grant copies

A key's value is stored once per place it is used:

- **The master copy** on `user_keys`, sealed with field `user_keys.value`,
  the owner and the key's id. Only creating a grant opens it to make a copy
  (`createOrReuseGrant`); the data-key re-seal pass also opens it, to seal it
  again under the same binding.
- **One copy per grant** on `user_key_grants`, sealed with field
  `user_key_grants.value`, the owner, the grant's id, the key's id (as the
  binding's `parentId`) and the grant's destination (`grantCopyBinding`).
  Sending opens only this copy, under the destination stored on the grant
  (`openGrantForSending`), and reads neither the master copy nor the operation.

Replacing a key seals the new value as the master copy and as every grant's
copy in one transaction, so nothing asks for approval again and the old value
opens nowhere. Creating a grant locks the key's row first, so a replace
running at the same time either finishes first or re-seals the new grant too.
`user_key_grants.value` is registered in `SEALED_COLUMNS`, so data-key
rotation re-seals grant copies, and the census reports them as
`sealed census: user_key_grants.value rowsByKeyId=…`.

**A grant row can't be added by hand.** A row inserted with SQL has no copy
sealed to its own id, key and destination: copying the sealed columns from
another grant, another key's grant or the key itself gives a copy bound to
that other row, and editing a grant's `destination` or `key_id` breaks its own
binding. Each fails to open with `SecretDecryptionError`, so the grant sends
nothing. Nothing else takes such a row for a grant either: an approval never
reuses a row whose copy doesn't open, and replacing the key leaves it as it is
instead of sealing the new value to it, the same as the data-key re-seal pass
does. To give a key a destination, the owner approves an operation that
sends there; to move a grant, remove it and approve again.

### Grants of a key that mints tokens

An OAuth connection or a `client_credentials` client (`MINTING_KINDS` in
`lib/user-keys.ts`) never sends its stored value: it mints an access token at a
token endpoint, which only the platform calls. Its grant's copy is a random
marker, sealed under the same binding, never the value: opening it under the
grant's destination is what proves at send time that the realm server made the
grant, and the minted token is attached after. Creating such a grant doesn't
open the master copy, replacing the key doesn't re-seal its grants, and a
refresh that rotates a connection's refresh token leaves them alone. Such a
key is never granted a destination that covers a token endpoint
(`tokenEndpointCoveredBy` in `lib/outbound/token-endpoints.ts`), and an
authorization-code client, which only signs people in, is never granted one
at all (400). See the `oauth-connections` skill.

### Creating or reusing a grant

A grant is made from an operation, never from a typed destination: the
destination is the operation's lowered `callApi` destination, read from the
realm's definition cache (see the `call-api` skill). If one of the key's
grants already **covers** it, that grant is used; otherwise a new one is
created. Covering is `destinationCovers`, the same rule the send-time check
applies: the operation's destination starts with the grant's, compared as
normalized `href`s, so a match always ends at a `/`. `https://api.openai.com/`
doesn't cover `https://api.openai.com.evil.net/`, and `/v1/` doesn't cover
`/v1beta/`. When several cover it, the longest is used.

The request also carries `expectedDestination`, the destination the user was
shown. It is compared with the one read from the operation and never used in
its place; when they differ, nothing is approved and the answer is 409, so an
edit to the operation between showing it and approving it can't move the key.
The approval UI shows the destination again and asks once more.

A grant stores its destination when it is created and nothing reads the
operation again, so editing a declaration afterwards changes no grant: the
next approval of the edited operation creates, or reuses, a grant for where
it now sends.

**Whole-host grants.** A destination is the path up to the operation URL's
first `{name}` segment, so one whose first segment is a parameter
(`https://storage.googleapis.com/{bucket}/…`) is the whole host,
`https://storage.googleapis.com/`. That grant covers every later operation on
the host, so on a host that separates tenants by path, one approval covers
them all. The grant can't be narrower than the operation, which can itself
send to any path there. An approval UI should say so when the destination's
path is `/`.

A destination with a host wildcard (`*`, or `%2A`), user info, a query or
fragment, a path not ending in `/`, or a trailing dot on the host is refused.

The caller must be able to read both the realm the request names and the
realm that serves the operation's module (`readsRealmOf`, as for a named
query's type). A module in a realm they can't read, or in none this server
serves, answers as no such operation, so a grant request never discloses an
unreadable realm's destinations.

Creating and removing a grant take a session signed in on the secure origin,
from a request whose `Origin` is the secure origin or absent, exactly as
minting a key write ticket does. No ticket is involved.

| Route                               | Does                                                                                                                                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /_user-key-grants`            | Create or reuse: type `user-key-grant`, `attributes.{keyId, realm, codeRef: {module, name}, operation, expectedDestination}`; answers 201 with a new grant or 200 with the one reused, and `meta.{created}` |
| `DELETE /_user-key-grants/:grantId` | Remove one of the user's grants; revokes every binding that sent under it, in every realm, and answers `meta.{revokedBindings}` (see the `key-bindings` skill)                                              |

| Status | Means                                                                                                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 400    | Malformed body; an attribute that can't be set (a `destination` included); no `expectedDestination`; an operation that sends no request or whose declaration has problems; a refused destination |
| 403    | No secure session, or a request from another `Origin`                                                                                                                                            |
| 404    | No such key or grant of the user's; a realm the user can't read; no such operation, or one whose module is in a realm the user can't read                                                        |
| 409    | The operation sends to another destination than `expectedDestination`                                                                                                                            |

### Rejected grants

A vendor that answers a `callApi` with **401** has refused the key at that
destination, so every grant the request was sent under becomes `rejected`
(`markGrantRejected` in `lib/key-grant-rejection.ts`, called from the sender in
`lib/outbound/call-api-sender.ts`), and the call is refused
`credential-rejected` (424, `meta.slot`, `meta.destination`) instead of
handing the card the 401. Only those grants: the same key's grant at another
host keeps sending, since a vendor can refuse a key at one host and accept it
at another (a data-residency host). When a request carries two credentials
the vendor doesn't say which it refused, so both grants are rejected.

- **Calls under a rejected grant** are refused `credential-rejected` before
  the key is opened and without contacting the vendor (`checkedBindings` in
  `lib/key-bindings.ts`), except **one probe per grant per interval**: the
  first call after `last_probe_at` plus the interval claims the probe in one
  `UPDATE` (`claimProbe`), so concurrent calls can't both probe. The interval
  is `KEY_GRANT_PROBE_INTERVAL_SECONDS` (default 900). A pipeline admission
  (`pipelineAdmission`) admits a run only while a probe is due, and claims
  nothing.
- **A probe the vendor answers below 400 clears the grant**; a 401 leaves it
  rejected, and anything else (403, 429, 5xx, a timeout) leaves it as it was,
  since none of those says the key works.
- **Replacing the key clears every one of its grants** in the transaction that
  re-seals them (`clearKeyRejections`). Removing a grant, or deleting the key,
  takes its rejection with it.
- **A 403 never changes state.** Vendors use it for a missing permission on
  one resource, an organization's single sign-on approval or a rate limit, so
  it is recorded on the grant (`last_forbidden_at`, `last_forbidden_host`) and
  returned to the card as the vendor's answer. The owner sees it in the key's
  listing as `grants[].vendorForbidden`, beside `state` and `rejectedAt`.
- **One notice on entering the state**, never on a probe refused again:
  `user_key_grant_notices`, one row per recipient — the key's owner, and when
  the call came through a share, each direct writer of the share's realm —
  with the key's id and name and the destination copied in. Withheld from
  `readonly_role` and the SQLite dump, like the other key tables.

```sql
-- A user's rejected grants, and when each was last probed.
SELECT id, key_id, destination, rejected_at, last_probe_at, last_forbidden_at, last_forbidden_host
FROM user_key_grants WHERE owner = '@someone:boxel.ai' AND state = 'rejected';

-- The notices entering the state sent.
SELECT created_at, recipient, key_name, destination, realm_url, share_id
FROM user_key_grant_notices WHERE grant_id = '<id>' ORDER BY recipient;
```

The `boxel:key-grant` log channel carries one JSON line per event:
`grant-rejected` (`grant`, `host`, `realm`, `share`), `grant-cleared`
(`reason`: `probe` or `key-replaced`), `probe` (`status`, or null when the
probe got no answer) and `vendor-outcome` (`host`, `status`) for every
`callApi` the vendor answered. Hosts and ids only, never a path or a value.

### Rejected keys

A `google-service-account` key that Google's token endpoint refuses (see
[Google service accounts](#google-service-accounts)) is refused as a key, not
at one destination, so the **key** becomes `rejected` (`markKeyRejected` in
`lib/key-grant-rejection.ts`, called from `mintedToken` in
`lib/key-bindings.ts`), with `rejected_at` and `last_probe_at` set. Its
grants keep their own state. Only a refusal that names the key, its subject or
its scopes (an OAuth error in `REJECTED_ERRORS` in
`lib/outbound/google-service-account.ts`, carried as `keyRefused`) does this.
A 4xx that names no OAuth error, or an `invalid_grant` for an assertion outside
Google's time window (the signing host's clock), refuses that call alone and
leaves the key `active`; a 408 is retried like a 5xx.

- **Calls through any grant of a rejected key** are refused
  `credential-rejected` (424, `meta.reason: 'rejected'`) by `checkSlots`
  without contacting Google, except **one probe per key per interval**,
  claimed on `user_keys.last_probe_at` in one `UPDATE` (`claimKeyProbe`), with
  the same `KEY_GRANT_PROBE_INTERVAL_SECONDS`. A pipeline admission admits a
  run only while the probe is due.
- **A probe that mints clears the key**; one Google refuses again leaves it
  rejected and starts a new interval; one the endpoint fails to answer leaves
  it as it was.
- **Replacing the key clears it**, and every rejected grant of it, in the
  transaction that seals the new value (`clearKeyRejected`,
  `clearKeyRejections`).
- **One notice on entering the state**, in `user_key_grant_notices` with
  `reason` `key-rejected` (a grant's is `credential-rejected`), naming the
  grant the refused call came through and its destination: to the key's owner
  and, through a share, the direct writers of the share's realm.
- **A refusal only rejects the value it was signed with.** The exchange
  carries the sealed value's nonce, and the move to `rejected` matches it, so
  an exchange that started before a replace can't reject the new value.
- **A probe always asks Google.** It skips the in-memory token cache
  (`googleAccessToken(…, { fresh: true })`), since a token another process
  cached before the refusal says nothing about the key now.
- **Readiness** (`lib/key-readiness.ts`) answers `credential-rejected` for a
  binding whose key is `rejected`, to every caller.

```sql
-- A user's rejected keys, and when each was last probed.
SELECT id, name, kind, rejected_at, last_probe_at
FROM user_keys WHERE owner = '@someone:boxel.ai' AND state = 'rejected';
```

The `boxel:key-grant` channel carries `key-rejected` (`key`, `realm`,
`share`), `key-probe` (`minted`) and `key-cleared` (`reason`: `probe` or
`key-replaced`).

A user whose card shows Reconnect has a rejected grant or key. If the key is good
(a vendor outage that answered 401), the next probe brings it back on its
own, within one interval; otherwise the owner replaces the key.
