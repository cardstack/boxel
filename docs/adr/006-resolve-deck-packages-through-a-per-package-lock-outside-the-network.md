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
  - packages/realm-server/node-realm.ts
  - packages/deck-history/**
  - packages/boxel-cli/src/lib/deck-*.ts
  - packages/boxel-cli/src/commands/realm/sync.ts
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

A Deck realm also keeps its own History. Every save is committed
automatically, a burst of saves becoming one History Step, so nobody runs a
commit. The realm's `main` is the one HEAD that the Boxel host and every
boxel-cli user write to, and boxel-cli syncs with it file by file, as mtime
sync did, on content hashes instead of modification times. The collaboration
mechanics are in `docs/deck-collaboration.md`.

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
MUST be the network's, unchanged, no save MUST be committed to History, and
boxel-cli MUST sync by modification time as before.

### 1.9. Every save is committed

Every file a Deck-enabled source realm's file adapter writes, appends,
splices or removes MUST be committed to the realm's History, without anyone
running a commit. Saves MUST be debounced per realm: a burst that ends in a
quiet window (400 ms) MUST become one History Step, whose message names the
paths that changed. Deck's own state under `.deck/` MUST NOT be committed as
a save, and a staged write the realm has not yet renamed into place MUST NOT
be part of a Step.

The realm server MUST say which writes it accepted: deckd's own file watcher
MUST stay off, so a large branch materialization is never sealed halfway. A
History failure MUST NOT fail the save that caused it.

Restore MUST move forward: restoring a Step MUST write a new Step, never
rewind History.

### 1.10. One HEAD

A realm's `main` MUST be the realm's live files. Committing saves MUST advance
`main` to them in the same conditional update that records the History Step,
and each hosted package's tree MUST be the subtree at its path. A branch
update MUST first commit the live files, with any saves still waiting out the
debounce, as their own Step, and MUST then apply on top of them, so it never
writes over a host save. There MUST be no other writable branch, and no
update MAY move `main` unconditionally.

### 1.11. Sync per file

A branch update whose every file names the content it was made against (its
`base`, `null` for a file that did not exist) MUST apply on top of whatever
`main` holds. It MUST be refused for a file whose current content is neither
its base nor its result, with a 409 listing exactly those paths, and nothing
MUST be written when any file is refused. An update that names no bases MUST
need the whole branch unmoved since it was read; History restore uses it.

boxel-cli MUST keep mtime sync's semantics, comparing content hashes against
the base each file had at the last sync (`.boxel-sync.json`). A file changed
on one side MUST move to the other. A file changed on both sides MUST be
skipped and reported, and stay a conflict until resolved: with
`--prefer-local` it MUST be pushed with the realm's current content as its
base, and with `--prefer-remote` the realm's content MUST replace the local
file. `--prefer-newest` MUST be refused, since content has no "newer". When a
publish is refused because the realm changed a file after the read, boxel-cli
MUST read again, a bounded number of times. `realm push` MUST be the push half
of sync; neither MAY force a write.

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

Committing every save is what makes the realm itself the backup: undo used
to need boxel-cli on a local machine keeping its own git history, and a realm
edited only through the Boxel host had none. Debouncing keeps History at the
grain of an edit rather than a keystroke. The realm server, not deckd's file
watcher, decides what is committed, because only it knows when a write was
accepted and when a branch write is complete.

`main` follows the live files because they are what the realm serves, and
what boxel-cli users synced against before Deck. A Deck branch that host saves
did not advance would hide them from boxel-cli, and the next push would write
over them. With one HEAD, the host and the CLI see the same thing.

Sync merges per file because that is what its users rely on: two people
editing different files never block each other. A whole-branch condition
would refuse nearly every push once host saves advance `main`. The per-file
base keeps what mtime sync lacked: a file two writers changed is never
silently overwritten, the loser's version is in History, and the base is a
content hash, not a modification time that a copy or a clock can change.
Branching and an explicit merge are left out deliberately. They need their
own commands and review, and a force push would undo the guarantee.

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
- **deckd's file watcher commits saves (History).** It cannot tell a host save
  from a half-written branch materialization, and it would commit Deck's own
  bookkeeping.
- **History behind the files, `main` moved only by boxel-cli.** Host saves
  never reach `main`, so a push overwrites them.
- **A whole-branch condition on every push.** Simple, and right for one
  writer; with host saves and several CLI users it refuses almost every push.
- **`--prefer-newest`, force push, or a branch per writer.** Newest has no
  meaning for content; a force push silently discards another writer's work;
  branches need an explicit merge workflow, which comes later.

## 4. Consequences

- An exact Version fetched by its transport URL before its prefix is
  registered makes the Loader discard its caches. Resolving through RRIs does
  not.
- Querying across Versions is not part of this integration.
- A file both a host save and a boxel-cli user changed is reported to the CLI
  user, not merged within the file.
- `main` moves often, so a boxel-cli History restore needs a fresh sync first:
  restore keeps the whole-branch condition.
- Only `main` exists. Branches, Checkpoints and Reviews are verified objects
  (`docs/deck-collaboration.md`), but nothing writes another branch yet.

## 5. Sources

1. `deck/restack-01-core` to `deck/restack-06-version-index`: `5c6f3c9f34`,
   `d7801cccea`, `3aaba08d09`, `c5043412f4`, `d3582d926c`, `ef357bbba6`,
   `b7af804295`.
2. `deck/restack-09-content-sync` and `deck/restack-10-history`: History
   Steps, forward restore, content-addressed sync; `77491e337e` (every save
   committed, debounced) and `78a6804b60` (one HEAD, per-file sync).
3. ADR 002 §1.2, §1.4, §3; ADR 004.
4. #5965 (reserved `@cardstack/` names); #6073 (code refs without a
   VirtualNetwork); #6445 (base in the host bundle).
