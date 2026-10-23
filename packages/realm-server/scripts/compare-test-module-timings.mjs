#!/usr/bin/env node
/* eslint-env node */

// Compares tests/test-module-timings.json at two points in history and says
// which test files the suite's time went to. The file is the shard-timings
// job's output (see scripts/generate-test-module-timings.mjs), so its history
// records what every file cost without downloading any CI report.
//
// The history is drift-gated, not sampled. The job rewrites the file only when
// repacking with fresh measurements would cut the predicted slowest shard by
// a minimum (--min-drift-seconds in .github/workflows/ci.yaml). A slowdown
// that leaves the packing about the same — shared setup getting slower, or
// growth spread evenly across files — is not committed until some later run
// opens the gate, and that run then writes every file's fresh time at once.
// So the weights at either end can be days older than the commit date
// suggests, and growth inside the window can show up late.
//
// Usage:
//   node scripts/compare-test-module-timings.mjs --since 2026-09-10
//   node scripts/compare-test-module-timings.mjs --since <ref> --until <ref>
//
// Options:
//   --since <date|ref>  Baseline: the file as of the last commit to it on or
//                       before that local date, or at that git ref. Default:
//                       21 days ago.
//   --until <date|ref>  The other end, resolved the same way. Default: HEAD.
//   --shard-count <n>   Also print the predicted slowest shard at each end,
//                       packed the way CI packs it. There is no default, for
//                       the reason the generator has none. The same count
//                       applies to both ends, so the comparison is of the
//                       suite, not of a matrix change inside the window.
//   --top <n>           How many files each list shows. Default 15.
//
// Test counts are approximate: a count of `test(` calls in each file's source
// at the later revision, so a loop or a helper that registers tests counts as
// one or none.

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import shardTestModules from './shard-test-modules.cjs';

const { DEFAULT_WEIGHT, assignByWeight, weightFor } = shardTestModules;

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const timingsFile = 'tests/test-module-timings.json';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TEST_CALL = '(^|[^.[:alnum:]_])test(\\.[a-z]+)?\\(';
const USAGE =
  'Usage: node scripts/compare-test-module-timings.mjs [--since date|ref] ' +
  '[--until date|ref] [--shard-count n] [--top n]';

// Exported for tests/compare-test-module-timings-test.ts. Every file present
// at either end gets a row; a file absent at one end is new or removed, which
// is also how a renamed file shows up. `filesAfter`, the test files on disk at
// the later end, finds the ones no run has measured yet.
export function compareTimings(
  before,
  after,
  testCounts = {},
  filesAfter = [],
) {
  const files = new Set([...Object.keys(before), ...Object.keys(after)]);
  const rows = [...files].map((file) => {
    const was = before[file];
    const now = after[file];
    const status =
      was === undefined ? 'new' : now === undefined ? 'removed' : 'kept';
    const delta = round((now ?? 0) - (was ?? 0));
    const tests = testCounts[file];
    return {
      file,
      before: was,
      after: now,
      delta,
      status,
      tests,
      secondsPerTest:
        now !== undefined && tests ? round(now / tests) : undefined,
    };
  });
  const sum = (timings) =>
    round(Object.values(timings).reduce((total, s) => total + s, 0));
  const byDelta = (a, b) => b.delta - a.delta || a.file.localeCompare(b.file);
  return {
    before: { total: sum(before), files: Object.keys(before).length },
    after: { total: sum(after), files: Object.keys(after).length },
    // A new file is listed even at 0s, so every added file can be named.
    grown: rows
      .filter((r) => r.status === 'new' || (r.status === 'kept' && r.delta > 0))
      .sort(byDelta),
    shrunk: rows
      .filter((r) => r.status === 'kept' && r.delta < 0)
      .sort((a, b) => byDelta(b, a)),
    added: rows.filter((r) => r.status === 'new').length,
    removed: rows
      .filter((r) => r.status === 'removed')
      .sort((a, b) => byDelta(b, a)),
    unmeasured: filesAfter.filter((file) => after[file] === undefined).sort(),
  };
}

// The load of the heaviest bin when `files` are packed the way CI packs them:
// measured zeros floored to MIN_WEIGHT, unmeasured files at DEFAULT_WEIGHT.
// This, not total / shardCount, is what a CI run waits on.
export function slowestShard(files, timings, shardCount) {
  let slowest = 0;
  for (let shard = 1; shard <= shardCount; shard++) {
    const load = assignByWeight(files, timings, shard, shardCount).reduce(
      (sum, file) => sum + weightFor(file, timings),
      0,
    );
    slowest = Math.max(slowest, load);
  }
  return round(slowest);
}

function round(seconds) {
  return Math.round(seconds * 10) / 10;
}

function git(...args) {
  return execFileSync('git', args, {
    cwd: packageDir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

// A date picks the last commit to the timings file on or before the end of
// that day, so the baseline is the weights as they stood then rather than
// whatever commit happened to land nearest.
function resolveRevision(spec) {
  if (DATE.test(spec)) {
    const sha = git(
      'rev-list',
      '-1',
      `--before=${spec} 23:59:59`,
      'HEAD',
      '--',
      timingsFile,
    ).trim();
    if (!sha) {
      // A shallow clone (the actions/checkout default) has cut the history
      // off, which is not the same as the file having no commit then.
      if (git('rev-parse', '--is-shallow-repository').trim() === 'true') {
        fail(
          `This clone is shallow, so the history before ${spec} is missing. ` +
            `Run \`git fetch --shallow-since=${spec}\` (or \`git fetch --unshallow\`) and retry.`,
        );
      }
      fail(`${timingsFile} has no commit on or before ${spec}.`);
    }
    return sha;
  }
  try {
    return git('rev-parse', '--verify', '--quiet', `${spec}^{commit}`).trim();
  } catch {
    fail(`${spec} is neither a YYYY-MM-DD date nor a commit.`);
  }
}

function readTimingsAt(sha) {
  return JSON.parse(git('show', `${sha}:./${timingsFile}`));
}

// The same discovery rule as collectTestModules in shard-test-modules.cjs,
// read from a commit instead of the working tree.
function testFilesAt(sha) {
  return git('ls-tree', '-r', '--name-only', sha, '--', 'tests')
    .split('\n')
    .filter((path) => path.endsWith('-test.ts'))
    .map((path) => path.slice('tests/'.length))
    .sort();
}

function testCountsAt(sha) {
  const counts = {};
  let output = '';
  try {
    output = git('grep', '-c', '-E', TEST_CALL, sha, '--', 'tests');
  } catch (err) {
    // git grep exits 1 when nothing matches, which is not an error here.
    if (err.status !== 1) {
      throw err;
    }
  }
  for (const line of output.split('\n')) {
    const match = /^[^:]+:tests\/(.+):(\d+)$/.exec(line);
    if (match) {
      counts[match[1]] = Number(match[2]);
    }
  }
  return counts;
}

function commitLabel(sha) {
  return git('show', '-s', '--format=%cs %h', sha).trim();
}

// Local, because git reads the date in `--before` as local time.
function localDateDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function minutes(seconds) {
  return `${(seconds / 60).toFixed(1)} min`;
}

function signed(value, format) {
  return `${value >= 0 ? '+' : '−'}${format(Math.abs(value))}`;
}

function percent(before, after) {
  return before
    ? ` (${signed(((after - before) / before) * 100, (p) => `${p.toFixed(0)}%`)})`
    : '';
}

function table(rows) {
  const seconds = (value) =>
    value === undefined ? '—' : `${value.toFixed(1)}s`;
  const lines = rows.map((r) => [
    seconds(r.before),
    seconds(r.after),
    signed(r.delta, (d) => `${d.toFixed(1)}s`),
    r.tests === undefined ? '—' : `≈${r.tests}`,
    r.secondsPerTest === undefined ? '—' : `${r.secondsPerTest.toFixed(1)}s`,
    r.status === 'new' ? `${r.file} (new)` : r.file,
  ]);
  const header = ['before', 'after', 'delta', 'tests', 'per test', 'file'];
  const widths = header.map((h, i) =>
    Math.max(h.length, ...lines.map((l) => l[i].length)),
  );
  return [header, ...lines]
    .map((cells) =>
      cells
        .map((cell, i) =>
          i === cells.length - 1 ? cell : cell.padStart(widths[i]),
        )
        .join('  '),
    )
    .join('\n');
}

function printList(title, items, top, render) {
  if (!items.length) {
    return;
  }
  console.log(`${title} (${Math.min(top, items.length)} of ${items.length}):`);
  console.log(render(items.slice(0, top)));
  console.log();
}

function parseOptions(args) {
  let values;
  try {
    ({ values } = parseArgs({
      args,
      options: {
        since: { type: 'string' },
        until: { type: 'string', default: 'HEAD' },
        'shard-count': { type: 'string' },
        top: { type: 'string', default: '15' },
        help: { type: 'boolean', short: 'h' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (err) {
    fail(`${err.message}\n${USAGE}`);
  }
  if (values.help) {
    console.log(USAGE);
    process.exit(0);
  }
  const shardCount =
    values['shard-count'] === undefined
      ? undefined
      : Number(values['shard-count']);
  const top = Number(values.top);
  if (
    (shardCount !== undefined &&
      !(Number.isInteger(shardCount) && shardCount > 0)) ||
    !(Number.isInteger(top) && top > 0)
  ) {
    fail(`--shard-count and --top take a positive whole number.\n${USAGE}`);
  }
  return {
    since: values.since ?? localDateDaysAgo(21),
    until: values.until,
    shardCount,
    top,
  };
}

function main(args) {
  const options = parseOptions(args);
  const from = resolveRevision(options.since);
  const to = resolveRevision(options.until);
  const before = readTimingsAt(from);
  const after = readTimingsAt(to);
  const filesAfter = testFilesAt(to);
  const result = compareTimings(before, after, testCountsAt(to), filesAfter);

  console.log(`${timingsFile}: ${commitLabel(from)} → ${commitLabel(to)}\n`);
  console.log(
    `Total:          ${minutes(result.before.total)} → ${minutes(result.after.total)}` +
      percent(result.before.total, result.after.total),
  );
  if (options.shardCount) {
    const was = slowestShard(testFilesAt(from), before, options.shardCount);
    const now = slowestShard(filesAfter, after, options.shardCount);
    console.log(
      `Slowest shard:  ${minutes(was)} → ${minutes(now)}${percent(was, now)} ` +
        `(predicted, ${options.shardCount} shards at both ends)`,
    );
  }
  console.log(
    `Files:          ${result.before.files} → ${result.after.files} ` +
      `(${result.added} new, ${result.removed.length} removed)\n`,
  );

  printList('Grew most', result.grown, options.top, table);
  printList('Shrank most', result.shrunk, options.top, table);
  printList(
    'Removed — a renamed file also shows as new above',
    result.removed,
    options.top,
    table,
  );
  printList(
    `Not measured yet (CI packs each at ${DEFAULT_WEIGHT}s)`,
    result.unmeasured,
    options.top,
    (files) => files.map((file) => `  ${file}`).join('\n'),
  );

  console.log(
    'The timings file is rewritten only when a rebalance is worth a commit, so ' +
      'the weights at each end can be days older than the commit dates above.\n' +
      'Tests are counted from `test(` calls at the later revision, so they are approximate.',
  );
}

// Compare real paths, so the script still runs when invoked through a symlink,
// and do nothing when imported with no script path (node -e, a REPL).
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  main(process.argv.slice(2));
}
