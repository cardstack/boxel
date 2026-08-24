# PretUI collaboration with Deck and Boxel CLI

This is the operator and teammate tour for the feature-gated PretUI pilot. The
Realm is canonical: a local checkout is a materialized branch, and GitHub is
not involved in the daily edit loop.

## Start a local pilot Realm

Start `deckd` in one terminal:

```sh
cargo run --manifest-path packages/deckd/Cargo.toml -- serve --port 8787
```

Create the deterministic 28-unit PretUI team Realm once. The destination must
be empty:

```sh
pnpm --dir packages/realm-server fixture:pretui-live -- /tmp/pretui-team-realm
```

Start the complete Host and Realm environment:

```sh
PRETUI_REALM_PATH=/tmp/pretui-team-realm mise run dev-pretui-all
```

For independent Host and Realm restart cycles, use the backend-only task:

```sh
PRETUI_REALM_PATH=/tmp/pretui-team-realm mise run dev-pretui
mise exec -- pnpm -C packages/host start
```

The Realm is `https://localhost:4201/pretui/`. The Host is
`https://localhost:4200/`.

Open the Realm from the existing Workspace Chooser and then open **Astra Query
Harness** from the normal pinned-card area. The Realm root is an ordinary
`Workspace` card in `index.json`; there is no parallel Deck application and no
replacement for Interact mode. The Boxel product icon, Interact selector, New
menu, stack rails, profile, and assistant remain Host-owned and unchanged.

The harness is Realm content backed by the real `POST /.deck/astra/query`
protocol. The deterministic replay compares PretUI 0.9.0 with 1.0.0 and shows
20 added cards, 8 changed, 0 removed, and 8 unchanged. Its four views cover an
older Version, the stable Version, the next development Version, and mutable
`main`; every result includes the exact tree/index/Repository/History
provenance needed to explain what was queried.

The query card keeps the Deck-at-rest console's useful interaction model while
remaining an ordinary card inside Interact mode:

- the top ledger shows every card in all four exact views, with match/miss
  marks and the index generation used for each view;
- the question rail provides release-surface, ownership, and evolving-system
  queries such as **Known Date**, **Development locks**, and **Design review**;
- the request is editable as `boxel-astra-query-v1` JSON and runs with the
  button or Command/Control+Enter;
- the answer lists exact matches with Version or branch provenance and reports
  added, changed, removed, and unchanged counts for the selected comparison.

Selecting **Known Date** is the shortest smoke tour: 0.9.0 has no matches,
1.0.0 and 1.1.0-dev.1 each have the control and field, and mutable `main`
resolves those same two cards from its current index.

The pilot task deliberately mounts only Base and PretUI and skips optional
Skills, OpenRouter, and Software Factory realms. Ordinary Boxel development
still uses the normal tasks. A hosted environment enables the same capability
and RRI allowlist through deployment configuration.

## Teammate branch loop

Teammates authenticate through their normal Boxel CLI profile. The secret-seed
environment shown in local integration tests is an operator-only development
shortcut, not the team workflow.

```sh
boxel realm branch list https://localhost:4201/pretui/
boxel realm branch create https://localhost:4201/pretui/ mina/focus-ring --from main

boxel realm pull \
  https://localhost:4201/pretui/ \
  ~/Projects/pretui-mina \
  --branch mina/focus-ring

boxel realm sync status ~/Projects/pretui-mina
boxel parse --workspace ~/Projects/pretui-mina
boxel test ~/Projects/pretui-mina
boxel realm push ~/Projects/pretui-mina https://localhost:4201/pretui/
boxel realm checkpoint \
  ~/Projects/pretui-mina \
  --message "Focus ring 1.1 review candidate"
boxel realm review open \
  ~/Projects/pretui-mina \
  --target main \
  --title "Make keyboard focus unmistakable" \
  --body "Updates the focus token and the field that consumes it."

boxel realm review list https://localhost:4201/pretui/
boxel realm review show https://localhost:4201/pretui/ 1
boxel realm review merge https://localhost:4201/pretui/ 1
```

The checkout's `.boxel-sync.json` records the Realm RRI, branch identity,
exact Repository, tree, import-map lock, History head, index generation, and
observed ref generation. A push compares those values with the current branch
head; a stale or divergent push writes nothing. File mtimes are never used as
causality in Deck mode.

To move a clean checkout to another branch:

```sh
boxel realm branch switch ~/Projects/pretui-mina main
```

`realm sync --branch` selects a branch only when creating a workspace. An
existing workspace retains its recorded branch and directs the author to the
explicit switch command.

A Checkpoint freezes the exact Repository, tree, import-map lock, History head,
and completed index generation for Review. It does not create a Git commit or
stop later saves. The CLI refuses to Checkpoint unpushed bytes or a branch that
moved since the workspace observed it.

A Review is not a mutable alias for its source branch. Opening one pins three
exact Checkpoints: the source candidate, the target as observed, and their
common ancestor as the three-way merge base. The CLI refuses dirty source
bytes, stale branch state, or a source/target without an exact Checkpoint.
Later saves remain recoverable in History but cannot silently change what a
reviewer sees.

Review merge is a conditional Realm Server operation, not a local Git merge.
The CLI observes the current Review generation and target Checkpoint; the
server rejects either moving underneath it. A clean three-way result is
materialized into the target workspace, sealed in deckd as one History change
with exact target and source parents, indexed, and only then published by one
target-ref advance to a two-parent Checkpoint. A content conflict returns 409
without changing target bytes, History, index, or ref.

## Headless collaboration replay

The B7 acceptance replay drives the same public commands as two teammate
checkouts. It creates separate branches from the current `main`, pulls them,
changes controls plus their field/card consumers, pushes and syncs, creates
Checkpoints, opens and merges fixed Reviews, advances each source branch to a
`^1.1.0-0` range with an exact `1.1.0-dev.1` import-map lock, then switches to
`main` and back to prove the exact branch state is recoverable.

With the PretUI stack running, a local operator can replay it with:

```sh
BOXEL_REALM_SECRET_SEED="<local development seed>" \
  pnpm --dir packages/boxel-cli replay:pretui-collaboration -- \
  https://localhost:4201/pretui/
```

The secret seed is only for this headless local acceptance run. Teammates use
their normal Boxel CLI profiles for the interactive commands above. The replay
ends with structured JSON containing both branch names and the source, merge,
and next-work Checkpoint identities.

## What the fixture proves

The replay contains 28 design-system units across foundations, layout,
controls, fields, patterns, and cards, plus four party-owned workspaces. Each
workspace declares a semver dependency while its `importmap.json` locks the
exact PretUI Version used at runtime. This exercises component and field
extension, theme/focus behavior, country-code lookup, cards, and downstream
composition without turning the Realm into a vendored monorepo.

Branch creation is copy-on-write. It reuses immutable Repository, tree, and
lock objects, creates a lightweight shared-jj History workspace, builds a
branch-qualified index, waits for the exact preview to be ready, and only then
publishes the branch ref. Each accepted push appends one History Step and moves
that branch ref once.

Review open/list/show/merge commands are layered on this same branch state.
Exact candidate Browse/Run presentation and exact-Version syndication follow
the rollout order in the backport plan.

The same replay also proves the Realm can present this state with normal Boxel
cards. `workspace.gts` supplies the standard Workspace behavior through the
Base package, `index.json` is the default entry card, and the Astra harness and
four view cards remain ordinary inspectable Realm resources. This is an
additive Realm-level demonstration; future branch and Review controls remain
feature-gated Host work.
