import { module, test } from 'qunit';
import { promises as fs } from 'fs';
import path from 'path';
import {
  v8ProfEnabled,
  v8ProfJsFlags,
  prepareV8ProfForLaunch,
  uploadV8ProfLog,
  V8_PROF_LOG_DIR,
  V8_PROF_LOG_PREFIX,
} from '../prerender/v8-prof.ts';

// The V8 `--prof` capture is gated by env and reads/writes the OS temp dir.
// These tests pin the dependency-free behavior — flag gating, the launch
// flags, the stale-log sweep, and how `uploadV8ProfLog` selects the pegged
// isolate's log and what it does when the upload can't land — without S3 or
// Chrome. With no bucket configured the sink returns false, which drives the
// "keep the local log" branch: that lets us assert WHICH file was selected
// (it appears in the status string) and that a non-persisted capture is never
// deleted. The env is read at call time, so each case sets what it needs and
// the hooks restore the process environment and clean up fixtures afterward.

const ENV_KEYS = ['PRERENDER_V8_PROF', 'PRERENDER_ARTIFACTS_BUCKET'];

function snapshotEnv(): Record<string, string | undefined> {
  let snapshot: Record<string, string | undefined> = {};
  for (let key of ENV_KEYS) {
    snapshot[key] = process.env[key];
  }
  return snapshot;
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (let key of ENV_KEYS) {
    if (snapshot[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = snapshot[key];
    }
  }
}

// A `--prof` log fixture. `isolatePrefix` reproduces V8's per-isolate
// `isolate-<addr>-` prepend so we exercise the `includes` (not `startsWith`)
// filename match. `ageMs` backdates the mtime to simulate a log from before
// this browser run (stale, must be excluded from selection).
async function writeLog(basename: string, sizeBytes: number): Promise<string> {
  let full = path.join(V8_PROF_LOG_DIR, basename);
  await fs.writeFile(full, Buffer.alloc(sizeBytes, 'v'));
  return full;
}

async function backdate(full: string, ageMs: number): Promise<void> {
  let when = new Date(Date.now() - ageMs);
  await fs.utimes(full, when, when);
}

module('prerender v8-prof', function (hooks) {
  let saved: Record<string, string | undefined>;
  let created: string[];

  hooks.beforeEach(async function () {
    saved = snapshotEnv();
    created = [];
    // Arm, point at no bucket (sink disabled), and sweep + stamp the launch
    // time so each case starts from a clean slate with a known "this run"
    // boundary.
    process.env.PRERENDER_V8_PROF = 'true';
    delete process.env.PRERENDER_ARTIFACTS_BUCKET;
    await prepareV8ProfForLaunch();
  });

  hooks.afterEach(async function () {
    for (let full of created) {
      await fs.rm(full, { force: true }).catch(() => {});
    }
    restoreEnv(saved);
  });

  test('v8ProfEnabled mirrors the env flag (exact "true")', function (assert) {
    process.env.PRERENDER_V8_PROF = 'true';
    assert.true(v8ProfEnabled());
    process.env.PRERENDER_V8_PROF = 'false';
    assert.false(v8ProfEnabled());
    delete process.env.PRERENDER_V8_PROF;
    assert.false(v8ProfEnabled());
  });

  test('v8ProfJsFlags arms --prof with a per-pid logfile under the prefix', function (assert) {
    let flags = v8ProfJsFlags();
    assert.true(flags.includes('--prof'), 'arms the sampler');
    assert.true(flags.includes('--logfile='), 'directs the log to a file');
    assert.true(flags.includes(V8_PROF_LOG_PREFIX), 'uses the known prefix');
    assert.true(flags.includes('%p'), 'per-pid so concurrent renderers split');
  });

  test('uploadV8ProfLog is inert (null) when not armed', async function (assert) {
    process.env.PRERENDER_V8_PROF = 'false';
    let status = await uploadV8ProfLog({ realm: 'r', card: 'c', step: 's' });
    assert.strictEqual(status, null, 'disabled → no work, no status');
  });

  test('armed with no log present → self-diagnosing reason', async function (assert) {
    let status = await uploadV8ProfLog({ realm: 'r', card: 'c', step: 's' });
    assert.true(
      (status ?? '').includes('no v8 --prof log'),
      `reason names the absence, got: ${status}`,
    );
  });

  test('selects the largest this-run log and, on a non-persisted upload, KEEPS it', async function (assert) {
    let small = await writeLog(
      `isolate-0xaaa-${V8_PROF_LOG_PREFIX}101.log`,
      4096,
    );
    let big = await writeLog(
      `isolate-0xbbb-${V8_PROF_LOG_PREFIX}102.log`,
      64 * 1024,
    );
    created.push(small, big);

    let status = await uploadV8ProfLog({ realm: 'r', card: 'c', step: 's' });
    let s = status ?? '';

    assert.true(
      s.includes(path.basename(big)),
      `picks the largest (pegged-isolate) log, got: ${status}`,
    );
    assert.true(
      s.includes('kept local'),
      'sink disabled → reports the local copy was retained',
    );
    // The safety property: a capture that never reached S3 is not destroyed.
    assert.true(
      await fs
        .stat(big)
        .then(() => true)
        .catch(() => false),
      'the only copy of the log is still on disk',
    );
  });

  test('excludes stale logs written before this browser run', async function (assert) {
    // A big but STALE log (mtime before the stamped launch time) must lose to
    // a small fresh one — otherwise a previous run's log would be mis-picked.
    let staleBig = await writeLog(`${V8_PROF_LOG_PREFIX}900.log`, 128 * 1024);
    await backdate(staleBig, 60_000);
    let freshSmall = await writeLog(`${V8_PROF_LOG_PREFIX}901.log`, 2048);
    created.push(staleBig, freshSmall);

    let status = await uploadV8ProfLog({ realm: 'r', card: 'c', step: 's' });

    assert.true(
      (status ?? '').includes(path.basename(freshSmall)),
      `picks the fresh log over the larger stale one, got: ${status}`,
    );
  });

  test('only stale logs present → "no log from this run"', async function (assert) {
    let stale = await writeLog(`${V8_PROF_LOG_PREFIX}910.log`, 8192);
    await backdate(stale, 60_000);
    created.push(stale);

    let status = await uploadV8ProfLog({ realm: 'r', card: 'c', step: 's' });

    assert.true(
      (status ?? '').includes('from this run'),
      `distinguishes stale-only from absent, got: ${status}`,
    );
  });

  test('prepareV8ProfForLaunch sweeps prior --prof logs', async function (assert) {
    let orphan = await writeLog(
      `isolate-0xccc-${V8_PROF_LOG_PREFIX}777.log`,
      1024,
    );
    created.push(orphan);
    assert.true(
      await fs
        .stat(orphan)
        .then(() => true)
        .catch(() => false),
      'fixture present before the sweep',
    );
    await prepareV8ProfForLaunch();
    assert.false(
      await fs
        .stat(orphan)
        .then(() => true)
        .catch(() => false),
      'launch sweep removed the prior-run log',
    );
  });
});
