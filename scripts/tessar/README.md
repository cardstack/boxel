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

The script authenticates only the synthetic harness account. It compares all
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
stored statistics disagreed. The tool records those reads as invalid. It does
not treat their latency as a passing baseline. Initial connected materialized
smoke reads and eight mutations now pass. Full dashboard adaptation, feeder and
restart tests, concurrency, and the 10x performance report remain required.
