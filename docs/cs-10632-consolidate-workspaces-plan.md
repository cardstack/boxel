# CS-10632 — Reimplement `boxel consolidate-workspaces`

## Context

The legacy `boxel-cli` (standalone repo) ships a `boxel consolidate-workspaces` command — a **purely local** filesystem migration tool that re-homes scattered local realm mirror directories into a structured `<root>/<domain>/<owner>/<realm>/` layout.

It walks `<root>`, finds every `.boxel-sync.json` (the manifest `boxel realm pull/sync/push` writes at the root of each local mirror), and computes the canonical destination path from the realm URL stored in the manifest. The command never talks to the realm server.

CS-10632 is the port of that command into the monorepo CLI at `packages/boxel-cli/` as part of the umbrella project "Incorporate Boxel CLI to Monorepo" (parent: CS-10519).

## Decisions

- **Command name and placement:** keep verbatim as `boxel consolidate-workspaces [root-dir]` at top-level (not under `boxel realm` — this command acts on the local filesystem layout, not on a realm).
- **Manifest schema:** recognise the monorepo manifest's `realmUrl` field only. Drop the legacy `workspaceUrl` field entirely; the monorepo deliberately avoids "workspace" terminology in favour of "realm".
- **Warn hook in scope:** also port `warnIfLegacyWorkspacePaths` (renamed `warnIfMisplacedLocalRealmDirs`) and wire it into the program's `preAction` hook so every command surfaces the nudge.
- **Lib filename:** `src/lib/realm-local-paths.ts`.
- **Tests:** separate lib tests + command tests.

## Files

### Create — `packages/boxel-cli/src/lib/realm-local-paths.ts`

- `MisplacedLocalRealmEntry` type — `{ manifestPath, currentDir, expectedDir, realmUrl }`
- `relativeStructuredPathForRealmUrl(realmUrl): string` — `<domain>/<owner>/<realm>`
- `absoluteStructuredPathForRealmUrl(realmUrl, rootDir): string`
- `findMisplacedLocalRealmDirs(rootDir): MisplacedLocalRealmEntry[]` — scans both legacy `<root>/<realm>/.boxel-sync.json` and canonical `<root>/<domain>/<owner>/<realm>/.boxel-sync.json` layouts
- `warnIfMisplacedLocalRealmDirs(rootDir): void` — process-level dedup, env override `BOXEL_DISABLE_PATH_WARNING=1`, **also bails under `isQuiet()`**
- `canonicalDomainFromHost(hostname)` — `*.stack.cards` → `stack.cards`, `*.boxel.ai` → `boxel.ai`, otherwise passthrough
- Skippable-dirs filter for `.git`, `node_modules`, `dist`, `.boxel-history`, `.claude`
- Manifest type guard reads only `realmUrl: string` so partially-corrupt manifests still detect

### Create — `packages/boxel-cli/src/commands/consolidate-workspaces.ts`

Pattern follows `src/commands/realm/wait-for-ready.ts` (Commander register + exported impl for testability):

- `registerConsolidateWorkspacesCommand(program)` and `consolidateWorkspacesCommand(rootDirInput, options)`
- `boxel consolidate-workspaces [root-dir]` with `--dry-run`
- Move semantics: `fs.renameSync` with `EXDEV` fallback to `cpSync` + `rmSync`
- Skip when target exists; final tally summary
- Uses `console.log` / `console.warn` (decorative output, silenced under `--quiet` per `cli-log.ts` guidance)

### Create — `packages/boxel-cli/tests/lib/realm-local-paths.test.ts`

Vitest, real tmpdir fixtures.

### Create — `packages/boxel-cli/tests/commands/consolidate-workspaces.test.ts`

Vitest, real tmpdir fixtures + monkey-patched `fs.renameSync` for the `EXDEV` path.

### Edit — `packages/boxel-cli/src/build-program.ts`

- Import and register the new command
- Extend the existing `preAction` hook with `warnIfMisplacedLocalRealmDirs(process.cwd())`, after `setQuiet` so the warn-hook respects `--quiet`

## Verification

1. `cd packages/boxel-cli && pnpm install`
2. `cd packages/boxel-cli && pnpm test`
3. `cd packages/boxel-cli && pnpm build`
4. Fixture smoke (`mktemp` tree → `--dry-run` then real → check destination)
5. Warn-hook dedup + `--quiet` silencing
