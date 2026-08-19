// Trip-test for the AMD-transpile bench gate.
//
// Spawns `check.ts` against a deliberately stingy synthetic baseline
// (every fixture's median pinned at 0.001 ms) and asserts:
//   1. The gate exits 1.
//   2. stderr contains the canonical FAIL message format.
//   3. Every fixture in the synthetic baseline appears in the breach list.
//
// This proves the gate's failure path works end-to-end on every CI run
// without ever mutating the real `baseline.json`. The override path is
// passed via `BENCH_AMD_BASELINE_OVERRIDE` (handled in `paths.ts`); the
// real baseline file on disk is never touched.
//
// Run from `packages/runtime-common`:
//   pnpm bench:amd:check:trip-test
//
// This is the cheap synthetic test (Option A). The faithful "inject a
// real perf regression and watch the gate trip" drill is `trip-drill.ts`
// — slower, manual, lives behind `mise run bench:amd-trip-drill`.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { fixturesDir } from './paths.ts';

const STINGY_MEDIAN_MS = 0.001;
// Matches the FAIL message produced by `check.ts`. The optional noise-
// floor note (`(with +Nms noise floor)`) is permitted but not required —
// the synthetic baseline this trip-test writes deliberately omits
// `noise_floor_ms` so the regex stays stable across baseline shape
// changes that don't affect the gate's wording.
const FAIL_MSG_RE =
  /production median for [\w.-]+ is [\d.]+ms, exceeds allowed [\d.]+ms( \(with \+[\d.]+ms noise floor\))? \(baseline [\d.]+ms × [\d.]+ tolerance\)/;

function listFixtureNames(): string[] {
  return readdirSync(fixturesDir)
    .filter((f) => f.endsWith('.js') && !f.startsWith('_'))
    .sort();
}

(async () => {
  const fixtures = listFixtureNames();
  if (fixtures.length === 0) {
    console.error(
      `trip-test: no fixtures in ${fixturesDir}. Run \`pnpm bench:amd:prep\`.`,
    );
    process.exit(1);
  }

  const tmpDir = mkdtempSync(path.join(tmpdir(), 'bench-amd-trip-'));
  const synthBaselinePath = path.join(tmpDir, 'baseline.json');
  const synthBaseline = {
    version: 1,
    generated: new Date().toISOString().slice(0, 10),
    iterations: 1,
    warmup: 0,
    tolerance: 1.25,
    candidate: 'production',
    fixtures: Object.fromEntries(
      fixtures.map((f) => [f, { median_ms: STINGY_MEDIAN_MS }]),
    ),
  };
  writeFileSync(synthBaselinePath, JSON.stringify(synthBaseline, null, 2));

  console.log(
    `trip-test: running gate against synthetic stingy baseline (${STINGY_MEDIAN_MS}ms × 1.25 = ${(STINGY_MEDIAN_MS * 1.25).toFixed(4)}ms allowed per fixture)`,
  );
  console.log(`trip-test: synthetic baseline at ${synthBaselinePath}`);

  // ITER=5 / WARMUP=1 keeps the trip-test cheap (~5s) — we're not
  // measuring perf here, just confirming the gate fails when the
  // baseline is unreachable. Real timing precision happens in the
  // bench gate itself, which still runs at ITER=100 / WARMUP=10.
  const result = spawnSync('pnpm', ['bench:amd:check'], {
    env: {
      ...process.env,
      BENCH_AMD_BASELINE_OVERRIDE: synthBaselinePath,
      ITER: '5',
      WARMUP: '1',
    },
    encoding: 'utf8',
  });

  // Always clean up the temp dir before any assertion exits the script.
  rmSync(tmpDir, { recursive: true, force: true });

  const failures: string[] = [];

  if (result.status !== 1) {
    failures.push(
      `expected exit code 1, got ${result.status}. stdout/stderr below.`,
    );
  }

  const stderr = result.stderr ?? '';
  const stdout = result.stdout ?? '';
  const combined = stdout + '\n' + stderr;

  if (!FAIL_MSG_RE.test(combined)) {
    failures.push(
      `expected FAIL message matching ${FAIL_MSG_RE} in script output, not found.`,
    );
  }

  const missingFromBreaches = fixtures.filter(
    (f) =>
      !new RegExp(`production median for ${f.replace(/\./g, '\\.')} is`).test(
        combined,
      ),
  );
  if (missingFromBreaches.length > 0) {
    failures.push(
      `expected every fixture to appear in the breach list, missing: ${missingFromBreaches.join(', ')}`,
    );
  }

  if (failures.length > 0) {
    console.error('\nFAIL — trip-test did not behave as expected:');
    for (const f of failures) console.error(`  - ${f}`);
    console.error('\n--- check.ts stdout ---');
    console.error(stdout);
    console.error('--- check.ts stderr ---');
    console.error(stderr);
    process.exit(1);
  }

  console.log(
    '\nPASS — gate exited 1, FAIL message format intact, all fixtures reported as breaches.',
  );
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
