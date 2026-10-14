---
name: user-keys
description: Operate and diagnose the keys that belong to people — the `user_keys` table, the signed-in user's write-only management API (`/_user-keys`), and the key write tickets (`/_key-write-tickets`) that every value write must present. Covers what the table holds and how its values are sealed and bound (field, owner, id, destination), why no API, log line, Sentry event or read-only database role can ever read a value back, who may mint a ticket (the secure origin and the CLI, never the app page) and how that is decided, ticket lifetime and single use, every refusal the API answers with, and setting a key's destination later. Use when a user reports a key they can't add, replace or delete, when a key write is refused with 403, when reading or querying `user_keys` / `key_write_tickets` as an operator, when a key's value fails to open with SecretDecryptionError, or when changing `lib/user-keys.ts` or `handlers/handle-user-keys.ts`.
---

# User keys (operators)

A key is a credential stored for one user, its **owner**: the Matrix user id
of the session that added it. Only the owner lists, shows, replaces or
deletes it. The code is `packages/realm-server/lib/user-keys.ts` (storage,
tickets, sealing) and `packages/realm-server/handlers/handle-user-keys.ts`
(the routes).

**No value is ever readable.** No route returns one, nothing logs one, the
request telemetry keeps only the method and path of these routes, the
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
| `destination`                                                  | Where the key may be sent, or null until its first approval sets it                                         |
| `placement_hints`                                              | Where the key goes in a request, as the operation declares it, or null                                      |
| `state`                                                        | `active`                                                                                                    |
| `value_ciphertext`, `value_nonce`, `value_tag`, `value_key_id` | The sealed value                                                                                            |
| `created_at`, `updated_at`                                     | `timestamptz`                                                                                               |

`key_write_tickets` — one row per unused ticket: `ticket_sha256`, `owner`,
`expires_at`. Only the SHA-256 is stored; the ticket itself exists only in
the response that minted it.

Both are excluded from the SQLite schema dump and withheld from
`readonly_role` and its members. Query them as the application role, and
select metadata columns only:

```sql
SELECT id, owner, name, kind, destination, state, value_key_id, created_at, updated_at
FROM user_keys WHERE owner = '@someone:boxel.ai' ORDER BY name;
```

## Sealing and binding

Each value is sealed with field `user_keys.value`, the owner, the row's id
and, once it has one, the destination. A key added with no destination is
bound to field, owner and id only. `setUserKeyDestination` (run by a key's
first approval) re-seals it with its destination; from then on it opens only
with that destination, and its destination can't change. Setting the
destination it already has is a no-op.

A value moved to another row, owner or destination by a database writer does
not open: `SecretDecryptionError`, which names none of the inputs.

## Key write tickets

A value is written (add or replace) only with a ticket: minted for the
signed-in user, valid for 10 minutes, single use. The write consumes the
ticket in the same transaction, so a write refused for another reason (a
duplicate name, an unknown key) leaves the ticket usable. Expired tickets are
swept whenever a ticket is minted.

**Who may mint one.** `POST /_key-write-tickets` mints only for a request
with no `Origin` header (the CLI) or whose `Origin` is the secure origin's.
Browsers always send `Origin` on a POST and page script can't change it, so
the app page — where card code runs with the user's session — is refused
with 403 and never sees a ticket, and so can never write a value.

## The API

All routes take the user's realm-server session (`Authorization: Bearer`),
refuse a delegated session with 401 (the shared session check) and a
realm-authority session with 403. Bodies are
JSON:API with type `user-key`; the ticket and any operation reference go in
`meta`.

| Route                      | Does                                                                |
| -------------------------- | ------------------------------------------------------------------- |
| `POST /_key-write-tickets` | Mint a ticket: `data.attributes.{ticket, expiresAt}`                |
| `GET /_user-keys`          | List the user's keys' metadata, by name                             |
| `GET /_user-keys/:id`      | One key's metadata                                                  |
| `POST /_user-keys`         | Add: `attributes.{name, kind?, value}`, `meta.{ticket, operation?}` |
| `PATCH /_user-keys/:id`    | Replace the value: `attributes.{value}`, `meta.{ticket}`            |
| `DELETE /_user-keys/:id`   | Delete                                                              |

A destination is never typed: an `attributes.destination` is refused with 400. An add takes it from `meta.operation`
(`{realmURL, definitionURL, exportName, operationName}`) through
`resolveKeyDestination`, which answers 422 for an operation that declares no
destination a key can be sent to; without an operation the key is stored with
none.

| Status | Means                                                                                                                      |
| ------ | -------------------------------------------------------------------------------------------------------------------------- |
| 400    | Malformed body, a missing or over-long name or value, an attribute that can't be set                                       |
| 401    | No session, an invalid one, or a delegated one                                                                             |
| 403    | No valid ticket (missing, used, expired, or another user's); a ticket asked for by the app page; a realm-authority session |
| 404    | No such key — also what another user's key answers                                                                         |
| 409    | The owner already has a key of that name                                                                                   |
| 422    | The operation reference supplies no destination                                                                            |

A failure that isn't one of these is a 500 logged on `realm:user-keys` with
the error's name and message only, never the request.
