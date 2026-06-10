import { coalesce } from '@cardstack/boxel-ui/helpers';
import { module, test } from 'qunit';

module('Unit | helpers | coalesce', function () {
  test('returns the first argument when it is a non-null string', function (assert) {
    assert.strictEqual(coalesce('hello', 'fallback'), 'hello');
  });

  test('returns the second argument when the first is null', function (assert) {
    assert.strictEqual(coalesce(null, 'fallback'), 'fallback');
  });

  test('returns the second argument when the first is undefined', function (assert) {
    assert.strictEqual(coalesce(undefined, 'fallback'), 'fallback');
  });

  test('returns the first argument when it is 0', function (assert) {
    assert.strictEqual(coalesce(0, 42), 0);
  });

  test('returns the first argument when it is an empty string', function (assert) {
    assert.strictEqual(coalesce('', 'fallback'), '');
  });

  test('returns the first argument when it is false', function (assert) {
    assert.false(coalesce(false, true));
  });

  test('returns the second argument when both are null/undefined', function (assert) {
    assert.strictEqual(coalesce(null, 'default'), 'default');
    assert.strictEqual(coalesce(undefined, 'default'), 'default');
  });

  test('works with object values', function (assert) {
    const obj = { x: 1 };
    assert.strictEqual(coalesce(obj, { x: 2 }), obj);
    assert.deepEqual(coalesce(null, { x: 2 }), { x: 2 });
  });

  test('works with number values', function (assert) {
    assert.strictEqual(coalesce(42, 99), 42);
    assert.strictEqual(coalesce(null, 99), 99);
  });
});
