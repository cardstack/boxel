---
status: proposed
date: 2026-11-17
scope:
  - packages/runtime-common/card-operations/gate.ts
  - packages/runtime-common/card-operations/policy*.ts
  - packages/runtime-common/card-operations/capabilities.ts
  - packages/runtime-common/card-operations/coordinator.ts
  - packages/runtime-common/card-operations/dispatch.ts
  - packages/runtime-common/card-operations/executors.ts
  - packages/runtime-common/realm.ts
  - packages/runtime-common/realm-history.ts
  - packages/base/operations.ts
  - packages/base/realm-path.gts
---

# 038. Narrow policy grants by path, and keep every grant typed

A `PolicyRule` and an `OperationGrant` can each carry a path specifier
(ADR 037), so a realm can grant updates to `BlogPost` cards under `blog/` and
nowhere else. A path narrows a grant that a type already scopes, and never
replaces the type. This ADR records how the gate matches a target's path, where
a create's card lands, how an operation on a path such as reading history is
granted, and what a path doesn't do: it isn't a boundary for linked cards. It
extends ADR 024 §1.4, §1.5 and §1.7, and supersedes none of it.

## 1. Decision

### 1.1. A path narrows a type

A policy rule and a grant MAY each carry a path specifier, in a field on the
`PolicyRule` and `OperationGrant` definitions. Those live in boxel-catalog
(`realm-policy/realm-policy.gts`), which no `scope` glob here reaches. Every
policy rule MUST still name a `targetType`, and a path MUST NOT stand in for it. A grant
MUST admit a target only when the target's type is its rule's `targetType` or
descends from it, the target's path matches both its rule's specifier and its
own, and the grant names the operation and its `where` holds (ADR 024 §1.4).
Whatever a specifier names, `/` included, a grant MUST NOT reach the realm's
config card or a policy card (ADR 024 §1.5), or a path the realm ignores.

### 1.2. Invalid and non-overlapping paths

A grant or policy rule whose specifier is invalid (ADR 037 §1.5) MUST be left
out whole, with a recorded issue (ADR 024 §1.6). The compile MUST record an
issue for a grant whose specifier can't overlap its rule's, and MUST keep the
grant. Two specifiers overlap when some path matches both (ADR 037 §1.4), or
when either is absent or empty.

### 1.3. Match the path first

For a stored target, the gate MUST match the target's path against the grants
that name the invoked operation before it reads the target's index row or
stored bytes, or evaluates any predicate. A target whose path none of those
grants covers MUST be refused without either read. A card MUST be matched by
the path of its stored file, and a file by its own path.

### 1.4. Creates

A create MUST be judged at the path its card will be stored at: the creation
path when the create names one, and the default path
(`<directory>/<type directory>/<id>.json`) otherwise. The type directory is the
one the realm names after the type it resolves (ADR 024 §1.4), and can span
more than one segment. A grant MUST NOT admit creating a file.

A declared create MAY name a directory for its cards, as a realm setting and a
default for when the realm doesn't set it. The realm MUST use that directory
whenever the caller names neither a directory nor a creation path. A setting
that isn't a valid directory (a prefix that ends in `/` and that ADR 037 §1.5
accepts), or that names a path the realm ignores, MUST refuse the create, with
an error that names the setting, and MUST NOT fall back to the default. Unless
the declaration allows creation paths, the compile MUST record an issue for a
grant on such a create whose paths, with its rule's, don't cover the directory
as the realm resolves it. The grant MUST be kept. A change to the realm's
settings MUST make the compile run again, so the issue follows the setting.

For a caller the realm's permissions don't let read the realm, the realm MUST
pick the new card's id, and MUST store the card at the root or in its declared
create's directory. A caller who reads the realm only through grants is such a
caller. Such a caller MUST NOT choose the directory, and MUST NOT name a
creation path unless the declared create it invokes allows creation paths.

### 1.5. Search

A `query` grant's specifier and its rule's MUST narrow the search filter the
policy compiles for the grant (ADR 024 §1.7), combined with AND. The path
condition MUST travel in the policy's search scope with the grant's other
filters, so explain shows it, and MUST be lowered as ADR 037 §1.1 requires.

### 1.6. Operations on a path

An operation whose target is a path, such as reading history, MUST be matched
under `RealmPath` (`packages/base/realm-path.gts`), which a policy rule names as
its `targetType` and a specifier narrows. A rule on any other type MUST NOT grant such an operation.
A `RealmPath` grant's `where` MUST read only `actor()`, `realmConfig()` and
`policy()`. A `RealmPath` grant whose `where` reads the target MUST be left
out, with a recorded issue. Besides its own grant, a restore MUST judge each
file it writes as that write would be judged on its own: an update or a delete
of what is stored, or, where nothing is stored, a create of the card it brings
back, at that card's path (§1.4). So no grant restores a deleted file that
isn't a card, and a caller the realm's permissions don't let read the realm
can't bring back a deleted card.

### 1.7. The reach check and granted paths

The reach check (ADR 024 §1.5) MUST count a type as covered only by a grant
that neither its own specifier nor its rule's limits. `_capabilities` MAY list
the paths a caller is granted for an operation on a type. It MUST list them
only to a caller the realm's permissions let read the realm, and MUST leave
out grants whose `where` reads the target.

## 2. Rationale

A type says what a target's operations are and what they do (ADR 024 §1.4). A
path says only where the target is. So a path narrows a type and never replaces
it, and an absent specifier narrows nothing, so existing policies keep their
meaning. A target must match its rule's paths and its grant's, the way
`targetType` and `where` already combine, so a grant stays within its rule.

A path doesn't change while a write waits for its lock, so the gate can match
it before reading anything stored. A request outside every grant's paths then
costs no read, and its timing says less about whether a card is there.

The realm already picks the id of a card created by a caller who can't read
the realm, and stores it at the root, so the caller learns nothing about what
is stored. A declared directory moves where those cards land without giving
the caller a choice, since only the realm's administrators change its settings
(ADR 024 §1.3). A creation path would tell such a caller whether a path is
taken, so only a declaration that accepts that may allow one. A creation path
isn't one of the "predicates over params" that ADR 024 §3 rejects: it says
where the write lands, not who may make it. A specifier is literal
(ADR 037 §1.3), so it can't follow the setting, and the compile reports the
drift instead, each time the setting changes. A create grant whose paths miss
where such a caller's card lands, such as one on `blog/` for a create that
declares no directory, admits only callers who can read the realm. The compile
reports that only against a declared directory, because a grant for editors who
read the realm is often written that way on purpose.

An operation on a path has no stored target to type or to read, so `RealmPath`
gives its grants a type, and their `where` reads no target. A restore writes
files, so each one is judged as the same write made any other way. Bringing
back a deleted card names the path it lands at, which would tell a caller who
can't read the realm whether that path is taken, so §1.4 refuses it.

A path limits which targets a grant admits, not the linked cards a granted
answer carries (ADR 024 §1.5). So a path-scoped grant can hand over cards
outside its paths, and the reach check must not treat it as covering a type.
Content that some readers must not reach still belongs in a separate realm
(ADR 006 §1.4).

A caller who can read the realm through its permissions can already list every
directory, so their granted paths show them nothing new. A `where` that reads
the target can't be answered for a path, so its grant isn't listed, and the
gate's answer for a specific target stays final.

ADR 006 holds: permissions stay whole-realm (§1.1), and a grant's paths apply
on every write route, as the rest of the grant does (§1.3). Only a direct
writer commits an automation run (ADR 026 §1.5), so no grant's path judges it
(ADR 027).

## 3. Considered options

- **Paths that narrow a typed rule and grant (chosen).**
- **A policy rule with paths and no `targetType`.** It would grant an operation
  of that name on every type under its paths, including module source and types
  added later.
- **A grant's paths replacing its rule's.** A grant could reach past what its
  rule says.
- **Letting the matched grant choose a create's directory.** It's ambiguous
  when two grants match.
- **Requiring a creation path, so a card can land anywhere but the root.** It
  tells a caller who can't read the realm which paths are taken.
- **A directory fixed in the type's code.** It puts a type's cards in the same
  directory in every realm that uses the type.
- **One platform setting keyed by type and operation.** Its keys would be code
  refs, which break when a module moves.
- **A BXL expression for the directory.** A setting name and a default are
  enough.
- **A grant path that reads the setting.** Specifiers are literal.
- **An issue for every create grant whose paths miss where a caller who can't
  read the realm would get the card.** It fires on grants meant only for
  callers who read the realm, such as editors of one section.
- **Checking a declared directory's coverage only when a create runs.** The
  administrator who changes the setting wouldn't see the mismatch until a
  caller is refused.
- **Matching history by each changed file's type.** A deleted file has nothing
  stored to type, a card's type can change between revisions, `git log` can't
  filter by type, and a filter applied after the query breaks `limit`.
- **Matching history under the config card or the index card.** No grant may
  reach the config card, and the index card's type differs between realms.
- **Listing granted paths to every caller, or to callers who read only through
  grants.** Either list could name directories, and show part of the policy,
  that the caller can't otherwise see.
- **No list of granted paths.** A caller browsing the realm's root gets no hint
  that they can create in `blog/`.

## 4. Remediation

Known gaps are listed in [remediation/038.md](remediation/038.md).
