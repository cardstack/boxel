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

For host QUnit tests, build with `RESOLVED_BASE_REALM_URL` pointing at the printed
local server's `/base/` and clear ambient `BOXEL_ENVIRONMENT`, `ENV_SLUG`, and
`ENV_MODE` settings. Filter on `Tessar`. Capture the complete console output.
After a base-module edit, invalidate that local realm's module cache or restart
the isolated stack before claiming that a browser test covered the edit.

The initial ordinary-query GET case has failed correctness: live membership and
stored statistics disagree. The tool records those reads as invalid. It does
not treat their latency as a passing baseline. Full dashboard adaptation,
concurrency, write/freshness trials and the 10x performance report remain required.
