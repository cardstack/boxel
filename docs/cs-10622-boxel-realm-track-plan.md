# CS-10622: Reimplement `boxel realm track` command

## Goal

Port the legacy `boxel track` command from the standalone `boxel-cli` repo into the monorepo at `packages/boxel-cli`, namespaced as `boxel realm track`. Track is the **write-side** counterpart to `boxel realm watch` (CS-10623): it watches the local filesystem, debounces edits, creates checkpoints in `.boxel-history/`, and with `--push` batch-uploads add/update changes to the realm via `/_atomic`. The marquee workflow is collaborative card editing — a developer (or Claude Code) edits locally with `track --push` running, while teammates see updates in the web UI.

## Branch / dependency

- Branch: `cs-10622-reimplement-boxel-realm-track-command`.
- Based on `cs-10623-reimplement-boxel-realm-watch-command` (PR #4554) — track depends on `RealmSyncBase`, `RealmAuthenticator`, `CheckpointManager`, the `realm` command group, and a generalized lock module that lands in this PR.
- Targets `main` once #4554 merges; will rebase.

## Design decisions

1. **Push is in scope.** Single PR ships local tracking + `--push` together.
2. **Hybrid change detection.** mtime+size on the 2s poll triggers the debounce; `computeFileHash` runs once per pending file before checkpoint creation, dropping no-op saves (editor touched-but-content-identical) without paying hash cost on every poll tick.
3. **Generalized sync-lock with bidirectional cross-guard.** `watch-lock.ts` is renamed to `sync-lock.ts` and parameterized by a `kind: 'watch' | 'track'`. Both watch and track call `acquireSyncLock`; both refuse if the *other* kind is held by a live PID. Prevents the track+watch infinite loop on the same dir.
4. **Defer deletions on `--push`** (legacy parity). `op: 'remove'` is defined in `runtime-common/atomic-document.ts` but **not implemented** server-side — `filterAtomicOperations` strips no-data ops and the atomic handler only iterates add/update. Implementing it server-side is a sizable change to `runtime-common/realm.ts` (validation, dispatch, indexing/invalidation hooks) and out of scope for a CLI port. Track's `--push` cycle uploads adds/updates only. A locally-deleted file still produces a local `[deleted]` checkpoint entry but emits a `[VERBOSE] Skipping delete on push (deferred)` log. Filed as follow-up.
5. **Inline push using `uploadFilesAtomic()` as-is.** `RealmTracker extends RealmSyncBase` and calls the existing `uploadFilesAtomic(files, addPaths)` method directly — no signature change. `RealmPusher` stays untouched.
6. **Sort ops .gts-first within the single atomic doc.** `uploadFilesAtomic` preserves Map insertion order in the operations array, so a sorted input Map satisfies the legacy `.gts before .json` requirement without splitting batches or changing the server.
7. **Manifest is required for `--push`.** Track is a streaming-edit tool, not an initial-sync tool. Pre-flight refuses if `.boxel-sync.json` is missing or points at a different realm; the operator runs `boxel realm sync` first.
8. **Auth is lazy.** Without `--push`, no authenticator is resolved — tracker is local-only. With `--push`, the authenticator is resolved via `resolveRealmAuthenticator` and a single `getRemoteFileList('')` call at startup smoke-tests it, mirroring legacy track's startup JWT check.

## Files

### New
- `packages/boxel-cli/src/lib/sync-lock.ts` — generalized lock module with `LockKind`, `acquireSyncLock(localDir, kind, realmUrl)`, `releaseSyncLock(localDir, kind)`, `readSyncLock(localDir, kind)`. Bidirectional cross-guard built into `acquireSyncLock`.
- `packages/boxel-cli/src/commands/realm/track.ts` — `RealmTracker extends RealmSyncBase`, `trackRealms(specs, options)` orchestrator, `registerTrackCommand(realm)` Commander wiring with `-i`, `-d`, `-q`, `-p`, `-v`, `--realm-secret-seed`.
- `packages/boxel-cli/tests/integration/realm-track.test.ts` — integration suite covering local behavior, `--push`, and locks.

### Modified
- `packages/boxel-cli/src/lib/watch-lock.ts` — **deleted**, replaced by `sync-lock.ts`.
- `packages/boxel-cli/src/commands/realm/watch.ts` — imports updated to `sync-lock`, lock acquisition passes `'watch'` kind, error message handles the cross-guard `track` conflict case.
- `packages/boxel-cli/src/commands/realm/index.ts` — registers `track` command.
- `packages/boxel-cli/tests/integration/realm-watch.test.ts` — adds two cross-guard cases: refuses when track is live, ignores stale track lock.

### Reused (no changes)
- `packages/boxel-cli/src/lib/realm-sync-base.ts` — `getRemoteFileList`, `getRemoteMtimes`, `uploadFilesAtomic`, `buildFileUrl`, `isProtectedFile`.
- `packages/boxel-cli/src/lib/checkpoint-manager.ts` — `createCheckpoint('local', changes)`, `init`, `isInitialized`.
- `packages/boxel-cli/src/lib/sync-manifest.ts` — `loadManifest`, `saveManifest`, `computeFileHash`.
- `packages/boxel-cli/src/lib/auth-resolver.ts` — `resolveRealmAuthenticator`.
- `packages/boxel-cli/src/lib/prompt.ts` — `resolveRealmSecretSeed`.

## Test plan

`pnpm --filter @cardstack/boxel-cli test:integration -- realm-track` covers:

**Local behavior** (no `--push`):
1. Detects an added file, writes a local checkpoint.
2. Detects a modification, writes a local checkpoint.
3. Detects a deletion, writes a local checkpoint.
4. Coalesces a burst of edits into one debounced checkpoint.
5. Defers a second batch when min-interval has not elapsed.
6. Hash-gates a noop modify when the manifest has the same hash.

**`--push`**:
7. Uploads adds/updates via `/_atomic`, then updates the manifest.
8. Orders `.gts` modules before `.json` instances inside the atomic POST.
9. Skips deletions on push, recording them in the local checkpoint only.
10. Fails fast when `--push` is enabled but no manifest exists.
11. Retains entries whose push fails (e.g. concurrent 409) for the next cycle.

**Locks and orchestration**:
12. Blocks a second concurrent track against the same `localDir`.
13. Refuses to start when a live watch lock exists at the same `localDir`.
14. Overwrites a stale track lock from a process that no longer exists.
15. Flushes pending changes before exit when the abort signal fires.

## Verification

1. `pnpm --filter @cardstack/boxel-cli test:integration` — realm-track suite green.
2. `pnpm --filter @cardstack/boxel-cli build` succeeds.
3. `boxel realm track --help` documents `-i`, `-d`, `-q`, `-p`, `-v`, `--realm-secret-seed`.
4. **Manual smoke against staging:**
   - `boxel realm sync ./scratch/ <staging-url>` (establishes manifest).
   - `boxel realm track ./scratch/ <staging-url> --push -v`.
   - Edit a `.gts` and matching `.json`; within `debounce + interval` confirm: local checkpoint logged, atomic POST visible in verbose output with `.gts` op listed first, manifest hash updated.
   - In a second terminal: `boxel realm watch <staging-url> ./scratch/` → refuses with `.boxel-track.lock` conflict.
   - Delete a file locally; confirm checkpoint logs `deleted` and verbose log shows `Skipping delete on push (deferred)`. Remote file remains.
   - Ctrl+C; confirm pending changes flushed, lock released, exit 0.

## Open follow-ups (not this PR)

- **Implement server-side `op: 'remove'`** in `runtime-common/realm.ts`. Bypass `filterAtomicOperations` for remove ops, validate target existence, dispatch through the realm adapter's delete + indexing path, add tests in `packages/realm-server/tests/atomic-endpoints-test.ts`. Once that lands, both `RealmTracker.pushDrained` and `RealmPusher` (the `--delete` path at `push.ts:244-253`) migrate to atomic remove.
- `boxel realm stop` (CS-10624) — once track lands its lock, stop becomes a kill-switch over `.boxel-track.lock` and `.boxel-watch.lock` discovery sources.
