---
status: proposed
date: 2023-04-18
retroactive: true
recorded: 2026-10-19
scope:
  - packages/postgres/migrations/*permission*
  - packages/runtime-common/realm.ts
  - packages/runtime-common/realm-permission-checker.ts
  - packages/runtime-common/db-queries/realm-permission-queries.ts
  - packages/runtime-common/card-operations/gate.ts
  - packages/runtime-common/card-operations/policy*.ts
  - packages/realm-server/handlers/create-realm.ts
  - packages/realm-server/handlers/handle-realm-auth.ts
  - packages/realm-server/handlers/handle-create-session.ts
  - packages/realm-server/handlers/handle-delegate-session.ts
  - packages/realm-server/handlers/handle-upsert-realm-user-permission.ts
  - packages/realm-server/handlers/handle-delete-realm.ts
  - packages/realm-server/handlers/handle-publish-realm.ts
  - packages/realm-server/handlers/handle-unpublish-realm.ts
  - packages/realm-server/handlers/handle-unlisted-realm-path.ts
  - packages/realm-server/handlers/archive-realm-utils.ts
  - packages/realm-server/middleware/multi-realm-authorization.ts
---

# 006. Grant realm permissions per realm, and widen them only with a realm policy

A user's permission applies to a whole realm, never to a folder, file, or card
inside it. There are three levels: `read`, `write`, and `realm-owner`. Access
finer than a whole realm is a grant in the realm's policy card, and a policy
only widens what the permissions allow. To keep content from some of a realm's
members, put it in another realm. The `realm-auth` skill covers tokens and
checks, and the `realm-policy-authoring` skill in boxel-skills covers writing
a policy.

## 1. Decision

### 1.1. Permissions apply to the whole realm

A realm permission MUST be granted for a whole realm. The permission store
MUST NOT key a permission on a path, folder, file, or card inside a realm. The
permission a request needs MUST depend only on what the request does (its
method, or the realm-level endpoint it calls), never on which file or folder
it names.

A permission's subject MUST be one user, `users` (any signed-in user), or `*`
(everyone). Roles and groups MUST NOT be added as subjects.

### 1.2. Three levels

The levels MUST be exactly `read`, `write`, and `realm-owner`. `read` admits
reading the realm. `write` admits changing its contents. `realm-owner` admits
administering the realm, such as granting and revoking other users' `read` and
`write`, archiving or deleting it, and publishing or unpublishing it.

The permission check MUST test each level on its own and MUST NOT infer one
level from another. A grant of `write` MUST include `read`, and every endpoint
that grants permissions MUST refuse `write` without `read`.

`realm-owner` MUST be assigned only when a realm is created or published, and
always with `read`. A migration that seeds a system realm's owner counts as
creating that realm. Every endpoint that grants permissions MUST refuse to
grant `realm-owner` and MUST refuse to change an owner's permissions.

`assume-user` is not a grantable level. Only the realm's own Matrix user
holds it, and it MUST NOT be stored or granted.

### 1.3. Finer-grained access is a policy grant

Access finer than a whole realm MUST be a grant in the `RealmPolicy` card that
the realm's `realm.json` names. A policy MUST only widen access. The realm
MUST consult its policy only for a caller its permissions would refuse. A policy
MUST NOT refuse anything the permissions allow. A policy MUST NOT grant
`realm-owner` authority.

### 1.4. Restriction is a separate realm

Content that some of a realm's readers or writers must not reach SHOULD go in
a separate realm with its own permissions.

## 2. Rationale

Permissions were scoped to the realm from the first plan for them [1], and
each later step kept that scope [2][3][4][5]. Four reasons hold the line
against finer permissions [8].

First, the index is per realm. A realm's cards are indexed and prerendered
once, on the realm's own authority, and every reader gets the same search
rows and the same HTML. A permission on part of a realm would make search and
prerendering differ for each viewer.

Second, the realm is the unit of authorization everywhere else. A session
token carries one permission set for each realm, and the check is one indexed
lookup of the realm's permission rows and an exact match of the token's claim
against them. Publishing and federation also work one realm at a time.

Third, the model stays simple. Who holds realm-wide access is one list, and a
user who needs to keep something from some members makes another realm. A
policy gives up part of this: who can reach a given card is that list plus the
policy's grants. But the grants only add to the list, so the list still says
the least each user can reach.

Fourth, the access people actually need to express below the realm is
conditional, such as "a teacher may read the classrooms they teach." A policy
rule over the data says that, and a change to the roster is a change to the
data. Per-user permission rows would need an update each time the roster
changed. The policy layer was added for this purpose [6][7].

A policy only widens for two reasons [8]. A caller the permissions allow never
loads the policy or evaluates a predicate, so a writer editing their own realm
pays nothing for it [7]. And the permissions stay truthful: if they say a user
may read a realm, nothing elsewhere takes that away.

## 3. Considered options

- **Realm-wide permissions, widened by policy grants (chosen).**
- **Per-folder permissions.** Search and prerendered HTML would differ for
  each viewer, a token's claim and the permission lookup would no longer be
  one per realm, and who holds realm-wide access would no longer be one list
  [8].
- **Per-file or per-card permissions.** These fail for the same reasons as
  per-folder permissions [8]. A policy can already grant access to a single
  card by a predicate on its id.
- **Policies that restrict.** Every allowed caller would pay for a policy
  load, and the realm permissions would no longer say what a user can reach
  [8].
- **Roles or groups as subjects.** Membership already lives in the data. A
  policy predicate over a card's fields, such as
  `.teacherIds | any(. == actor())`, expresses it with nothing separate to
  keep in sync [8].

## 4. Sources

1. #298 (`ba5a022666`), `docs/realm.md` "Future capabilities": permissions
   "will not be card specific but they will apply to all cards in the realm."
2. #975 (`d75de62450`): a `PUT`, `PATCH`, `POST`, or `DELETE` is a write
   request, and any other request is a read.
3. #1053 (`633a20cfd4`): the `users` subject.
4. #1306 (`05befcac24`):
   `packages/realm-server/migrations/1716284017819_add-realm-user-permissions.js`
   (now under `packages/postgres/migrations/`) keys `realm_user_permissions`
   on realm and username, with no path column.
5. #1553 (`b2fe4df54b`) adds `realm-owner`, and #1748 (`d0bc07f3a8`) adds the
   owner-only `_permissions` endpoint.
6. #6276 (`72f824fa1b`): the policy definitions add access "the coarse
   read/write/owner ACL" cannot express.
7. #6300 (`e212a68c4d`) and the header of
   `packages/runtime-common/card-operations/gate.ts`: the gate runs only for
   a caller the ACL declined, so a policy never narrows access and an allowed
   caller pays nothing for it.
8. Luke Melia, 2026-10-19: the reasons in §2 and the rejected options in §3.

## 5. Remediation

No known gaps.
