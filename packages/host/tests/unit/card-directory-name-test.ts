import { module, test } from 'qunit';

import type { CodeRef } from '@cardstack/runtime-common';
import { getCardDirectoryName } from '@cardstack/runtime-common/helpers/card-directory-name';
import { RealmPaths } from '@cardstack/runtime-common/paths';

module('Unit | runtime-common | card directory names', function () {
  let paths: RealmPaths;

  module('getCardDirectoryName', function (hooks) {
    hooks.beforeEach(function () {
      paths = new RealmPaths(new URL('http://example.com/test/'));
    });

    test('returns explicit export names when provided', function (assert) {
      let ref: CodeRef = { module: '../pet', name: 'PetCard' };
      assert.strictEqual(getCardDirectoryName(ref, paths), 'PetCard');
    });

    test('infers directory from module name for default exports', function (assert) {
      let ref: CodeRef = { module: '../pet', name: 'default' };
      assert.strictEqual(getCardDirectoryName(ref, paths), 'Pet');
    });

    test('uses parent directory when module is an index file', function (assert) {
      let ref: CodeRef = { module: '../animals/index', name: 'default' };
      assert.strictEqual(getCardDirectoryName(ref, paths), 'Animals');
    });

    test('strips executable extensions before inferring name', function (assert) {
      let ref: CodeRef = {
        module: '../cards/preview-card.gts',
        name: 'default',
      };
      assert.strictEqual(getCardDirectoryName(ref, paths), 'PreviewCard');
    });

    test('sanitizes names with dashes and encoded characters', function (assert) {
      let ref: CodeRef = {
        module: '../fancy/%E2%9C%A8-sparkle-card',
        name: 'default',
      };
      assert.strictEqual(getCardDirectoryName(ref, paths), 'SparkleCard');
    });

    test('prefixes directories that would start with invalid characters', function (assert) {
      let ref: CodeRef = { module: '../123', name: 'default' };
      assert.strictEqual(getCardDirectoryName(ref, paths), 'Card123');
    });

    test('resolves nested code refs like fieldOf', function (assert) {
      let ref: CodeRef = {
        type: 'fieldOf',
        field: 'bio',
        card: { module: '../person', name: 'default' },
      };
      assert.strictEqual(getCardDirectoryName(ref, paths), 'Person');
    });

    test('falls back to cards when adoptsFrom is missing', function (assert) {
      assert.strictEqual(getCardDirectoryName(undefined, paths), 'cards');
    });
  });
});
