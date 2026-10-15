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

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this
document are to be interpreted as described in BCP 14 (RFC 2119, RFC 8174) when,
and only when, they appear in all capitals, as shown here.

### 1.1. Identifiers are opaque

Card ids, module references, code-ref modules, and link targets MUST be typed
as `RealmResourceIdentifier` or `RealmIdentifier`. Code MUST compare, key,
store, and pass them as strings, without parsing them. `meta.realmURL` is the
one exception: it carries the realm's served URL.

### 1.2. Resolution happens at the network boundary

Code MUST NOT pass an RRI to `new URL()`. Only the VirtualNetwork
(`toURL`, `toURLHref`, `fetch`) MAY resolve an RRI to a URL. Code SHOULD
resolve immediately before the network call, and SHOULD pass the RRI to
`VirtualNetwork.fetch` directly. Realm membership and path math MUST use
`RealmPaths`.

Rendering, serialization, and store code SHOULD NOT take a VirtualNetwork in
order to resolve an identifier. The exception is a cross-form membership test
in `RealmPaths`, which needs one.

### 1.3. Canonical form at the edges

Serialization MUST write RRI form. Deserialization MUST canonicalize incoming
identifiers to RRI form.

### 1.4. Well-known realms are named by prefix

Source and card JSON MUST reference a well-known realm by its
`@cardstack/<realm>/` prefix, not by an environment-specific URL. Each prefix
MUST be registered on a VirtualNetwork instance with `addRealmMapping`.

New code MUST NOT import from the `https://cardstack.com/base/` alias. The
alias MAY appear only where the `no-url-form-base-imports` rule allows it:
fetch targets, alias registration, and tests that assert on served content.

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
  portable across environments, and a lint rule rewrites them to prefixes
  [1, 4].
- **A global prefix registry.** The runtime replaced it with per-VirtualNetwork
  mappings [5], so that a test can register and drop a throwaway prefix without
  affecting other tests [1, 6]. More generally, the project avoids globals
  unless there is no other choice [6].

## 4. Consequences

`no-url-from-realm-identifier` runs only in `packages/runtime-common` and
`packages/host` app code, which build the TypeScript program it needs [3].
Elsewhere, reviewers enforce §1.2.

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
