# CS-10624 — Reimplement `boxel realm watch stop`

## Goal

Bring the standalone `boxel-cli`'s `boxel stop` capability into `packages/boxel-cli/` as `boxel realm watch stop`. Stops all running `boxel realm watch` processes gracefully; safe no-op when nothing is running.

CS-10623 already landed `boxel realm watch <url> <dir>` here, but there is currently no way to stop a running watch other than Ctrl+C in the foreground TTY — a problem for skills/scripts that spawn `realm watch` in the background.

## Design decisions

- **Discovery**: new central process registry at `~/.boxel-cli/watch-processes.json`. The per-dir `.boxel-watch.lock` file (already in place via `src/lib/watch-lock.ts`) stays unchanged — it remains the source of truth for race protection within a single directory and is visible locally inside the watched dir.
- **Command shape**: convert `realm watch` into a command group. Move the existing single `watch.ts` into a new `realm/watch/` directory split into `start.ts` (today's behavior) and `stop.ts` (new). **Breaking CLI change** for consumers that call `boxel realm watch <url> <dir>` directly — they must call `boxel realm watch start <url> <dir>`.
- **Scope**: watch only. The monorepo will not get a `track` command; the registry stores `{ pid, workspace, startedAt }` with no `type` field.
- **Defense in depth**: `stop` uses the registry as its primary discovery path, with a `ps aux` fallback (Unix only) to catch processes started before this PR landed, processes spawned under a different `HOME`, or registry skew.

## Implementation outline

### 1. New file: `src/lib/watch-process-registry.ts`

Async `fs/promises`, atomic writes (temp file + rename). Exports:

- `interface RegisteredProcess { pid: number; workspace: string; startedAt: string; }`
- `registerProcess(workspace)` — prunes dead PIDs, removes any prior entry for `process.pid`, appends the new one.
- `unregisterCurrentProcess()` — drops `process.pid`. No-op if missing.
- `listRegisteredProcesses()` — prunes dead PIDs, persists, returns alive list.

Liveness check reuses the `process.kill(pid, 0)` / `EPERM` pattern from `watch-lock.ts`.

### 2. Restructure `src/commands/realm/watch.ts` into a directory

```
src/commands/realm/watch/
  index.ts   — registerWatchCommand: creates the `watch` group, wires start + stop
  start.ts   — body of today's watch.ts (registerStartCommand + watchRealms + RealmWatcher)
  stop.ts    — registerStopCommand + stopWatchProcesses
```

`watchRealms()` (in `start.ts`) gains `registerProcess` after watcher initialization and `unregisterCurrentProcess` inside its existing `cleanup` closure (alongside the existing `releaseWatchLock` calls). Both wrapped in try/catch — registry failures must never block the watch or its lock cleanup.

### 3. `realm/watch/stop.ts` handler

1. **Registry pass**: signal each registered PID (SIGINT on Unix; on Windows fall back to `taskkill /PID … /F` if `process.kill` fails).
2. **`ps aux` fallback (Unix only)**: scan the process table for `realm watch start` processes whose PIDs we haven't already signaled, send SIGINT to each. Pattern excludes `stop` to avoid self-targeting.
3. **Settle and re-prune**: brief sleep so each watch's SIGINT handler runs, then re-list the registry to prune anything left behind.
4. **Output**: `⇅ Stopped: boxel realm watch <workspace> (PID <pid>)` per process; final `✓ Stopped N process(es)`. Empty: `No running watch processes found.` Exit code: always `0`.

## Files modified / added

- `src/lib/watch-process-registry.ts` — new
- `src/lib/watch-lock.ts` — optionally export `isProcessAlive` for reuse
- `src/commands/realm/watch.ts` → `src/commands/realm/watch/start.ts` (renamed export, `.command('watch')` → `.command('start')`, register/unregister hooks)
- `src/commands/realm/watch/index.ts` — new (group registration)
- `src/commands/realm/watch/stop.ts` — new
- `tests/commands/realm-watch-stop.test.ts` — unit tests for registry + empty-stop
- `tests/integration/realm-watch-stop.test.ts` — end-to-end stop test
- `tests/integration/realm-watch.test.ts` — update import to `realm/watch/start`

## Testing

Vitest, run via `pnpm test` from `packages/boxel-cli`.

**Unit** (`tests/commands/realm-watch-stop.test.ts`): override `process.env.HOME` to `mkdtempSync` so the registry is isolated. Cover: write/replace/remove for `registerProcess`/`unregisterCurrentProcess`, dead-PID pruning in `listRegisteredProcesses`, empty `stopWatchProcesses` returns `{ stopped: [], failed: [] }` and prints "No running watch processes found.".

**Integration** (`tests/integration/realm-watch-stop.test.ts`): spawn a real `realm watch start` subprocess against the test realm server (reusing `realm-watch.test.ts` helpers). Override the child's `HOME` to a per-test temp dir. Wait for the registry to record the PID, then call `stopWatchProcesses()` and assert the child exits, the `.boxel-watch.lock` is cleaned up, and the registry no longer contains the PID. Edge cases: cold start (no watchers), dead-PID-in-registry, and `ps aux` fallback (Unix-only — registry write disabled, child still found).

## Verification

```bash
cd packages/boxel-cli
pnpm lint
pnpm test
```

Smoke test with two terminals: start `realm watch start <url> /tmp/watch-smoke` in one, run `realm watch stop` in the other, observe the watcher exit cleanly with the lockfile removed. Cold no-op: run `realm watch stop` with nothing running and observe "No running watch processes found." (exit 0).
