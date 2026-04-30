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

import { runBench, type Result } from './bench';
import { baselinePath } from './paths';

interface Baseline {
  version: number;
  generated?: string;
  iterations?: number;
  warmup?: number;
  tolerance: number;
  candidate: string;
  fixtures: Record<string, { median_ms: number }>;
}

const DEFAULT_ITER = 100;
const DEFAULT_WARMUP = 10;
const GATED_CANDIDATE = 'production';

const fmtMs = (ms: number) => `${ms.toFixed(2)}ms`;

function appendStepSummary(markdown: string) {
  const target = process.env.GITHUB_STEP_SUMMARY;
  if (!target) return;
  writeFileSync(target, markdown + '\n', { flag: 'a' });
}

(async () => {
  const iterations = Number(process.env.ITER ?? DEFAULT_ITER);
  const warmup = Number(process.env.WARMUP ?? DEFAULT_WARMUP);

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

    // Print a JSON snippet authors can paste straight into baseline.json
    const snippet = {
      version: 1,
      generated: new Date().toISOString().slice(0, 10),
      iterations,
      warmup,
      tolerance: 1.25,
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

  lines.push(
    `Baseline tolerance: \`× ${tolerance.toFixed(2)}\` (fail if median exceeds baseline × tolerance).\n`,
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
    const allowed = base.median_ms * tolerance;
    const ok = r.median <= allowed;
    const status = ok ? 'PASS' : 'FAIL';
    lines.push(
      `| \`${r.fixture}\` | ${fmtMs(base.median_ms)} | ${fmtMs(r.median)} | ${fmtMs(allowed)} | ${status} |`,
    );
    if (!ok) {
      breaches.push(
        `${GATED_CANDIDATE} median for ${r.fixture} is ${fmtMs(r.median)}, ` +
          `exceeds baseline ${fmtMs(base.median_ms)} × ${tolerance.toFixed(2)} tolerance ` +
          `(= ${fmtMs(allowed)})`,
      );
    }
  }
  lines.push('');

  // Surface fixtures listed in baseline but missing from the run
  // (e.g. someone deleted a fixture file but forgot to drop the entry).
  // These don't fail the gate but are worth flagging.
  const orphaned = Object.keys(baseline!.fixtures).filter(
    (f) => !results.some((r) => r.fixture === f),
  );
  if (orphaned.length > 0) {
    lines.push(
      `Note: baseline lists fixtures not present in this run: ${orphaned
        .map((f) => `\`${f}\``)
        .join(', ')}\n`,
    );
  }

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
