// Wall-time benchmark for AMD transpilation candidates against real
// card-source fixtures. Prints mean / median / p95 per candidate per
// fixture, plus a speedup-vs-babel-current table at the bottom.
//
// Run from `packages/runtime-common`:
//   pnpm bench:amd:prep    # regenerates committed fixtures
//   pnpm bench:amd         # runs the bench
//
// Tunables via env vars:
//   ITER=50    iterations per (candidate, fixture)
//   WARMUP=5   warmup iterations (results discarded)
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { candidatesDir, fixturesDir } from './paths.ts';

export const DEFAULT_ITERATIONS = 50;
export const DEFAULT_WARMUP = 5;

export interface Candidate {
  name: string;
  transform: (src: string, moduleId: string) => Promise<string>;
}

export interface Stats {
  mean: number;
  median: number;
  p95: number;
  min: number;
  max: number;
}

export interface Result extends Stats {
  candidate: string;
  fixture: string;
  iterations: number;
}

export const stats = (samples: number[]): Stats => {
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  // Standard median: average the two middle elements for even n.
  const median =
    n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[(n - 1) / 2];
  // Standard nearest-rank p95: index `ceil(0.95 * n) - 1` (zero-based).
  const p95 = sorted[Math.min(n - 1, Math.ceil(0.95 * n) - 1)];
  return { mean, median, p95, min: sorted[0], max: sorted[n - 1] };
};

export interface RunBenchOptions {
  iterations?: number;
  warmup?: number;
  // Restrict to a subset of candidate names. Default: all candidates.
  candidates?: string[];
}

export function listFixtures(): string[] {
  return readdirSync(fixturesDir)
    .filter((f) => f.endsWith('.js') && !f.startsWith('_'))
    .sort();
}

export async function loadCandidates(): Promise<Candidate[]> {
  const candidateFiles = readdirSync(candidatesDir)
    .filter((f) => f.endsWith('.ts'))
    .sort();
  const candidates: Candidate[] = [];
  for (const f of candidateFiles) {
    // ts-node intercepts `.ts` so `require()` returns the compiled module.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(path.join(candidatesDir, f));
    if (typeof mod.transform === 'function') {
      candidates.push({
        name: mod.name ?? f.replace(/\.ts$/, ''),
        transform: mod.transform,
      });
    }
  }
  return candidates;
}

export async function runBench(
  options: RunBenchOptions = {},
): Promise<Result[]> {
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  const warmup = options.warmup ?? DEFAULT_WARMUP;
  const filter = options.candidates;

  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error(
      `runBench: iterations must be a positive integer, got ${iterations}`,
    );
  }
  if (!Number.isInteger(warmup) || warmup < 0) {
    throw new Error(
      `runBench: warmup must be a non-negative integer, got ${warmup}`,
    );
  }

  const fixtures = listFixtures();
  if (fixtures.length === 0) {
    throw new Error(
      `runBench: no fixtures found in ${fixturesDir}. Run \`pnpm bench:amd:prep\` to generate them.`,
    );
  }

  const allCandidates = await loadCandidates();
  const candidates = filter
    ? allCandidates.filter((c) => filter.includes(c.name))
    : allCandidates;
  if (candidates.length === 0) {
    const want = filter ? `[${filter.join(', ')}]` : 'any';
    const have = allCandidates.map((c) => c.name).join(', ') || '<none>';
    throw new Error(
      `runBench: no candidates matched (wanted=${want}, available=${have}).`,
    );
  }
  if (filter) {
    const matchedNames = candidates.map((c) => c.name);
    const missing = filter.filter((n) => !matchedNames.includes(n));
    if (missing.length > 0) {
      throw new Error(
        `runBench: requested candidates not found: ${missing.join(', ')}. Available: ${allCandidates.map((c) => c.name).join(', ')}.`,
      );
    }
  }

  const fixtureSrc: Record<string, string> = {};
  for (const f of fixtures) {
    fixtureSrc[f] = readFileSync(path.join(fixturesDir, f), 'utf8');
  }

  const results: Result[] = [];
  for (const fixture of fixtures) {
    for (const c of candidates) {
      const moduleId = `http://example.com/${fixture}`;
      for (let i = 0; i < warmup; i++) {
        await c.transform(fixtureSrc[fixture], moduleId);
      }
      const samples: number[] = [];
      for (let i = 0; i < iterations; i++) {
        const t0 = performance.now();
        await c.transform(fixtureSrc[fixture], moduleId);
        samples.push(performance.now() - t0);
      }
      const s = stats(samples);
      results.push({ candidate: c.name, fixture, iterations, ...s });
    }
  }
  return results;
}

const fmt = (ms: number) => `${ms.toFixed(2).padStart(8)}ms`;

async function main() {
  const iterations = Number(process.env.ITER ?? DEFAULT_ITERATIONS);
  const warmup = Number(process.env.WARMUP ?? DEFAULT_WARMUP);

  const fixtures = listFixtures();
  const candidates = await loadCandidates();

  console.log(
    `iterations=${iterations} warmup=${warmup} candidates=${candidates.length} fixtures=${fixtures.length}\n`,
  );

  const results = await runBench({ iterations, warmup });

  // Per-fixture detail table (preserves the original UX).
  for (const fixture of fixtures) {
    const fixtureBytes = readFileSync(
      path.join(fixturesDir, fixture),
      'utf8',
    ).length;
    console.log(`=== ${fixture} (${fixtureBytes} bytes) ===`);
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
      const r = results.find(
        (x) => x.fixture === fixture && x.candidate === c.name,
      );
      if (!r) continue;
      console.log(
        [
          c.name.padEnd(22),
          fmt(r.mean),
          fmt(r.median),
          fmt(r.p95),
          fmt(r.min),
          fmt(r.max),
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
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
