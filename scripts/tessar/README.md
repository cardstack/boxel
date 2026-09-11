# Tessar experimental benchmark tools

DO NOT MERGE. Use an isolated local runtime from this worktree. All generated
records are fabricated; the generator does not read deployment records.

From the monorepo root, with the pinned mise toolchain installed:

```sh
mise exec -- pnpm exec node --test scripts/tessar/generate.test.mjs
mise exec -- pnpm exec node scripts/tessar/generate.mjs --preset smoke --output /private/tmp/tessar-smoke
```

Presets are `smoke` (34 instances), `1x` (1,255) and `10x` (12,550). The output
directory must not exist. `manifest.json` records the seed, counts and data hash;
`expected.json` is the independent raw-document oracle. Production data is never
an input. A 100x preset is deliberately unsupported.

`--variant materialized` is the default. `--variant get-cards` changes only the
dashboard definition; source inputs and expected displayed output stay the same.
The reference pages broad type queries in batches of 100 without a fixed number
of pages. It must pass the browser oracle before being used as a baseline.

Build the host and serve its icons using the package scripts. From
`packages/realm-server`:

```sh
mise exec -- pnpm exec node ../../scripts/tessar/bench.mjs --dataset /private/tmp/tessar-smoke --output /private/tmp/tessar-smoke-result.json --serve
```

The harness starts disposable Postgres/Synapse/realm/host services and prints the
local realm URL. Runtime URLs and owned process IDs are saved beside the output
as `.runtime.json`. The source fingerprint includes dirty and untracked runtime
files so a cached fixture cannot silently stand in for the current implementation.
Stop the harness with SIGINT/SIGTERM when the browser trial finishes.

Use a fully migrated template database containing the Tessar migration. If the
default harness template predates the migration, set
`TEST_HARNESS_MIGRATED_TEMPLATE_DB` to a separately prepared disposable template;
do not reset a database that an active harness is using. `--realm-server-url`
can pin a localhost URL so the host is built against the same base realm.
Set `TEST_HARNESS_PGPORT=55437` for the separate disk-backed Tessar Postgres
container. The 10× cold build requires
`TEST_HARNESS_FULL_INDEX_REALM_STARTUP_TIMEOUT_MS=3600000`; this is a setup
allowance, not a change to the fixed 10,000 ms write-freshness deadline.

Once the harness is ready, run the real Chromium check from the monorepo root:

```sh
mise exec -- pnpm exec node scripts/tessar/browser-check.mjs --dataset /private/tmp/tessar-smoke --runtime /private/tmp/tessar-smoke-result.json.runtime.json --matrix-url http://localhost:<isolated-matrix-port>/ --output /private/tmp/tessar-smoke-browser.json --iterations 20 --writes
```

The version 2 script authenticates only the synthetic harness account. It waits
for the live realm subscription, connected client and removal of server markup
before qualifying a display or starting writes. `firstContentMs` and
`interactiveMs` are separate observations. Earlier version 1 browser samples
could accept server HTML before client boot and are provisional. Run the
regression with `pnpm exec node --test scripts/tessar/browser-oracle.test.mjs`.

It compares all
statistics and displayed rows with the raw-document oracle, records input-card
and search requests, and exercises content, transitive, entry/exit, asynchronous,
unrelated, insertion, deletion and offline/reconnect mutations in the already-open browser. Each
write series needs a fresh generated realm: it deliberately changes the fixture.
The `get-cards` variant's write/freshness behavior is still being validated;
passing initial reads alone does not qualify a baseline for a freshness claim.

`lifecycle-check.mjs --dataset ... --runtime ... --output ...` adds a synthetic
five-stage feeder chain after the size benchmark. It verifies an unrelated
module epoch change and leaf-to-dashboard convergence. Its additional records
must not be included in the fixed-size performance samples.

For host QUnit tests, build with `RESOLVED_BASE_REALM_URL` pointing at the printed
local server's `/base/` and clear ambient `BOXEL_ENVIRONMENT`, `ENV_SLUG`, and
`ENV_MODE` settings. Filter on `Tessar`. Capture the complete console output.
After a base-module edit, invalidate that local realm's module cache or restart
the isolated stack before claiming that a browser test covered the edit.

The initial ordinary-query GET case failed correctness: live membership and
stored statistics disagreed. Failed cases remain in the report. The current
10× materialized JSON path passes connected browser reads, nine mutations,
both worker crash points and 1/10/50 HTTP-reader checks. The getCards reference
has produced correct initial output but breached the fixed refresh deadline.
The full 10× HTML pipeline has a separate failed render and must not be labeled
a successful setup. See `docs/tessar-performance-report.md` for qualifications.

### Tessar diagnostic tools

`verify-owners.mjs --dataset ... --runtime ... --output ...` validates every saved
view against its independent oracle, requiring ready provenance. It uses four
bounded HTTP readers.

`load-check.mjs --dataset ... --runtime ... --matrix-url ... --output ... --writes`
checks 1, 10 and 50 simultaneous HTTP readers plus one open browser. It records
pending responses separately and validates complete rows/statistics and revision
floors. This is not a test of 50 concurrent browser processes.

`restart-check.mjs` takes the same dataset/runtime/matrix/output arguments. It
holds the publication transaction lock, acknowledges a fabricated source edit,
then interrupts only the verified worker child owned by that runtime. The
replacement worker must finish the reserved job and refresh the open browser
within the unchanged 10-second deadline. `--phase after-source-publication`
instead interrupts after the dirty owner generation is durably committed.
The before-publication case also opens a separately authenticated browser after
acknowledgement, rejects stale or cacheable initial HTML, and requires both
clients to reach the complete output within the same deadline.

Set `TEST_HARNESS_USER_INDEX_WORKERS=1` to give the isolated harness one existing
index-only worker in addition to its one all-priority worker. The default remains
zero. Keep these counts identical in performance comparisons.

`bench.mjs --resume-index sf_bld_<owned-builder>` clones a preserved successful
source index and replays its failed HTML job. This is a recovery diagnostic,
not a cold build. `--skip-html-replay` additionally isolates JSON/browser reads
from the failed HTML path; it requires `--resume-index` and records
`setupMode: committed-json-index-only`. An HTML failure remains a failed full
pipeline result even when the separate JSON/browser tests pass. Failure details
are saved to `.failure.json` before the disposable runtime is cleaned up.

A separate built host can be selected with `TEST_HARNESS_HOST_DIST_PACKAGE_DIR`.
Its index HTML is fingerprinted. Explicitly set `ICONS_URL=http://localhost:4206`
and the local `RESOLVED_BASE_REALM_URL` when building; inherited hosted asset
settings can invalidate a local test setup.

`prewarm-check.mjs --database <owned-builder> --dataset ... --output ...` is a read-only probe
of real indexed dependency collection with an inert module-cache sink. A Node
old-space cap distinguishes bounded collection from retaining every dependency
row; its elapsed time is not end-to-end indexing throughput.

`plot-results.py --results docs/tessar-benchmark-results.json --output docs`
uses Matplotlib to reproduce the standalone SVG and PNG. It reads only sanitized
observations; it does not contact a realm. Use a disposable Python virtual
environment if Matplotlib is not already available.
