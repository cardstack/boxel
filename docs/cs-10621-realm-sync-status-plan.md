# CS-10621 — Reimplement `boxel realm sync status`

Linear: https://linear.app/cardstack/issue/CS-10621/reimplement-boxel-realm-sync-status-command

## Context

Ports the `status` command from the standalone `boxel-cli` repo into the monorepo's `@cardstack/boxel-cli`. This is the read-only inspector — `git status` for a Boxel realm sync — that shows pending changes between a local sync directory and its remote realm without committing to any direction.

The monorepo already has `sync`, `push`, `pull` (all with `--dry-run`). `status` is intentionally overlapping but not redundant:

- Clearer read-only intent than `sync --dry-run`.
- `--pull` shortcut that fast-forwards only the safe one-way subset (won't clobber unsynced local edits).
- `--all` fleet view across multiple local sync dirs.

## CLI shape

```
boxel realm sync status [local-dir]
boxel realm sync st [local-dir]           # alias

Options:
  --pull                       Download safe remote changes and update manifest
  --all                        Recursively report all .boxel-sync.json dirs under cwd
  --realm-secret-seed          Administrative auth (env: BOXEL_REALM_SECRET_SEED)
```

`--all` and `--pull` are mutually exclusive — reject the combination with a clear error.

## Files

| Path | Action |
|---|---|
| `packages/boxel-cli/src/commands/realm/status.ts` | **new** — the command |
| `packages/boxel-cli/src/commands/realm/sync.ts` | modify `registerSyncCommand` to return the created `Command` |
| `packages/boxel-cli/src/commands/realm/index.ts` | capture returned sync command, pass to `registerStatusCommand(sync)` |
| `packages/boxel-cli/tests/integration/realm-sync-status.test.ts` | **new** — vitest integration tests |

No new lib helper — `lib/sync-logic.ts` and `lib/sync-manifest.ts` already cover the diff + manifest plumbing. `RealmSyncBase` provides `getRemoteMtimes`, `getLocalFileListWithMtimes`, `downloadFile`, URL normalization.

## Module structure

```ts
class RealmStatusInspector extends RealmSyncBase {
  async sync(): Promise<StatusResult>   // classify + render + optional pull
}

export interface StatusEntry {
  file: string;
  status: 'new-remote' | 'modified-remote' | 'new-local' | 'modified-local'
        | 'conflict' | 'deleted-local' | 'deleted-remote';
}

export interface StatusResult {
  localDir: string;
  realmUrl: string;
  manifestMtime?: number;          // fs.stat(.boxel-sync.json).mtimeMs — last-sync proxy
  changes: StatusEntry[];
  pulled: string[];                // populated only with options.pull
  inSync: boolean;
  hasError: boolean;
  error?: string;
}

export interface StatusAllResult {
  workspaces: Array<StatusResult & { skipped?: 'no-manifest' | 'malformed' | 'fetch-failed' }>;
  hasError: boolean;
}

export async function status(localDir: string, options: StatusCommandOptions): Promise<StatusResult>;
export async function statusAll(rootDir: string, options: StatusCommandOptions): Promise<StatusAllResult>;
export function registerStatusCommand(sync: Command): void;
```

## Classification mapping

Use `{localStatus, remoteStatus}` from `classifyLocal` / `classifyRemote` (not the collapsed `SyncAction`, which would drop the new-vs-modified distinction).

| local | remote | user-facing |
|---|---|---|
| unchanged | added | `new-remote` |
| unchanged | changed | `modified-remote` |
| added | unchanged | `new-local` |
| changed | unchanged | `modified-local` |
| changed | changed | `conflict` |
| added | added | `conflict` |
| changed | added | `conflict` |
| added | changed | `conflict` |
| deleted | changed | `conflict` |
| changed | deleted | `conflict` |
| unchanged | deleted | `deleted-remote` |
| deleted | unchanged | `deleted-local` |
| added | deleted | `new-local` |
| deleted | added | `new-remote` |
| unchanged | unchanged | (skip) |
| deleted | deleted | (skip) |

## `--pull` flow

1. Classify normally.
2. Render the full diff (all categories) first.
3. `toPull = classifications.filter(c => c.action === 'pull').map(c => c.relativePath)` — excludes `pull-delete` and `conflict` by design (the safe one-way subset).
4. If `!options.pull || toPull.length === 0`, return without writing.
5. For each `rel`, call `this.downloadFile(rel, abs)`. On per-file error: log, set `hasError`, **continue**. On success: append to `pulled`, recompute `manifest.files[rel] = computeFileHash(abs)`, set `manifest.remoteMtimes![rel] = remoteMtimes.get(rel)`.
6. `saveManifest(localDir, updatedManifest)`.

Do **not** re-fetch `_mtimes` after the pulls — preserves the original snapshot so concurrent server edits are surfaced as `changed` on the next status.

## `--all` walker

Recursive scan from cwd (or the explicit root passed to `statusAll`):

- Skip dirs: `node_modules`, `.git`, `.boxel-history`, `.cache`, `.vscode`, `dist`, `build`, `tmp`.
- Depth limit: 6 (override with `BOXEL_STATUS_ALL_MAX_DEPTH` env).
- When a directory contains `.boxel-sync.json`, record it and **do not descend further**.
- Sort results lexicographic by `localDir`.
- Per workspace: call `status(dir, options)` but continue on error. Failures bucket as `skipped: 'malformed' | 'no-manifest' | 'fetch-failed'`. `hasError` rolls up.

Per-workspace render uses the monorepo's existing color style (`FG_GREEN`, `FG_CYAN`, `FG_YELLOW`, `DIM` from `lib/colors.ts`).

## Subcommand attachment

```ts
// sync.ts
export function registerSyncCommand(realm: Command): Command {
  const sync = realm.command('sync')...;
  return sync;
}

// realm/index.ts
const sync = registerSyncCommand(realm);
registerStatusCommand(sync);

// status.ts
sync.command('status').aliases(['st'])
  .description('Show pending changes between a local sync dir and its realm')
  .argument('[local-dir]', 'Local sync directory (defaults to cwd)')
  .option('--pull', 'Download safe remote changes and update manifest')
  .option('--all', 'Recursively report all .boxel-sync.json dirs under cwd')
  .option('--realm-secret-seed', '...')
  .action(...)
```

Commander supports a parent command with both an action and subcommands. `boxel realm sync status` routes to the subcommand; `boxel realm sync <dir> <url>` continues to route to the parent action (no breaking change).

## Exit codes

Align with `sync.ts` precedent:

- `0` — success (in-sync, diff-only, or pull completed). **"Diff present" stays zero** so scripting (`if boxel realm sync status; then ...`) keeps working.
- `1` — config error (missing manifest, auth failure, mutually-exclusive flag combo).
- `2` — partial failure (some `--pull` downloads failed).

## Pitfalls

- **mtime units** — `getRemoteMtimes()` returns seconds-epoch; `fs.stat().mtimeMs` is milliseconds. Status compares remote mtime to `manifest.remoteMtimes[rel]` (both seconds) inside the classifier — no conversion needed there. If we print a remote mtime, `* 1000` first.
- **No `lastSyncTime` in monorepo manifest** — use `fs.stat('.boxel-sync.json').mtimeMs` as a proxy, label it `Manifest updated:`.
- **URL normalization** — pass `manifest.realmUrl` straight into `RealmSyncBase`; its constructor calls `normalizeRealmUrl`. Don't pre-normalize.
- **`.boxel-sync.json` and `.realm.json`** — `getLocalFileList` excludes the manifest; `isProtectedFile` excludes `.realm.json`. Both correctly stay out of classifications.
- **Malformed manifest** — `loadManifest` returns `null` and warns. Single-dir status treats this as "missing manifest". `--all` walker buckets as `skipped: 'malformed'`.
- **Seed auth + `--all`** — construct a fresh `RealmAuthenticator` per workspace (matches `pull.ts`).
- **`--pull` with zero safe pulls** — print `Nothing to pull.`, do **not** call `saveManifest` (would bump manifest mtime, polluting our `Manifest updated:` proxy).
- **`--all --pull` combo** — rejected with `Cannot use --pull with --all`.

## Tests

`tests/integration/realm-sync-status.test.ts`, vitest. Reuse `startTestRealmServer`, `setupTestProfile`, `createTestRealm`, `writeLocalFile`, `readManifest`, `authedRealmFetch` from `tests/integration/realm-sync.test.ts`.

1. Clean sync → `inSync: true`, `changes === []`.
2. New remote file → single `new-remote`.
3. Modified remote file → `modified-remote`.
4. New local file → `new-local`.
5. Modified local file → `modified-local`.
6. Conflict (modify both sides) → `conflict`.
7. Delete local → `deleted-local`.
8. Delete remote → `deleted-remote`.
9. `--pull` with new-remote + modified-remote → `pulled = [...]`, files written, manifest updated, second `status()` is clean.
10. `--pull` leaves conflicts untouched.
11. `--pull` with zero safe pulls → exits cleanly, manifest mtime unchanged.
12. Missing manifest → `error: /No \.boxel-sync\.json/`, no throw.
13. Defaults to cwd → pass explicit `localDir`; verify no `process.chdir` is needed.
14. `--all` walker discovers three sync dirs in a temp root, ignores one nested under `node_modules`, results sorted.
15. `--all` with one malformed manifest → other dirs still processed, malformed has `skipped: 'malformed'`.
16. CLI alias — `program.parseAsync(['node','boxel','realm','sync','st', dir])` resolves identically to `status`.
17. `--all --pull` → rejected with clear error.

## Verification

From `packages/boxel-cli/`:

```sh
pnpm test tests/integration/realm-sync-status.test.ts
pnpm test                                         # regression check, esp. realm-sync.test.ts
pnpm tsc --noEmit
pnpm lint
```

Manual smoke against a local realm:

```sh
boxel realm sync status                           # in sync
echo "x" >> some-file.gts
boxel realm sync status                           # modified-local
boxel realm sync st                               # alias
boxel realm sync <dir> <url>                      # parent action unaffected
cd .. && boxel realm sync status --all
boxel realm sync status --pull --all              # rejected
```
