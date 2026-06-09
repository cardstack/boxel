import { module, test } from 'qunit';
import {
  shouldProfileAffinity,
  getAffinityProfileTarget,
} from '../prerender/cpu-profiler';

// The affinity-scoped CPU profiler is the one trigger that could harm a
// production realm if it ever profiled the wrong one, so the gate must be
// airtight: ONLY the render whose affinity key exactly equals the
// configured target is ever profiled. These tests pin that contract on
// the dependency-free pure function (no Chrome / CDP) — exact match
// profiles, and an empty, undefined, or non-matching target / affinity
// profiles nothing.
module('cpu-profiler affinity gate', function () {
  let target = 'realm:https://realms.example/team/my-realm/';

  test('an exact affinity match is profiled', function (assert) {
    assert.true(shouldProfileAffinity(target, target), 'exact match → profile');
  });

  test('a different affinity is not profiled', function (assert) {
    assert.false(
      shouldProfileAffinity(
        'realm:https://realms.example/team/other-realm/',
        target,
      ),
      'different realm → no profile',
    );
  });

  test('a prefix of the target is not profiled', function (assert) {
    // Guards against any accidental substring/startsWith matching: the
    // gate is strict equality only.
    assert.false(
      shouldProfileAffinity('realm:https://realms.example/team/', target),
      'prefix of target → no profile',
    );
  });

  test('an empty target profiles nothing', function (assert) {
    assert.false(
      shouldProfileAffinity(target, ''),
      'empty target → feature inert',
    );
  });

  test('an undefined target profiles nothing', function (assert) {
    assert.false(
      shouldProfileAffinity(target, undefined),
      'undefined target → feature inert',
    );
  });

  test('an undefined affinity is not profiled even with a target', function (assert) {
    assert.false(
      shouldProfileAffinity(undefined, target),
      'undefined affinity → no profile',
    );
  });

  test('an empty affinity is not profiled even with a target', function (assert) {
    assert.false(
      shouldProfileAffinity('', target),
      'empty affinity → no profile',
    );
  });
});

// `getAffinityProfileTarget` reads `PRERENDER_PROFILE_AFFINITY` at call
// time. Unset or whitespace-only resolves to undefined so the gate above
// is inert; a non-empty value is returned trimmed.
module('cpu-profiler affinity target env', function (hooks) {
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

  test('unset resolves to undefined', function (assert) {
    delete process.env.PRERENDER_PROFILE_AFFINITY;
    assert.strictEqual(getAffinityProfileTarget(), undefined);
  });

  test('empty / whitespace resolves to undefined', function (assert) {
    process.env.PRERENDER_PROFILE_AFFINITY = '   ';
    assert.strictEqual(getAffinityProfileTarget(), undefined);
  });

  test('a set value is returned trimmed', function (assert) {
    process.env.PRERENDER_PROFILE_AFFINITY =
      '  realm:https://realms.example/team/my-realm/  ';
    assert.strictEqual(
      getAffinityProfileTarget(),
      'realm:https://realms.example/team/my-realm/',
    );
  });
});
