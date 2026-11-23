import { module, test } from 'qunit';

import { refusalReason } from '@cardstack/host/services/realm-server';

module('Unit | realm-server refusal reason', function () {
  test('a string error is the reason', function (assert) {
    assert.strictEqual(
      refusalReason('{"errors":["Hostname is already claimed"]}'),
      'Hostname is already claimed',
    );
  });

  test('a JSON:API error object gives its detail, or its title', function (assert) {
    assert.strictEqual(
      refusalReason(
        JSON.stringify({
          errors: [
            { status: '409', title: 'Conflict', detail: 'The name is taken' },
            { status: '422', title: 'The host is not allowed' },
          ],
        }),
      ),
      'The name is taken The host is not allowed',
    );
  });

  test('a body that is not JSON, or has no errors, is the reason itself', function (assert) {
    assert.strictEqual(refusalReason('Bad gateway'), 'Bad gateway');
    assert.strictEqual(refusalReason('{"message":"x"}'), '{"message":"x"}');
    assert.strictEqual(refusalReason(''), 'The request failed');
  });
});
