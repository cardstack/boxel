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
  - packages/realm-server/handlers/handle-archived-realms.ts
  - packages/realm-server/handlers/handle-publish-progress.ts
  - packages/realm-server/middleware/multi-realm-authorization.ts
  - packages/runtime-common/db-queries/realm-metadata-queries.ts
  - packages/host/app/services/realm.ts
  - packages/host/app/lib/workspace*.ts
---

# 006. Grant realm permissions per realm, and widen them only with a realm policy

A user's permission applies to a whole realm, never to a folder, file, or card
inside it. There are two levels, `read` and `write`, and the users whose own
row grants `write` administer the realm. The realm owner is the one user the
realm is indexed as, and owning a realm grants nothing. Access finer than a
whole realm is a grant in the realm's policy card, and a policy only widens
what the permissions allow. To keep content from some of a realm's
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

### 1.2. Two levels, and an owner who holds no authority

The levels MUST be exactly `read` and `write`. `read` admits reading the
realm. `write` admits changing its contents.

A user whose own permission row grants `write` administers the realm
(ADR 024 §1.3). Administering covers granting and revoking other users' `read`
and `write`, archiving, restoring or deleting the realm, and publishing or
unpublishing it. Publishing, unpublishing and
reading a published realm's publish progress MUST be authorized against
administering the realm it was published from. A `*` or `users` row names no one, so the
`write` it grants MUST NOT admit administering.

The permission check MUST test each level on its own and MUST NOT infer one
level from another. A grant of `write` MUST include `read`, and every endpoint
that grants permissions MUST refuse `write` without `read`.

`realm-owner` is not a level. It marks the one user the realm is indexed as.
An authorization decision MUST NOT rest on it: the permission check, the realm
server's endpoints and the host MUST NOT admit or refuse a request because its
caller is, or is not, the realm owner.

`realm-owner` MUST be assigned only when a realm is created or published, and
always with `read`. A migration that seeds a system realm's owner counts as
creating that realm. Every endpoint that grants permissions MUST refuse to
grant `realm-owner`, and MUST keep the owner's `read` and `realm-owner`. It
MAY change the owner's `write` like anyone else's.

`assume-user` is not a grantable level. Only the realm's own Matrix user
holds it, and it MUST NOT be stored or granted.

### 1.3. Finer-grained access is a policy grant

Access finer than a whole realm MUST be a grant in the `RealmPolicy` card that
the realm's `realm.json` names. A policy MUST only widen access. The realm
MUST consult its policy only for a caller its permissions would refuse. A policy
MUST NOT refuse anything the permissions allow. A policy MUST NOT admit
administering (§1.2), and MUST NOT make a user the realm owner.

Every realm route that writes the realm's cards or files for a caller its
permissions refuse MUST judge each write by the policy as the operation it
amounts to, so a grant admits through one route what it admits through any
other. An automation run's commit is the exception: only a direct writer
makes one (ADR 026 §1.5). A grant MUST NOT admit a write that changes the type
of what it writes.

A grant MAY admit a write to module source, which a policy types as
`TsFileDef` or `GtsFileDef`, as it admits a write to any other file. The
realm MUST NOT refuse that write, or anything that loads the module, because
a grant admitted it.

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

The realm owner holds no authority because a realm is shared [9]. A shared
realm's administrators are the users it gives direct write, and ADR 024 §1.3
already makes them the users who can rewrite its policy. Administration tied
to the user who created the realm would leave co-administrators unable to
manage it, and would leave the creator in charge after handing it over. The
owner keeps one job that needs a single user: indexing renders the realm as
them, so a realm's index is the same whoever triggered it.

A grant reaches a write the same way on every route, because a policy author
writes one rule per operation and type, not per route. A grant on a type is
matched against what a write's target is. A write that leaves its target
another type would escape the grants it was matched on, and could turn a card
into a `RealmPolicy` after the gate judged it as its old type [10].

Who may change a realm's code is its administrators' decision [10]. A module
runs in the browser of everyone who loads it, with that person's sessions, and
in an automation run beside the run's token, so whoever a grant lets write a
module can act with the authority of anyone who loads it. An administrator who
grants write to module source widens who can change the realm's code and
accepts that risk. A refusal would second-guess that choice.

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
- **The realm owner as administrator.** A shared realm could be managed only
  by the one user who created it, whatever the other administrators' direct
  write says, and a permission level that separates administering a realm from
  writing it is the kind of level ADR 024 §1.3 rules out [9].
- **Leave verbatim writes and module source to the permissions alone.** A
  grant would admit a write on one route and not another, and a script that
  saves a card through a batch write would fail for a user a grant admits
  [10].
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
9. Hassan Abdel-Rahman, 2026-11-10: `realm-owner` keeps its function, but no
   permission decision rests on it; a realm owner who administers the realm
   "flies in the face of shared realms".
10. Hassan Abdel-Rahman, 2026-11-13: a policy applies across every realm
    API; a write grant on `TsFileDef` or `GtsFileDef` writes a module like
    any other grant writes its target, and the administrator who grants it
    accepts the risk, automation runs included; a write that changes a
    card's type is never matched on the type it replaces.

## 5. Remediation

Known gaps are listed in [remediation/006.md](remediation/006.md).
