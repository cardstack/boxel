---
status: accepted
date: 2026-11-10
scope:
  - packages/base/realm-config.gts
  - packages/runtime-common/card-operations/gate.ts
  - packages/runtime-common/card-operations/policy*.ts
  - packages/runtime-common/card-operations/grant-expressions.ts
  - packages/runtime-common/serializers/policy-predicate.ts
  - packages/realm-server/lib/realm-policy-pointer.ts
---

# 024. Build realm access on one policy that only widens, and give direct write only to administrators

A realm's permissions and its one `RealmPolicy` card together decide who may
do what in it. The policy only widens what the permissions allow
(ADR 006 §1.3). This ADR records what follows from that for anyone designing
roles on a realm. To give a role less access, give it fewer direct
permissions and grant back what it needs. Put every role in the realm's one
policy. Give direct write only to the realm's administrators, because direct
write controls the policy. Narrow a grant by the operation it names, never by
the operation's params. The `realm-policy-authoring` skill in boxel-skills
covers writing a policy.

## 1. Decision

### 1.1. Narrow access by lowering permissions

A design that needs some callers to reach less than the realm's permissions
give them MUST lower those permissions and grant the callers' access back
through the policy. The platform MUST NOT add a way for a policy, a rule, or
a grant to refuse what the permissions allow. A realm MAY give direct
permission to no one but its administrators, including no direct `read`, so
that the policy grants every other caller's access.

### 1.2. One policy per realm

A realm MUST name at most one policy, in the `policy` field of its
`realm.json`. The platform MUST NOT add a second pointer, a list of policies,
or a way for one policy to include, import, or inherit another. Each role MUST
be a set of rules and grants in that one policy. The grants of every rule that
matches a request are OR'ed together, so a caller in two roles gets the union
of both.

### 1.3. Direct write is administration

A user with direct `write` on a realm can change its `realm.json`, which
names the policy, and the policy card, which grants everyone else's access.
So a realm MUST give direct `write` only to users it treats as its
administrators. A user who contributes to a realm but does not administer it
MUST get write access through policy grants. The platform MUST NOT add a
permission level or a grant that separates writing the realm's settings or
its policy from writing the rest of its contents.

### 1.4. Narrow a grant by its operation, not its params

A policy predicate MUST NOT read an operation's params. A grant that must
admit only some writes SHOULD name a narrower operation that the card type
declares, such as one per kind of entry, instead of a general operation that
writes whatever its caller sends.

## 2. Rationale

The permissions list says the least each user can reach, and the policy
adds to it (ADR 006 §2). A policy that could also refuse would make that list
wrong, and every caller the permissions allow would pay for a policy load. So
when a design wants a role to reach less, the fault is that the role started
with too much. A realm that no one but its administrators can read directly is
a valid starting point. Its policy then states every other role's access
explicitly.

One policy keeps the answer to "who can do this here?" in one place, and the
grants union, so a role is just a group of rules. Several policies would
need a rule for how they combine. If they only union, they add nothing that
rules in one policy can't express. If they intersect or override, they
restrict, which §1.1 rules out.

Direct write already reaches the policy. Any direct writer can repoint
`realm.json` at another policy or edit the policy card, and so can grant
themselves or anyone else any grantable access. No grant reaches either card
(`gate.ts`), so direct writers are the only users who can change them. A
separate "administer"
permission would not stop that unless direct write lost the power to change
`realm.json`, which would create a second write level. The simpler and
truthful model is that direct writers are the realm's administrators, and
everyone else writes through grants.

A predicate decides on the caller, the target card, the governed realm's
settings, and the policy card's own fields. It does not read params, because
a caller-supplied value must not decide its own authorization
(`packages/runtime-common/card-operations/policy.ts`, `PREDICATE_CALLS`). A
named operation is declared by the card type's author, so granting it grants
exactly what that author wrote.

## 3. Considered options

- **One widening policy, administrators as the only direct writers
  (chosen).**
- **Deny rules or restricting policies.** A restriction breaks ADR 006 §1.3:
  the permissions would no longer say what a user can reach, and every
  allowed caller would pay for a policy evaluation.
- **Several policies per realm, one per role.** If they union, rules in one
  policy already do the same. If they combine any other way, they restrict.
- **A separate permission to administer the realm, or to write its
  settings.** It splits direct write into two levels while the policy card
  stays an ordinary card that writers can change. It adds a concept without
  removing the need to trust direct writers.
- **Predicates over params.** The caller would choose the value that
  authorizes the call.

## 4. Sources

1. Hassan Abdel-Rahman, 2026-11-10: grants only widen, and a design that
   struggles with that needs fewer direct permissions, down to a realm no one
   can read; a realm has one policy whose rules are OR'ed; direct writers are
   administrators, and non-administrators write through grants; no new
   permission for administering a realm.
2. ADR 006 §1.3 and `packages/runtime-common/card-operations/gate.ts`: the
   policy runs only for a caller the permissions declined.
3. `packages/base/realm-config.gts`: `policy` is one string field.
4. `packages/runtime-common/card-operations/policy.ts`, `PREDICATE_CALLS`:
   a predicate reads `actor()`, `instance()`, `realmConfig()`, and `policy()`,
   and not `params()`.
