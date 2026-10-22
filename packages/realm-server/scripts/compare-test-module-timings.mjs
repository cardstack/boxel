#!/usr/bin/env node
/* eslint-env node */

// Compares tests/test-module-timings.json at two points in history and says
// which test files the suite's time went to. The file is the shard-timings
// job's output (see scripts/generate-test-module-timings.mjs), committed on
// main several times a day, so its history is a record of what every file
// costs without downloading any CI report.
//
// Growth that matters rarely comes from one file: many files that are each
// reasonable add up. This answers "what grew since <date>" for when CI feels
// slow.
//
// Usage:
//   node scripts/compare-test-module-timings.mjs --since 2026-09-10
//   node scripts/compare-test-module-timings.mjs --since <ref> --until <ref>
//
// Options:
//   --since <date|ref>  Baseline: the file as of the last commit to it on or
//                       before that date, or at that git ref. Default: 21 days
//                       ago.
//   --until <date|ref>  The other end, resolved the same way. Default: HEAD.
//   --shard-count <n>   Also print the implied time per shard. There is no
//                       default, for the reason the generator has none: keep it
//                       equal to the realm-server matrix in
//                       .github/workflows/ci.yaml.
//   --top <n>           How many grown files to list. Default 15.
//
// Test counts are approximate: a count of `test(` calls in each file's source
// at the later revision, so a loop or a helper that registers tests counts as
// one or none.

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const timingsFile = 'tests/test-module-timings.json';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TEST_CALL = '(^|[^.[:alnum:]_])test(\\.[a-z]+)?\\(';

// Exported for tests/compare-test-module-timings-test.ts. Every file present
// at either end gets a row; a file absent at one end is new or removed, which
// is also how a renamed file shows up.
export function compareTimings(before, after, testCounts = {}) {
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
    grown: rows
      .filter((r) => r.status !== 'removed' && r.delta > 0)
      .sort(byDelta),
    shrunk: rows
      .filter((r) => r.status === 'kept' && r.delta < 0)
      .sort((a, b) => byDelta(b, a)),
    added: rows.filter((r) => r.status === 'new').length,
    removed: rows
      .filter((r) => r.status === 'removed')
      .sort((a, b) => byDelta(b, a)),
  };
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
      throw new Error(`${timingsFile} has no commit on or before ${spec}.`);
    }
    return sha;
  }
  return git('rev-parse', '--verify', `${spec}^{commit}`).trim();
}

function readTimingsAt(sha) {
  return JSON.parse(git('show', `${sha}:./${timingsFile}`));
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

function main(args) {
  const options = { since: undefined, until: 'HEAD', top: 15 };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[++i];
    if (flag === '--since') {
      options.since = value;
    } else if (flag === '--until') {
      options.until = value;
    } else if (flag === '--shard-count') {
      options.shardCount = Number(value);
    } else if (flag === '--top') {
      options.top = Number(value);
    } else {
      console.error(`Unexpected argument: ${flag}`);
      process.exit(1);
    }
  }
  if (
    (options.shardCount !== undefined &&
      !(Number.isInteger(options.shardCount) && options.shardCount > 0)) ||
    !(Number.isInteger(options.top) && options.top > 0)
  ) {
    console.error(
      'Usage: node scripts/compare-test-module-timings.mjs [--since date|ref] ' +
        '[--until date|ref] [--shard-count n] [--top n]',
    );
    process.exit(1);
  }
  if (!options.since) {
    const date = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000);
    options.since = date.toISOString().slice(0, 10);
  }

  const from = resolveRevision(options.since);
  const to = resolveRevision(options.until);
  const result = compareTimings(
    readTimingsAt(from),
    readTimingsAt(to),
    testCountsAt(to),
  );
  const { before, after } = result;

  console.log(`${timingsFile}: ${commitLabel(from)} → ${commitLabel(to)}\n`);
  console.log(
    `Total:      ${minutes(before.total)} → ${minutes(after.total)}` +
      percent(before.total, after.total),
  );
  if (options.shardCount) {
    console.log(
      `Per shard:  ${minutes(before.total / options.shardCount)} → ` +
        `${minutes(after.total / options.shardCount)} (${options.shardCount} shards)`,
    );
  }
  console.log(
    `Files:      ${before.files} → ${after.files} ` +
      `(${result.added} new, ${result.removed.length} removed)\n`,
  );

  if (result.grown.length) {
    console.log(
      `Grew most (${Math.min(options.top, result.grown.length)} of ${result.grown.length}):`,
    );
    console.log(table(result.grown.slice(0, options.top)));
    console.log();
  }
  if (result.shrunk.length) {
    console.log(
      `Shrank most (${Math.min(5, result.shrunk.length)} of ${result.shrunk.length}):`,
    );
    console.log(table(result.shrunk.slice(0, 5)));
    console.log();
  }
  if (result.removed.length) {
    console.log('Removed (a renamed file also shows as new above):');
    console.log(table(result.removed));
    console.log();
  }
  console.log(
    'Tests are counted from `test(` calls at the later revision, so they are approximate.',
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
