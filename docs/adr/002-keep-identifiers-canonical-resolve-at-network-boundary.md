---
status: proposed
date: 2026-04-16
recorded: 2026-10-15
retroactive: true
scope:
  - packages/runtime-common/**
  - packages/host/app/**
  - packages/base/**
  - packages/eslint-plugin-boxel/**
  - packages/realm-server/**
  - packages/ai-bot/**
  - packages/ai-assistant-evals/**
  - packages/bot-runner/**
  - packages/boxel-cli/**
  - packages/software-factory/**
  - packages/software-factory/.agents/**
  - packages/vscode-boxel-tools/**
  - packages/catalog/**
  - packages/*-realm/**
  - packages/pretui/**
  - packages/test-realm-cards/**
  - AGENTS.md
  - .claude/skills/**
---

# 002. Keep identifiers as canonical RRIs, and resolve them to URLs only at the network boundary

Card ids, module references, and links are Realm Resource Identifiers (RRIs):
branded strings in either prefix form (`@cardstack/base/card-api`) or URL form.
Inside the runtime they stay opaque and canonical. Only the VirtualNetwork turns
one into a URL, immediately before a network call. Well-known realms are named
by prefix, so card JSON and source mean the same thing in every environment.
The mechanics are in [Realm Resource Identifiers](../realm-resource-identifiers.md);
this ADR records the rules and why.

## 1. Decision

### 1.1. Identifiers are opaque

Card ids, FileDef ids, module references, code-ref modules, and link targets
MUST be typed as `RealmResourceIdentifier` or `RealmIdentifier`. Code MUST
compare, key, store, and pass them as strings, without parsing them. Code MUST
test which form an identifier has only with the exported `isPrefixForm()` and
`isAbsoluteIdentifier()` helpers.

A resource's realm is `meta.realmIdentifier`, a `RealmIdentifier`.
`meta.realmURL` is deprecated, and new code MUST NOT read it.

These are not identifiers:

- bare package specifiers, such as `@cardstack/boxel-ui/components`;
- fields whose documented value is a served URL, such as `Spec.moduleHref`.
  Such a field MUST say so in its name and type;
- index-row, realm-registry, and permission keys on the server, which are
  served URLs.

### 1.2. Resolution happens at the network boundary

Code MUST NOT pass an RRI to `new URL()`. Only VirtualNetwork methods MAY
convert an identifier from one form to the other. Code SHOULD resolve
immediately before the network call, and SHOULD pass the RRI to
`VirtualNetwork.fetch` directly. Realm membership and path math MUST use
`RealmPaths`. Code MUST join a relative reference with `resolveRRIReference`,
which keeps the form of its base.

Rendering and store code SHOULD NOT take a VirtualNetwork in order to resolve
an identifier. Code that already holds one, such as the realm write path, MUST
call its methods instead of resolving by hand. A store MAY call
`keyForIdentifier` to fold every spelling of a resource onto one internal key.
That key MUST NOT leave the store as an identifier.

A client without a VirtualNetwork MUST build one from the prefix map that the
realm server serves. It MUST NOT derive a URL from a prefix by naming
convention.

### 1.3. Canonical form at the edges

Serialization MUST write RRI form. Deserialization MUST canonicalize incoming
identifiers to RRI form. Identifiers in model prompts and Matrix events follow
the same rules. Realm-server endpoints that take an identifier MUST accept
prefix form.

### 1.4. Well-known realms are named by prefix

A well-known realm is one listed in `PREFIX_REALMS`. Source and card JSON,
including catalog content, MUST reference a well-known realm by its
`@cardstack/<realm>/` prefix, not by an environment-specific URL. Each prefix
MUST be registered on a VirtualNetwork instance with `addRealmMapping`.
`PREFIX_REALMS` MAY list the prefix names. The URL that a prefix stands for
MUST live only on a VirtualNetwork. Lint and migration tools MAY hold
prefix-to-URL tables, and these MUST derive from `PREFIX_REALMS`.

New code MUST NOT use the `https://cardstack.com/base/` alias. While the alias
is the base realm's registered identity, it MAY appear only in:

- `baseRealm`, the base realm's registration, and its permission rows;
- `registeredRealmURL` and tsconfig `paths` entries;
- code that recognizes legacy alias data, such as `equivalentURLForms`;
- tests of alias tolerance, canonicalization, or migration.

`no-url-form-base-imports` MUST allow the alias only in these positions.

## 2. Rationale

The rule against `new URL()` exists because the defect is invisible until it
fails. A branded string is assignable where a `string` is expected, so
`new URL(rri)` type-checks. A URL-form RRI parses. A prefix-form RRI throws
with no base, and with a base it resolves to a URL that points nowhere [1, 2].
The call site usually cannot know which form it holds [1]. The compiler cannot
see the difference, "which is why the same defect keeps recurring" [3], so a
type-aware lint rule enforces it [2, 3].

Prefix form makes card JSON and import specifiers portable. The catalog realm
is served at a different URL in development, staging, and production, but a
prefix-form link resolves in all three. Card JSON written in one environment
can be copied to another [1].

Resolving only at the network boundary has been a goal since the start of the
project [6]. Resolving at an in-memory site means "resolution is happening at
the wrong layer" [1]. Canonicalizing on deserialization keeps the rule true for
data that arrives from the network [1]. Agents found the discipline hard to
keep [6].

A realm is identified like any other resource, so its meta field is an RRI
[7]. A prefix id anchors relative links by path math, and Matrix room state
outlives any one environment's URLs [7]. `resolved*RealmURL` settings let a
realm be served anywhere, so a naming convention can resolve to the wrong place
without an error [7].

Store keys are the one place where the resolved URL is the right form.
`unresolveURL` leaves a URL-mapped alias unchanged, so only the real URL folds
every spelling of a resource onto one key [8].

## 3. Considered options

- **Canonical RRIs, resolved at the network boundary (chosen).**
- **Wrapper objects for identifiers.** A branded string matches the
  serialized form directly and uses less memory [6]. It is a compile-time
  marker with no runtime wrapper [1].
- **Address the base realm by `https://cardstack.com/base/…`, rewritten by the
  VirtualNetwork.** This was the earlier approach. It is "misleading — nothing
  is served there — and it required every consumer to know about the rewrite"
  [1]. The alias remains for realm data that still holds URL-form references
  [1].
- **Environment-specific realm URLs in source and card JSON.** These are not
  portable across environments [1, 4].
- **A global prefix registry.** The runtime replaced it with per-VirtualNetwork
  mappings [5], so that a test can register and drop a throwaway prefix without
  affecting other tests [1, 6]. More generally, the project avoids globals
  unless there is no other choice [6].
- **Allow a parse that a form check guards.** No guarded site needed to parse
  [7].
- **`meta.realmURL` as a served URL that code may parse** [7].
- **Key stores by the canonical identifier.** This adds a step on a hot path
  for a key that never leaves the store [7].
- **Absolute URLs for ids shown to the model**, so that it can follow relative
  links [7, 9].
- **Resolve prefixes by naming convention without a VirtualNetwork**, as
  boxel-cli does [1, 7].

## 4. Consequences

`no-url-from-realm-identifier` sees only branded values, so its coverage
depends on §1.1. A clean run does not show compliance with §1.2. The rule runs
only in `packages/runtime-common` and `packages/host` app code, which build the
TypeScript program it needs [3]. `no-url-form-base-imports` checks only import
specifiers, and `no-literal-realm-urls` checks only realm submissions [4].
Neither sees card JSON. Elsewhere, reviewers enforce §1.2 and §1.4.

## 5. Sources

1. `docs/realm-resource-identifiers.md`, added in #5720 (`be8e366834`), and
   its sections "Why prefix form", "Registering a prefix", "Resolution belongs
   at the network boundary", "RealmPaths", and "Compatibility with the
   base-realm alias".
2. `packages/eslint-plugin-boxel/lib/rules/no-url-from-realm-identifier.js`,
   header comment.
3. #5847 (`560dfa6853`), which added `no-url-from-realm-identifier` and
   enabled it in `packages/runtime-common/.eslintrc.cjs` and
   `packages/host/.eslintrc.js`.
4. #4202 (`3c9bde0da3`), which added `no-literal-realm-urls`.
5. #4954, which moved prefix mappings onto the VirtualNetwork. #4409 and
   #4425 introduced the identifier types and `addRealmMapping` as the first
   steps of the migration away from `https://cardstack.com/base/`. #5473
   (`d59e0635d4`) moved base code refs to prefix form and added
   `no-url-form-base-imports`.
6. Luke Melia, answering this ADR's open questions, 2026-10-15.
7. Luke Melia, deciding the findings of a compliance audit of this ADR,
   2026-10-19.
8. `VirtualNetwork.keyForIdentifier` in
   `packages/runtime-common/virtual-network.ts`, and the store-key comment in
   `packages/host/app/services/store.ts`.
9. `packages/host/app/lib/utils.ts`, comments on `skillsIndexId` and
   `skillFileURL`.

## 6. Remediation

Known gaps are listed in [remediation/002.md](remediation/002.md).
