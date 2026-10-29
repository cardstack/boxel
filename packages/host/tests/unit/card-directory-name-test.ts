import { module, test } from 'qunit';

import { rri } from '@cardstack/runtime-common';
import type { CodeRef } from '@cardstack/runtime-common';
import { getCardDirectoryName } from '@cardstack/runtime-common/helpers/card-directory-name';

module('Unit | runtime-common | card directory names', function () {
  module('getCardDirectoryName', function () {
    test('returns explicit export names when provided', function (assert) {
      let ref: CodeRef = {
        module: rri('../pet'),
        name: 'PetCard',
      };
      assert.strictEqual(getCardDirectoryName(ref), 'PetCard');
    });

    test('infers directory from module name for default exports', function (assert) {
      let ref: CodeRef = {
        module: rri('../pet'),
        name: 'default',
      };
      assert.strictEqual(getCardDirectoryName(ref), 'Pet');
    });

    test('uses parent directory when module is an index file', function (assert) {
      let ref: CodeRef = {
        module: rri('../animals/index'),
        name: 'default',
      };
      assert.strictEqual(getCardDirectoryName(ref), 'Animals');
    });

    test('ignores dot segments in a relative index module', function (assert) {
      let ref: CodeRef = {
        module: rri('./animals/../index'),
        name: 'default',
      };
      assert.strictEqual(getCardDirectoryName(ref), 'Index');
    });

    test('does not climb past the root of an absolute module', function (assert) {
      assert.strictEqual(
        getCardDirectoryName({
          module: rri('http://example.com/pets/../..'),
          name: 'default',
        }),
        'Example',
      );
      assert.strictEqual(
        getCardDirectoryName({
          module: rri('HTTPS://example.com/pets/../..'),
          name: 'default',
        }),
        'Example',
        'the root is found whatever the case of the scheme',
      );
      assert.strictEqual(
        getCardDirectoryName({
          module: rri('@cardstack/catalog/../../pet-card'),
          name: 'default',
        }),
        'PetCard',
      );
    });

    test('strips executable extensions before inferring name', function (assert) {
      let ref: CodeRef = {
        module: rri('../cards/preview-card.gts'),
        name: 'default',
      };
      assert.strictEqual(getCardDirectoryName(ref), 'PreviewCard');
    });

    test('sanitizes names with dashes and encoded characters', function (assert) {
      let ref: CodeRef = {
        module: rri('../fancy/%E2%9C%A8-sparkle-card'),
        name: 'default',
      };
      assert.strictEqual(getCardDirectoryName(ref), 'SparkleCard');
    });

    test('prefixes directories that would start with invalid characters', function (assert) {
      let ref: CodeRef = {
        module: rri('../123'),
        name: 'default',
      };
      assert.strictEqual(getCardDirectoryName(ref), 'Card123');
    });

    test('resolves nested code refs like fieldOf', function (assert) {
      let ref: CodeRef = {
        type: 'fieldOf',
        field: 'bio',
        card: {
          module: rri('../person'),
          name: 'default',
        },
      };
      assert.strictEqual(getCardDirectoryName(ref), 'Person');
    });

    test('infers directory from a prefix-form module', function (assert) {
      let ref: CodeRef = {
        module: rri('@cardstack/catalog/pets/pet-card.gts'),
        name: 'default',
      };
      assert.strictEqual(getCardDirectoryName(ref), 'PetCard');
    });

    test('infers directory from a URL-form module with a query', function (assert) {
      let ref: CodeRef = {
        module: rri('http://example.com/test/animals/index.gts?x=1#y'),
        name: 'default',
      };
      assert.strictEqual(getCardDirectoryName(ref), 'Animals');
    });

    test('falls back to cards when adoptsFrom is missing', function (assert) {
      assert.strictEqual(getCardDirectoryName(undefined), 'cards');
    });
  });
});
