#!/usr/bin/env node

// Compares how long a CI Host run's shards spent in their test step with
// recent runs of the same kind, and records runs into a committed baseline.
//
// Usage:
//   node host-test-time.mjs check <baseline-json> [--slot <markdown-file>]
//   node host-test-time.mjs update <baseline-json>
//
// Reads GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID and GITHUB_EVENT_NAME.
// The token needs `actions: read`.
//
// The measure is the wall time of the "host test suite" step summed across the
// shards, from the jobs API. It is not the junit test times: a leak that slows
// the suite by adding garbage collection between tests leaves each test's own
// time unchanged, and only the step time shows it.
//
// A pull request run is compared with recent pull request runs, and a main run
// with recent main runs. Main indexes from scratch while pull requests import
// the index cache, so their totals sit on different scales. Runs on RunsOn and
// on GitHub's runners are kept apart for the same reason, and so are pull
// request runs that index from scratch because they change how indexing
// behaves (see check-index-cache in ci-host.yaml).
//
// `check` exits 0 and prints `slower=true|false` to GITHUB_OUTPUT, so the
// workflow can publish the PR comment section before it fails the job.
//
// `update` runs on main only. It adds this run to the main samples, and the
// pull request runs finished since the last update to the pull request
// samples. A main run over the threshold is recorded as flagged and left out
// of the main baseline, so a regression keeps failing the check until it is
// fixed rather than becoming the new normal after a few runs. To accept a
// slowdown on purpose, delete the `main` entries from the baseline file in the
// same PR; the next main runs rebuild it.

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const THRESHOLD = 1.4;
// The median of this many recent runs is the baseline.
const MAIN_WINDOW = 20;
const PR_WINDOW = 50;
// Too few runs make the median depend on one or two of them.
const MIN_RUNS = 10;
// Pull request samples older than this are not used: a runner kind that has
// been out of use for a while would otherwise be compared with stale values.
const PR_MAX_AGE_DAYS = 7;
// Entries kept in the file, enough for the windows above.
const MAIN_KEEP = 40;
const PR_KEEP = 300;
// A shard's test step longer than this is close to the job's 35-minute
// timeout once the ~6 minutes of setup before it are added.
const SHARD_WARN_MINUTES = 25;

const [command, baselinePath, ...rest] = process.argv.slice(2);
const opt = (name) => {
  let i = rest.indexOf(`--${name}`);
  return i === -1 ? undefined : rest[i + 1];
};

if (!['check', 'update'].includes(command) || !baselinePath) {
  console.error(
    'Usage: node host-test-time.mjs check|update <baseline-json> [--slot <markdown-file>]',
  );
  process.exit(2);
}

const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_EVENT_NAME } =
  process.env;
if (!GITHUB_TOKEN || !GITHUB_REPOSITORY || !GITHUB_RUN_ID) {
  console.error(
    'GITHUB_TOKEN, GITHUB_REPOSITORY and GITHUB_RUN_ID must be set.',
  );
  process.exit(2);
}

async function api(path) {
  let response = await fetch(
    `https://api.github.com/repos/${GITHUB_REPOSITORY}/${path}`,
    {
      headers: {
        authorization: `Bearer ${GITHUB_TOKEN}`,
        accept: 'application/vnd.github+json',
      },
    },
  );
  if (!response.ok) {
    throw new Error(`GET ${path}: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

// The run's test-step time, or undefined when a shard was cancelled or skipped
// or did not finish its test step, since its total would not be comparable.
// Also undefined when the shards disagree on the runner kind or on whether they
// imported the index cache, as after a re-run of failed jobs under different
// settings: the total would mix two scales.
async function measureRun(runId) {
  let { jobs } = await api(
    `actions/runs/${runId}/jobs?filter=latest&per_page=100`,
  );
  let shards = jobs.filter((j) => j.name.startsWith('Host Tests ('));
  if (shards.length === 0) return undefined;
  let stepMinutes = [];
  let importedCache = [];
  for (let job of shards) {
    if (!['success', 'failure'].includes(job.conclusion)) return undefined;
    let step = job.steps?.find(
      (s) => s.name.startsWith('host test suite') && s.completed_at,
    );
    if (!step) return undefined;
    let cacheStep = job.steps.find(
      (s) => s.name === 'Import cached realm index',
    );
    importedCache.push(cacheStep?.conclusion === 'success');
    stepMinutes.push(
      (Date.parse(step.completed_at) - Date.parse(step.started_at)) / 60000,
    );
  }
  let onRunsOn = shards.map((j) =>
    j.labels.some((l) => l.startsWith('runs-on')),
  );
  if (new Set(onRunsOn).size > 1 || new Set(importedCache).size > 1) {
    return undefined;
  }
  return {
    minutes: round(stepMinutes.reduce((a, b) => a + b, 0)),
    slowestShard: round(Math.max(...stepMinutes)),
    shards: shards.length,
    runsOn: onRunsOn[0],
    indexCache: importedCache[0],
  };
}

const round = (n) => Math.round(n * 10) / 10;

function median(values) {
  let sorted = [...values].sort((a, b) => a - b);
  let mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function readBaseline() {
  try {
    let baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
    return { main: [], pullRequest: [], ...baseline };
  } catch {
    return { main: [], pullRequest: [] };
  }
}

// The samples a run is compared with: the same event, runner kind, index cache
// use and shard count, newest last.
function comparable(baseline, event, run, now) {
  if (event === 'push') {
    return baseline.main
      .filter(
        (r) =>
          !r.flagged &&
          r.runsOn === run.runsOn &&
          r.indexCache === run.indexCache &&
          r.shards === run.shards,
      )
      .slice(-MAIN_WINDOW);
  }
  let oldest = now - PR_MAX_AGE_DAYS * 864e5;
  return baseline.pullRequest
    .filter(
      (r) =>
        r.minutes != null &&
        r.runsOn === run.runsOn &&
        r.indexCache === run.indexCache &&
        r.shards === run.shards &&
        Date.parse(r.at) >= oldest,
    )
    .slice(-PR_WINDOW);
}

function compare(baseline, event, run, now) {
  let samples = comparable(baseline, event, run, now);
  if (samples.length < MIN_RUNS) {
    return { count: samples.length };
  }
  let base = median(samples.map((r) => r.minutes));
  let ratio = run.minutes / base;
  return { count: samples.length, base, ratio, slower: ratio > THRESHOLD };
}

const runner = (run) =>
  `${run.runsOn ? 'RunsOn' : "GitHub's runners"}, ${run.indexCache ? 'importing the index cache' : 'indexing from scratch'}`;

async function check() {
  let event = GITHUB_EVENT_NAME === 'push' ? 'push' : 'pull_request';
  let baseline = readBaseline();
  let run = await measureRun(GITHUB_RUN_ID);
  let lines = ['### Host Test Time', ''];
  let slower = false;

  if (!run) {
    lines.push(
      'Not measured: a shard was cancelled or skipped or did not finish its test step, ' +
        'or the shards differ in runner kind or index cache use.',
    );
  } else {
    let result = compare(baseline, event, run, Date.now());
    let what = event === 'push' ? 'main runs' : 'pull request runs';
    if (result.ratio == null) {
      lines.push(
        `The shards took **${run.minutes.toFixed(0)} min** in their test step, on ${runner(run)}. ` +
          `Not compared: only ${result.count} recent ${what} on the same runners are recorded.`,
      );
    } else {
      slower = result.slower;
      lines.push(
        `${slower ? '⚠️ ' : ''}The shards took **${run.minutes.toFixed(0)} min** in their test step, ` +
          `**${result.ratio.toFixed(2)}×** the median of the last ${result.count} ${what} on ${runner(run)} ` +
          `(${result.base.toFixed(0)} min).`,
      );
      if (slower) {
        lines.push(
          '',
          `That is over the ${THRESHOLD}× threshold. A slowdown this size usually comes from a leak ` +
            '(retained apps or timers make garbage collection slower between tests) rather than from slower tests: ' +
            'compare the shards’ end-of-shard heap in their logs with a recent run.',
        );
        let lastMain = baseline.main.at(-1);
        if (event === 'pull_request' && lastMain?.flagged) {
          lines.push(
            '',
            'The latest recorded main run was also over the threshold, so this pull request may only have inherited a slowdown from main.',
          );
        }
      }
    }
    if (run.slowestShard > SHARD_WARN_MINUTES) {
      let message = `The slowest shard spent ${run.slowestShard.toFixed(0)} min in its test step, close to the job's 35-minute timeout.`;
      lines.push('', `⚠️ ${message}`);
      console.log(
        `::warning title=Host shard close to its timeout::${message}`,
      );
    }
  }

  let summary = lines.join('\n') + '\n';
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  }
  let slot = opt('slot');
  if (slot) writeFileSync(slot, summary);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `slower=${slower}\n`);
  }
}

async function update() {
  let baseline = readBaseline();
  let now = Date.now();

  let current = await api(`actions/runs/${GITHUB_RUN_ID}`);
  if (!baseline.main.some((r) => r.run === current.id)) {
    let run = await measureRun(current.id);
    if (run) {
      let { slower } = compare(baseline, 'push', run, now);
      baseline.main.push({
        run: current.id,
        at: current.created_at,
        ...run,
        ...(slower ? { flagged: true } : {}),
      });
      console.log(
        `Recorded this run: ${run.minutes} min${slower ? ', flagged as slower' : ''}.`,
      );
    } else {
      console.log('This run is not measurable; main samples unchanged.');
    }
  }

  // Pull request runs that finished since the newest recorded one. Each is
  // recorded once, also when it is not measurable (as `minutes: null`), so a
  // later update doesn't fetch its jobs again.
  let known = new Set(baseline.pullRequest.map((r) => r.run));
  let newest = baseline.pullRequest.at(-1)?.at;
  let since = new Date(
    Math.max(newest ? Date.parse(newest) - 6 * 3600e3 : 0, now - 2 * 864e5),
  ).toISOString();
  let candidates = [];
  for (let page = 1; page <= 5; page++) {
    let { workflow_runs } = await api(
      `actions/workflows/${current.workflow_id}/runs?event=pull_request&status=completed` +
        `&created=${encodeURIComponent(`>=${since}`)}&per_page=100&page=${page}`,
    );
    candidates.push(...workflow_runs);
    if (workflow_runs.length < 100) break;
  }
  let added = 0;
  for (let r of candidates.sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  )) {
    if (known.has(r.id) || !['success', 'failure'].includes(r.conclusion)) {
      continue;
    }
    let run = await measureRun(r.id);
    baseline.pullRequest.push({
      run: r.id,
      at: r.created_at,
      ...(run ?? { minutes: null }),
    });
    added++;
  }
  console.log(`Recorded ${added} pull request run(s).`);

  baseline.main = baseline.main
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-MAIN_KEEP);
  baseline.pullRequest = baseline.pullRequest
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-PR_KEEP);
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + '\n');
}

await (command === 'check' ? check() : update());
