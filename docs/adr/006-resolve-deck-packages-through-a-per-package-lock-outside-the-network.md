---
status: proposed
date: 2026-10-19
scope:
  - packages/deck/**
  - scripts/deck-sync.mjs
  - packages/runtime-common/deck-*.ts
  - packages/runtime-common/dynamic-rri-resolution.ts
  - packages/runtime-common/decklist-adopt.ts
  - packages/runtime-common/virtual-network.ts
  - packages/runtime-common/loader.ts
  - packages/realm-server/handlers/serve-deck-version.ts
  - packages/realm-server/lib/deck-*.ts
  - packages/host/app/services/network.ts
  - packages/host/app/services/deck-adoption.ts
---

# 006. Resolve Deck packages through a per-package lock, outside the network

Deck is a package protocol developed in its own repository and vendored here.
A realm becomes a package: `package.json` names it and holds dependency
ranges, and `importmap.json` holds a lock, an import map whose targets are
exact Version RRIs. The host discovers each package's lock as its modules
load, and scopes it to that package, so two Versions of one package can be
resident at once. A Deck resolver answers in RRIs, and the network carries no
Deck code. The mechanics are in
`docs/deck-packages-and-runtime-resolution.md`.

## 1. Decision

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this
document are to be interpreted as described in BCP 14 (RFC 2119, RFC 8174) when,
and only when, they appear in all capitals, as shown here.

### 1.1. Deck is vendored

`packages/deck/src` and `packages/deck/tests` MUST match the Deck commit that
`packages/deck/DECK_SOURCE` records. A change to them MUST be made in Deck and
synced with `scripts/deck-sync.mjs`. Lock, specifier, and RRI algorithms MUST
come from `@cardstack/deck`. Only Deck-owned code MAY read the version in an
RRI, and only through `@cardstack/deck` functions.

### 1.2. The lock

A lock MUST be canonicalized by `canonicalRRIImportMap`, which refuses URL
targets. Every target MUST be an exact Version RRI, such as
`@acme/ui@3.4.2/button.gts`. A lock MUST NOT hold a URL.

### 1.3. Resolution answers in RRIs

`DeckPackageResolver` MUST resolve a bare specifier to an exact Version RRI by
the importing module's scope, and MUST NOT build a URL. It MUST NOT answer for
a specifier already shaped as an RRI. A request with no importer MUST NOT use
a scope. The Loader MUST consult it through `resolveImportThroughDeck`, which
hands the resulting RRI to the network.

### 1.4. Deck stays outside the network

Deck code MUST reach the network only through `DeckRoutes`. The
VirtualNetwork MUST NOT contain Deck-specific code. An exact Version root MUST
be registered as an ordinary prefix, next to its package: `@acme/ui@3.4.2/` at
the package's URL plus `@3.4.2/`.

### 1.5. Discovery

A package's lock MUST be installed before a module from it transpiles, and
before a card document from its realm deserializes. Discovery MUST read the
realm named by `X-Boxel-Realm-Url`, and install nothing unless
`.deck/capabilities` confirms collaboration for the same realm RRI that
`package.json` names. The lock MUST install as a scope over the package root,
never as global imports. The prefixes a lock names MUST be registered before
any of them is fetched.

### 1.6. Keeping loaded modules

A lock change that only adds entries MUST keep registered modules; any other
lock change MUST discard them. Registering a mapping that is already in place
MUST NOT notify. A prefix with no previous mapping MUST be reported as
`added`, and the Loader MUST keep its modules unless a cached module lives
under the new target.

### 1.7. Serving Versions

An exact Version MUST be served read-only at `/<scope>/<name>@<version>/<path>`
from the realm's `.deck/store`, to the realm's readers, checked through
`Realm.handle`. It MUST be served as immutable, public or private as the realm
is. A module request MUST get JavaScript transpiled under the exact RRI. A
range or tag MUST be resolved by a `?spec=` request whose answer is not
cached.

### 1.8. Gated

The integration MUST be off unless `BOXEL_DECK_COLLABORATION_ENABLED` is
`true`, and the realm server MUST enable it only for realms in
`BOXEL_DECK_COLLABORATION_REALM_RRIS`. With it off, the Loader's resolution
MUST be the network's, unchanged.

## 2. Rationale

A lock of RRIs means the same thing in every environment, as prefixes do for
well-known realms (ADR 002 §1.4). Under federation (ADR 004), moving a Version
to another server changes only how an RRI is projected, never the lock or a
card.

Locks are scoped per package because a realm can host competing apps. One
shared map forces every app onto one Version of every dependency.

Proposed ADR 002 makes the network the only place an RRI becomes a URL, and
open work is moving consumers off the VirtualNetwork (#6073). A resolver that
answers in RRIs behind a small interface follows wherever ADR 002 takes that
boundary, with nothing of Deck's to unpick. Making an exact Version root an
ordinary prefix is what removes Deck code from the network.

Resolution stays in the Loader rather than the browser's import maps.
Packages appear at runtime, a browser map cannot change a specifier it has
resolved, and the browser cannot evict a module when card code is edited.
Resolution is not baked into served bytes either: Deck allows a transform
before the seal, never after it.

The lock must be in place before transpilation because AMD registration
resolves a module's dependencies synchronously. Loaded modules are kept when
nothing they depend on can change, because re-evaluating them gives their
classes a second identity. Cache keys fold through the mappings, so an added
prefix is safe only when no cached module lives under its target.

Probing authorization through `Realm.handle` keeps every read rule in one
place. `addRealmMapping` refuses an undeclared `@cardstack/` prefix (#5965),
so a lock that pins a Version of base fails instead of loading a second copy
of base's classes, which the host bundle must not have (#6445).

## 3. Considered options

- **A Deck resolver behind the Loader, outside the network (chosen).**
- **The lock inside the VirtualNetwork.** The first cut did this. It puts
  Deck logic in the network, which must then change wherever ADR 002 moves
  RRI resolution.
- **Native browser import maps.** A map cannot gain scopes at runtime or
  change a resolved specifier, and the browser cannot evict a module. It also
  works only in the browser.
- **Rewrite imports when a Version is served.** It is a transform after the
  seal, it works only for immutable Versions, and two locks need two copies
  of a module.
- **A realm-relative package door, `<realm>/_packages/…`, with a short
  alias.** It puts realm URLs and the store layout into card JSON, against
  ADR 002, and the alias names an entry module no scope covers.
- **One import map for the realm or the process.** It couples competing apps,
  and it is the global registry ADR 002 §3 rejects.

## 4. Consequences

- An exact Version fetched by its transport URL before its prefix is
  registered makes the Loader discard its caches. Resolving through RRIs does
  not.
- Querying across Versions is not part of this integration.

## 5. Sources

1. `deck/restack-01-core` to `deck/restack-06-version-index`: `5c6f3c9f34`,
   `d7801cccea`, `3aaba08d09`, `c5043412f4`, `d3582d926c`, `ef357bbba6`,
   `b7af804295`.
2. ADR 002 §1.2, §1.4, §3; ADR 004.
3. #5965 (reserved `@cardstack/` names); #6073 (code refs without a
   VirtualNetwork); #6445 (base in the host bundle).
