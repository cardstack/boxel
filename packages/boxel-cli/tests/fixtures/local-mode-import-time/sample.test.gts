import { module, test } from 'qunit';

// Declared at import time, with no `runTests` export: the other shape a realm
// test file takes. The accompanying vitest case asserts this is the run's only
// test, which is false whenever the harness fails to attribute it and adds its
// "no realm tests found" placeholder instead.
module('local-mode import-time declaration', function () {
  test('a test declared at import time is the run', function (assert) {
    assert.ok(true);
  });
});
