# CS-10627 — Reimplement `boxel file touch` command

Linear: https://linear.app/cardstack/issue/CS-10627
Branch: `cs-10627-reimplement-boxel-file-touch-command`

## Context

Port the `touch` command from the standalone `cardstack/boxel-cli` into the monorepo's `packages/boxel-cli` under the `file` subcommand group. Touch forces realm re-indexing of one or more instances after a remote `.gts` definition update. Without it, the common loop "edit `.gts`, push, see updated instance" leaves users staring at stale renders.

This unblocks the Claude Code plugin (CS-10900) which needs to advise the model to touch a single instance after definition changes.

## Current state

- Monorepo `packages/boxel-cli/src/commands/file/index.ts` registers: `delete`, `list` (alias `ls`), `lint`, `read`, `write`. **No `touch` subcommand exists.**
- Legacy implementation: `/Users/fadhlanridhwanallah/Documents/Cardstack/Repo/boxel-cli/src/commands/touch.ts` (245 lines) — port reference.
- Per `project_boxel_cli_command_structure.md` memory, `touch` was already pre-allocated to the `file` group (per-file op, same shape as read/write/delete).
- Canonical pattern: `packages/boxel-cli/src/commands/realm/wait-for-ready.ts` (`register<Name>Command` + exported core async function).

## Plan

### 1. New file `packages/boxel-cli/src/commands/file/touch.ts`

- Export `touchFiles(realmRef: string, paths: string[], options?: TouchOptions): Promise<TouchResult>`.
  - `TouchOptions`: `{ all?: boolean; dryRun?: boolean; profileManager?: ProfileManager }`.
  - `TouchResult`: `{ touched: string[]; skipped: string[]; error?: string }`.
- Resolve `realmRef` (`.`, `@user/workspace`, or full URL) via existing helpers in `src/lib/` if available; otherwise port from legacy.
- Auth: per-realm via `pm.authedRealmFetch`.
- Touch mechanism: matches legacy — typically a no-op `PATCH` or an mtime bump request to the file path.
- `--all`: enumerate `.json` and `.gts` files via the realm's mtimes endpoint (`/_mtimes`) and touch each.
- `--dry-run`: print would-touch list, no requests.
- Export `registerTouchCommand(file: Command): void`.

### 2. Wire into `packages/boxel-cli/src/commands/file/index.ts`

```ts
import { registerTouchCommand } from './touch';
// ...
registerTouchCommand(file);
```

### 3. Tests at `packages/boxel-cli/tests/integration/file-touch.test.ts`

Real realm endpoints (per CS-10852/10853 precedent). Cover:
- touching specific files updates their mtime on the realm
- `--all` touches every `.json` and `.gts`
- `--dry-run` prints the plan and makes zero state-changing requests
- error: missing file path → non-zero exit + clear message
- error: no active profile

## Files to add/modify

- **Add**: `packages/boxel-cli/src/commands/file/touch.ts`
- **Add**: `packages/boxel-cli/tests/integration/file-touch.test.ts`
- **Edit**: `packages/boxel-cli/src/commands/file/index.ts` (register the new subcommand)

## Test plan

- [ ] `pnpm --filter @cardstack/boxel-cli test:unit` passes
- [ ] `pnpm --filter @cardstack/boxel-cli test:integration` passes
- [ ] `pnpm --filter @cardstack/boxel-cli build` succeeds
- [ ] `boxel file touch --help` documents `--all` and `--dry-run`
- [ ] Manual: edit a `.gts` file in a staging realm, push, then `boxel file touch <realm-url> SomeCard/instance.json` and confirm the instance re-renders against the updated definition

## Verification

End-to-end: change a definition's field type, push, run `boxel file touch <realm> <Card>/<one-instance>.json` — the realm re-indexes that card type and subsequent reads reflect the new schema.

## Open questions

- Exact endpoint contract for "touch" (PATCH with empty body? `_touch`? `_atomic` no-op?) — read legacy `touch.ts` first thing.
- Whether `--all` should require explicit confirmation (the inspiration CLAUDE.md warns: "do NOT touch everything"). Default behaviour TBD; lean toward requiring `--yes` confirmation.
