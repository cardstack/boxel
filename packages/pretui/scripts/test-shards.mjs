// Splits the *.test.gts files into CI shards by recorded run time, so no
// shard nears `boxel test`'s 300 s cap on a whole QUnit run.
//   node scripts/test-shards.mjs <shard> <total>  delete every test file outside shard <shard> of <total>
//   node scripts/test-shards.mjs --plan <total>   print each shard's files and weight
//   node scripts/test-shards.mjs --record         re-time every test file with the `boxel` on PATH
// Record with the boxel-cli version the pretui-test CI job pins.
// The split is a greedy longest-first fill: files go heaviest first, each to
// the lightest shard so far (lowest index on a tie), so it is deterministic
// for a given file list and timings file. A file with no recorded time
// weighs the mean of the recorded ones, so new tests still spread evenly
// until the next --record.
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TIMINGS = join(root, 'scripts', 'test-timings.json');

function testFiles(dir = root) {
  let out = [];
  for (let entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    let path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...testFiles(path));
    else if (entry.name.endsWith('.test.gts')) out.push(relative(root, path));
  }
  return out.sort();
}

function plan(total) {
  let timings = JSON.parse(readFileSync(TIMINGS, 'utf8'));
  let files = testFiles();
  // Every recording includes the harness boot, which a shard pays once, not
  // once per file. The fastest file's time bounds that boot from below, so
  // it comes off each recording; left on, it would make many-file shards
  // look heavier than they run.
  let recorded = Object.values(timings);
  let boot = recorded.length ? Math.min(...recorded) : 0;
  let known = files.filter((f) => f in timings).map((f) => timings[f] - boot);
  let fallback = known.length
    ? Math.round(known.reduce((a, b) => a + b, 0) / known.length)
    : 1;
  let weighted = files
    .map((file) => ({
      file,
      ms: file in timings ? timings[file] - boot : fallback,
    }))
    .sort((a, b) => b.ms - a.ms || (a.file < b.file ? -1 : 1));
  let shards = Array.from({ length: total }, () => ({ files: [], ms: 0 }));
  for (let { file, ms } of weighted) {
    let lightest = shards.reduce((min, s) => (s.ms < min.ms ? s : min));
    lightest.files.push(file);
    lightest.ms += ms;
  }
  return shards;
}

// Runs each file alone so its time is its own; plan() takes the shared
// harness boot back out.
function record() {
  let timings = {};
  for (let file of testFiles()) {
    let dir = mkdtempSync(join(tmpdir(), 'pretui-timing-'));
    try {
      cpSync(root, dir, {
        recursive: true,
        filter: (src) => !src.includes('node_modules'),
      });
      for (let other of testFiles(dir)) {
        if (other !== file) rmSync(join(dir, other));
      }
      let result;
      try {
        result = execFileSync('boxel', ['test', '.', '--json'], {
          cwd: dir,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });
      } catch (e) {
        result = e.stdout;
      }
      let { status, durationMs } = JSON.parse(result);
      if (status !== 'passed') {
        throw new Error(
          `${file} did not pass (${status}); fix it before recording`,
        );
      }
      timings[file] = durationMs;
      console.log(`${file}\t${durationMs} ms`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  writeFileSync(TIMINGS, JSON.stringify(timings, null, 2) + '\n');
}

let [first, second] = process.argv.slice(2);
if (first === '--record') {
  record();
} else if (first === '--plan') {
  plan(Number(second)).forEach((s, i) => {
    console.log(
      `shard ${i + 1}: ${s.files.length} file(s), ${(s.ms / 1000).toFixed(1)} s`,
    );
    for (let f of s.files) console.log(`  ${f}`);
  });
} else {
  let shard = Number(first);
  let total = Number(second);
  if (!(shard >= 1 && shard <= total)) {
    console.error('usage: node scripts/test-shards.mjs <shard> <total>');
    process.exit(1);
  }
  let shards = plan(total);
  for (let [i, s] of shards.entries()) {
    if (i !== shard - 1) for (let f of s.files) rmSync(join(root, f));
  }
  let mine = shards[shard - 1];
  console.log(
    `${mine.files.length} test file(s) in shard ${shard} of ${total}, ${(mine.ms / 1000).toFixed(1)} s recorded`,
  );
}
