// Wall-time benchmark for AMD transpilation candidates against real
// card-source fixtures. Prints mean / median / p95 per candidate per
// fixture, plus a speedup-vs-babel-current table at the bottom.
//
// Run from `packages/runtime-common`:
//   pnpm bench:amd:prep    # generates fixtures
//   pnpm bench:amd         # runs the bench
//
// Tunables via env vars:
//   ITER=50    iterations per (candidate, fixture)
//   WARMUP=5   warmup iterations (results discarded)
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const ITERATIONS = Number(process.env.ITER ?? 50);
const WARMUP = Number(process.env.WARMUP ?? 5);

const fixturesDir = path.join(__dirname, 'fixtures');
const candidatesDir = path.join(__dirname, 'candidates');

const fixtures = readdirSync(fixturesDir)
  .filter((f) => f.endsWith('.js') && !f.startsWith('_'))
  .sort();
const candidateFiles = readdirSync(candidatesDir)
  .filter((f) => f.endsWith('.ts'))
  .sort();

interface Candidate {
  name: string;
  transform: (src: string, moduleId: string) => Promise<string>;
}

interface Stats {
  mean: number;
  median: number;
  p95: number;
  min: number;
  max: number;
}

interface Result extends Stats {
  candidate: string;
  fixture: string;
}

const stats = (samples: number[]): Stats => {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / sorted.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95 =
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  return { mean, median, p95, min: sorted[0], max: sorted[sorted.length - 1] };
};

const fmt = (ms: number) => `${ms.toFixed(2).padStart(8)}ms`;

(async () => {
  // ts-node intercepts `.ts` so `require()` returns the compiled module.
  const candidates: Candidate[] = [];
  for (const f of candidateFiles) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(path.join(candidatesDir, f));
    if (typeof mod.transform === 'function') {
      candidates.push({
        name: mod.name ?? f.replace(/\.ts$/, ''),
        transform: mod.transform,
      });
    }
  }

  console.log(
    `iterations=${ITERATIONS} warmup=${WARMUP} candidates=${candidates.length} fixtures=${fixtures.length}\n`,
  );

  const fixtureSrc: Record<string, string> = {};
  for (const f of fixtures) {
    fixtureSrc[f] = readFileSync(path.join(fixturesDir, f), 'utf8');
  }

  const results: Result[] = [];

  for (const fixture of fixtures) {
    console.log(`=== ${fixture} (${fixtureSrc[fixture].length} bytes) ===`);
    console.log(
      [
        'candidate'.padEnd(22),
        'mean'.padStart(10),
        'median'.padStart(10),
        'p95'.padStart(10),
        'min'.padStart(10),
        'max'.padStart(10),
      ].join('  '),
    );

    for (const c of candidates) {
      const moduleId = `http://example.com/${fixture}`;
      // Warmup
      for (let i = 0; i < WARMUP; i++) {
        await c.transform(fixtureSrc[fixture], moduleId);
      }
      const samples: number[] = [];
      for (let i = 0; i < ITERATIONS; i++) {
        const t0 = performance.now();
        await c.transform(fixtureSrc[fixture], moduleId);
        samples.push(performance.now() - t0);
      }
      const s = stats(samples);
      results.push({ candidate: c.name, fixture, ...s });
      console.log(
        [
          c.name.padEnd(22),
          fmt(s.mean),
          fmt(s.median),
          fmt(s.p95),
          fmt(s.min),
          fmt(s.max),
        ].join('  '),
      );
    }
    console.log();
  }

  // Summary: speedup vs babel-current per fixture, by median.
  console.log('=== speedup vs babel-current (by median) ===');
  const baselineName = 'babel-current';
  const cnames = candidates.map((c) => c.name);
  const header = [
    'fixture'.padEnd(22),
    ...cnames.map((n) => n.padStart(20)),
  ].join('  ');
  console.log(header);

  for (const fixture of fixtures) {
    const baseline = results.find(
      (r) => r.fixture === fixture && r.candidate === baselineName,
    );
    if (!baseline) continue;
    const row = [fixture.padEnd(22)];
    for (const c of cnames) {
      const r = results.find((x) => x.fixture === fixture && x.candidate === c);
      const speedup = baseline.median / r!.median;
      row.push(`${speedup.toFixed(2).padStart(18)}x`);
    }
    console.log(row.join('  '));
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
