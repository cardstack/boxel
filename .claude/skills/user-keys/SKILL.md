---
name: user-keys
description: Operate and diagnose the keys that belong to people — the `user_keys` table, the signed-in user's write-only management API (`/_user-keys`), and the key write tickets (`/_key-write-tickets`) that adding, replacing or deleting a key must present. Covers what the table holds and how its values are sealed and bound (field, owner, id), that a key records no destination, why no API, log line, Sentry event or read-only database role can ever read a value back, who may mint a ticket (a session signed in on the secure origin, from the secure window or the CLI — never the app's session) and how that is decided, ticket lifetime, single use and the one change each ticket is minted for, and every refusal the API answers with. Use when a user reports a key they can't add, replace or delete, when a key change is refused with 403, when reading or querying `user_keys` / `key_write_tickets` as an operator, when a key's value fails to open with SecretDecryptionError, or when changing `lib/user-keys.ts` or `handlers/handle-user-keys.ts`.
---

# User keys (operators)

A key is a credential stored for one user, its **owner**: the Matrix user id
of the session that added it. Only the owner lists, shows, replaces or
deletes it. A key is only its secret: it records no destination, and nothing
here says where a key may be sent. The code is `packages/realm-server/lib/user-keys.ts` (storage,
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

| Route                      | Does                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /_key-write-tickets` | Mint a ticket for one change: type `key-write-ticket`, `attributes.{action, keyId?, realm?, shareId?}`; answers `attributes.{ticket, expiresAt}` |
| `GET /_user-keys`          | List the user's keys' metadata, by name                                                                                                          |
| `GET /_user-keys/:id`      | One key's metadata                                                                                                                               |
| `POST /_user-keys`         | Add: `attributes.{name, kind?, value}`, `meta.{ticket}` (a ticket to `add`)                                                                      |
| `PATCH /_user-keys/:id`    | Replace the value: `attributes.{value}`, `meta.{ticket}` (a ticket to `replace` this key)                                                        |
| `DELETE /_user-keys/:id`   | Delete: `meta.{ticket}` (a ticket to `delete` this key); suspends every share holding it (`GET /_key-shares?key=<id>` lists them first)          |

An attribute other than these, such as a `destination`, is refused with 400.

From the terminal, `boxel keys` (`packages/boxel-cli/src/commands/keys/`)
calls these routes and the shares routes (see the `key-shares` skill). It
reads with the profile's ordinary session; each change mints its own ticket
with the profile's secure session, signing in through the browser first when
the profile has none. It prints a refusal as `Refused (HTTP <status>):
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
