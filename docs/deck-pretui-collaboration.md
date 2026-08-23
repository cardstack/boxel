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

Start Realm Server, a dedicated user-index lane, and the prerender worker:

```sh
PRETUI_REALM_PATH=/tmp/pretui-team-realm mise run dev-pretui
```

Start Host in another terminal:

```sh
mise exec -- pnpm -C packages/host start
```

The Realm is `https://localhost:4201/pretui/`. The Host is
`https://localhost:4200/`.

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
