// Bench gate: runs the AMD transpiler bench against committed fixtures
// and compares each `production` candidate's median wall-time against
// `baseline.json`. Exits 1 on any fixture whose median exceeds
// `baseline_ms × tolerance`.
//
// Two modes:
//   - REPORT-ONLY (no baseline.json on disk) — measures medians, prints
//     a table, writes the markdown summary, and exits 0. This is how
//     we anchor the initial baseline: land the gate first, observe the
//     numbers a real CI run produces, then commit baseline.json in a
//     follow-up.
//   - ENFORCE (baseline.json present) — same measurement, but each
//     fixture's median is compared against baseline × tolerance and
//     the gate fails on any breach.
//
// Run from `packages/runtime-common`:
//   pnpm bench:amd:check
//
// Tunables via env vars:
//   ITER=100   iterations per fixture (default 100; CI doubles the
//              local 50 to dampen runner noise)
//   WARMUP=10  warmup iterations (default 10)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { runBench, type Result } from './bench.ts';
import { baselinePath } from './paths.ts';

interface Baseline {
  version: number;
  generated?: string;
  iterations?: number;
  warmup?: number;
  tolerance: number;
  // Optional absolute noise floor in milliseconds. The allowed
  // threshold for a fixture is `max(baseline × tolerance,
  // baseline + noise_floor_ms)`. This handles small-magnitude
  // fixtures where sub-ms runner jitter dominates the relative
  // tolerance — e.g. a 0.65ms baseline × 1.25 = 0.81ms only leaves
  // 0.16ms for noise, and observed GH-runner jitter on the smallest
  // fixture has been up to 0.21ms. Default 0 (relative tolerance
  // only).
  noise_floor_ms?: number;
  candidate: string;
  fixtures: Record<string, { median_ms: number }>;
}

function allowedMs(baselineMs: number, b: Baseline): number {
  const relative = baselineMs * b.tolerance;
  const absolute = baselineMs + (b.noise_floor_ms ?? 0);
  return Math.max(relative, absolute);
}

const DEFAULT_ITER = 100;
const DEFAULT_WARMUP = 10;
const GATED_CANDIDATE = 'production';

// Display-only formatter for the markdown summary table.
const fmtMs = (ms: number) => `${ms.toFixed(2)}ms`;
// Higher-precision formatter for FAIL messages — the gate compares
// unrounded medians, and 2-decimal rounding can produce confusing
// "current=10.41ms exceeds allowed=10.41ms" pairs on borderline cases.
const fmtMsPrecise = (ms: number) => `${ms.toFixed(4)}ms`;

function parsePositiveInt(
  name: string,
  raw: string,
  allowZero = false,
): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || (allowZero ? n < 0 : n < 1)) {
    throw new Error(
      `${name} must be a ${allowZero ? 'non-negative' : 'positive'} integer, got ${JSON.stringify(raw)}`,
    );
  }
  return n;
}

function appendStepSummary(markdown: string) {
  const target = process.env.GITHUB_STEP_SUMMARY;
  if (!target) return;
  writeFileSync(target, markdown + '\n', { flag: 'a' });
}

(async () => {
  const iterations = parsePositiveInt(
    'ITER',
    process.env.ITER ?? String(DEFAULT_ITER),
  );
  const warmup = parsePositiveInt(
    'WARMUP',
    process.env.WARMUP ?? String(DEFAULT_WARMUP),
    true,
  );

  const hasBaseline = existsSync(baselinePath);
  let baseline: Baseline | undefined;
  if (hasBaseline) {
    baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Baseline;
    if (baseline.candidate !== GATED_CANDIDATE) {
      // Future-proof: if someone changes which candidate is gated, the
      // baseline file must agree. We only know how to enforce one
      // candidate at a time, and `production` is the only one that
      // matters for gating per CS-10983.
      console.error(
        `baseline.json declares candidate=${baseline.candidate} but the gate enforces ${GATED_CANDIDATE}; aborting.`,
      );
      process.exit(1);
    }
  }

  console.log(
    `iterations=${iterations} warmup=${warmup} mode=${
      hasBaseline ? 'enforce' : 'report-only'
    }\n`,
  );

  const results: Result[] = await runBench({
    iterations,
    warmup,
    candidates: [GATED_CANDIDATE],
  });

  // Console-friendly table
  console.log(
    `${'fixture'.padEnd(20)}  ${'median'.padStart(10)}  ${'p95'.padStart(10)}  ${'min'.padStart(10)}  ${'max'.padStart(10)}`,
  );
  for (const r of results) {
    console.log(
      `${r.fixture.padEnd(20)}  ${fmtMs(r.median).padStart(10)}  ${fmtMs(r.p95).padStart(10)}  ${fmtMs(r.min).padStart(10)}  ${fmtMs(r.max).padStart(10)}`,
    );
  }

  // Build the markdown summary
  const lines: string[] = [];
  lines.push('## AMD Transpile Bench\n');
  lines.push(
    `iterations=${iterations} warmup=${warmup} candidate=${GATED_CANDIDATE} mode=${
      hasBaseline ? 'enforce' : 'report-only'
    }\n`,
  );

  if (!hasBaseline) {
    lines.push(
      'No `baseline.json` found — running in report-only mode. ' +
        'Anchor the baseline by copying the medians below into ' +
        '`packages/runtime-common/scripts/bench-amd/baseline.json`.\n',
    );
    lines.push('| Fixture | Median | p95 | Min | Max |');
    lines.push('|---------|-------:|----:|----:|----:|');
    for (const r of results) {
      lines.push(
        `| \`${r.fixture}\` | ${fmtMs(r.median)} | ${fmtMs(r.p95)} | ${fmtMs(r.min)} | ${fmtMs(r.max)} |`,
      );
    }
    lines.push('');

    // Print a JSON snippet authors can paste straight into baseline.json.
    // noise_floor_ms = 0.3 is opinionated default for the AMD bench: the
    // smallest fixture is sub-ms and absolute runner jitter has been
    // observed up to ~0.21ms across runs, which the relative tolerance
    // alone can't absorb. See README.
    const snippet = {
      version: 1,
      generated: new Date().toISOString().slice(0, 10),
      iterations,
      warmup,
      tolerance: 1.25,
      noise_floor_ms: 0.3,
      candidate: GATED_CANDIDATE,
      fixtures: Object.fromEntries(
        results.map((r) => [
          r.fixture,
          { median_ms: Number(r.median.toFixed(2)) },
        ]),
      ),
    };
    lines.push('<details><summary>Suggested baseline.json</summary>\n');
    lines.push('```json');
    lines.push(JSON.stringify(snippet, null, 2));
    lines.push('```');
    lines.push('</details>\n');

    const summary = lines.join('\n');
    console.log('\n' + summary);
    appendStepSummary(summary);
    return;
  }

  // ENFORCE mode
  const tolerance = baseline!.tolerance;
  const breaches: string[] = [];
  const missingFromBaseline: string[] = [];

  // Hard sanity check: a baseline fixture with no measured result means
  // the gated candidate failed to run (renamed export, broken import,
  // etc.). Treat that as a gate failure so the silent-pass case can't
  // happen.
  const orphaned = Object.keys(baseline!.fixtures).filter(
    (f) => !results.some((r) => r.fixture === f),
  );
  if (orphaned.length > 0) {
    console.error(
      `\nFAIL: baseline lists ${orphaned.length} fixture(s) with no measurement: ${orphaned.join(', ')}. ` +
        `The gated candidate (${GATED_CANDIDATE}) may have failed to load, or the fixture file is missing.`,
    );
    process.exit(1);
  }

  const noiseFloor = baseline!.noise_floor_ms ?? 0;
  const noiseFloorNote =
    noiseFloor > 0
      ? ` or baseline + ${noiseFloor}ms absolute noise floor, whichever is more lenient`
      : '';
  lines.push(
    `Baseline tolerance: \`× ${tolerance.toFixed(2)}\`${noiseFloorNote} (fail if median exceeds the allowed threshold).\n`,
  );
  lines.push('| Fixture | Baseline | Current | Allowed | Status |');
  lines.push('|---------|---------:|--------:|--------:|:------:|');

  for (const r of results) {
    const base = baseline!.fixtures[r.fixture];
    if (!base) {
      missingFromBaseline.push(r.fixture);
      lines.push(
        `| \`${r.fixture}\` | _none_ | ${fmtMs(r.median)} | — | new |`,
      );
      continue;
    }
    const allowed = allowedMs(base.median_ms, baseline!);
    const ok = r.median <= allowed;
    const status = ok ? 'PASS' : 'FAIL';
    lines.push(
      `| \`${r.fixture}\` | ${fmtMs(base.median_ms)} | ${fmtMs(r.median)} | ${fmtMs(allowed)} | ${status} |`,
    );
    if (!ok) {
      const floorNote =
        noiseFloor > 0 ? ` (with +${noiseFloor}ms noise floor)` : '';
      breaches.push(
        `${GATED_CANDIDATE} median for ${r.fixture} is ${fmtMsPrecise(r.median)}, ` +
          `exceeds allowed ${fmtMsPrecise(allowed)}${floorNote} ` +
          `(baseline ${fmtMsPrecise(base.median_ms)} × ${tolerance.toFixed(2)} tolerance)`,
      );
    }
  }
  lines.push('');

  if (breaches.length === 0 && missingFromBaseline.length === 0) {
    lines.push('All fixtures within tolerance.\n');
  }

  const summary = lines.join('\n');
  console.log('\n' + summary);
  appendStepSummary(summary);

  if (breaches.length > 0) {
    console.error('\nFAIL:');
    for (const b of breaches) console.error(`  ${b}`);
    console.error(
      '\nIf this is an intentional perf change (improvement or accepted regression), ' +
        'update packages/runtime-common/scripts/bench-amd/baseline.json in the same PR ' +
        'with a commit message explaining why.',
    );
    process.exit(1);
  }

  if (missingFromBaseline.length > 0) {
    // A new fixture without a baseline entry is a soft warning, not a
    // hard fail — author needs to extend baseline.json deliberately.
    console.warn(
      `\nWARN: ${missingFromBaseline.length} fixture(s) not in baseline: ${missingFromBaseline.join(', ')}`,
    );
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
