import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { mergeCardVisitResults } from '@cardstack/runtime-common/index-runner/visit-file';
import type { RenderResponse } from '@cardstack/runtime-common';

// An index visit (native or browser) and an HTML visit are merged into one
// card result. The merge rebuilds the response field by field; the time
// grain (validUntil) belongs to the index visit and must survive the merge,
// or boxel_index.valid_until is never written.
module(basename(import.meta.filename), function () {
  const index = {
    serialized: { data: { type: 'card', id: 'x' } },
    searchDoc: { id: 'x' },
    displayNames: ['Card'],
    types: ['t'],
    deps: ['a'],
    iconHTML: '<svg/>',
    validUntil: '2027-03-20T04:00:00.000Z',
  } as unknown as RenderResponse;
  const html = {
    serialized: null,
    searchDoc: null,
    displayNames: null,
    types: null,
    deps: ['b'],
    isolatedHTML: '<div/>',
    validUntil: '1999-01-01T00:00:00.000Z',
  } as unknown as RenderResponse;

  test("the merged card result carries the index visit's validUntil", function (assert) {
    const merged = mergeCardVisitResults(index, html)!;
    assert.strictEqual(merged.validUntil, '2027-03-20T04:00:00.000Z');
    assert.strictEqual(
      merged.isolatedHTML,
      '<div/>',
      'HTML still comes from the HTML visit',
    );
    assert.deepEqual([...(merged.deps ?? [])].sort(), ['a', 'b']);
  });

  test('no grain stays absent', function (assert) {
    const merged = mergeCardVisitResults(
      { ...index, validUntil: undefined },
      undefined,
    )!;
    assert.notOk('validUntil' in merged);
  });
});
