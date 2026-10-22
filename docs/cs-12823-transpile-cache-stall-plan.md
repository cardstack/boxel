# CS-12823: transpile-cache misses stall the realm-server event loop

## Goal

A module request that misses the transpile cache must not block the realm-server's event loop. Today one miss blocks it for as long as the file takes to compile: 8–16 s for a large generated file, and the sum of thousands of misses after a reindex wipe. While it is blocked, every other request on that task waits, including published-site page loads.

## What the code does today

- A `GET` of a `.js`/`.gjs`/`.ts`/`.gts` file with `Accept: */*` reaches `Realm.fallbackHandle` → `loadModuleFromDisk` → `#transpileModuleDeduped` → `#transpileWithLayers` (`runtime-common/realm.ts`).
- Every file with an executable extension is transpiled. There is no size limit and no exclusion for minified or generated files.
- `transpileJS` (`runtime-common/transpile.ts`) runs content-tag, then babel with five plugins. `babel.transformAsync` (CS-9745) made the API asynchronous, but parse, traverse and generate still run on the calling thread. Nothing in the path runs off the main thread.
- After the transpile, `extractModuleDependencyKeys` parses the output again, also synchronously.
- **L1** (`#transpiledModuleCache`) is an unbounded in-process map. An L1 hit is served without checking the file again.
- **L2** (`module_transpile_cache`, UNLOGGED) is shared by all replicas. An L2 row is used only if its ETag matches the one the request builds from the current file fingerprint. So L2 already validates itself against the file's content.
- Every from-scratch index ends with a wildcard `NOTIFY realm_file_changes '<realm>:*'` (`tasks/indexer.ts`). Every replica that receives it clears L1 and tombstones all of the realm's L2 rows (`#dropAllTranspiledModuleCacheEntries`). Bootstrap realms also do this on every replica boot.
- The transpiler version is not part of the L2 key or the ETag (`MODULE_ETAG_VARIANT = 'module'`). The reindex wipe is therefore the only thing that keeps old compiled output from outliving a transpiler change (CS-13356).
- No log records transpile duration. The `perf` log line says `cache miss` for an L2 hit and for a real compile alike.

## Plan

Three phases, each its own PR, in this order.

### Phase 1: measure (small)

- Log one line per real compile (not per L2 hit) with the path, source size, and duration, at `info` when it exceeds a threshold (for example 1 s), otherwise at `debug`.
- Add `transpiles=<n> transpileMs=<sum>/<max>` for the sampling window to the `realm:health` line, so a stall names its cause.
- Raise the bulk-tombstone row-count log from `debug` to `info`, so warm-cache wipes are visible in production.

Files: `runtime-common/realm.ts` (`#transpileWithLayers`), `realm-server/health-sampler.ts`.

### Phase 2: compile off the main thread (the structural fix)

- Run `transpileJS` (and the dependency-key parse) in a small `worker_threads` pool inside the realm-server. `transpileJS` is a pure function of `(content, filename) → string`, so it moves cleanly.
- Pool size: 1 on the current 2 vCPU task, configurable. The pool's queue also bounds how many compiles run at once (the ticket's fix 3), without yielding logic.
- The host and other callers keep calling `transpileJS` directly. Only the realm-server's module serve path uses the pool.
- Effect: a 12 s compile still takes 12 s for the request that asked for it, but every other request is served meanwhile. This also covers the generated-files case (a single huge file), which no amount of staggering or yielding helps.

Files: new `realm-server/transpile-pool.ts` (or similar), an injectable transpile function on `Realm` (the server passes the pool, everyone else gets `transpileJS`), `realm-server/main.ts` wiring.

### Phase 3: stop wiping a cache that validates itself (optional, decide after phase 2)

- Add a transpiler version to the module ETag variant, so a transpiler change misses L2 by itself. This also fixes CS-13356.
- Then a reindex wipe can clear L1 only and leave L2 intact. A replica that restarts or reindexes refills from L2 instead of recompiling, which removes the wipe storms (the ticket's fixes 2 and 4).

## Out of scope here

- **Not transpiling huge generated files at all.** For example, serve a raw `.js` above some size, or under some paths, without compiling. That is the separate ticket we discussed. Phase 2 removes the stall it causes; whether such files should be compiled or stored in realms at all is a product question.
- **Alerting on `eventLoopLagMs`** (ticket item 5). That is a Grafana alert in the observability package, separate from this code.

## Testing

- **Phase 1:** a realm-server test asserts the compile log line and the health counters after one cache miss, and that an L2 hit produces neither.
- **Phase 2:** a test that, while a deliberately slow compile is in the pool, another request (`/_standby` or a cached module) is answered promptly. The existing `module-cache-race-test.ts` and `module-serve-endpoints-test.ts` suites must stay green, since they pin the dedup, coalesce, and OCC behavior the pool sits under.
- **Phase 3:** extend the existing "reindex tombstones L2" tests: after a reindex, L2 rows survive and are served; after a transpiler-version change, they are compiled over.

## Open questions

1. **Phase 2 memory:** each worker thread loads babel, the ember template compiler and the plugins. That is probably 100–200 MB per thread, on tasks that already reach about 2 GB heap during a stall. To be measured in phase 1 or a spike.
2. **Phase 2 and the coordinator:** today the coordinated winner holds a pinned DB connection and an advisory lock for the whole compile. With the compile off-thread that connection is still held while waiting. That is acceptable, but a long compile then holds one of the 40 pool connections. Should the lock be taken only around the L2 write?
3. **Phase 3:** is any caller relying on the reindex wipe for something other than staleness? For example, a test, a manual "force recompile" practice, or the bootstrap-boot wipe.
