import { module, test } from 'qunit';
import {
  shouldProfileAffinity,
  getAffinityProfileTargets,
} from '../prerender/cpu-profiler.ts';

// The affinity-scoped CPU profiler is the one trigger that could harm a
// production realm if it ever profiled the wrong one, so the gate must be
// airtight: ONLY a render whose affinity key exactly equals one of the
// configured targets is ever profiled. These tests pin that contract on
// the dependency-free pure function (no Chrome / CDP) — a member of the
// target list profiles, and an empty list, a non-member affinity, or an
// empty/undefined affinity profiles nothing.
module('cpu-profiler affinity gate', function () {
  let a = 'realm:https://realms.example/team/realm-a/';
  let b = 'realm:https://realms.example/team/realm-b/';

  test('an affinity in a single-element target list is profiled', function (assert) {
    assert.true(shouldProfileAffinity(a, [a]), 'exact match → profile');
  });

  test('any affinity in a multi-element target list is profiled', function (assert) {
    assert.true(shouldProfileAffinity(a, [a, b]), 'first listed → profile');
    assert.true(shouldProfileAffinity(b, [a, b]), 'second listed → profile');
  });

  test('an affinity not in the target list is not profiled', function (assert) {
    assert.false(
      shouldProfileAffinity('realm:https://realms.example/team/realm-c/', [
        a,
        b,
      ]),
      'unlisted realm → no profile',
    );
  });

  test('a prefix of a target is not profiled', function (assert) {
    // Guards against any accidental substring/startsWith matching: the
    // gate is strict membership (exact equality) only.
    assert.false(
      shouldProfileAffinity('realm:https://realms.example/team/', [a]),
      'prefix of a target → no profile',
    );
  });

  test('the sentinel "off" target profiles no real realm', function (assert) {
    // The Terraform-managed SSM parameter defaults to "off" (SSM rejects
    // empty strings); it must match no realm's affinity key.
    assert.false(shouldProfileAffinity(a, ['off']), 'off sentinel → inert');
  });

  test('an empty target list profiles nothing', function (assert) {
    assert.false(shouldProfileAffinity(a, []), 'empty list → feature inert');
  });

  test('an empty or undefined affinity is not profiled even with targets', function (assert) {
    assert.false(shouldProfileAffinity(undefined, [a]), 'undefined affinity');
    assert.false(shouldProfileAffinity('', [a]), 'empty affinity');
  });
});

// `getAffinityProfileTargets` reads `PRERENDER_PROFILE_AFFINITY` at call
// time and parses it as a comma-separated list — each entry trimmed,
// empties dropped. Unset or whitespace-only resolves to an empty list so
// the gate above is inert.
module('cpu-profiler affinity targets env', function (hooks) {
  let original: string | undefined;
  hooks.beforeEach(function () {
    original = process.env.PRERENDER_PROFILE_AFFINITY;
  });
  hooks.afterEach(function () {
    if (original === undefined) {
      delete process.env.PRERENDER_PROFILE_AFFINITY;
    } else {
      process.env.PRERENDER_PROFILE_AFFINITY = original;
    }
  });

  test('unset resolves to an empty list', function (assert) {
    delete process.env.PRERENDER_PROFILE_AFFINITY;
    assert.deepEqual(getAffinityProfileTargets(), []);
  });

  test('whitespace-only resolves to an empty list', function (assert) {
    process.env.PRERENDER_PROFILE_AFFINITY = '   ';
    assert.deepEqual(getAffinityProfileTargets(), []);
  });

  test('a single value is returned trimmed', function (assert) {
    process.env.PRERENDER_PROFILE_AFFINITY =
      '  realm:https://realms.example/team/realm-a/  ';
    assert.deepEqual(getAffinityProfileTargets(), [
      'realm:https://realms.example/team/realm-a/',
    ]);
  });

  test('a comma-separated list is split, trimmed, and empties dropped', function (assert) {
    process.env.PRERENDER_PROFILE_AFFINITY =
      'realm:https://realms.example/team/realm-a/ , ,realm:https://realms.example/team/realm-b/,';
    assert.deepEqual(getAffinityProfileTargets(), [
      'realm:https://realms.example/team/realm-a/',
      'realm:https://realms.example/team/realm-b/',
    ]);
  });
});
