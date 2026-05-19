---
name: host-test-memory-leak-hunting
description: Hunt down memory leaks in the @cardstack/host Ember test suite using V8 heap snapshots over CDP. Use when host CI shards OOM, when MEMPROBE output shows used-heap climbing across tests, or when adding a new feature that holds DOM/closure state across the test lifecycle. Documents the local probe loop, the snapshot-analysis scripts, and the catalog of leaks already found.
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---

# Host test memory leak hunting

The host test suite is large enough that a per-test leak as small as 5 MB will OOM a CI shard before the suite finishes. This skill is the playbook for finding and validating fixes. It exists because a single leak hunt can take days if you don't have the loop tightened — Chrome heap snapshots are slow, big, and ambiguous unless you reduce them to retainer paths.

See [`known-leaks.md`](./known-leaks.md) for the catalog of leaks found so far and the patterns that cause them. Read it first — most "new" leaks rhyme with one of those.

## When to use

- CI host-test shard OOMs (V8 `Reached heap limit Allocation failed` in the test log).
- Local `pnpm test` shows `MEMPROBE used=` climbing every 10 tests.
- New feature added a service, modifier, or globalThis closure that captures the test's `owner`.
- After landing a fix that is supposed to flatten the slope — verify before declaring victory.

## What's already in the suite

Two pieces of permanent instrumentation in `packages/host/tests/helpers/setup-qunit.js`:

1. **Forced GC every test** (requires Chrome `--js-flags="--expose-gc"`). Without this V8's opportunistic GC can't keep up and the heap drifts toward the 4GB ceiling regardless of leak size.
2. **`MEMPROBE` log line every 10 tests** with `used=`/`total=`/`app_instances=`/`alive=`/`destroying=`/`destroyed=` — visible in CI output and used by the snapshot runner to trigger snaps.

Three diagnostic scripts in `packages/host/scripts/` (only used during a hunt):

- `heap-snapshot-runner.js` — CDP client. Watches Chrome console for `PROBE t=N`; at configured indices, takes a heap snapshot and streams chunks to disk (joining blows V8's max string length past ~300MB).
- `snapshot-diff.js` — top-N constructor counts/retained-sizes that grew between two snapshots.
- `snapshot-retainers.js` — backward BFS from target nodes to GC roots. Flags: `--type=<native|object|closure|string>`, `--min-size=N`, `--strong` (skips `weak`/`shortcut` AND WeakMap "part of key" internal edges; use this — it's the difference between a misleading WeakMap path and the real strong retainer).
- `snapshot-by-class.js` — like snapshot-diff but truncates long names so output is scannable.
- `snapshot-diff-stream.js` / `snapshot-retainers-stream.js` — **use these when a snapshot file is >500 MB.** Same flags and output as the non-streaming versions; they use `stream-json` to avoid `fs.readFileSync('utf8')` (which throws `ERR_STRING_TOO_LONG` above V8's ~512 MB cap). The retainers-stream variant also buffers nodes/edges into a growable `Float64Array` so huge snapshots don't hit `Invalid array length` around 100M+ items. Just swap the script name; all arguments are identical.

See [`packages/host/scripts/HEAP_PROBE.md`](../../../packages/host/scripts/HEAP_PROBE.md) for invocation reference.

## The probe loop

The dev stack must already be up via `mise run dev-all`, with Chrome launched with `--remote-debugging-port=9333 --js-flags="--expose-gc" --enable-precise-memory-info`. (You can launch a dedicated Chrome on macOS with `/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9333 --js-flags="--expose-gc" --enable-precise-memory-info --user-data-dir=/tmp/chrome-leak-probe`.)

### 1. Pick a fast filter

The test filter you choose dominates iteration time. Use a module that exercises the suspect code path AND completes ~1 second per test. Good defaults:

- `card-basics` — 99 tests, ~1s/test, exercises card-api + Box trees (hits the most common leak shape)
- `Integration | Store` — good for store/card-api-related leaks; reproduces ~20 MB/test for store service leaks that `card-basics` misses (~1.1 MB/test)
- `Integration` — slower, broader, use only when narrower filters miss the signal
- A specific module name from a failing CI shard

Avoid filters that include realm-indexing-heavy tests (e.g. those that intentionally trigger errors) — those run at ~60s/test and crush iteration.

**Important:** if `card-basics` doesn't reproduce the expected slope, try a heavier filter. Some leaks only trigger when specific service code paths are exercised (e.g. StoreService.setup() only fires when the store is actually used).

### 2. Start the snapshot runner

```sh
rm -f /tmp/snap-t*.heapsnapshot /tmp/snap-runner.log
SNAPSHOT_AT="10,50,90" \
  nohup node packages/host/scripts/heap-snapshot-runner.js > /tmp/snap-runner.log 2>&1 &
```

Snapshots at `t=10` (warm) and `t=50` give a clean delta over 40 tests. Add `t=90` to confirm the t=10→t=50 slope continues (rules out one-time allocations).

**`SNAPSHOT_AT` values must be multiples of 10** — the runner triggers on `MEMPROBE` log lines, which only fire every 10 tests. Values like `3` or `15` will be silently missed.

### 3. Open a fresh test tab

```sh
ENCODED=$(node -e 'console.log(encodeURIComponent("https://localhost:4200/tests/index.html?hidepassed&filter=card-basics"))')
curl -sX PUT "http://localhost:9333/json/new?${ENCODED}"
```

Important: **close any prior `/tests/` tabs first** — the runner picks the first matching tab and will get stuck on a stale one. The runner exits after writing the last snapshot in `SNAPSHOT_AT`.

### 4. Read the MEMPROBE lines

The runner echoes every `MEMPROBE` line as it streams from the browser. Look at the trajectory:

- `used=` climbing linearly = leak. Per-test slope = `(used_t90 - used_t10) / 80`.
- `app_instances=` > 0 between tests = `App._applicationInstances` leak (see known-leaks.md).
- `destroyed=N alive=0` with N > 0 = `willDestroy` ran but `_unwatchInstance` was skipped (super.willDestroy threw).

### 5. Diff the snapshots to identify what grew

```sh
node --max-old-space-size=16384 packages/host/scripts/snapshot-diff.js \
  /tmp/snap-t10.heapsnapshot /tmp/snap-t50.heapsnapshot | head -40
```

The top of the output sorted by retained-size delta tells you what's accumulating. Watch for:

- `+N copies` of `string::define("https://cardstack.com/base/...")` — a Registry/factory chain is pinning fresh-per-test card-api module sources. Almost always points back to `App._applicationInstances` retention.
- `+N copies` of `JSArrayBufferData` (native) — usually downstream of the above (each pinned ApplicationInstance brings ArrayBuffers).
- `+N` Box / FieldComponent / Glimmer-internal counts — Box tree retention.
- `+N` of `native::DOMTimer` — orphaned `setInterval`/`setTimeout` from async service code that ran after the service was destroyed (see known-leaks.md #5).

### 6. Trace the retainer chain

Pick a high-count constructor from the diff and trace it:

```sh
node --max-old-space-size=16384 packages/host/scripts/snapshot-retainers.js \
  /tmp/snap-t50.heapsnapshot '^Box$' \
  --max=10 --depth=30 --type=object --strong
```

**Always pass `--strong`.** Without it, the shortest path runs through `weak` edges and WeakMap "part of key" internal edges — neither of which actually retain the target. With `--strong`, you see the real GC-root path. The retainer signature (the chain of edge labels) tells you what to fix.

If the chain ends at `Window.@cardstack/host` → some service or registry, fix the leak there. If it ends at `synthetic root` → `(GC roots)` → some array, you're likely looking at a global Set/Map that needs a WeakMap or an explicit cleanup.

### 7. Apply the fix and re-run from step 2

If the slope flattens and the offending constructor count stops growing, you're done. Save a memory entry with the retainer chain and the fix.

## Pitfalls

- **`getContext()` returns undefined at `QUnit.testDone`** because `unsetContext()` runs in `teardownContext` before the owner is destroyed. Don't snapshot `ctx.owner` in testDone — capture in `hooks.afterEach` of the test module, or read `getApplication()._applicationInstances` directly.
- **WeakMap edges**. Heap snapshots show WeakMap key→value as a normal-looking edge. `snapshot-retainers.js` skips them when `--strong` is passed; otherwise you'll chase ghosts.
- **V8 max string length on big snapshots**. `JSON.parse(fs.readFileSync(snap, 'utf8'))` works up to ~500MB, but `chunks.join('')` blows up around 300MB. The runner streams chunks straight to disk for this reason. The analysis scripts (`snapshot-diff.js`, `snapshot-retainers.js`) also hit this limit — if snapshots exceed ~500MB, take them earlier in the run (lower `SNAPSHOT_AT` values) to keep file sizes manageable.
- **GC timing**. The `globalThis.gc(); globalThis.gc()` double-call in setup-qunit is intentional — V8 sometimes needs a second pass to actually collect. If a snapshot still shows the suspect, re-snap after a short wait.
- **Stale tabs**. Each `/json/new?<URL>` call creates a NEW tab. The runner picks the first one. Close stale tabs before starting the runner.

## Validating the fix

A clean fix is one that:

1. Makes the per-test slope flat in steady state (compare t=50→t=90, not t=10→t=50 — the early region warms up caches).
2. Drops the leaked constructor count delta to zero (or single digits — V8 caching introduces a small floor).
3. Still passes the full host-test shard 3 (the historical canary for memory pressure) under the original `shardTotal: 20` config.

If you bumped CI shard count as a temporary mitigation, revert that bump in the same PR as the fix.
