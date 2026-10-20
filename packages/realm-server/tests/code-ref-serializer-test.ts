import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import { rri } from '@cardstack/runtime-common';
import { queryableValue } from '@cardstack/runtime-common/serializers/code-ref';

module(basename(import.meta.filename), function () {
  module('queryableValue', function () {
    test('joins a relative module against a prefix-form card id', function (assert) {
      assert.strictEqual(
        queryableValue({ module: rri('./person'), name: 'Person' }, [
          { id: '@cardstack/catalog/specs/person-spec' },
        ]),
        '@cardstack/catalog/specs/person/Person',
      );
    });

    test('joins a relative module against a URL-form card id', function (assert) {
      assert.strictEqual(
        queryableValue({ module: rri('../person'), name: 'Person' }, [
          { id: 'http://example.com/realm/specs/person-spec' },
        ]),
        'http://example.com/realm/person/Person',
      );
    });

    test('leaves a prefix-form module as it is', function (assert) {
      assert.strictEqual(
        queryableValue(
          { module: rri('@cardstack/base/card-api'), name: 'CardDef' },
          [{ id: 'http://example.com/realm/specs/person-spec' }],
        ),
        '@cardstack/base/card-api/CardDef',
      );
    });
  });
});
