import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { resolveRangeHeader } from '@cardstack/runtime-common';

module(basename(import.meta.filename), function () {
  test('no header resolves to the full representation', function (assert) {
    assert.deepEqual(resolveRangeHeader(null, 100), { kind: 'full' });
    assert.deepEqual(resolveRangeHeader(undefined, 100), { kind: 'full' });
    assert.deepEqual(resolveRangeHeader('', 100), { kind: 'full' });
  });

  test('a bounded range resolves to its inclusive offsets', function (assert) {
    assert.deepEqual(resolveRangeHeader('bytes=0-0', 100), {
      kind: 'range',
      start: 0,
      end: 0,
    });
    assert.deepEqual(resolveRangeHeader('bytes=2-5', 100), {
      kind: 'range',
      start: 2,
      end: 5,
    });
    assert.deepEqual(
      resolveRangeHeader(' bytes=2-5 ', 100),
      { kind: 'range', start: 2, end: 5 },
      'surrounding whitespace is tolerated',
    );
  });

  test('an open-ended range runs through the final byte', function (assert) {
    assert.deepEqual(resolveRangeHeader('bytes=90-', 100), {
      kind: 'range',
      start: 90,
      end: 99,
    });
    assert.deepEqual(resolveRangeHeader('bytes=0-', 100), {
      kind: 'range',
      start: 0,
      end: 99,
    });
  });

  test('a last-byte position past the end is clamped', function (assert) {
    assert.deepEqual(resolveRangeHeader('bytes=90-1000', 100), {
      kind: 'range',
      start: 90,
      end: 99,
    });
  });

  test('a suffix range selects the final N bytes', function (assert) {
    assert.deepEqual(resolveRangeHeader('bytes=-10', 100), {
      kind: 'range',
      start: 90,
      end: 99,
    });
    assert.deepEqual(
      resolveRangeHeader('bytes=-1000', 100),
      { kind: 'range', start: 0, end: 99 },
      'a suffix longer than the representation selects all of it',
    );
  });

  test('ranges that select no bytes are unsatisfiable', function (assert) {
    assert.deepEqual(resolveRangeHeader('bytes=100-', 100), {
      kind: 'unsatisfiable',
    });
    assert.deepEqual(resolveRangeHeader('bytes=100-200', 100), {
      kind: 'unsatisfiable',
    });
    assert.deepEqual(
      resolveRangeHeader('bytes=-0', 100),
      { kind: 'unsatisfiable' },
      'a zero-length suffix selects nothing',
    );
    assert.deepEqual(
      resolveRangeHeader('bytes=0-', 0),
      { kind: 'unsatisfiable' },
      'an empty representation has no bytes to select',
    );
    assert.deepEqual(resolveRangeHeader('bytes=-5', 0), {
      kind: 'unsatisfiable',
    });
  });

  test('anything but a well-formed single bytes range resolves to full', function (assert) {
    assert.deepEqual(
      resolveRangeHeader('bytes=0-1,4-5', 100),
      { kind: 'full' },
      'multi-range requests are answered with the full representation',
    );
    assert.deepEqual(
      resolveRangeHeader('items=0-5', 100),
      { kind: 'full' },
      'non-bytes units are ignored',
    );
    assert.deepEqual(
      resolveRangeHeader('bytes=5-2', 100),
      { kind: 'full' },
      'an inverted range is malformed',
    );
    assert.deepEqual(
      resolveRangeHeader('bytes=-', 100),
      { kind: 'full' },
      'a range with no offsets is malformed',
    );
    assert.deepEqual(resolveRangeHeader('bytes=abc-def', 100), {
      kind: 'full',
    });
  });
});
