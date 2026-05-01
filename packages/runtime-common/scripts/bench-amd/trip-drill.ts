// Faithful trip drill for the AMD-transpile bench gate.
//
// Wraps the real `transpileAmd` with an artificial per-call delay,
// runs a small bench (production candidate × all fixtures), compares
// each median against the committed `baseline.json` × tolerance, and
// asserts every fixture trips. This is the literal "introduce an
// artificial setTimeout in the rewriter and watch the gate fail" drill
// CS-10983 calls out, exercised against the real transpiler and the
// real baseline rather than synthetic numbers.
//
// Run from `packages/runtime-common`:
//   pnpm bench:amd:trip-drill
//
// Or from the repo root via mise:
//   mise run bench:amd-trip-drill
//
// This is **out-of-band** by design — it doesn't run in CI because
// running it on every PR is wasteful (the synthetic trip-test already
// proves the gate's failure path), and the cheap synthetic test
// covers the same correctness assertion. Use this drill when you
// touch the gate itself and want to confirm the whole pipeline still
// works end-to-end against a real perf regression.
import { performance } from 'node:perf_hooks';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { fixturesDir, baselinePath } from './paths';
import { transpileAmd } from '../../amd-transpile';
import { stats } from './bench';

// 5ms/call is enough to push every fixture (median 0.65–10ms baseline)
// past 1.25× tolerance with comfortable margin. Tunable via env var
// for experimentation.
const ARTIFICIAL_DELAY_MS = Number(process.env.TRIP_DRILL_DELAY_MS ?? 5);
const ITER = Number(process.env.ITER ?? 10);
const WARMUP = Number(process.env.WARMUP ?? 2);

interface Baseline {
  tolerance: number;
  noise_floor_ms?: number;
  candidate: string;
  fixtures: Record<string, { median_ms: number }>;
}

// Mirrors `check.ts`'s allowed-threshold formula so the drill's
// pass/trip decisions match the gate exactly.
function allowedMs(baselineMs: number, b: Baseline): number {
  const relative = baselineMs * b.tolerance;
  const absolute = baselineMs + (b.noise_floor_ms ?? 0);
  return Math.max(relative, absolute);
}

(async () => {
  if (!existsSync(baselinePath)) {
    console.error(
      `trip-drill: ${baselinePath} not found. The drill compares against the committed baseline; nothing to compare against.`,
    );
    process.exit(1);
  }
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Baseline;
  if (baseline.candidate !== 'production') {
    console.error(
      `trip-drill: baseline.json declares candidate=${baseline.candidate}; expected 'production'.`,
    );
    process.exit(1);
  }

  const fixtures = readdirSync(fixturesDir)
    .filter((f) => f.endsWith('.js') && !f.startsWith('_'))
    .sort();

  console.log(
    `trip-drill: wrapping production transpileAmd with ${ARTIFICIAL_DELAY_MS}ms artificial delay (iterations=${ITER} warmup=${WARMUP})`,
  );
  console.log(
    `trip-drill: comparing against committed baseline at ${baselinePath} (tolerance ×${baseline.tolerance})\n`,
  );

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

  // The "regression": a synthetic per-call delay that simulates an
  // accidentally-introduced O(N) hot-path slowdown in the rewriter.
  // Real transpileAmd is still called so the timing includes real
  // work, just delayed.
  const wrappedTransform = async (
    src: string,
    moduleId: string,
  ): Promise<string> => {
    await sleep(ARTIFICIAL_DELAY_MS);
    return transpileAmd(src, { moduleId });
  };

  const fixtureSrc: Record<string, string> = {};
  for (const f of fixtures) {
    fixtureSrc[f] = readFileSync(path.join(fixturesDir, f), 'utf8');
  }

  const breaches: string[] = [];
  const passes: string[] = [];
  const missing: string[] = [];

  console.log(
    `${'fixture'.padEnd(20)}  ${'baseline'.padStart(10)}  ${'allowed'.padStart(10)}  ${'measured'.padStart(10)}  ${'status'.padStart(8)}`,
  );

  for (const fixture of fixtures) {
    const base = baseline.fixtures[fixture];
    if (!base) {
      missing.push(fixture);
      continue;
    }
    const moduleId = `http://example.com/${fixture}`;
    for (let i = 0; i < WARMUP; i++) {
      await wrappedTransform(fixtureSrc[fixture], moduleId);
    }
    const samples: number[] = [];
    for (let i = 0; i < ITER; i++) {
      const t0 = performance.now();
      await wrappedTransform(fixtureSrc[fixture], moduleId);
      samples.push(performance.now() - t0);
    }
    const s = stats(samples);
    const allowed = allowedMs(base.median_ms, baseline);
    const ok = s.median <= allowed;
    const status = ok ? 'pass' : 'TRIP';
    console.log(
      `${fixture.padEnd(20)}  ${base.median_ms.toFixed(2).padStart(8)}ms  ${allowed.toFixed(2).padStart(8)}ms  ${s.median.toFixed(2).padStart(8)}ms  ${status.padStart(8)}`,
    );
    if (ok) {
      passes.push(fixture);
    } else {
      breaches.push(fixture);
    }
  }

  console.log();
  if (missing.length > 0) {
    console.error(
      `trip-drill: baseline lists fixtures with no measurement: ${missing.join(', ')}. Drill cannot complete.`,
    );
    process.exit(1);
  }

  if (breaches.length === fixtures.length) {
    console.log(
      `PASS — every fixture (${breaches.length}/${fixtures.length}) tripped the gate. The bench gate's regression-detection path works against a real perf regression.`,
    );
    return;
  }

  console.error(
    `FAIL — only ${breaches.length}/${fixtures.length} fixtures tripped (passed: ${passes.join(', ') || '<none>'}). ` +
      `The ${ARTIFICIAL_DELAY_MS}ms delay was not enough to push every fixture past tolerance — ` +
      `try TRIP_DRILL_DELAY_MS=10 or higher.`,
  );
  process.exit(1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
