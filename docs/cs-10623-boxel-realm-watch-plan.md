# CS-10623 — `boxel realm watch` review-feedback fixes

Linear: https://linear.app/cardstack/issue/CS-10623
Branch: `cs-10623-reimplement-boxel-realm-watch-command`
PR: https://github.com/cardstack/boxel/pull/4554 (draft)

## Context

PR #4554 has review feedback from `copilot-pull-request-reviewer` (6 line comments, 4 of them correctness blockers) and from a second-opinion review (lock-file mismatch with the plan doc, option-typing quirk, a few low-severity items). The implementation is mostly sound — `RealmWatcher` reuses `RealmSyncBase` / `CheckpointManager` / `SyncManifest` correctly, tests cover the obvious paths, and `watchRealms()` has a clean programmatic surface. What's left is a focused round of correctness fixes plus light cleanup before un-drafting.

## Scope decisions (settled in interview)

- **Lock file:** implement minimal `.boxel-watch.lock` (pid + start time) created on `watchRealms()` startup and removed in `cleanup()`. No cross-command coordination from this PR — `pull`/`push`/`sync` won't read the lock; that's a follow-up ticket if/when cross-command coordination is wanted.
- **Multi-realm CLI:** keep the CLI surface single-realm (`<realm-url> <local-dir>`). Trim "multi-realm support" wording from the PR description. Keep `watchRealms()`'s array-of-specs programmatic API for testing/future use.

## Plan

Five commits, ordered so each is independently reviewable. Tests added inline with the fix that motivated them.

### Commit 1 — correctness fixes (the four review blockers)

All in `packages/boxel-cli/src/commands/realm/watch.ts`.

**1a. Don't treat poll errors as "everything deleted"** _(Copilot, watch.ts:144)_

`RealmSyncBase.getRemoteMtimes()` (`realm-sync-base.ts:175-239`) wraps the fetch in a `try/catch` that returns an empty map on any failure. In the watcher this is interpreted as "every previously-known file is now deleted" and triggers `fs.unlink` on the whole local workspace.

Fix in the watcher rather than touching the base (push/pull/sync rely on the swallow-and-return-empty behavior for first-run UX). Override `getRemoteMtimes` in `RealmWatcher`:

```ts
protected override async getRemoteMtimes(): Promise<Map<string, number>> {
  const url = `${this.normalizedRealmUrl}_mtimes`;
  const response = await this.authenticator.authedRealmFetch(url, {
    headers: { Accept: 'application/vnd.api+json' },
  });
  if (!response.ok) {
    throw new Error(
      `_mtimes fetch failed: ${response.status} ${response.statusText}`,
    );
  }
  const data = (await response.json()) as {
    data?: { attributes?: { mtimes?: Record<string, number> } };
  };
  const mtimes = new Map<string, number>();
  for (const [fileUrl, mtime] of Object.entries(
    data.data?.attributes?.mtimes ?? {},
  )) {
    mtimes.set(fileUrl.replace(this.normalizedRealmUrl, ''), mtime);
  }
  return mtimes;
}
```

`tickAll`'s existing per-watcher `try/catch` (`watch.ts:391-399`) already turns poll errors into a logged warning rather than a teardown — that's the right behavior.

**1b. Snapshot `pendingChanges` before flushing** _(both — Copilot watch.ts:208)_

Lost-update race: `flushPending` iterates `pendingChanges`, awaits I/O per entry, then calls `pendingChanges.clear()` at the end. New changes recorded by an interleaved `poll()` get wiped.

```ts
async flushPending(): Promise<FlushResult> {
  if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null; }
  if (this.pendingChanges.size === 0) {
    return { pulled: [], deleted: [], checkpoint: null };
  }
  const drained = new Map(this.pendingChanges);
  this.pendingChanges.clear();
  // …iterate `drained` instead of `this.pendingChanges` for the rest of the method…
  for (const [file, info] of drained) { … }
  for (const [file, info] of drained) {
    if (info.status === 'deleted') this.lastKnownMtimes.delete(file);
    else this.lastKnownMtimes.set(file, info.mtime);
  }
  …
}
```

**1c. Serialize ticks** _(Copilot, watch.ts:417 — actually the `setInterval` at watch.ts ~423)_

Replace `setInterval(tickAll, intervalMs)` with a self-scheduling `setTimeout` chain so a slow tick can't be re-entered:

```ts
let stopped = false;
let timeoutId: NodeJS.Timeout | null = null;
const scheduleNextTick = () => {
  if (stopped) return;
  timeoutId = setTimeout(async () => {
    timeoutId = null;
    if (stopped) return;
    await tickAll();
    scheduleNextTick();
  }, intervalMs);
};
await tickAll();          // initial tick stays
scheduleNextTick();
```

Update `cleanup()` to clear `timeoutId` instead of `intervalId`. The `stopped` flag already exists.

**1d. Pending add/modify → deleted when remote disappears** _(Copilot, watch.ts:161)_

Today (`watch.ts:159`) the deletion sweep is gated on `!this.pendingChanges.has(file)`, so a queued add/modify keeps trying to download a now-missing file (404 in the next flush). Replace with:

```ts
if (!remoteMtimes.has(file)) {
  const pending = this.pendingChanges.get(file);
  if (pending?.status !== 'deleted') {
    this.pendingChanges.set(file, { status: 'deleted', mtime: 0 });
    hasNewChanges = true;
  }
}
```

**Tests added in this commit (`tests/integration/realm-watch.test.ts`):**
- _"a poll error does not delete local files"_: stub the watcher's `getRemoteMtimes` to throw once; previously-pulled files must remain on disk.
- _"a remote delete supersedes a pending modify"_: write file, poll, modify it remote, poll, delete it remote, poll, flush → result has `deleted: [file]` and `pulled: []`.

### Commit 2 — minimal lock file

Add `.boxel-watch.lock` per `localDir`. Contents:

```json
{ "pid": 12345, "startedAt": "2026-05-05T12:34:56.000Z", "realmUrl": "https://…/" }
```

- Acquire in `watchRealms()` before constructing watchers, after the empty-spec check. One lock per spec. If a lock already exists, read its pid: if `process.kill(pid, 0)` succeeds, return `{ watchers: [], error: 'A boxel realm watch process is already active for <localDir> (pid <n>)' }`. Otherwise the lock is stale — overwrite.
- Release in `cleanup()` for each watcher's `localDir`.
- Lock-file path lives next to `.boxel-sync.json` (i.e. `${localDir}/.boxel-watch.lock`); add a tiny `lib/watch-lock.ts` helper with `acquire(localDir, info)` / `release(localDir)` so the logic isn't inline in `watch.ts`.

**Tests:** `tests/integration/realm-watch.test.ts`
- _"second watchRealms call against the same localDir returns an error"_: start one with an `AbortController`, attempt a second concurrent run, expect `result.error` to mention `pid`.
- _"stale lock from a non-existent pid is overwritten"_: write a lock referencing pid `999999`, run `watchRealms`, expect success and the lock to be replaced.

### Commit 3 — single-realm CLI cleanup + PR description

- Remove the "Multi-realm support" bullet from the PR description.
- Update the inline doc comments on `watchRealms()` (`watch.ts:306-310`) to clarify the array-of-specs API is programmatic only.
- Remove the stale `## Plan doc` line from the PR description (the doc was deleted in `c6076cfe00`; this re-adds it under a different name — link the new one).
- Resolve the "boxel stop — open question" section in the PR description: with the lock file landing in commit 2, the recommendation ("rely on Ctrl+C; lock file makes 'is watch running' detectable") is now consistent with the code.
- Resolve `--realm-secret-seed` per-spec note in the lib doc — explicitly call out that the CLI passes a single spec, so the single-tenant authenticator resolution is intentional.

### Commit 4 — code cleanups

**4a. Drop `WatcherInternalOptions`.** Pass `{ realmUrl, localDir }` to `super()`; keep `debounceMs` / `quiet` only as instance fields. (`watch.ts:49-79`.)

**4b. Make `persistManifest` O(changed files)** _(Copilot, watch.ts:276)_. Load the prior manifest at the start of the method, mutate just the entries in the current flush's `drained` (rehash pulled files, drop deleted ones, advance `remoteMtimes`), and write back. Files unchanged this flush keep their stored hash without a re-read.

**4c. Remove duplicate `_mtimes` probe in `initialize()`** _(watch.ts:108-117)_. With commit 1a, the first `poll()` already throws on access failure with a meaningful error, so the probe is redundant. Keep the manifest seeding portion.

**4d. TTY-aware colors.** Audit `lib/colors.ts` — if it doesn't already check `process.stdout.isTTY`, add the check there once (so all sibling commands inherit the fix), then `watch.ts` is automatically clean.

### Commit 5 — nits & clean up

- `realm-watch.test.ts:80`: `let localDirs` → `const localDirs`.
- `watch.ts:419-422`: split `sigtermHandler` into its own closure for readability.
- Run `pnpm --filter @cardstack/boxel-cli lint` after each commit; resolve any new warnings.

## Files modified

- `packages/boxel-cli/src/commands/realm/watch.ts` — commits 1, 3, 4, 5.
- `packages/boxel-cli/src/lib/watch-lock.ts` — **new**, commit 2.
- `packages/boxel-cli/src/lib/colors.ts` — possibly commit 4d.
- `packages/boxel-cli/tests/integration/realm-watch.test.ts` — commits 1, 2.
- `docs/cs-10623-boxel-realm-watch-plan.md` — this file (added now, deleted with the final implementation commit per the project convention).
- PR description (via `gh pr edit 4554 --body …`) — commit 3.

## Test plan

- `pnpm --filter @cardstack/boxel-cli test:integration` — existing 7 tests + 4 new ones (poll-error-doesn't-delete, delete-supersedes-pending, second-watch-blocked, stale-lock-overwritten).
- `pnpm --filter @cardstack/boxel-cli build` — clean type-check after `WatcherInternalOptions` removal.
- `pnpm --filter @cardstack/boxel-cli lint` — clean.

## Verification

End-to-end against a staging realm:

1. `boxel realm watch <staging-url> <localDir>` → confirm header logs, `.boxel-watch.lock` appears in `localDir`, manifest `.boxel-sync.json` written.
2. Edit a card via Boxel web UI → file lands locally within ~30s, `.boxel-history/` gets a `[remote]` checkpoint.
3. Open a second `boxel realm watch <staging-url> <localDir>` in another terminal → expect the "already active" error referencing the first pid.
4. Kill the realm server mid-watch → tick logs a poll error, **no local files are deleted**, lock file stays. Restart the realm; next tick recovers.
5. Ctrl+C the watch → lock file removed, "Watch stopped" log, exit code 0.

## Out of scope (follow-up tickets)

- Cross-command coordination on the lock file (pull/push/sync warning when watch is active). Worth a Linear ticket if/when desired.
- Multi-realm CLI surface (variadic args). Programmatic `watchRealms` keeps the array shape so a future ticket can wire the CLI without re-architecting.
- `deriveRealmName` robustness for edge URLs (root path, single-segment).
