# CS-10623 — Reimplement `boxel realm watch` command

Linear: https://linear.app/cardstack/issue/CS-10623
Branch: `cs-10623-reimplement-boxel-realm-watch-command`

## Context

Port the `watch` command from the standalone `cardstack/boxel-cli` into the monorepo's `packages/boxel-cli` under the `realm` subcommand group (now namespaced as `boxel realm watch`, not the legacy top-level `boxel watch`). Watch monitors a remote realm for server-side changes, pulls updates into the local workspace, and creates checkpoints. It's the marquee Claude-Code workflow: "I'm working on a card with you while teammates edit in the web UI."

This blocks the Claude Code plugin marketplace submission (CS-10900).

## Current state

- Monorepo `packages/boxel-cli/src/commands/realm/index.ts` registers: `cancel-indexing`, `create`, `pull`, `push`, `sync`, `wait-for-ready`. **No `watch` subcommand exists.**
- Legacy implementation: `/Users/fadhlanridhwanallah/Documents/Cardstack/Repo/boxel-cli/src/commands/watch.ts` (360 lines) — port reference.
- Canonical pattern: `packages/boxel-cli/src/commands/realm/wait-for-ready.ts`.
- Watch depends on `realm history` (CS-10625) for checkpoint creation on detected changes — this PR can stub checkpointing if 10625 hasn't merged, then wire up once it lands.

## Plan

### 1. New file `packages/boxel-cli/src/commands/realm/watch.ts`

- Export `watchRealms(realms: string[], options?: WatchOptions): Promise<void>`.
  - `WatchOptions`: `{ intervalSeconds?: number; debounceSeconds?: number; quiet?: boolean }`.
  - Defaults: `interval=30`, `debounce=5`, `quiet=false`.
- Long-running command — runs until SIGINT/SIGTERM.
- Polling loop per realm: hit `/_mtimes`, diff against last-known mtimes, debounce until changes settle, then pull changed files and create a checkpoint via `realm history` machinery (or stub if 10625 hasn't merged).
- Multi-realm support: accept multiple positional `[realms...]` and run each loop concurrently with `Promise.all` of independent loops.
- Lifecycle:
  - On start: write a lock file (e.g. `.boxel-watch.lock` per workspace) so other commands can warn if `watch` is active.
  - On exit: clean up lock file.
- Export `registerWatchCommand(realm: Command): void`.

### 2. Wire into `packages/boxel-cli/src/commands/realm/index.ts`

```ts
import { registerWatchCommand } from './watch';
// ...
registerWatchCommand(realm);
```

### 3. Tests at `packages/boxel-cli/tests/integration/realm-watch.test.ts`

Long-running command tests are tricky — use short intervals + test timeouts. Cover:
- detects server-side changes within `interval` and pulls them
- debounce groups rapid changes into one checkpoint
- `--quiet` suppresses no-change output
- multi-realm: changes on one realm don't block the other
- lock file lifecycle: created on start, removed on graceful exit

Use real realm endpoints (per CS-10852/10853 precedent), mutate from the test side via `fetch` to trigger detected changes.

## Files to add/modify

- **Add**: `packages/boxel-cli/src/commands/realm/watch.ts`
- **Add**: `packages/boxel-cli/tests/integration/realm-watch.test.ts`
- **Edit**: `packages/boxel-cli/src/commands/realm/index.ts`

## `boxel stop` (open question, see below)

The inspiration CLAUDE.md describes `boxel stop` as the kill-running-watch-processes companion. **No Linear ticket exists for `stop`.** Options:

- **A**: Roll `stop` into this PR's scope (track running watch via PID file under `~/.boxel-cli/`, `boxel realm stop` reads it and SIGTERMs).
- **B**: Skip — users SIGINT (`Ctrl+C`) the watch process directly, which is normal long-running CLI behaviour. The lock file from §1 makes "is watch running?" detectable without needing a `stop` command.
- **C**: File a separate ticket and defer.

Recommendation: **B** for now (no `stop` command). The inspiration's `boxel stop` was useful when watch backgrounded itself; the monorepo's `watch` runs in the foreground, so SIGINT is sufficient. Confirm with reviewer in the draft PR.

## Test plan

- [ ] `pnpm --filter @cardstack/boxel-cli test:unit` passes
- [ ] `pnpm --filter @cardstack/boxel-cli test:integration` passes
- [ ] `pnpm --filter @cardstack/boxel-cli build` succeeds
- [ ] `boxel realm watch --help` documents `-i`, `-d`, `-q`
- [ ] Manual: `boxel realm watch <staging-realm-url>` against a staging realm, edit a card via the web UI, confirm the local workspace pulls the change within `interval` and a checkpoint is created (once CS-10625 lands)

## Verification

End-to-end: start `boxel realm watch <url>` in one terminal, edit a card via Boxel web UI in another, confirm the local file updates within ~30s and a new checkpoint shows in `boxel realm history` (after CS-10625).

## Open questions

- `boxel stop` — confirm option B (no separate command, rely on SIGINT + lock file). Flag in draft PR review.
- Coordination with CS-10625 (`history`): if 10625 merges first, depend on it; if this lands first, stub checkpointing behind a feature flag and follow up.
- Coordination with CS-10627 (`file touch`): not strictly required, but watch may need to skip files locked by `boxel file edit` (CS-?? — not yet ticketed). Out of scope for v1 of watch.
