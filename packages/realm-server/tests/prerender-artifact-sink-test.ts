import { module, test } from 'qunit';
import {
  buildArtifactKey,
  getMaxSessionBytes,
  artifactSinkEnabled,
  anyArtifactCaptureEnabled,
  shouldCaptureCpuProfile,
  shouldCaptureTrace,
  shouldCaptureHeap,
} from '../prerender/artifact-sink.ts';

// The heavyweight artifact sink is gated by env (a configured bucket plus
// per-mode flags) and keys every blob by render identity. These tests pin
// the dependency-free pieces — key construction, the flag gates, and the
// per-session byte budget — without touching S3 or Chrome. The env vars
// are read at call time, so each case sets exactly what it needs and the
// hooks restore the process environment afterwards.

const ENV_KEYS = [
  'PRERENDER_ARTIFACTS_BUCKET',
  'PRERENDER_ARTIFACTS_ENV',
  'PRERENDER_PROFILE_CPUPROFILE',
  'PRERENDER_PROFILE_TRACE',
  'PRERENDER_PROFILE_HEAP',
  'PRERENDER_PROFILE_MAX_SESSION_BYTES',
];

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

module('prerender artifact-sink key', function (hooks) {
  let saved: Record<string, string | undefined>;
  hooks.beforeEach(function () {
    saved = snapshotEnv();
    for (let key of ENV_KEYS) {
      delete process.env[key];
    }
  });
  hooks.afterEach(function () {
    restoreEnv(saved);
  });

  let now = new Date('2026-06-10T14:30:00.000Z');

  test('a fully-populated key sanitizes every segment and orders them env/realm/jobId/card/step/file', function (assert) {
    process.env.PRERENDER_ARTIFACTS_ENV = 'staging';
    let key = buildArtifactKey(
      {
        realm: 'https://realms.example/team/realm-a/',
        jobId: 'job-123',
        card: 'https://realms.example/team/realm-a/Card/1',
        step: 'card isolated/0',
        kind: 'cpuprofile',
      },
      now,
      0,
    );
    assert.strictEqual(
      key,
      'staging/realms.example-team-realm-a/job-123/' +
        'realms.example-team-realm-a-Card-1/card-isolated-0/' +
        '2026-06-10T14-30-00-000Z-0.cpuprofile',
    );
  });

  test('missing fields fall back to no-<field> segments and env to "unknown"', function (assert) {
    let key = buildArtifactKey({ kind: 'trace' }, now, 7);
    assert.strictEqual(
      key,
      'unknown/no-realm/no-job/no-card/no-step/' +
        '2026-06-10T14-30-00-000Z-7.trace.json',
    );
  });

  test('each artifact kind maps to its conventional file suffix', function (assert) {
    let suffix = (kind: 'cpuprofile' | 'trace' | 'heap') =>
      buildArtifactKey({ kind }, now, 0).split('.').slice(1).join('.');
    assert.strictEqual(suffix('cpuprofile'), 'cpuprofile');
    assert.strictEqual(suffix('trace'), 'trace.json');
    assert.strictEqual(suffix('heap'), 'heapprofile');
  });

  test('the seq disambiguates artifacts that share a millisecond', function (assert) {
    let a = buildArtifactKey({ kind: 'cpuprofile' }, now, 0);
    let b = buildArtifactKey({ kind: 'cpuprofile' }, now, 1);
    assert.notStrictEqual(a, b, 'distinct seq → distinct key');
    assert.true(a.endsWith('-0.cpuprofile'));
    assert.true(b.endsWith('-1.cpuprofile'));
  });
});

module('prerender artifact-sink gates', function (hooks) {
  let saved: Record<string, string | undefined>;
  hooks.beforeEach(function () {
    saved = snapshotEnv();
    for (let key of ENV_KEYS) {
      delete process.env[key];
    }
  });
  hooks.afterEach(function () {
    restoreEnv(saved);
  });

  test('the sink is enabled only when a non-empty bucket is configured', function (assert) {
    assert.false(artifactSinkEnabled(), 'unset → disabled');
    process.env.PRERENDER_ARTIFACTS_BUCKET = '   ';
    assert.false(artifactSinkEnabled(), 'whitespace → disabled');
    process.env.PRERENDER_ARTIFACTS_BUCKET =
      'boxel-prerender-artifacts-staging';
    assert.true(artifactSinkEnabled(), 'set → enabled');
  });

  test('each per-mode flag is on only for the exact string "true"', function (assert) {
    for (let [flag, read] of [
      ['PRERENDER_PROFILE_CPUPROFILE', shouldCaptureCpuProfile],
      ['PRERENDER_PROFILE_TRACE', shouldCaptureTrace],
      ['PRERENDER_PROFILE_HEAP', shouldCaptureHeap],
    ] as const) {
      delete process.env[flag];
      assert.false(read(), `${flag} unset → off`);
      process.env[flag] = 'false';
      assert.false(read(), `${flag}=false → off`);
      process.env[flag] = '1';
      assert.false(read(), `${flag}=1 → off`);
      process.env[flag] = 'TRUE';
      assert.false(read(), `${flag}=TRUE → off (exact match only)`);
      process.env[flag] = '  true  ';
      assert.true(read(), `${flag} trims to "true" → on`);
    }
  });

  test('anyArtifactCaptureEnabled requires the sink AND at least one mode', function (assert) {
    process.env.PRERENDER_PROFILE_TRACE = 'true';
    assert.false(
      anyArtifactCaptureEnabled(),
      'a flag without a bucket captures nothing',
    );
    process.env.PRERENDER_ARTIFACTS_BUCKET =
      'boxel-prerender-artifacts-staging';
    assert.true(anyArtifactCaptureEnabled(), 'bucket + a flag → enabled');
    delete process.env.PRERENDER_PROFILE_TRACE;
    assert.false(
      anyArtifactCaptureEnabled(),
      'a bucket with every mode off → nothing to capture',
    );
  });
});

module('prerender artifact-sink session budget', function (hooks) {
  let saved: Record<string, string | undefined>;
  hooks.beforeEach(function () {
    saved = snapshotEnv();
    for (let key of ENV_KEYS) {
      delete process.env[key];
    }
  });
  hooks.afterEach(function () {
    restoreEnv(saved);
  });

  let defaultBytes = 5 * 1024 * 1024 * 1024;

  test('unset / non-positive / unparseable falls back to the built-in default', function (assert) {
    assert.strictEqual(getMaxSessionBytes(), defaultBytes, 'unset → default');
    process.env.PRERENDER_PROFILE_MAX_SESSION_BYTES = '0';
    assert.strictEqual(getMaxSessionBytes(), defaultBytes, '0 → default');
    process.env.PRERENDER_PROFILE_MAX_SESSION_BYTES = '-5';
    assert.strictEqual(
      getMaxSessionBytes(),
      defaultBytes,
      'negative → default',
    );
    process.env.PRERENDER_PROFILE_MAX_SESSION_BYTES = 'lots';
    assert.strictEqual(
      getMaxSessionBytes(),
      defaultBytes,
      'unparseable → default',
    );
  });

  test('a positive integer is honored', function (assert) {
    process.env.PRERENDER_PROFILE_MAX_SESSION_BYTES = '1048576';
    assert.strictEqual(getMaxSessionBytes(), 1048576);
  });
});
