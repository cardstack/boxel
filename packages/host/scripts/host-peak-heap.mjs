#!/usr/bin/env node

// Compares how much heap a CI Host run's shards used at their peak with recent
// main runs, and records main runs into a committed baseline.
//
// Usage:
//   node host-peak-heap.mjs check <reports-dir> <baseline-json> [--slot <markdown-file>]
//   node host-peak-heap.mjs update <reports-dir> <baseline-json>
//
// <reports-dir> holds the shards' memory-report-N.json files. Reads
// GITHUB_RUN_ID and GITHUB_EVENT_NAME; `update` also reads GITHUB_TOKEN and
// GITHUB_REPOSITORY, to record when the run was created.
//
// The measure is the median across shards of each shard's highest used heap.
// A leak that retains the app, its cards or its timers between tests makes
// every shard's heap grow with the number of tests it runs, so the median
// shard moves by a multiple. Changes that add or remove tests move it by a few
// percent. Over six weeks of runs, no run without a leak was more than 1.25×
// the median of the runs before it, and runs with a leak were more than 3×.
//
// Pull request runs and main runs are both compared with main runs: heap does
// not depend on whether the run imported the index cache or on the runner, so
// unlike test time, the two sit on one scale.
//
// `check` exits 0 and prints `higher=true|false` to GITHUB_OUTPUT, so the
// workflow can publish the PR comment section before it fails the job.
//
// `update` runs on main only and adds this run to the samples. A run over the
// threshold is recorded as flagged and left out of the baseline, so a leak
// keeps failing the check until it is fixed rather than becoming the new
// normal after a few runs. To accept a higher heap on purpose, delete the
// entries from the baseline file in the same PR; the next main runs rebuild it.
//
// A shard that times out uploads no memory report, and a bad leak is what
// pushes a shard past its timeout. So a run with fewer shards than the latest
// main run is still compared, by the median of the shards that left a report,
// and the report names how many are missing.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  api,
  median,
  newest,
  opt,
  publish,
  readBaseline,
  writeBaseline,
} from './host-baseline-check.mjs';

const THRESHOLD = 2;
// The median of this many recent main runs is the baseline.
const WINDOW = 20;
// Too few runs make the median depend on one or two of them.
const MIN_RUNS = 10;
// Entries kept in the file, enough for the window above.
const KEEP = 40;

const [command, reportsDir, baselinePath, ...rest] = process.argv.slice(2);

if (!['check', 'update'].includes(command) || !reportsDir || !baselinePath) {
  console.error(
    'Usage: node host-peak-heap.mjs check|update <reports-dir> <baseline-json> [--slot <markdown-file>]',
  );
  process.exit(2);
}

const { GITHUB_RUN_ID, GITHUB_EVENT_NAME } = process.env;

// The run's median shard peak, or undefined when no shard left a report. A
// shard whose report is empty did not run its tests and is left out.
function measureRun() {
  let peaks = [];
  let files;
  try {
    files = readdirSync(reportsDir).filter((f) => f.endsWith('.json'));
  } catch {
    return undefined;
  }
  for (let file of files) {
    let report = JSON.parse(readFileSync(join(reportsDir, file), 'utf8'));
    let used = Object.values(report).map((m) => m.used_mb);
    if (used.length > 0) peaks.push(Math.max(...used));
  }
  if (peaks.length === 0) return undefined;
  return {
    peakMb: Math.round(median(peaks)),
    highestShardMb: Math.round(Math.max(...peaks)),
    shards: peaks.length,
  };
}

// Samples are main runs split into as many shards as this run, since the
// split changes what the median shard holds. A run with fewer shards than the
// latest main run is taken to have lost reports, not to be split differently,
// and is compared with runs of the latest main run's shard count.
function compare(baseline, run) {
  let expected = baseline.main.at(-1)?.shards;
  let shards = expected && run.shards < expected ? expected : run.shards;
  let samples = baseline.main
    .filter((r) => !r.flagged && r.shards === shards && r.run !== run.runId)
    .slice(-WINDOW);
  let missing = shards - run.shards;
  if (samples.length < MIN_RUNS) {
    return { count: samples.length, shards, missing };
  }
  let base = median(samples.map((r) => r.peakMb));
  let ratio = run.peakMb / base;
  return {
    count: samples.length,
    shards,
    missing,
    base,
    ratio,
    higher: ratio > THRESHOLD,
  };
}

function check() {
  let baseline = readBaseline(baselinePath, { main: [] });
  let run = measureRun();
  let lines = ['### Host Peak Heap', ''];
  let higher = false;

  if (!run) {
    lines.push('Not measured: no shard left a memory report.');
  } else {
    let result = compare(baseline, { ...run, runId: Number(GITHUB_RUN_ID) });
    if (result.ratio == null) {
      lines.push(
        `The median shard peaked at **${run.peakMb} MB** of used heap across ${run.shards} shards. ` +
          `Not compared: only ${result.count} recent main runs with ${result.shards} shards are recorded.`,
      );
    } else {
      higher = result.higher;
      lines.push(
        `${higher ? '⚠️ ' : ''}The median shard peaked at **${run.peakMb} MB** of used heap, ` +
          `**${result.ratio.toFixed(2)}×** the median of the last ${result.count} main runs ` +
          `(${Math.round(result.base)} MB).`,
      );
      if (higher) {
        lines.push(
          '',
          `That is over the ${THRESHOLD}× threshold, which usually means a leak: something retains ` +
            'the app, its cards or its timers between tests, so the heap grows with every test a shard runs. ' +
            'The Host Memory Baseline job lists the modules whose heap grew most.',
        );
        let lastMain = baseline.main.at(-1);
        if (GITHUB_EVENT_NAME === 'pull_request' && lastMain?.flagged) {
          lines.push(
            '',
            'The latest recorded main run was also over the threshold, so this pull request may only have inherited the leak from main.',
          );
        }
      }
    }
    if (result.missing > 0) {
      let message =
        `${result.missing} of ${result.shards} shards left no memory report, as a shard that times out does. ` +
        `The median is of the ${run.shards} that did.`;
      lines.push('', `⚠️ ${message}`);
      console.log(
        `::warning title=Host shard memory reports missing::${message}`,
      );
    }
  }

  publish(lines, { slot: opt(rest, 'slot'), output: 'higher', value: higher });
}

async function update() {
  let baseline = readBaseline(baselinePath, { main: [] });
  let runId = Number(GITHUB_RUN_ID);
  if (baseline.main.some((r) => r.run === runId)) {
    console.log('This run is already recorded.');
    return;
  }
  let run = measureRun();
  if (!run) {
    console.log('This run left no memory reports; samples unchanged.');
    return;
  }
  let { higher, missing } = compare(baseline, { ...run, runId });
  if (missing > 0) {
    console.log(
      `${missing} shard(s) left no memory report; samples unchanged.`,
    );
    return;
  }
  let { created_at } = await api(`actions/runs/${runId}`);
  baseline.main.push({
    run: runId,
    at: created_at,
    ...run,
    ...(higher ? { flagged: true } : {}),
  });
  console.log(
    `Recorded this run: ${run.peakMb} MB${higher ? ', flagged as higher' : ''}.`,
  );
  baseline.main = newest(baseline.main, KEEP);
  writeBaseline(baselinePath, baseline);
}

await (command === 'check' ? check() : update());
