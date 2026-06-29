import QUnit from 'qunit';
const { module, test } = QUnit;

import {
  diffDoc,
  isShallowLink,
  shallowIds,
} from '../scripts/searchable-parity-diff.ts';

// Unit coverage for the realm-scale parity validator's pure comparison logic.
// The differ ignores `_cardType`, normalizes object key order, and (under
// --ignore-shallow-links) treats the store-driven omit-vs-keep-`{id}` difference
// as equivalent while still catching a CHANGED reference.
module('Unit | searchable-parity-diff', function () {
  module('isShallowLink', function () {
    test('null / a bare { id } / an array of bare { id } are shallow', function (assert) {
      assert.true(isShallowLink(null), 'null');
      assert.true(isShallowLink({ id: 'x' }), 'bare { id }');
      assert.true(isShallowLink([{ id: 'x' }, { id: 'y' }]), 'array of { id }');
      assert.true(isShallowLink([]), 'empty array');
    });

    test('an object with data beyond id is not shallow', function (assert) {
      assert.false(isShallowLink({ id: 'x', name: 'n' }), 'has extra field');
      assert.false(isShallowLink([{ id: 'x', name: 'n' }]), 'array w/ data');
      assert.false(isShallowLink('scalar'), 'a scalar is not a link');
    });
  });

  module('shallowIds', function () {
    test('extracts ids, flattening plurals; null/empty contribute none', function (assert) {
      assert.deepEqual(shallowIds({ id: 'a' }), ['a'], 'singular');
      assert.deepEqual(
        shallowIds([{ id: 'a' }, { id: 'b' }]),
        ['a', 'b'],
        'plural flattened',
      );
      assert.deepEqual(shallowIds(null), [], 'null → none');
      assert.deepEqual(shallowIds([]), [], 'empty → none');
      assert.deepEqual(shallowIds('scalar'), [], 'scalar → none');
    });
  });

  module('diffDoc', function () {
    test('identical docs have no diffs and _cardType is ignored', function (assert) {
      assert.deepEqual(
        diffDoc(
          { title: 'A', _cardType: 'X' },
          { title: 'A', _cardType: 'Y' },
          false,
        ),
        [],
        'same data, differing _cardType → equal',
      );
    });

    test('key order does not produce a diff', function (assert) {
      assert.deepEqual(
        diffDoc({ a: 1, b: 2 }, { b: 2, a: 1 }, false),
        [],
        'reordered keys → equal',
      );
    });

    test('a changed scalar is reported', function (assert) {
      let diffs = diffDoc({ title: 'A' }, { title: 'B' }, false);
      assert.strictEqual(diffs.length, 1, 'one diff');
      assert.ok(diffs[0].includes('title'), 'names the field');
    });

    test('a key present on only one side is reported as absent (not null)', function (assert) {
      let diffs = diffDoc({ extra: 1 }, {}, false);
      assert.strictEqual(diffs.length, 1, 'one diff');
      assert.ok(
        diffs[0].includes('generated=absent'),
        'the missing side reads "absent", not "null"',
      );
    });

    test('present-null vs absent is a real diff without --ignore-shallow-links', function (assert) {
      let diffs = diffDoc({ link: null }, {}, false);
      assert.strictEqual(diffs.length, 1, 'null vs absent diverges');
    });

    module('--ignore-shallow-links', function () {
      test('a bare { id } vs absent is ignored (the intended omit-vs-keep difference)', function (assert) {
        assert.deepEqual(
          diffDoc({}, { link: { id: 'a' } }, true),
          [],
          'generated keeps { id }, live omits → equal',
        );
        assert.deepEqual(
          diffDoc({ link: null }, { link: { id: 'a' } }, true),
          [],
          'null vs { id } → equal',
        );
        assert.deepEqual(
          diffDoc({}, { links: [{ id: 'a' }] }, true),
          [],
          'plural [{ id }] vs absent → equal',
        );
      });

      test('a CHANGED reference ({id:A} vs {id:B}) is still reported', function (assert) {
        let diffs = diffDoc({ link: { id: 'A' } }, { link: { id: 'B' } }, true);
        assert.strictEqual(diffs.length, 1, 'changed id is a real divergence');
        assert.ok(diffs[0].includes('link'), 'names the field');
      });

      test('a changed reference inside a plural is still reported', function (assert) {
        let diffs = diffDoc(
          { links: [{ id: 'A' }] },
          { links: [{ id: 'B' }] },
          true,
        );
        assert.strictEqual(diffs.length, 1, 'changed plural id diverges');
      });

      test('an expanded vs shallow slot is reported (data difference, not shallow-vs-absent)', function (assert) {
        let diffs = diffDoc(
          { author: { id: 'a', name: 'Jo' } },
          { author: { id: 'a' } },
          true,
        );
        assert.strictEqual(diffs.length, 1, 'expanded vs shallow diverges');
      });
    });
  });
});
