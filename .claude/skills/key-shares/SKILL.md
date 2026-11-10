---
name: key-shares
description: Operate and diagnose shares — keys their owners have put into a realm for other people there to consume — the `key_shares` and `key_share_notices` tables and the `/_key-shares` and `/_key-share-notices` routes. Covers share states (`active`, `suspended`) and every suspension reason (`owner-lost-write`, `suspended-by-writer`, `key-deleted`), which change makes each, how a share resumes, the triggers on `realm_user_permissions` and `user_keys` that suspend shares however those rows change, who may share, unshare, suspend, resume and swap, how sharing follows whether the realm's policy opens shared-key calls to people who aren't signed in and whether the key allows them, the audit a policy save that opens shares to such people needs (`policy-opens-shares-to-anonymous`, `key_policy_notices`, `/_key-policy-notices`), who sees what, and every refusal the API answers with. Use when a user reports a share that stopped working or that they can't share, swap, suspend or see; when reading or querying `key_shares` / `key_share_notices` as an operator; or when changing `lib/key-shares.ts`, `lib/policy-share-audit.ts`, `handlers/handle-key-shares.ts` or the triggers.
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

### What an unattended run checks before it starts

An automation (a run the realm server makes on its own, for its payer) asks
`automationAdmission` in `lib/key-bindings.ts` about each operation it
declares before its script starts. For a slot filled from a share, that's the
check every call makes (`checkSlots`), and the first one the slot fails stops
the run:

- the share is suspended, for any reason: `share-suspended`;
- the share's binding was made for another request than the operation sends
  now: `binding-needs-reapproval`;
- the share's grant at the destination is gone: `binding-not-approved`;
- the vendor rejected the share's key at that destination, or Google refused
  its service-account key, and no probe is due: `credential-rejected`;
- the share's key is an OAuth connection or client that can't mint a token:
  `credential-rejected` with `reason` `rejected` (a connection its vendor
  refused, or an access-only token past its expiry) or `needs-admin` (a
  broken, deleted, unshared or suspended client). See the `oauth-connections`
  skill.

The run opens no key at admission and asks no vendor. A run doesn't need the
share's binding approved for interactive use, and it isn't counted against
the share's limits, since only interactive calls are.

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

| Action  | Who                                                                                                                                                                                                                                                        | Ticket                       |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Share   | The key's owner, into a realm where they are a direct writer                                                                                                                                                                                               | `share` for that key + realm |
| Unshare | The share's owner, whether or not they still write the realm                                                                                                                                                                                               | none                         |
| Suspend | Any direct writer of the realm, on an active share                                                                                                                                                                                                         | none                         |
| Resume  | Any direct writer of the realm, on a `suspended-by-writer` share                                                                                                                                                                                           | `resume` for that share      |
| Swap    | Any direct writer of the realm, putting one of their own keys into a suspended share; they become its owner and it resumes, and its bindings move to grants of their key (a secure-origin session is needed when it has any; see the `key-bindings` skill) | `swap` for that key + share  |

A direct writer is a person whose own permission row grants write
(`isDirectWriter`): a `*` or `users` row, a bot account or a policy grant
makes no one a direct writer. Nobody swaps in another user's key: a ticket to
do so is refused at minting with 404, as for a key that doesn't exist.

A share's limits (its per-caller rate limit and daily and monthly budgets) are
changed by its owner only, from a secure session (`PUT
/_key-shares/:id/limits`); a direct writer who isn't the owner is refused 403
and suspends the share instead. See the `key-limits` skill.

## People who aren't signed in

A share carries nothing about people who aren't signed in: `key_shares` has no
anonymous columns, and a share resource no anonymous attributes. Whether such
people may use a key is its owner's decision about the key itself
(`user_keys.anonymous`, `user_keys.anonymous_daily_cap` and `user_keys.anonymous_monthly_cap`; see the
`user-keys` skill), and whether they can use it in a realm is that realm's
policy's to say. A visitor the policy admits to an operation is served by a
share's interactive bindings only while the key the share holds allows
anonymous use (see the `key-bindings` skill), within the per-address rate and
the key's daily and monthly anonymous caps (see the `key-limits` skill).

Sharing makes no choice about such people: the owner's only decision is on
the key. Where the realm's policy opens a call that sends a shared key to
people who aren't signed in, sharing a key there means they will use it. The
policy opens shared-key calls to visitors when some compiled grant has
`anonymous.sendsSharedKey` (`opensSharedKeysToAnonymous` in
`lib/anonymous-key-use.ts`), which compilation sets only for a grant naming
`"anonymous"` on a `callApi` whose every slot takes a shared key; a grant on a
keyless `callApi` doesn't count. The secure window reads it as
`realm.opensToAnonymous`.

- **The policy opens nothing to visitors.** The share is made as any other,
  and the `share-key` page is the signed-in-only page.
- **The policy opens such calls and the key allows anonymous use.** The share
  is made. The page's intro bolds "and so will people who aren't signed in",
  and a read-only row says the key allows it (with its anonymous caps) and
  that sharing it here means they will use it.
- **The policy opens such calls and the key doesn't allow it.** The share is
  refused 400 (`shareKey`), with a message telling the owner to allow it for
  the key first: on the key's page, or `boxel keys anonymous <name> on` (see
  the `user-keys` skill). The page disables Share key, says the key can't be
  shared here, and links to the key's page to allow it first.

`POST /_key-shares` takes no anonymous attributes: `anonymous` and
`anonymousDailyCap` and `anonymousMonthlyCap` are refused 400 as attributes that can't be set.
`boxel keys share` has no `--anonymous`; it first asks the realm
(`POST /_secure-window/context` with the CLI's secure session), and where the
policy opens such calls it prints a warning that sharing means people who
aren't signed in will use the key, and refuses a key that doesn't allow it,
pointing to `boxel keys anonymous <name> on`. The AI assistant warns the user
before opening `share-key` for such a workspace (`SYSTEM_MESSAGE` in `runtime-common/ai/constants.ts`, and the
`open-secure-window` tool's description). It tells one by the workspace's
`realm.json` naming a `policy` card with a grant whose `where` is
`actor() == "anonymous"` on a `callApi` operation whose every credential slot
is `{{apiKey}}`.

The policy is asked only once the ticket and the owner's direct write are
checked, so nobody else learns from the answer what it opens. A key already
shared into a realm whose policy later opens calls to visitors serves them if
the key allows anonymous use, and otherwise they are asked to sign in.

A swap follows the same rule (`swapKeyIntoShare`, given the policy's
`opensToAnonymous` too): swapping a key into a share in a realm whose policy
opens shared-key calls to visitors means they will use it, so a key that
doesn't allow anonymous use is refused 400, pointing to the key's page or
`boxel keys anonymous <name> on`. Otherwise the `swap-key` page says in bold
that "they will use this key", and `boxel keys swap` prints the same warning
as `boxel keys share`.

Only a key that can serve people who aren't signed in is held to this: a
static key, a Google service account, or an OAuth client whose grant type is
`client_credentials` (`servesVisitorsSQL` in `lib/user-keys.ts`). A sign-in
app (an `authorization_code` client) never serves visitors, so sharing or
swapping one has no anonymous check.

## Published realms

A published realm holds no share or binding of its own, and nobody can share
into it, since it has no direct writers. Its cards use the shares of the realm
it was published from:

- **Policy.** Publishing points the copy's `realm.json` at its own copy of the
  source's policy card, when the source's pointer names a card in the source
  (`rebaseRealmPolicyPointer` in `handlers/handle-publish-realm.ts`). A pointer
  to a card in another realm is dropped. A realm mounted as published
  (`publishedMountOf` in `lib/published-realm.ts`, which the server and the
  test reconciler both mount from) compiles only the grants on a `callApi`
  whose every slot is `{{apiKey}}` (`sharedKeyCallsOnly`), so it admits no
  write. A keyless `callApi` is left out too: every request a published site
  sends is one a key's owner approved and budgeted. A rule naming a type by
  the source's URL names the copy's type (`Realm#ownCopyOf`).
- **Bindings.** The published realm's sender (`publishedFrom` in
  `lib/outbound/call-api-sender.ts`) looks a call's binding up in the source:
  the realm, the type's module and the card are each read at the same path in
  the source (`sameResourceIn`), and a module in any other realm as it is.
  Limits and caps are the share's and the key's, so the site's calls spend the
  same budgets as the workspace's.
- **What the site's callers see.** A refusal names the published realm, never
  the source, whose URL a published site may exist to hide. Readiness that
  only the source's writers can act on (`needs-connect`, `needs-approval`,
  `needs-reapproval`) reads as `needs-admin` on the published realm.
- **Usage.** The site's uses and refusals are recorded under the published
  realm's URL (`key_uses.realm_url`). A share's usage lists them by realm
  (`realms`, with `published` on each site), and the secure origin's usage
  panel draws "Where it was used" once a site has used the share.
- **Staleness.** The policy is the snapshot's, so a change to the source's
  policy reaches the published realm on republish. The share, its key and its
  bindings are live: unsharing, suspending or turning off anonymous use on the
  key applies at once. A binding approved again for a request the snapshot's
  older code doesn't send refuses the published realm's call
  `binding-needs-reapproval` and is left active for the source; republishing
  serves it again.

## Visibility

- A share's owner sees every share they own, in every realm, with its key
  (`GET /_key-shares`); `?key=<id>` narrows that to the shares holding one
  key — the ones deleting it would suspend.
- A realm's direct writers see its shares with owner and state, without the
  key of a share they don't own, each with the operations it is approved for
  there (`operations`: one per binding, with its type, operation, instance,
  slot, state and the destination it was last approved for, which a swap
  grants the new key; see the `key-bindings` skill) (`GET /_key-shares?realm=<url>`), and its
  notices, newest first, at most 100 (`GET /_key-share-notices?realm=<url>`).
  An owner who loses write stops seeing the realm's shares and notices, and
  still sees their own.
- A share's or notice's `owner` and `suspendedBy` are shown to someone else
  only while permission rows in the share's realm name both the viewer and
  that person (ADR 011 §1.2); otherwise they read `null`. That holds for the
  realm's listings, the share a suspend or resume answers with, and the
  owner's own listing, which always carries the owner's own id but shows the
  suspender only while rows in that realm name them both. A `*` or `users`
  row, or a policy grant, names no one. The `key_shares` and
  `key_share_notices` rows keep the ids.
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

## A policy that opens shares to visitors

Whether people who aren't signed in may use a key is its owner's setting on
the key; whether they can in a realm is its policy's. A write that would put
a policy in force (a card whose written `adoptsFrom` is RealmPolicy, named by
a realm with shares, or a realm's `realm.json` pointing at another card) is
audited before anything is written, by `lib/policy-share-audit.ts`, which the
realm reaches through its `policyWriteAuditor`. Only realms with an active,
interactive binding on an active share are asked about, each one's pointer is
read without mounting it, and only a realm whose pointer names a changed card
is mounted. One that can't be mounted refuses the write 503.

The audit lists each share whose active, interactive bindings are for an
operation the new policy opens to visitors with a shared key and the policy in
force doesn't, skipping keys that never serve visitors (a sign-in app's, a
connection's). A listed write is refused 409 with
`meta.code: 'policy-opens-shares-to-anonymous'` and the list in `meta.audit`,
unless it carries the list's fingerprint in
`X-Boxel-Policy-Audit-Confirmation`. A saver who isn't a direct writer of a
governed realm is shown its entries without the share, label and owner. Every
write route takes the confirmation: the card+json verbs, `+source` and byte
writes, `/_atomic` and `_operations`.

Once a confirmed write lands, each listed share's owner gets a row in
`key_policy_notices`: `visitors-use` for a key that allows anonymous use,
`visitors-wanted` for one that doesn't, unless their latest notice for the
share already says the same. The owner reads their own, newest first, at
`GET /_key-policy-notices`. A `visitors-wanted` notice is a request: the secure
origin's key page shows it as needing an answer, and the owner either allows
anonymous use on the key (`keys#anonymous=<key id>` opens that setting) or
declines it (`POST /_key-policy-notices/:id/decline`, from a secure session),
which sets `declined_at` and changes nothing about the key. A notice that
can't be recorded is logged on `realm:policy-share-audit` and costs the write
nothing.

Recording a notice sends `key-notices-updated` to the owner's session room,
and the app shows the count on the user's avatar and on the profile
menu's API Keys item. The count is `meta.unread` on `GET /_key-policy-notices`:
the notices among the newest 100 whose `read_at` is null. The key page marks
the ones it lists read with `POST /_key-policy-notices/read`
(`data: [{ type: 'key-policy-notice', id }]`). Only a secure session may call
it, so card code in the app page can read the count but not clear it. Marking
read sends `key-notices-updated` again, so the owner's other sessions clear
the badge too. A badge that won't clear is the owner's key page failing to
mark read; it logs `Could not mark the key notices read` in the browser
console.

```sql
-- What a realm's policy opened, to whom it was told, and whether they saw it.
SELECT created_at, owner, label, reason, operations, saved_by, read_at
FROM key_policy_notices WHERE realm_url = 'https://app.boxel.ai/someone/realm/'
ORDER BY created_at DESC;
```

## The tables

```sql
-- A realm's shares.
SELECT id, label, owner, key_id, state, suspension_reason, suspended_by, suspended_at
FROM key_shares WHERE realm_url = 'https://app.boxel.ai/someone/realm/' ORDER BY label;

-- Why a share is suspended, and since when.
SELECT created_at, reason, owner, suspended_by
FROM key_share_notices WHERE share_id = '<id>' ORDER BY created_at DESC;
```

Neither table holds a secret. `readonly_role` (dashboards and read-only
database access, such as `claude_readonly_user` in staging and production) can
read `key_shares`, so a realm's shares can be inspected while triaging without
the application role. `key_share_notices` is withheld from it, as `user_keys`
is, and from every role that reads with its privileges (granted it with
INHERIT or SET, directly or through other roles). Both tables are excluded from
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
| `GET /_key-policy-notices`            | The user's policy notices as a key's owner; `meta.unread` is the badge's count |
| `POST /_key-policy-notices/read`      | Mark listed notices read: `data: [{type, id}]`, from a secure session          |
| `PUT /_key-shares/:id/limits`         | Set the share's limits, as its owner (see the `key-limits` skill)              |

| Status | Means                                                                                                                                                                                                                                                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400    | Malformed body, a missing realm or key, a missing, over-long or control-character label, an attribute that can't be set (`anonymous`, `anonymousDailyCap` and `anonymousMonthlyCap` included); sharing a key that doesn't allow anonymous use into a realm whose policy opens a call that sends a shared key to people who aren't signed in |
| 403    | No valid ticket; sharing into a realm the owner isn't a direct writer of; a writer action by someone who isn't one; unsharing someone else's share; listing a realm's shares or notices without being a direct writer                                                                                                                       |
| 404    | No such share, or one the user can't see; no such key of the user's                                                                                                                                                                                                                                                                         |
| 409    | A label the realm already has; suspending a suspended share; resuming one a writer didn't suspend; swapping into an active one                                                                                                                                                                                                              |
