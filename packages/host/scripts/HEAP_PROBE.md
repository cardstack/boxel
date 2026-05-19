# Heap snapshot scripts

Diagnostic tooling for hunting memory leaks in the host test suite. See [`.claude/skills/host-test-memory-leak-hunting/SKILL.md`](../../../.claude/skills/host-test-memory-leak-hunting/SKILL.md) for the workflow these are part of, and [`known-leaks.md`](../../../.claude/skills/host-test-memory-leak-hunting/known-leaks.md) for the catalog of leaks found so far.

These are dev-time tools — not invoked from CI or production builds.

## Prerequisites

- The dev stack is up via `mise run dev-all`.
- Chrome launched with the remote debugging port and GC exposed:
  ```sh
  /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
    --remote-debugging-port=9333 \
    --js-flags="--expose-gc" \
    --enable-precise-memory-info \
    --user-data-dir=/tmp/chrome-leak-probe
  ```

## `heap-snapshot-runner.js`

Connects to Chrome via CDP on `localhost:9333`. Watches the test page console for `MEMPROBE t=N` lines (emitted by `setup-qunit.js` every 10 tests). At the test indices configured by `SNAPSHOT_AT`, takes a heap snapshot via `HeapProfiler.takeHeapSnapshot` and streams the chunks straight to `/tmp/snap-tN.heapsnapshot`.

Streams chunks instead of `chunks.join('')` because joining blows V8's max string length on snapshots past ~300MB.

```sh
SNAPSHOT_AT="10,50,90" node packages/host/scripts/heap-snapshot-runner.js
# default: SNAPSHOT_AT="2,20,40"
```

The runner picks the first Chrome tab whose URL contains `/tests/`. Close stale test tabs before starting.

## `snapshot-diff.js`

Diffs two snapshots, reporting constructor-name counts and retained-size deltas. Sorted by retained-size delta first, then by count delta.

```sh
node --max-old-space-size=16384 \
  packages/host/scripts/snapshot-diff.js \
  /tmp/snap-t10.heapsnapshot /tmp/snap-t50.heapsnapshot | head -40
```

The top entries identify what's accumulating between snapshots. `+N copies` of base-realm `string::define(...)` entries almost always indicate a Registry-pinning leak.

## `snapshot-by-class.js`

Like `snapshot-diff.js` but truncates long names so the output is scannable in a single screen. Sorts by count delta only.

```sh
node --max-old-space-size=16384 \
  packages/host/scripts/snapshot-by-class.js \
  /tmp/snap-t10.heapsnapshot /tmp/snap-t50.heapsnapshot
```

## `snapshot-retainers.js`

Backward BFS from nodes matching a name regex to GC roots. Reports the most common retainer signature (the chain of edge labels) so you can group many leaked instances by the path that pins them.

```sh
node --max-old-space-size=16384 \
  packages/host/scripts/snapshot-retainers.js \
  /tmp/snap-t50.heapsnapshot '<name-regex>' \
  --max=10 --depth=30 --type=object --strong
```

Flags:
- `--type=<native|object|closure|string>` — restrict to a node type (default: object/closure)
- `--min-size=N` — skip targets smaller than N bytes
- `--max=N` — sample up to N matching targets (default 10)
- `--depth=D` — BFS depth limit (default 25)
- `--strong` — **almost always pass this**. Skips `weak`/`shortcut` edges AND WeakMap "part of key" internal edges. Without it, the shortest path runs through WeakMap table slots that don't actually retain — and you'll waste time chasing ghosts.

## Workflow tip

A typical hunt looks like:

```sh
# 1. Snap (runner exits when last index is taken)
rm -f /tmp/snap-t*.heapsnapshot /tmp/snap-runner.log
SNAPSHOT_AT="10,50,90" \
  nohup node packages/host/scripts/heap-snapshot-runner.js > /tmp/snap-runner.log 2>&1 &

# 2. Open a fresh test tab
ENCODED=$(node -e 'console.log(encodeURIComponent("https://localhost:4200/tests/index.html?hidepassed&filter=card-basics"))')
curl -sX PUT "http://localhost:9333/json/new?${ENCODED}"

# 3. After runner exits — diff and trace
node --max-old-space-size=16384 packages/host/scripts/snapshot-diff.js \
  /tmp/snap-t10.heapsnapshot /tmp/snap-t50.heapsnapshot | head -20

node --max-old-space-size=16384 packages/host/scripts/snapshot-retainers.js \
  /tmp/snap-t50.heapsnapshot '^<top-suspect-class>$' --strong --max=5
```

The full step-by-step (including pitfalls and what to look for in the output) is in the skill.
