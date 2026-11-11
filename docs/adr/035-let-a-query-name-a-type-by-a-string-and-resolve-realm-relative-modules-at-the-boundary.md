---
status: proposed
date: 2026-11-10
scope:
  - packages/runtime-common/type-reference.ts
  - packages/runtime-common/query.ts
  - packages/runtime-common/query-syntax.ts
  - packages/runtime-common/search-entry.ts
  - packages/runtime-common/query-field-utils.ts
  - packages/runtime-common/card-operations/named-query.ts
  - packages/runtime-common/realm.ts
  - packages/realm-server/handlers/handle-search.ts
  - packages/runtime-common/helpers/ai.ts
  - packages/runtime-common/index-query-engine.ts
  - docs/search.md
---

# 035. Let a query name a type by a string, and resolve a realm-relative module where the request arrives

Queries are written where there is no JavaScript to hand them a class: a
query-backed field's options, a query saved in card JSON, an HTTP body, the
AI tool. ADR 002 says how such a query names a module (a canonical RRI, never
a relative path) but not how it names a type in one string, nor how a query
that should serve in any realm names a module in its own. This ADR adds
both, and keeps ADR 002's rule that identifiers stay canonical past the
boundary.

## 1. Decision

### 1.1. A type reference has two spellings

A query MAY name a card type as the code ref `{ module, name }` or as the
string `"<module>#<Name>"`. The two MUST mean the same type, wherever a query
takes a type. The name is what follows the last `#`, since a module
identifier never holds one, and MUST be an identifier. The module MUST be an
absolute URL, a prefix-form identifier (`@scope/name/…`), or `$REALM/<path>`.
Anything else MUST be refused with `invalid-type`.

### 1.2. `$REALM/` names the query's own realm

In either spelling a module MAY be written `$REALM/<path>`, naming the module
at that path in the realm the query belongs to: the realm a `_search`
addresses; the realm of the card declaring a query-backed field; the realm
holding a named query's declaration; the outer query's realm for a `let`
binding or a comparison set; the one realm a federated search names. A search
that names several realms has no one realm, and MUST refuse a `$REALM/`
module with `invalid-type`. A path that leaves the realm MUST be refused.

### 1.3. They resolve once, at the boundary

Both spellings MUST resolve once, where the request arrives (the search
handlers, a query-backed field's normalization, a named query's resolution),
to the absolute `{ module, name }` in its canonical form: a URL re-spelled
through the VirtualNetwork (`unresolveURL`) where the boundary holds one, so a
mapped realm's module is its prefix form. Nothing after that boundary — the
checks, signatures and caches, explain, policy lookup, the engine — MAY see a
shorthand or a `$REALM/` module. A client without the realm (one building a
wire query) MUST parse the shorthand and carry a `$REALM/` module unresolved
for the boundary; it MUST NOT guess the realm.

## 2. Rationale

The string form is what a person or a model writes in JSON, and the object
form is what code has always passed; making them one type, resolved in one
place, keeps a single identity for caches and signatures (ADR 002 §1.1) and
keeps resolution at the network boundary (ADR 002 §1.2). `$REALM/` lets a query in a
card's JSON travel with the card between realms and environments, the way a
prefix lets a well-known realm's module be named the same everywhere. Refusing
it across several realms is the only reading that cannot silently search the
wrong module.

## 3. Considered options

- **Relative modules (`./product#Product`) in the shorthand.** Refused: a
  query in an HTTP body or saved JSON has no module to be relative to, and
  002 already forbids relative identifiers past the boundary.
- **Resolve `$REALM/` against the first realm of a federated search.**
  Refused: the answer would depend on the order realms are listed in.
- **An alias table (`types: { Product: '…' }`).** Deferred.

## 4. Consequences

A string where a type goes was refused before Query V2 in both query
spellings (`type is not valid`, and a top-level `type` was an unknown
member), so the shorthand changes no saved query's answer and is read in
both spellings (ADR 032 §1.6).

## 5. Remediation

Known gaps are listed in [remediation/035.md](remediation/035.md).
