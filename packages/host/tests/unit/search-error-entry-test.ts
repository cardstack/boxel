import { module, test } from 'qunit';

import { searchErrorEntry } from '@cardstack/host/lib/search-error-entry';

// A failed `_search` as the store throws it: the status and the response
// body ride on the error (`fetchSearchEntryDoc`).
function failedSearch(status: number, responseText: string) {
  let err = new Error(`status: ${status} - . ${responseText}`) as any;
  err.status = status;
  err.responseText = responseText;
  return err;
}

module('Unit | search-error-entry', function () {
  test('a refused query carries the refusal code and message', function (assert) {
    let entry = searchErrorEntry(
      failedSearch(
        400,
        JSON.stringify({
          errors: [
            {
              status: '400',
              title: 'Invalid Query',
              message: 'Invalid query: //filter: unknown member "note"',
              code: 'unknown-key',
            },
          ],
        }),
      ),
    );
    assert.deepEqual(entry.refusal, {
      status: 400,
      code: 'unknown-key',
      message: 'Invalid query: //filter: unknown member "note"',
    });
    assert.strictEqual(entry.error.status, 400, 'the error is kept as it was');
  });

  test('a refusal without a code still carries its message', function (assert) {
    let entry = searchErrorEntry(
      failedSearch(400, JSON.stringify({ errors: [{ message: 'bad page' }] })),
    );
    assert.deepEqual(entry.refusal, { status: 400, message: 'bad page' });
  });

  test('a failure that is not a refusal carries none', function (assert) {
    assert.strictEqual(
      searchErrorEntry(failedSearch(500, '{"errors":[{"message":"x"}]}'))
        .refusal,
      undefined,
      'a server error',
    );
    assert.strictEqual(
      searchErrorEntry(failedSearch(400, '<html>bad gateway</html>')).refusal,
      undefined,
      'a body that is not JSON',
    );
    assert.strictEqual(
      searchErrorEntry(new Error('network down')).refusal,
      undefined,
      'a network error',
    );
  });
});
