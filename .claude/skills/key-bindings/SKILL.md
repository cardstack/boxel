---
name: key-bindings
description: How a `callApi` operation's credential slots are filled from bindings — a key owner's approval of one operation in one realm, naming the key (or share) for each slot — and how to diagnose a binding refusal. Covers the `key_bindings`, `key_binding_approvals` and `key_binding_notices` tables, the `/_key-bindings` routes and who may call them, how approving creates or reuses a grant, the fingerprint and exactly which parts of a declaration it covers, `needs-reapproval` and its one notice, per-instance bindings, pipelines versus interactive invocation (`Realm.handlePipeline`, `pipelineAdmission`), what removing a grant, deleting a key, suspending a share and swapping a key into a share do to bindings, and each refusal (`binding-not-approved`, `share-suspended`, `binding-needs-reapproval`, `interactive-use-not-approved`). Use when a `callApi` is refused with one of those codes, when reading or querying the binding tables as an operator, or when changing `lib/key-bindings.ts`, `lib/key-binding-revocation.ts`, `handlers/handle-key-bindings.ts`, the slot filling in `card-operations/call-api.ts`, or anything that removes grants, keys or shares.
---

# Key bindings

A **binding** is a key owner's approval for one `callApi` operation, in one
realm, to send a chosen key in one of its credential slots. Card code never
names a key; the binding does. At call time nothing is searched: each slot's
binding is looked up by its identity, and a slot with none is not sent.

| What                                                   | Where                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Approving, filling, fingerprints, swap, admission      | `packages/realm-server/lib/key-bindings.ts`                                                      |
| Revoking (shared by revoke, grant removal, key delete) | `packages/realm-server/lib/key-binding-revocation.ts`                                            |
| Routes                                                 | `packages/realm-server/handlers/handle-key-bindings.ts`                                          |
| Where the executor asks for the slots                  | `packages/runtime-common/card-operations/call-api.ts` (`callApiOperation`, `CallApiSender.fill`) |
| The sender that fills them                             | `packages/realm-server/lib/outbound/call-api-sender.ts` (`createCallApiSender`)                  |
| Pipeline entry                                         | `Realm.handlePipeline` in `packages/runtime-common/realm.ts`                                     |
| Tables, trigger                                        | the `add-key-bindings` migration in `packages/postgres/migrations/`                              |
| Grants                                                 | the `user-keys` skill, _Grants_                                                                  |

## What a binding is keyed by

One row of `key_bindings` per slot:

- `realm_url` — the realm it was approved in. Approving in one realm says
  nothing about another.
- `definition_url`, `export_name`, `operation_name` — the operation, as the
  **type it is invoked through** resolves it: the type a type target names, or
  the one an instance adopts from (`resolvedTypeOf` in `dispatch.ts`). An
  operation inherited from a parent class is bound per subclass. The module is
  resolved against the realm with its executable extension trimmed, at
  approval (`bindingType`) and at call time alike, so `…/inbox` and
  `…/inbox.gts` name one type.
- `instance_url` — the card, for an operation declared `perInstance: true`
  (one webhook per channel card), as invocations address it once the realm
  canonicalizes the target (`canonicalInstance`: the realm root is its index
  card; a `.json`, trailing slash, query or fragment names the card); null
  otherwise. Invoking a per-instance
  operation on the type, or on a card it wasn't approved for, is
  `binding-not-approved`.
- `slot` — the token as written: `userKey`, `apiKey`, or `apiKey:<name>`.
- Exactly one of `key_id` (a `userKey` slot: the approver's own key) and
  `share_id` (an `apiKey` slot: a share in the realm).
- `approved_by` — the key's owner. For a `userKey` slot it is also the **only
  caller** the binding serves, so uniqueness includes it: each caller approves
  their own key. An `apiKey` slot has one binding per realm (per instance),
  serving every caller; approving another share for it replaces the first.
- `grant_id` — the grant the credential is sent under.
- `interactive`, `anonymous` — always false: interactive and anonymous use
  aren't offered, and approving either is refused 403.
- `fingerprint`, `approval_id`, `state` (`active`, `needs-reapproval`,
  `suspended`).

## Approving

`POST /_key-bindings` with a **secure-origin session** (the secure window's
own, or the CLI's), from the secure origin's `Origin` or none — the same rule
as creating a grant (`secureClientOf`). The app page's session is refused
403 from any origin: card code can reach that session, and a card that could
approve bindings could spend the user's key.

```json
{
  "data": {
    "type": "key-binding-approval",
    "attributes": {
      "realm": "https://app.boxel.ai/someone/inbox/",
      "operations": [
        {
          "codeRef": { "module": "https://…/inbox", "name": "Inbox" },
          "operation": "listPRs",
          "expectedDestination": "https://api.github.com/",
          "slots": {
            "userKey": { "keyId": "<uuid>", "expectedFingerprint": "<hex>" }
          }
        }
      ]
    }
  }
}
```

Before approving, the approval screen reads what it shows from
`GET /_key-bindings/preview?realm=&module=&name=&operation=` (any session
that can read the realm): the destination, whether the operation is approved
per instance, and for each slot the request snapshot and its fingerprint. The
approval names those back.

A per-instance operation adds `"instance": "<card id>"`; a share slot is
`{ "shareId": "<uuid>", "expectedFingerprint": … }`, and only the owner of the
share's key approves it, while the share is active. A realm, card or module
may be named in prefix form; answers name them in RRI form. One request is one
confirmation: every row it writes shares a `batch_id`. For each operation, in
order:

1. The operation is read from the realm's definition cache (the caller must
   be able to read the realm and the module's realm, as for a grant). Its
   destination must equal `expectedDestination`, and each slot's request must
   hash to its `expectedFingerprint` — what the user was shown — or nothing
   is approved (409). So an edit between showing and approving, such as the
   key moved from a header into the body at the same destination, is never
   approved unseen.
2. A grant of the key (the share's key, for a share) covering that destination
   is reused, or one is created (`createOrReuseGrantIn`).
3. The binding is written or moved to this approval, `active`, and an
   `approved` / `re-approved` row is appended to `key_binding_approvals`.

The window builds what it approves from `POST /_key-bindings/batch`
(`lib/key-binding-batch.ts`, the window's own session only), whose
`attributes.target` names a card or a card type in its realm as the window's
context does, with `review` for review-changes. It answers every `callApi`
operation on that card definition, in that realm, that needs the caller's
approval: a slot the caller approves (their own key for `userKey`, a share of
theirs in the realm for `apiKey`; a share slot someone else approved is
theirs) with no binding, a binding whose grant is gone, or one whose
fingerprint no longer matches (`changed`, carrying the last approval's
snapshot for a field-by-field diff). Approved, unchanged slots are left out,
and so is an operation with nothing left; a per-instance operation is in the
batch only when the target is a card. Operations come grouped by normalized
destination, with the caller's keys a slot can take and their shares in the
realm, each with the batch's destinations its grants already cover. A batch
never spans card definitions or realms: approving one card's batch says
nothing about another card calling the same host, which gets its own batch
and reuses the grant.

The answer carries each binding with `meta.request` (the snapshot below) and
`meta.grant` (with `created`). `GET /_key-bindings` lists the caller's own;
`DELETE /_key-bindings/:id` revokes one (secure session again) and leaves its
grant.

## The fingerprint

`fingerprintOf(bindingSnapshot(request, slot))`: SHA-256, as hex, over a
fixed-order JSON array of what reaches the vendor —

| Field                                     | From the lowered `OperationCallApi`                                    |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| `destination`                             | `destination`                                                          |
| `method`                                  | `method`                                                               |
| `pathTemplate`                            | `url` with its `{name}` segments, `path` (what fills each) and `query` |
| `headersTemplate`                         | `headers`                                                              |
| `placement`, `placementName`, `transform` | the slot's: `header` + `authorization`, `body` + `auth.token`, `basic` |
| `bodyTemplate`                            | the JSON body, or the GraphQL document and variables                   |

Templates keep their typed references as lowering's markers and are encoded
with members sorted, so how a declaration is written doesn't change the hash.
**Not** covered: the `label`, the `output` mapping, `params`, `input`. Headers
are covered as well as the body, because a header such as
`X-HTTP-Method-Override` changes what a request does.

Every call recomputes it from what the definition cache holds now and compares
it with the binding's. A mismatch moves the binding to `needs-reapproval` and
records **one** `key_binding_notices` row for its owner (only on the move, so
repeated calls don't notify again), and the call is refused. The binding stays
refused even if the declaration is edited back: only approving again (which
appends `re-approved`, moves the fingerprint and returns it to `active`)
serves it. The check runs when a binding is read — at a call, or at a
pipeline's admission — so an edit nobody calls through yet is not yet flagged.

## Filling a slot at call time

`callApiOperation` asks `sender.fill(lookup)` for every slot before it builds
the request. `fillSlots` checks, per slot, in this order:

| Check                                                                                | Refusal                        | Status |
| ------------------------------------------------------------------------------------ | ------------------------------ | ------ |
| A binding with this identity (and caller, for `userKey`)                             | `binding-not-approved`         | 409    |
| Its share, if any, is `active`                                                       | `share-suspended`              | 409    |
| `state` isn't `needs-reapproval` and the fingerprint matches                         | `binding-needs-reapproval`     | 409    |
| Interactive invocation needs `interactive`                                           | `interactive-use-not-approved` | 403    |
| A grant is set, opens, and belongs to the binding's key (or the share's current key) | `binding-not-approved`         | 409    |
| The grant isn't `rejected`, unless this call claims its probe                        | `credential-rejected`          | 424    |

The value is the grant's copy (`openGrantForSending`), never the key's master
copy — or, for a key that mints its access tokens (an OAuth connection, a
`client_credentials` client, a Google service account), the access token
minted now, once the grant's marker has opened; a key that can't mint one is
refused `credential-rejected` (424) with `meta.reason` (see the
`oauth-connections` skill, and the `user-keys` skill's Google service
accounts) — with `|basic` applied (the raw value is registered with the scrubber
too). Back in the executor, after building, the request — every slot still a
token — must be under the **grant's stored destination**
(`destinationCovers`), not the declaration's, or it is refused
`guard-refused` with `meta.reason: 'destination'`. Only then is it sent.

## Pipelines and interactive invocation

Every request that reaches `_operations` off the network is **interactive**:
it carries a user session (a browser card, the AI assistant, the CLI). A
**pipeline** invocation exists only in-process: the realm server hands an
`_operations` request carrying the payer's session to `realm.handlePipeline`,
which records that request object and runs it through the ordinary
authorization; the `callApi` arm then runs with `callApiMode: 'pipeline'`.
Since every binding is pipelines-only, a binding can only be used that way.

Before a run starts, `pipelineAdmission(dbAdapter, {core, realmURL, codeRef,
operation, instance?, payer})` answers the refusal the call would get (or
nothing), without opening any key, so a missing or changed approval stops the
run up front.

## Readiness

`@context.keyReadiness(operation, target)` asks, through a `_capabilities`
pair carrying `readiness: true`, what filling the slots would answer for this
caller invoking from a card. `lib/key-readiness.ts` (`keyReadiness`, the
sender's `readiness`) reads the same rows as `checkedBindings`, in the same
order, and maps each way a slot falls short to an answer: no binding →
`needs-connect`, or `needs-approval` where one of the caller's grants already
covers the destination; a changed fingerprint → `needs-reapproval`; not
`interactive` → `needs-approval`; a share slot short in any way → `needs-admin`
to anyone but the share key's owner; a grant the vendor rejected, with no
probe due → `credential-rejected` (to everyone, since the call says the
same); nobody signed in → `needs-sign-in`. It
opens no key and writes nothing: a changed fingerprint is reported, not moved
to `needs-reapproval`, and no notice is recorded. **A check added to
`checkedBindings` or `fillSlots` belongs in `key-readiness.ts` too**, or
readiness will say `ready` for a call that is refused.

## What else changes bindings

- **Removing a grant** (`DELETE /_user-key-grants/:id`) revokes every binding
  that uses it, in every realm, each with a `revoked` row; the answer's
  `meta.revokedBindings` lists them.
- **Deleting a key** revokes its `userKey` bindings (`via` null, since the
  realm server did it). A share's bindings stay: the share is suspended
  `key-deleted`, its grants go with the key (`grant_id` becomes null), and a
  swap restores them.
- **A share suspended** for any reason suspends its bindings, and resuming it
  returns them to `active`: `key_bindings_follow_share`, a trigger on
  `key_shares.state`. A `needs-reapproval` binding stays so either way.
- **Swapping a key into a share** (`POST /_key-shares/:id/swap`) moves each
  of its bindings to a grant of the new key for the destination it was last
  approved for, with the swapper as `approved_by` and a `re-approved` row. The
  fingerprint is unchanged. A swap into a share with bindings needs a
  secure-origin session (it creates grants); one with none needs only its
  ticket. `meta.reapprovedBindings` lists the moved bindings.
- **Unsharing**, or deleting the realm, deletes the bindings with no
  `revoked` row; a deleted realm's `userKey` bindings are deleted too, so a
  realm later made at the same URL starts with none approved.

## Diagnosing a refusal

All four codes arrive in the operations refusal format with `meta.slot` (or
`meta.slots` for `binding-not-approved`). The detail names the slot and
whose key fills it, since the AI assistant sees only the message.

```sql
-- The binding a call looked for (userKey: add AND approved_by = '<caller>').
SELECT id, slot, key_id, share_id, grant_id, approved_by, state, fingerprint, updated_at
FROM key_bindings
WHERE realm_url = '<realm>/' AND definition_url = '<module>' AND export_name = '<Class>'
  AND operation_name = '<op>';

-- Its history: what was approved, by whom, how, and when.
SELECT at, action, actor, via, batch_id, destination, method, placement, placement_name, fingerprint
FROM key_binding_approvals WHERE binding_id = '<id>' ORDER BY at;

-- Whether its owner was told it needs re-approval.
SELECT created_at, owner FROM key_binding_notices WHERE binding_id = '<id>';
```

- **`binding-not-approved`** with no row: never approved here, approved for
  another type (a subclass), another instance, or (for `userKey`) by another
  user; or revoked — look for a `revoked` row by operation name in
  `key_binding_approvals`. With a row: its grant doesn't open, or belongs to
  another key than the binding's (see the `user-keys` skill on hand-written
  grant rows); the realm server logs which on `realm:key-bindings`. A fault
  opening the grant other than those (the database, the keyring) is an error,
  not this refusal.
- **`binding-needs-reapproval`**: diff the last approval row's snapshot
  against the declaration now; the owner approves again.
- **`share-suspended`**: the share's `suspension_reason` (see the
  `key-shares` skill). For `key-deleted`, the binding's `grant_id` is null
  too, since its grants went with the key: a direct writer swaps a key in,
  which grants it the binding's destination again.
- **`interactive-use-not-approved`**: expected for every call off the network.

The binding tables hold no secret, but like the keys tables they are withheld
from `readonly_role` and excluded from the SQLite schema dump; query them as
the application role.

## Tests

- `packages/realm-server/tests/key-bindings-test.ts` — end to end against the
  stub vendor: approve then call as a pipeline, grant reuse and a second
  grant at another host, realm and caller scoping, interactive refusal, the
  app session refused, re-approval on edits (and not on label or `output`
  edits), approving refused when the request shown has changed, share
  approval only by its key's owner and only while active, grant removal, key
  deletion, share suspension and swap, per-instance bindings, keyless
  operations untouched, and the fingerprint pinned to a fixed value. It indexes a card using `perInstance`, so it needs a
  host dist built from your tree (see the `call-api` skill).
- `packages/realm-server/tests/key-binding-batch-test.ts` — the batch: six
  operations approved as one with one grant, an unticked one left
  unapproved, an edited one alone in the review batch with its approved
  snapshot, a second card reusing the grant in a batch of its own, removing
  the grant returning them, share slots only in their key owner's batch, and
  the listings the key page's Use with a card reads.
- `packages/realm-server/tests/card-operations-dispatch-test.ts` — the
  executor's use of `fill` and the grant-destination check, with a fake
  sender.
- `packages/host/tests/unit/operation-lowering-test.ts` — lowering
  `perInstance`.

## Related skills

- **`call-api`** — the declaration, lowering and the rest of dispatch.
- **`user-keys`** — keys and grants.
- **`key-shares`** — shares, their states and the swap.
- **`secure-session`** — the secure-origin session approving needs.
