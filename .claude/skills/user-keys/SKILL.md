---
name: user-keys
description: Operate and diagnose the keys that belong to people — the `user_keys` table, the signed-in user's write-only management API (`/_user-keys`), and the key write tickets (`/_key-write-tickets`) that adding, replacing or deleting a key must present. Covers what the table holds and how its values are sealed and bound (field, owner, id), that a key records no destination, why no API, log line, Sentry event or read-only database role can ever read a value back, who may mint a ticket (a session signed in on the secure origin, from the secure window or the CLI — never the app's session) and how that is decided, ticket lifetime, single use and the one change each ticket is minted for, and every refusal the API answers with. Also covers grants — where a key may be sent, one `user_key_grants` row per destination its owner approved, each holding its own sealed copy of the key — the master and grant copies and which code opens each, how a grant is created or reused from an operation's lowered destination, why a grant row added by hand sends nothing, and the `/_user-key-grants` routes. Use when a user reports a key they can't add, replace or delete, when a key change or a grant is refused with 403, when reading or querying `user_keys` / `key_write_tickets` / `user_key_grants` as an operator, when a key's value or a grant's copy fails to open with SecretDecryptionError, or when changing `lib/user-keys.ts`, `lib/user-key-grants.ts`, `handlers/handle-user-keys.ts` or `handlers/handle-user-key-grants.ts`.
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

| Column                                                         | Holds                                                                                                       |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `id`                                                           | UUID, minted by the realm server before sealing (the value is bound to it)                                  |
| `owner`                                                        | The owner's Matrix user id                                                                                  |
| `name`                                                         | A label for people, unique among the owner's keys (`user_keys_owner_name_key`); two owners may share a name |
| `kind`                                                         | `static`                                                                                                    |
| `state`                                                        | `active`                                                                                                    |
| `value_ciphertext`, `value_nonce`, `value_tag`, `value_key_id` | The sealed value                                                                                            |
| `created_at`, `updated_at`                                     | `timestamptz`                                                                                               |

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
SELECT id, owner, name, kind, state, value_key_id, created_at, updated_at
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
| `POST /_user-keys`         | Add: `attributes.{name, kind?, value}`, `meta.{ticket}` (a ticket to `add`)                                                                                                           |
| `PATCH /_user-keys/:id`    | Replace the value: `attributes.{value}`, `meta.{ticket}` (a ticket to `replace` this key); re-seals every grant's copy                                                                |
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
calls these routes and the shares routes (see the `key-shares` skill). A
command that only reads (`list`, `show`, `shares`), and `unshare`, uses the
profile's ordinary session. A command that changes a key or a share in a way
that needs a ticket (`add`, `replace`, `delete`, `share`, `swap`) makes all of
its requests with the profile's secure session, signing in through the
browser first when the profile has none, and mints a ticket for that one
change. It prints a refusal as `Refused (HTTP <status>):
<reason>`, and under `--json` passes the response's `errors` through
unchanged, so a user's report carries the server's own words.

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

| Column                                                         | Holds                                                    |
| -------------------------------------------------------------- | -------------------------------------------------------- |
| `id`                                                           | UUID, minted by the realm server before sealing          |
| `key_id`                                                       | The key; deleting it deletes its grants                  |
| `owner`                                                        | The key's owner, who approved the grant                  |
| `destination`                                                  | The normalized destination; unique per key               |
| `state`                                                        | `active`                                                 |
| `approved_at`, `approved_via`                                  | When, and the secure session's client: `window` or `cli` |
| `value_ciphertext`, `value_nonce`, `value_tag`, `value_key_id` | The grant's own sealed copy of the key's value           |

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
