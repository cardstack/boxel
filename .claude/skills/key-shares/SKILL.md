---
name: key-shares
description: Operate and diagnose shares — keys their owners have put into a realm for other people there to consume — the `key_shares` and `key_share_notices` tables and the `/_key-shares` and `/_key-share-notices` routes. Covers share states (`active`, `suspended`) and every suspension reason (`owner-lost-write`, `suspended-by-writer`, `key-deleted`), which change makes each, how a share resumes, the triggers on `realm_user_permissions` and `user_keys` that suspend shares however those rows change, who may share, unshare, suspend, resume and swap, who sees what, and every refusal the API answers with. Use when a user reports a share that stopped working or that they can't share, swap, suspend or see; when reading or querying `key_shares` / `key_share_notices` as an operator; or when changing `lib/key-shares.ts`, `handlers/handle-key-shares.ts` or the triggers.
---

# Key shares (operators)

A **share** puts a key into a realm so that other people there can consume it
(a weather subscription, say). It holds no secret, only a reference to the
key, so one key can be shared into several realms while its value is stored
once, in `user_keys` (see the `user-keys` skill). Using your own key in a
realm is a different thing and needs no share.

The code is `packages/realm-server/lib/key-shares.ts` (the rules) and
`packages/realm-server/handlers/handle-key-shares.ts` (the routes). The
triggers are in the migration that adds `key_shares`.

## States and suspension reasons

A share is `active` or `suspended`. A suspended share serves nothing and
always carries one reason:

| `suspension_reason`   | Made by                                                                     | `key_id` | Ends when                                                                                 |
| --------------------- | --------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| `owner-lost-write`    | The owner's own permission row stops granting write, or is deleted (leaves) | kept     | The owner's row grants write again (resumes by itself), or a direct writer swaps a key in |
| `suspended-by-writer` | A direct writer of the realm (`suspended_by`), for abuse or any reason      | kept     | A direct writer resumes it, or swaps a key in                                             |
| `key-deleted`         | The owner deleted the key the share holds                                   | null     | A direct writer swaps a key in                                                            |

`key_shares_state_check` enforces these combinations. Only an active share is
suspended: a share suspended for one reason keeps that reason when another
applies too, so a share a writer suspended stays suspended when its owner
loses write and regains it. The exception is deleting the key: a share then
holds no key, so whatever it was suspended for, it becomes `key-deleted`
(clearing `suspended_by`), and the realm's writers get a notice of it. Resuming a `suspended-by-writer` share whose
owner is no longer a direct writer leaves it suspended as `owner-lost-write`,
and it resumes when they write again.

A suspension keeps the share's place, label and history: only its owner's
unshare, or deleting its realm, deletes a share, so cards that name it by
label keep working once it is brought back. Deleting a realm deletes its
shares and their notices, so a realm later made at the same URL gets none of
them back.

## Triggers

Suspensions that follow from another change are made by triggers, so they
hold however the change is made (the realm's `_permissions` endpoint, the
admin permission upsert, publishing, deleting a realm, a database writer):

- `key_shares_follow_permissions` on `realm_user_permissions`, after any
  insert, update or delete of a row: suspends that person's active shares in
  that realm when the row no longer grants write, and resumes their
  `owner-lost-write` shares there when it does again. A share's owner is
  always a person (only a direct writer can share or swap in), so their own
  row is the whole answer.
- `key_shares_follow_key_delete` on `user_keys`, before a delete: suspends
  every share holding the key as `key-deleted` and clears `key_id`.
- `key_shares_notice_suspension` on `key_shares`: each share going from active
  to suspended, and each suspended share whose key is deleted, records a row
  in `key_share_notices`.

Sharing and swapping lock the person's permission row (`isDirectWriterLocked`)
until they commit, so a concurrent removal of their write waits and then
suspends what they made.

## Who may do what

| Action  | Who                                                                                                                        | Ticket                       |
| ------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Share   | The key's owner, into a realm where they are a direct writer                                                               | `share` for that key + realm |
| Unshare | The share's owner, whether or not they still write the realm                                                               | none                         |
| Suspend | Any direct writer of the realm, on an active share                                                                         | none                         |
| Resume  | Any direct writer of the realm, on a `suspended-by-writer` share                                                           | `resume` for that share      |
| Swap    | Any direct writer of the realm, putting one of their own keys into a suspended share; they become its owner and it resumes | `swap` for that key + share  |

A direct writer is a person whose own permission row grants write
(`isDirectWriter`): a `*` or `users` row, a bot account or a policy grant
makes no one a direct writer. Nobody swaps in another user's key: a ticket to
do so is refused at minting with 404, as for a key that doesn't exist.

Changing a share's `limits` is for its owner only; the column is reserved and
no route sets it.

## Visibility

- A share's owner sees every share they own, in every realm, with its key
  (`GET /_key-shares`); `?key=<id>` narrows that to the shares holding one
  key — the ones deleting it would suspend.
- A realm's direct writers see its shares with owner and state, without the
  key of a share they don't own (`GET /_key-shares?realm=<url>`), and its
  notices, newest first, at most 100 (`GET /_key-share-notices?realm=<url>`).
  An owner who loses write stops seeing the realm's shares and notices, and
  still sees their own.
- Anyone else, readers included, sees nothing of a realm's shares: the
  listings answer 403 and a share by id answers 404.

## Where users manage shares

A realm's direct writers manage its shares from the **API Keys** entry of the
realm's config card (`realm.json`, `packages/base/realm-api-keys.gts`), in its
edit and isolated formats. It lists the realm's shares
(`GET /_key-shares?realm=`) with label, owner and state, and why a suspended
one is suspended. Suspend and the owner's Unshare call the routes directly, from the
app page, since neither takes a ticket. Share one of my keys and Swap one of my
keys in open the secure window (`share-key`, `swap-key`), where the ticket is
minted. For anyone who isn't a direct writer the listing answers 403 and the
entry isn't drawn. The host tools behind it are `list-realm-key-shares`,
`suspend-key-share` and `unshare-key` (`packages/host/app/tools/`).

## The tables

```sql
-- A realm's shares.
SELECT id, label, owner, key_id, state, suspension_reason, suspended_by, suspended_at
FROM key_shares WHERE realm_url = 'https://app.boxel.ai/someone/realm/' ORDER BY label;

-- Why a share is suspended, and since when.
SELECT created_at, reason, owner, suspended_by
FROM key_share_notices WHERE share_id = '<id>' ORDER BY created_at DESC;
```

Both tables hold no secret, but they are withheld from `readonly_role`, like
`user_keys`, and from every role that reads with its privileges (granted it
with INHERIT or SET, directly or through other roles). The migration revokes
each SELECT grant those roles hold, acting as the role that made it and with
CASCADE, never touching a table's owner or a member that only administers the
role. It then stops, naming the role and the column, if any of them can still
read a column (through a PUBLIC grant, say). Where the migrating role can't act
as a grant's grantor, it stops and names the grant. They are also excluded from
the SQLite schema dump.
`realm_url` is the realm's canonical URL, with a trailing slash, as
`realm_user_permissions` stores it.

## The API

All routes take the user's realm-server session and refuse a delegated or a
realm-authority session, as the keys API does. Bodies are JSON:API with type
`key-share`; a ticket goes in `meta.ticket`, minted from
`POST /_key-write-tickets` by a secure session (see the `user-keys` skill)
with `attributes.{action: 'share', keyId, realm}`,
`attributes.{action: 'swap', keyId, shareId}` or
`attributes.{action: 'resume', shareId}`. The request log keeps only the
method and path of these routes.

| Route                                 | Does                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| `GET /_key-shares`                    | The user's own shares; `?key=<id>` for one key's; `?realm=<url>` for a realm's |
| `POST /_key-shares`                   | Share: `attributes.{realm, keyId, label}`, `meta.{ticket}`                     |
| `DELETE /_key-shares/:id`             | Unshare                                                                        |
| `POST /_key-shares/:id/suspend`       | Suspend an active share                                                        |
| `POST /_key-shares/:id/resume`        | Lift a writer's suspension: `meta.{ticket}`                                    |
| `POST /_key-shares/:id/swap`          | Swap a key in: `attributes.{keyId}`, `meta.{ticket}`                           |
| `GET /_key-share-notices?realm=<url>` | A realm's suspension notices                                                   |

| Status | Means                                                                                                                                                                                                                 |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | Malformed body, a missing realm or key, a missing, over-long or control-character label, an attribute that can't be set                                                                                               |
| 403    | No valid ticket; sharing into a realm the owner isn't a direct writer of; a writer action by someone who isn't one; unsharing someone else's share; listing a realm's shares or notices without being a direct writer |
| 404    | No such share, or one the user can't see; no such key of the user's                                                                                                                                                   |
| 409    | A label the realm already has; suspending a suspended share; resuming one a writer didn't suspend; swapping into an active one                                                                                        |
