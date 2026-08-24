# PretUI team collaboration fixture

This fixture replays a complete PretUI release train from statements against
Deck's current Repository, branch, Checkpoint, Review, merge, Version, and
dist-tag APIs. It is intentionally larger than Known Date: 28 authored units
cross foundation, layout, controls, patterns, Boxel fields, and composed cards.

The fixture answers a practical team question: can several people change
different layers of a design system, preview exact development locks, submit
normal Reviews, release on `main`, and begin the next train without treating
GitHub or a checkout as canonical state?

The live bootstrap adds an Astra query harness without inventing a separate
application. The Realm's `index.json` adopts the standard Base `Workspace`,
pins the release train and harness, and exposes the generated view cards
through the ordinary Workspace Library.

## Scenario

```text
main @ 0.9.0 (latest)
  │
  ├── develop ─┬── mina/focus-contract ───── Review #1 ─┐
  │            ├── jo/action-density ─────── Review #2 ─┤
  │            ├── ana/known-date-fields ─── Review #3 ─┼──▶ develop
  │            └── leo/data-composition ──── Review #4 ─┘
  │                                                       │
  │                  publish 1.0.0-dev.1 (dev) ◀──────────┘
  │                  consumers lock the exact Version
  │                                                       │
  └──────────────────── Review #5 ◀──────────────── develop
                              │
                              ├── merge to main
                              ├── publish 1.0.0 (latest)
                              └── branch develop/1.1
                                      │
                                      └── publish 1.1.0-dev.1 (dev)
                                          refresh exact consumer locks
```

The four work streams are deliberately non-overlapping at the file layer.
They branch from the same `develop` Checkpoint, then merge after `develop` has
moved. That makes Reviews #2–#4 exercise a genuine three-way merge against an
advanced target rather than copying the source tree over it.

## Authored surface

The package contains 28 units:

| Layer      | Count | Representative units                            |
| ---------- | ----: | ----------------------------------------------- |
| Foundation |     3 | Theme Provider, Focus Ring, Surface             |
| Layout     |     5 | Stack, Cluster, Grid, Panel, Divider            |
| Controls   |    10 | Button, Text Input, Known Date, Select, Toolbar |
| Patterns   |     4 | Form Field, Empty State, Filter Bar, Data Table |
| Fields     |     3 | Known Date, Status, Country FieldDefs           |
| Cards      |     3 | Customer Profile, Design Review, Release Train  |

Eight units already exist in 0.9 and have three distinct source states: 0.9,
1.0, and 1.1 development. Twenty are introduced during the 1.0 train and have
two: 1.0 and 1.1 development. The 1.0 release candidate and stable Version
intentionally reuse component bytes. Promotion changes Version metadata and
locks; it does not rebuild approved source.

## Lock cycle

Each developer has a small consuming workbench under `workspaces/<name>/`.
The declared dependency expresses moving intent and `importmap.json` retains
the exact result:

| Moment         | package.json intent | exact import-map lock            |
| -------------- | ------------------- | -------------------------------- |
| Candidate work | `dev`               | `@cardstack/pretui@1.0.0-dev.1/` |
| Accepted main  | `latest`            | `@cardstack/pretui@1.0.0/`       |
| Next train     | `dev`               | `@cardstack/pretui@1.1.0-dev.1/` |

At the end, `main` remains materialized at stable 1.0.0. The next development
tree is not smeared over it: `develop/1.1` names its own exact Repository and
Checkpoint, while the immutable `1.1.0-dev.1` Version makes its files and locks
directly addressable.

## Replay and inspect

From `packages/realm-server`:

```sh
REALM_DIR="$(mktemp -d /tmp/boxel-pretui-team.XXXXXX)"
mise exec -- pnpm fixture:pretui-team -- "$REALM_DIR"
```

The command prints the complete report. The same report and a compact replay
log remain inside the realm:

```text
.deck/fixtures/pretui-team.json
.deck/fixtures/pretui-team.ndjson
```

Useful inspection points:

```sh
# Mutable main is stable
cat "$REALM_DIR/workspaces/mina/importmap.json"

# Branch and Review refs are ordinary inspectable files
find "$REALM_DIR/.deck/refs/heads" -type f -print
find "$REALM_DIR/.deck/reviews/numbers" -type f -print

# Store metadata shows independent latest and dev selections
cat "$REALM_DIR/.deck/store/cardstack/pretui/meta.json"
```

Mount the generated directory as the `@cardstack/pretui/` source realm and
open `index.json` to see the Release Train card. It visually connects the four
developer lanes, five Reviews, three lock moments, and the 28-unit main result.

For the browser-ready Realm with real multi-view query evidence, use deckd and
the live bootstrap:

```sh
cargo run --manifest-path packages/deckd/Cargo.toml -- serve --port 8787

REALM_DIR="$(mktemp -d /tmp/boxel-pretui-live.XXXXXX)"
mise exec -- pnpm fixture:pretui-live -- "$REALM_DIR"
PRETUI_REALM_PATH="$REALM_DIR" mise run dev-pretui
```

For a single foreground `mise` environment containing both Host and Realm
Server, use:

```sh
PRETUI_REALM_PATH="$REALM_DIR" mise run dev-pretui-all
```

`dev-pretui` remains the backend-only variant. Start the Host with the same
mise environment in a second terminal when independent restart cycles are
useful:

```sh
mise exec -- pnpm -C packages/host start
```

The mutable Realm is `https://localhost:4201/pretui/` and the Host is
`https://localhost:4200/`. Keeping the fixture path explicit prevents a task
from silently deleting or replacing a developer's collaboration Realm.

The bootstrap runs the current Astra implementation against four exact views,
writes the result to `.deck/fixtures/astra-query.json`, and materializes five
ordinary cards: one harness plus previous, stable, next, and main views. The
expected 0.9.0 → 1.0.0 comparison is 20 added, 8 changed, 0 removed, and 8
unchanged. Semantic card names live in `cardInfo.name`, so the Workspace,
activity feed, and generic card shells never fall back to “Untitled”.

The **Astra Query Harness** is not a static proof card. It posts the visible
request to the live Realm endpoint and redraws both its four-view corpus ledger
and answer pane from the response. Its saved questions cover layer, owner,
availability, development locks, and design-review concepts; the JSON editor
keeps the protocol inspectable when a teammate needs a query beyond those
shortcuts.

Focused verification:

```sh
cd packages/realm-server
MATRIX_REGISTRATION_SHARED_SECRET=xxxx \
  TEST_FILES=pretui-team-fixture-test \
  mise exec -- pnpm test
```
