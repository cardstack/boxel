# CS-11085 — Workspace chooser: center & ellipsize long realm names

**Linear:** [CS-11085](https://linear.app/cardstack/issue/CS-11085)

## Goal

When a workspace's realm name is longer than the icon tile, the chooser card today renders the name on a single nowrap line that overflows the tile to the right, dragging its centering out of alignment with the icon above. Design ask: **center and ellipsize after 2 lines.**

## Root cause

In `packages/host/app/components/operator-mode/workspace-chooser/workspace.gts`:

- `.workspace-card { width: fit-content }` — the card column sizes to its widest child, so a long name expands the whole column wider than the `var(--boxel-xxs-container)` icon tile.
- `.info > span { text-wrap: nowrap; … }` — the name is forced to one line and (because of `fit-content`) never actually clamps; it just grows.

## Change

`packages/host/app/components/operator-mode/workspace-chooser/workspace.gts`:

1. `.workspace-card`: `width: fit-content` → `width: var(--boxel-xxs-container)` so the whole card column matches the icon tile width.
2. `.name`: override the inherited single-line rules with a 2-line `-webkit-line-clamp` and reserve `min-height: 2lh` so cards in a row stay aligned regardless of name length.

`.visibility` row stays single-line — no change.

## Test

`packages/host/tests/acceptance/workspace-chooser-test.gts`: new test under a `long realm names` module that

- overrides realmA's `name` to a deliberately long string,
- asserts the workspace card renders with the full name in the DOM (`[data-test-workspace-name]`),
- asserts `.workspace-card`'s rendered width equals the `ItemContainer`'s width (i.e. doesn't grow with text length).

Pixel-perfect line-clamp visuals aren't asserted — too brittle. The width assertion catches the meaningful regression (someone reintroducing `width: fit-content` or removing the line-clamp wrap).

## Verification

- Filtered host test run: `cd packages/host && pnpm exec ember test --path dist --filter 'workspace-chooser' 2>&1 | tee /tmp/host-test-cs-11085.log`.
- Visual: `pnpm start` host, open workspace chooser, confirm short / medium / long names all render aligned under their tiles, with long names clamping after line 2.

## PR

Open as **draft** PR (`gh pr create --draft`). Delete this plan doc before marking ready / merging (plan docs are scratch).
