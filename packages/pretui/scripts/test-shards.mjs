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
// until the next --record; the script warns about such files, and about
// recorded files that no longer exist.
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
const BOOT_PERCENTILE = 0.02;

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
  let files = testFiles();
  let all = JSON.parse(readFileSync(TIMINGS, 'utf8'));
  let timings = Object.fromEntries(
    Object.entries(all).filter(([file]) => files.includes(file)),
  );
  let unrecorded = files.filter((f) => !(f in timings));
  let stale = Object.keys(all).filter((f) => !files.includes(f));
  if (unrecorded.length || stale.length) {
    // In GitHub Actions the prefix turns the line into a run annotation.
    let prefix = process.env.GITHUB_ACTIONS ? '::warning::' : 'warning: ';
    console.warn(
      `${prefix}scripts/test-timings.json is out of date, so the shards may be uneven; run \`node scripts/test-shards.mjs --record\`. ` +
        [
          unrecorded.length &&
            `No recorded time (weighed as the mean): ${unrecorded.join(', ')}.`,
          stale.length && `No such test file: ${stale.join(', ')}.`,
        ]
          .filter(Boolean)
          .join(' '),
    );
  }
  // Every recording includes the harness boot, which a shard pays once, not
  // once per file. A low percentile of the recordings estimates that boot
  // (the very fastest few files load less than the boot itself), and it
  // comes off each recording; left on, it would make many-file shards look
  // heavier than they run.
  let recorded = Object.values(timings).sort((a, b) => a - b);
  let boot = recorded.length
    ? recorded[Math.floor(BOOT_PERCENTILE * (recorded.length - 1))]
    : 0;
  let weight = (file) => Math.max(timings[file] - boot, 0);
  let known = Object.keys(timings).map(weight);
  let fallback = known.length
    ? Math.round(known.reduce((a, b) => a + b, 0) / known.length)
    : 1;
  let weighted = files
    .map((file) => ({
      file,
      ms: file in timings ? weight(file) : fallback,
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
// harness boot back out. The timings file is rewritten after every file, and
// a file that fails or hasn't run yet keeps its previous time, so neither a
// failure nor an interrupted run costs the readings already taken.
function record() {
  let files = testFiles();
  let previous = JSON.parse(readFileSync(TIMINGS, 'utf8'));
  let timings = {};
  let failed = [];
  let write = () => {
    let out = {};
    for (let f of files) {
      if (f in timings) out[f] = timings[f];
      else if (f in previous) out[f] = previous[f];
    }
    writeFileSync(TIMINGS, JSON.stringify(out, null, 2) + '\n');
  };
  for (let file of files) {
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
        if (e.code === 'ENOENT') {
          throw new Error(
            '`boxel` is not on PATH; install the boxel-cli version the pretui-test CI job pins',
          );
        }
        result = e.stdout;
      }
      let status;
      let durationMs;
      try {
        ({ status, durationMs } = JSON.parse(result));
      } catch {
        status = 'no JSON result';
      }
      if (status === 'passed') {
        timings[file] = durationMs;
        console.log(`${file}\t${durationMs} ms`);
      } else {
        failed.push(file);
        console.error(`${file}\t${status}; keeping its previous time`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    write();
  }
  if (failed.length) {
    console.error(
      `${failed.length} file(s) did not pass, so their times were not re-recorded: ${failed.join(', ')}`,
    );
    process.exitCode = 1;
  }
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
