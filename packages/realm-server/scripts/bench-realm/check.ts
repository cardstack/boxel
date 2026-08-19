// Bench gate: runs the realm bench and compares each scenario's median
// against `baseline.json`. Exits 1 on any scenario whose median exceeds
// `baseline_ms × tolerance` (or `baseline_ms + noise_floor_ms`, whichever
// is more lenient).
//
// Two modes:
//   - REPORT-ONLY (no baseline.json on disk) — measures medians, prints a
//     table + a paste-ready baseline.json snippet, exits 0. This is how
//     we anchor the initial baseline: land the gate first, observe what
//     real CI numbers look like, then commit baseline.json in a follow-up
//     PR. We deliberately do not auto-rebaseline on each merge — the
//     committed config is the contract that makes future regressions
//     visible.
//   - ENFORCE (baseline.json present) — same measurement, but each
//     scenario's median is compared against the baseline and the gate
//     fails on any breach.
//
// Run from `packages/realm-server`:
//   pnpm bench:realm:check
//
// Tunables via env vars:
//   ITER=50    iterations per scenario (default 50)
//   WARMUP=5   warmup iterations (default 5)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { runBench, type Result } from './bench.ts';
import { baselinePath } from './paths.ts';

interface Baseline {
  version: number;
  generated?: string;
  iterations?: number;
  warmup?: number;
  tolerance: number;
  // Optional absolute noise floor in milliseconds. The allowed threshold
  // for a scenario is `max(baseline × tolerance, baseline + noise_floor_ms)`.
  // Use this when relative tolerance alone is too tight for a particular
  // scenario's runner-jitter floor.
  noise_floor_ms?: number;
  scenarios: Record<string, { median_ms: number }>;
}

function allowedMs(baselineMs: number, b: Baseline): number {
  const relative = baselineMs * b.tolerance;
  const absolute = baselineMs + (b.noise_floor_ms ?? 0);
  return Math.max(relative, absolute);
}

const DEFAULT_ITER = 50;
const DEFAULT_WARMUP = 5;

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
  }

  console.log(
    `iterations=${iterations} warmup=${warmup} mode=${
      hasBaseline ? 'enforce' : 'report-only'
    }\n`,
  );

  const results: Result[] = await runBench({ iterations, warmup });

  console.log(
    [
      'scenario'.padEnd(50),
      'median'.padStart(10),
      'p95'.padStart(10),
      'min'.padStart(10),
      'max'.padStart(10),
    ].join('  '),
  );
  for (const r of results) {
    console.log(
      [
        r.scenario.padEnd(50),
        fmtMs(r.median_ms).padStart(10),
        fmtMs(r.p95_ms).padStart(10),
        fmtMs(r.min_ms).padStart(10),
        fmtMs(r.max_ms).padStart(10),
      ].join('  '),
    );
  }

  const lines: string[] = [];
  lines.push('## Realm Performance Benchmark\n');
  lines.push(
    `iterations=${iterations} warmup=${warmup} mode=${
      hasBaseline ? 'enforce' : 'report-only'
    }\n`,
  );

  if (!hasBaseline) {
    lines.push(
      'No `baseline.json` found — running in report-only mode. ' +
        'Anchor the baseline by committing the snippet below to ' +
        '`packages/realm-server/scripts/bench-realm/baseline.json`.\n',
    );
    lines.push('| Scenario | Median | p95 | Min | Max |');
    lines.push('|----------|-------:|----:|----:|----:|');
    for (const r of results) {
      lines.push(
        `| \`${r.scenario}\` | ${fmtMs(r.median_ms)} | ${fmtMs(r.p95_ms)} | ${fmtMs(r.min_ms)} | ${fmtMs(r.max_ms)} |`,
      );
    }
    lines.push('');

    const snippet = {
      version: 1,
      generated: new Date().toISOString().slice(0, 10),
      iterations,
      warmup,
      tolerance: 1.5,
      noise_floor_ms: 50,
      scenarios: Object.fromEntries(
        results.map((r) => [
          r.scenario,
          { median_ms: Number(r.median_ms.toFixed(2)) },
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

  // Sanity check: a baseline scenario with no measured result means the
  // bench failed to load that scenario (renamed, removed). Treat that as
  // a gate failure so a silent-pass case can't hide a regression.
  const orphaned = Object.keys(baseline!.scenarios).filter(
    (s) => !results.some((r) => r.scenario === s),
  );
  if (orphaned.length > 0) {
    console.error(
      `\nFAIL: baseline lists ${orphaned.length} scenario(s) with no measurement: ${orphaned.join(', ')}.`,
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
  lines.push('| Scenario | Baseline | Current | Allowed | Status |');
  lines.push('|----------|---------:|--------:|--------:|:------:|');

  for (const r of results) {
    const base = baseline!.scenarios[r.scenario];
    if (!base) {
      missingFromBaseline.push(r.scenario);
      lines.push(
        `| \`${r.scenario}\` | _none_ | ${fmtMs(r.median_ms)} | — | new |`,
      );
      continue;
    }
    const allowed = allowedMs(base.median_ms, baseline!);
    const ok = r.median_ms <= allowed;
    const status = ok ? 'PASS' : 'FAIL';
    lines.push(
      `| \`${r.scenario}\` | ${fmtMs(base.median_ms)} | ${fmtMs(r.median_ms)} | ${fmtMs(allowed)} | ${status} |`,
    );
    if (!ok) {
      const floorNote =
        noiseFloor > 0 ? ` (with +${noiseFloor}ms noise floor)` : '';
      breaches.push(
        `${r.scenario} median is ${fmtMsPrecise(r.median_ms)}, ` +
          `exceeds allowed ${fmtMsPrecise(allowed)}${floorNote} ` +
          `(baseline ${fmtMsPrecise(base.median_ms)} × ${tolerance.toFixed(2)} tolerance)`,
      );
    }
  }
  lines.push('');

  if (breaches.length === 0 && missingFromBaseline.length === 0) {
    lines.push('All scenarios within tolerance.\n');
  }

  const summary = lines.join('\n');
  console.log('\n' + summary);
  appendStepSummary(summary);

  if (breaches.length > 0) {
    console.error('\nFAIL:');
    for (const b of breaches) console.error(`  ${b}`);
    console.error(
      '\nIf this is an intentional perf change (improvement or accepted regression), ' +
        'update packages/realm-server/scripts/bench-realm/baseline.json in the same PR ' +
        'with a commit message explaining why.',
    );
    process.exit(1);
  }

  if (missingFromBaseline.length > 0) {
    console.warn(
      `\nWARN: ${missingFromBaseline.length} scenario(s) not in baseline: ${missingFromBaseline.join(', ')}`,
    );
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
