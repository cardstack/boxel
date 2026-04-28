# CS-10620 — Reimplement `boxel realm list` command

Linear: https://linear.app/cardstack/issue/CS-10620
Branch: `cs-10620-reimplement-boxel-realm-list-command`
Parent: CS-10519 (Incorporate Boxel CLI to Monorepo)

## Context

Port the `boxel realm list` command (originally in the standalone `cardstack/boxel-cli` repo) into the monorepo's `packages/boxel-cli`. Listing realms is needed by the factory to discover existing realms, and unblocks the Claude Code plugin (CS-10900) onboarding skill which can't say "verify your account by listing your realms" without it.

## Current state

- Monorepo `packages/boxel-cli/src/commands/realm/index.ts` registers: `cancel-indexing`, `create`, `pull`, `push`, `sync`, `wait-for-ready`. **No `list` subcommand exists.**
- Legacy implementation: `/Users/fadhlanridhwanallah/Documents/Cardstack/Repo/boxel-cli/src/commands/list.ts` (227 lines) — port reference.
- Canonical pattern in monorepo: `packages/boxel-cli/src/commands/realm/wait-for-ready.ts` — single-file command with exported core function + `register<Name>Command(parent)`.

## Plan

### 1. New file `packages/boxel-cli/src/commands/realm/list.ts`

- Export an async core function `listRealms(options?: ListRealmsOptions): Promise<ListRealmsResult>`.
  - `ListRealmsOptions`: `{ allAccessible?: boolean; hidden?: boolean; profileManager?: ProfileManager }`.
  - `ListRealmsResult`: `{ realms: RealmSummary[]; error?: string }`.
- Auth: `getProfileManager()` then `pm.authedRealmServerFetch(...)` (server-scoped JWT, not per-realm).
- Endpoint: hit the realm-server endpoint that returns the user's accessible realms — port from legacy `list.ts`. Likely `/_realm-auth` for `--all-accessible` and the standard user-realms endpoint otherwise.
- Filter logic for `--hidden`: realms accessible via `_realm-auth` but not exposed in the UI realm list.
- Export `registerListCommand(realm: Command): void` adding the `list` subcommand with alias `ls`.
- Options: `--json`, `--all-accessible`, `--hidden`. Mutually-exclusive validation if needed.
- Output: pretty table by default (use existing color utilities `lib/colors.ts`); JSON when `--json`.

### 2. Wire into `packages/boxel-cli/src/commands/realm/index.ts`

```ts
import { registerListCommand } from './list';
// ...
registerListCommand(realm);
```

### 3. Tests at `packages/boxel-cli/tests/integration/realm-list.test.ts`

Per CS-10852/10853 precedent — use **real realm endpoints**, not mocks. Cover:
- table format default
- `--json` outputs valid JSON
- `--all-accessible` includes hidden realms
- `--hidden` filters to hidden-only
- error path: no active profile → `NO_ACTIVE_PROFILE_ERROR`
- error path: realm-server auth failure

## Files to add/modify

- **Add**: `packages/boxel-cli/src/commands/realm/list.ts`
- **Add**: `packages/boxel-cli/tests/integration/realm-list.test.ts`
- **Edit**: `packages/boxel-cli/src/commands/realm/index.ts` (register the new subcommand)

## Test plan

- [ ] `pnpm --filter @cardstack/boxel-cli test:unit` passes
- [ ] `pnpm --filter @cardstack/boxel-cli test:integration` passes (against staging realm)
- [ ] `pnpm --filter @cardstack/boxel-cli build` succeeds
- [ ] `boxel realm list --help` shows the new subcommand under `boxel realm`
- [ ] Manual: `boxel realm list` against staging — table renders; `--json` parses; `--all-accessible` and `--hidden` filter as documented

## Verification

End-to-end: `boxel realm ls --json | jq '.[].url'` returns all accessible realm URLs for the active profile.

## Open questions

- Confirm exact realm-server endpoints used by legacy `list.ts` before porting (e.g. `_realm-auth` vs an alternative). Resolve by reading the legacy source first thing.
