---
status: accepted
date: 2026-11-10
scope:
  - packages/base/realm-config.gts
  - packages/runtime-common/realm.ts
  - packages/runtime-common/search-entry.ts
  - packages/runtime-common/card-operations/gate.ts
  - packages/runtime-common/card-operations/policy*.ts
  - packages/runtime-common/card-operations/grant-expressions.ts
  - packages/runtime-common/card-operations/find-targets.ts
  - packages/runtime-common/serializers/policy-predicate.ts
  - packages/realm-server/lib/realm-policy-pointer.ts
  - packages/realm-server/handlers/handle-search.ts
  - packages/bxl/src/bxl/profiles/function-safety.ts
---

# 024. Build realm access on one policy that only widens, and give direct write only to administrators

A realm's permissions and its one `RealmPolicy` card together decide who may
do what in it, and the policy only widens what the permissions allow
(ADR 006 §1.3). This ADR records how to design roles on that model (§1.1 to
§1.3) and the rules the policy engine keeps so that a grant admits only what
its author wrote (§1.4 to §1.7). The `realm-policy-authoring` skill in
boxel-skills covers writing a policy.

## 1. Decision

### 1.1. Narrow access by lowering permissions

A design that needs some callers to reach less than the realm's permissions
give them MUST lower those permissions and grant the callers' access back
through the policy, since a policy cannot refuse (ADR 006 §1.3). A realm MAY
give direct permission to no one but its administrators, including no direct
`read`, so that the policy grants every other caller's access.

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

### 1.4. The predicate decides whether, and the operation decides what

A predicate MUST read only the caller (`actor()`), the target card's values,
the governed realm's settings (`realmConfig()`), and the policy card's own
fields (`policy()`). The target's values are its stored source, or, for a
predicate marked `snapshot: true`, its stored source with its index row laid
under it. A predicate MUST NOT read an operation's params. A predicate MUST
NOT call a volatile function, such as the current time or a random value. A
predicate MUST NOT call a builtin that can hold for a value it matches only in
part, such as `contains`, a pattern match, or a lookup that settles for the
nearest value. An anchored test such as `startswith` MAY be used against fixed
text.

A write to a stored card MUST be judged on the card as it stands before the
write. A create MUST be judged on the card it would mint, of the type the
realm resolves, never the type the caller names. A grant MUST admit only the
operation name it names, so a grant on a named operation MUST NOT admit that
operation's base.

A grant that must admit only some writes SHOULD name a narrower operation that
the card type declares, such as one per kind of entry, instead of a general
operation that writes whatever its caller sends.

### 1.5. No grant admits an operation on authorization infrastructure

A grant MUST NOT admit an operation invoked on the realm's config card, on the
card its `policy` names, or on any `RealmPolicy` card or card of a subtype. A
grant MUST NOT admit an operation declared `nonGrantable` on the target's type
or on any type it descends from, or an `explain` or a `validate`. A search
that a policy scopes MUST leave out the rows of the config card and of every
policy card. These rules govern what a grant admits, not what a granted
answer carries: a card in a granted card's link closure is served with it. So
a type a grant admits SHOULD NOT link to an authorization card. The realm
records `grant-reaches-ungranted-type` when a `read` or `query` grant's links
reach a type no grant admits. A card type SHOULD
declare `nonGrantable` any operation that can write a field a grant's
predicate reads.

### 1.6. Fail closed

Deciding whether a grant admits a caller MUST fail closed. A policy the realm
names but cannot load, a predicate that throws or answers anything but
`true`, a target whose type the index cannot vouch for, a blocklist that
fails to evaluate, and an acting-user expression that names no user MUST each
refuse. A rate-limit expression that produces no limit MUST fall back to the
platform's limit, never to no limit. A `policy` value that is not a well-formed
card id names no policy, so the realm serves on its permissions alone, which
never widens access.

A grant the compiler can't apply MUST be left out with a recorded issue, and
the rest of the policy MUST still apply. A policy card that can't be read as a
card at all takes the whole policy out of force, and so refuses as above.

### 1.7. Scope search with filters compiled from the policy

A `query` grant's predicate MUST be compiled to a search filter when the
policy compiles. A search MUST NOT judge its rows one at a time against a
predicate. A `query` grant whose predicate does not compile to a filter MUST
add nothing to a search. A compiled filter MUST NOT admit a row its predicate
would refuse, except through a value that only a writer of the card can store.
A search answers from the index, so it MAY keep listing a card until the card
is reindexed, after a direct read already refuses it. A `read` grant MUST NOT
put a card in search results, a `query` grant MUST NOT admit a direct read,
and a grant on a named query MUST NOT admit an ad-hoc search.

## 2. Rationale

ADR 006 §2 gives the reasons a policy only widens. When a design wants a role
to reach less, the fault is that the role started with too much. A realm that
no one but its administrators can read directly is a valid starting point, and
its policy then states every other role's access.

One policy keeps the answer to "who can do this here?" in one place, and the
grants union, so a role is just a group of rules. Several policies would
need a rule for how they combine. If they only union, they add nothing that
rules in one policy can't express. If they intersect or override, they
restrict.

Any direct writer can repoint `realm.json` at another policy or edit the
policy card, and so can grant themselves or anyone else any grantable access.
No grant reaches either card (§1.5), so direct writers are the only users who
can change them. A separate "administer" permission would not stop that unless
direct write lost the power to change `realm.json`, which would create a
second write level. The simpler and truthful model is that direct writers are
the realm's administrators, and everyone else writes through grants.

§1.4 to §1.7 keep a grant to what its author wrote. The predicate's inputs
stay outside the caller's reach, so a grant can't be talked into admitting
anyone, and a named operation grants exactly what its declaring type's author
wrote. A grant that could reach an authorization card could become every
grant. A fault in a policy that only widens must never widen. And search
pages in SQL, so it can only be scoped by a filter. The reasoning for each is
in the headers of `gate.ts`, `policy.ts`, `policy-filter.ts` and
`policy-query.ts`, which Sources cites.

## 3. Considered options

- **One widening policy, administrators as the only direct writers
  (chosen).**
- **Several policies per realm, one per role.** They either add nothing or
  restrict.
- **A separate permission to administer the realm, or to write its
  settings.** It splits direct write into two levels while the policy card
  stays an ordinary card that writers can change.
- **Predicates over params.** The caller would choose the value that
  authorizes the call.
- **Grants on authorization cards, guarded by careful authoring.** One
  mistaken grant would hand over every grant, and nothing would report it.
- **Serving a realm whose policy won't load on its permissions alone.** The
  callers the policy was meant to admit would be refused with no sign that
  anything was wrong, and its author would see no fault to fix.
- **Judging search rows one at a time.** Paging could not survive it.

## 4. Sources

1. Hassan Abdel-Rahman, 2026-11-10: grants only widen, and a design that
   struggles with that needs fewer direct permissions, down to a realm no one
   can read; a realm has one policy whose rules are OR'ed; direct writers are
   administrators, and non-administrators write through grants; no new
   permission for administering a realm.
2. The header of `packages/runtime-common/card-operations/gate.ts`: the policy
   runs only for a caller the permissions declined, authorization
   infrastructure is outside the grant model but a link closure is not
   narrowed, a create is judged by the realm's resolved type, and every way
   the gate can fail denies.
3. `packages/base/realm-config.gts` and `packages/runtime-common/realm.ts`
   (`assignRealmPolicy`, `getRealmPolicy`): `policy` is one string field, and
   a malformed value is dropped.
4. `packages/runtime-common/card-operations/policy.ts`: `PREDICATE_CALLS`
   leaves out `params()`, and `PARTIAL_MATCH_BUILTINS` and
   `ANCHORED_BUILTINS` refuse partial matches.
   `packages/bxl/src/bxl/profiles/function-safety.ts` refuses volatile calls
   in a predicate.
5. `packages/runtime-common/card-operations/grant-expressions.ts`:
   `blocklistCloses` refuses on a failed blocklist, and `settleTraffic` falls
   back to the platform's limit. `policy-reach.ts` records
   `grant-reaches-ungranted-type`.
6. The headers of `packages/runtime-common/card-operations/policy-filter.ts`
   and `packages/runtime-common/card-operations/policy-query.ts`: a `query`
   grant compiles to a filter, a filter is never wider than its predicate
   except through a value only a writer can store, and only a grant on the
   invoked name contributes.
