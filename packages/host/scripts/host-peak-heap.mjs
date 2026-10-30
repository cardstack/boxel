#!/usr/bin/env node

// Compares how much heap a CI Host run's shards used at their peak with recent
// main runs, and records main runs into a committed baseline.
//
// Usage:
//   node host-peak-heap.mjs check <reports-dir> <baseline-json> [--slot <markdown-file>]
//   node host-peak-heap.mjs update <reports-dir> <baseline-json>
//
// <reports-dir> holds the shards' memory-report-N.json files. Reads
// GITHUB_RUN_ID and GITHUB_EVENT_NAME.
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

import {
  appendFileSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const THRESHOLD = 2;
// The median of this many recent main runs is the baseline.
const WINDOW = 20;
// Too few runs make the median depend on one or two of them.
const MIN_RUNS = 10;
// Entries kept in the file, enough for the window above.
const KEEP = 40;

const [command, reportsDir, baselinePath, ...rest] = process.argv.slice(2);
const opt = (name) => {
  let i = rest.indexOf(`--${name}`);
  return i === -1 ? undefined : rest[i + 1];
};

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

function median(values) {
  let sorted = [...values].sort((a, b) => a - b);
  let mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function readBaseline() {
  try {
    let baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
    return { main: [], ...baseline };
  } catch {
    return { main: [] };
  }
}

// A shard count other than the baseline's means a shard left no report, or the
// suite was split differently; either changes what the median shard holds.
function compare(baseline, run) {
  let samples = baseline.main
    .filter((r) => !r.flagged && r.shards === run.shards && r.run !== run.runId)
    .slice(-WINDOW);
  if (samples.length < MIN_RUNS) {
    return { count: samples.length };
  }
  let base = median(samples.map((r) => r.peakMb));
  let ratio = run.peakMb / base;
  return { count: samples.length, base, ratio, higher: ratio > THRESHOLD };
}

function check() {
  let baseline = readBaseline();
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
          `Not compared: only ${result.count} recent main runs with ${run.shards} shards are recorded.`,
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
  }

  let summary = lines.join('\n') + '\n';
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  }
  let slot = opt('slot');
  if (slot) writeFileSync(slot, summary);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `higher=${higher}\n`);
  }
}

function update() {
  let baseline = readBaseline();
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
  let { higher } = compare(baseline, { ...run, runId });
  baseline.main.push({
    run: runId,
    at: new Date().toISOString(),
    ...run,
    ...(higher ? { flagged: true } : {}),
  });
  console.log(
    `Recorded this run: ${run.peakMb} MB${higher ? ', flagged as higher' : ''}.`,
  );
  baseline.main = baseline.main
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-KEEP);
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + '\n');
}

command === 'check' ? check() : update();
