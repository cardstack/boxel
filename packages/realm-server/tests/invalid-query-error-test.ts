import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { InvalidQueryError } from '@cardstack/runtime-common';
import { LogQueryError } from '@cardstack/runtime-common/invalid-query-error';

module(basename(import.meta.filename), function () {
  test('a refusal names its mistake with the code it is given', function (assert) {
    let error = new InvalidQueryError(
      'page.size must be a whole number',
      'invalid-value',
    );
    assert.strictEqual(error.name, 'InvalidQueryError');
    assert.strictEqual(error.message, 'page.size must be a whole number');
    assert.strictEqual(error.code, 'invalid-value');
    assert.true(error instanceof Error);
  });

  test('a refusal keeps the code it is given', function (assert) {
    let error = new InvalidQueryError('unknown member', 'unknown-key');
    assert.strictEqual(error.code, 'unknown-key');
  });

  test('a log query refusal is a query refusal with its own status', function (assert) {
    let missing = new LogQueryError('no such log', 'log-not-found', 404);
    assert.true(missing instanceof InvalidQueryError);
    assert.strictEqual(missing.name, 'LogQueryError');
    assert.strictEqual(missing.code, 'log-not-found');
    assert.strictEqual(missing.status, 404);

    let plain = new LogQueryError('bad filter');
    assert.strictEqual(plain.code, 'invalid-value');
    assert.strictEqual(plain.status, 400);
  });
});
