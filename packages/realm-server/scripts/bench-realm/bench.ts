// Wall-time benchmark for realm-server HTTP GET and `_search` against a
// committed fixture realm. Spins up an isolated realm-server stack
// (postgres + prerender + worker + realm-server) via the realm-test-harness
// package, runs each scenario WARMUP+ITER times, and reports per-scenario
// medians.
//
// Why `realm-test-harness` instead of realm-server's own test helpers:
// the harness boots the *full* production stack as a set of real child
// processes (matrix synapse, postgres, prerender, worker-manager,
// realm-server, host-dist) and exercises requests over real HTTP. The
// realm-server package's qunit helpers run an in-process Realm against a
// SQLite-or-in-memory pg adapter and a stubbed prerenderer — useful for
// unit tests, but they short-circuit the layers a real GET goes through:
// HTTP framing, queue round-trips, prerender child-process IPC, FastBoot
// startup, the worker-manager hand-off. A regression in any of those
// layers can recreate the 22s warm-cache cost CS-11079 fixed without
// failing a single existing test. The bench has to stay faithful to the
// production wire path or it doesn't actually defend the speedup.
//
// Run from `packages/realm-server`:
//   pnpm bench:realm        # measure-only
//   pnpm bench:realm:check  # gate: enforce baseline.json (or report-only when
//                             baseline.json is absent — see check.ts)
//
// Tunables via env vars:
//   ITER=50    iterations per scenario (default 50)
//   WARMUP=5   warmup iterations (default 5)
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve as pathResolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { startFactoryRealmServer } from '@cardstack/realm-test-harness';
import {
  searchEntryWireQueryFromQuery,
  type Query,
} from '@cardstack/runtime-common';

import { realmSnapshotDir } from './paths.ts';

// The harness's template-DB cache key already includes the fixture realm
// and the software-factory source-realm contents, but not the host/dist
// build. Without that, a host/ change (e.g. the schema-emission code in
// `module.ts` that produces `Definition.fieldDefs`) won't invalidate a
// previously-cached template, and the bench reads stale modules-table
// rows from the cached template — defeating the gate's purpose. Mix the
// host-dist build's index.html hash into the cache salt so any host
// rebuild forces a fresh template.
//
// If host/dist isn't built yet (fresh checkout), the harness will build
// it on demand via `findHostDistPackageDir` → `buildHostDist`. The salt
// here uses a stable `no-host-dist` sentinel in that case; the next
// bench run will see the real fingerprint and invalidate the template,
// which is correct — a different host produced the cached rows.
function hostDistFingerprint(): string {
  let indexPath = pathResolve(
    import.meta.dirname,
    '..',
    '..',
    '..',
    'host',
    'dist',
    'index.html',
  );
  try {
    let bytes = readFileSync(indexPath);
    return `host-dist:${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}`;
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return 'no-host-dist';
    }
    throw e;
  }
}
process.env.TEST_HARNESS_CACHE_SALT ??= hostDistFingerprint();

export const DEFAULT_ITERATIONS = 50;
export const DEFAULT_WARMUP = 5;

// The bench's snapshot fixture is intentionally self-contained: the bench
// depends only on packages it explicitly tests (runtime-common,
// realm-server, host, realm-test-harness, base) — not on
// software-factory. SF can change freely without affecting bench medians.
//
// `fixtures/source-realm/` is pre-trimmed to only the card-definition files
// the bench's instance JSONs `adoptsFrom`. No runtime fileFilter — the
// glob is materialized in the snapshot itself, so the bench mounts the
// realm with the default copy-everything semantics.
const benchSourceRealmDir = pathResolve(
  import.meta.dirname,
  'fixtures',
  'source-realm',
);

export interface Scenario {
  name: string;
  // Build the request relative to the running realm. Re-built each call so
  // the harness can vary per-iteration if needed (auth headers stay stable).
  request: (ctx: ScenarioContext) => Request;
  // First-pass sanity check on the response body. Runs once during warmup —
  // if the scenario actually fails (e.g. 404, error envelope), the bench
  // aborts before we waste 50 timed iterations on noise.
  validate?: (response: Response) => Promise<void>;
}

export interface ScenarioContext {
  realmURL: URL;
  // Source-realm URL within the ephemeral stack (e.g.
  // `http://localhost:NNNN/software-factory/`). The harness mounts the
  // `software-factory/realm/` directory there, and the fixture's
  // `adoptsFrom` references resolve to it after URL rewriting.
  sourceRealmURL: URL;
  bearerToken: string;
}

export interface Stats {
  mean_ms: number;
  median_ms: number;
  p95_ms: number;
  min_ms: number;
  max_ms: number;
}

export interface Result extends Stats {
  scenario: string;
  iterations: number;
  warmup: number;
}

export const stats = (samples: number[]): Stats => {
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const median =
    n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[(n - 1) / 2];
  const p95 = sorted[Math.min(n - 1, Math.ceil(0.95 * n) - 1)];
  return {
    mean_ms: mean,
    median_ms: median,
    p95_ms: p95,
    min_ms: sorted[0],
    max_ms: sorted[n - 1],
  };
};

// ---------------------------------------------------------------------------
// Scenario catalog
//
// Modeled on the cs-11003-e2e-1 fixture (the workload that surfaced the
// 22s warm-cache pre-CS-11079 baseline). Each card the bench fetches has
// a non-trivial linksTo / linksToMany graph adopting from
// `software-factory/...` modules — exercising the populateQueryFields →
// definitionLookup hot path that CS-11079 collapsed.

function jsonRequest(
  url: URL,
  bearerToken: string,
  acceptType: 'card+json' | 'api+json',
): Request {
  return new Request(url, {
    method: 'GET',
    headers: {
      Accept: `application/vnd.${acceptType}`,
      Authorization: `Bearer ${bearerToken}`,
    },
  });
}

function searchRequest(
  realmURL: URL,
  bearerToken: string,
  query: unknown,
): Request {
  let url = new URL('_search', realmURL);
  return new Request(url, {
    method: 'QUERY',
    headers: {
      Accept: 'application/vnd.card+json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearerToken}`,
    },
    // The search endpoint takes a search-entry-rooted query; benchmark the
    // data-only fieldset (one full `item` per result), the closest analogue
    // to the legacy live-card search response.
    body: JSON.stringify(
      searchEntryWireQueryFromQuery(query as Query, { fields: ['item'] }),
    ),
  });
}

const SCENARIOS: Scenario[] = [
  {
    name: 'GET Validations/eval_sticky-note-1',
    request: ({ realmURL, bearerToken }) =>
      jsonRequest(
        new URL('Validations/eval_sticky-note-1', realmURL),
        bearerToken,
        'card+json',
      ),
  },
  {
    name: 'GET Issues/sticky-note',
    request: ({ realmURL, bearerToken }) =>
      jsonRequest(
        new URL('Issues/sticky-note', realmURL),
        bearerToken,
        'card+json',
      ),
  },
  {
    name: 'search filter-by-type Validations',
    request: ({ realmURL, sourceRealmURL, bearerToken }) =>
      searchRequest(realmURL, bearerToken, {
        filter: {
          type: {
            module: new URL('eval-result', sourceRealmURL).href,
            name: 'EvalResult',
          },
        },
      }),
  },
];

export interface RunBenchOptions {
  iterations?: number;
  warmup?: number;
  scenarios?: string[];
}

async function timeOnce(
  scenario: Scenario,
  ctx: ScenarioContext,
  validate: boolean,
): Promise<number> {
  const request = scenario.request(ctx);
  const t0 = performance.now();
  const response = await fetch(request);
  // Drain the body so we time the full request -> response cycle, not just
  // headers.
  const body = await response.text();
  const elapsed = performance.now() - t0;
  if (response.status !== 200) {
    const requestUrl = request.url;
    const truncatedBody = body.length > 800 ? `${body.slice(0, 800)}…` : body;
    throw new Error(
      `${scenario.name}: status ${response.status} (expected 200)\n` +
        `  url:  ${requestUrl}\n` +
        `  body: ${truncatedBody}`,
    );
  }
  if (validate && scenario.validate) {
    // Re-issue to validate — the body has been drained on the timed pass.
    const checkResponse = await fetch(scenario.request(ctx));
    await scenario.validate(checkResponse);
  }
  return elapsed;
}

export async function runBench(
  options: RunBenchOptions = {},
): Promise<Result[]> {
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  const warmup = options.warmup ?? DEFAULT_WARMUP;
  const filter = options.scenarios;

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

  const scenarios = filter
    ? SCENARIOS.filter((s) => filter.includes(s.name))
    : SCENARIOS;
  if (scenarios.length === 0) {
    const want = filter ? `[${filter.join(', ')}]` : 'any';
    const have = SCENARIOS.map((s) => s.name).join(', ') || '<none>';
    throw new Error(
      `runBench: no scenarios matched (wanted=${want}, available=${have}).`,
    );
  }
  if (filter) {
    const matched = scenarios.map((s) => s.name);
    const missing = filter.filter((n) => !matched.includes(n));
    if (missing.length > 0) {
      throw new Error(
        `runBench: requested scenarios not found: ${missing.join(', ')}`,
      );
    }
  }

  const realm = await startFactoryRealmServer({
    realms: [
      { dir: realmSnapshotDir, path: 'test/' },
      { dir: benchSourceRealmDir, path: 'software-factory/' },
    ],
  });

  try {
    const ctx: ScenarioContext = {
      realmURL: new URL(realm.realmURL.href),
      sourceRealmURL: new URL('software-factory/', realm.realmServerURL),
      bearerToken: realm.createBearerToken(),
    };

    const results: Result[] = [];
    for (const scenario of scenarios) {
      // Validate the scenario once before any timed work. Separated from
      // warmup so the reported `warmup` count matches the iterations
      // actually run — `WARMUP=0` means zero warmup requests, period.
      await timeOnce(scenario, ctx, true);
      for (let i = 0; i < warmup; i++) {
        await timeOnce(scenario, ctx, false);
      }
      const samples: number[] = [];
      for (let i = 0; i < iterations; i++) {
        samples.push(await timeOnce(scenario, ctx, false));
      }
      results.push({
        scenario: scenario.name,
        iterations,
        warmup,
        ...stats(samples),
      });
    }
    return results;
  } finally {
    await realm.stop();
  }
}

const fmt = (ms: number) => `${ms.toFixed(2).padStart(8)}ms`;

async function main(): Promise<void> {
  const iterations = Number(process.env.ITER ?? DEFAULT_ITERATIONS);
  const warmup = Number(process.env.WARMUP ?? DEFAULT_WARMUP);

  console.log(
    `iterations=${iterations} warmup=${warmup} scenarios=${SCENARIOS.length}\n`,
  );

  const results = await runBench({ iterations, warmup });

  console.log(
    [
      'scenario'.padEnd(50),
      'mean'.padStart(10),
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
        fmt(r.mean_ms),
        fmt(r.median_ms),
        fmt(r.p95_ms),
        fmt(r.min_ms),
        fmt(r.max_ms),
      ].join('  '),
    );
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
