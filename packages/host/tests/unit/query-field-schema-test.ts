import { module, test } from 'qunit';

import { getField } from '@cardstack/runtime-common/code-ref';
import type { Query } from '@cardstack/runtime-common/query';

import {
  CardDef,
  contains,
  field,
  linksTo,
  linksToMany,
  StringField,
  setupBaseRealm,
} from '../helpers/base-realm';
import { setupRenderingTest } from '../helpers/setup';

module('Unit | query field schema', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  test('linksToMany accepts a query option and exposes it via field metadata', function (assert) {
    class Shirt extends CardDef {
      @field name = contains(StringField);
    }

    const query: Query = {
      filter: {
        eq: { size: '$this.size' },
      },
      realms: ['$thisRealm', 'https://example.com/realm'],
    };

    class Person extends CardDef {
      @field size = contains(StringField);
      @field favoriteShirt = linksTo(Shirt, { query });
      @field shirts = linksToMany(Shirt, { query });
    }

    let fieldMeta = getField(Person, 'shirts') as { queryDefinition?: Query };
    let singleFieldMeta = getField(Person, 'favoriteShirt') as {
      queryDefinition?: Query;
    };

    assert.ok(fieldMeta, 'field metadata is registered for shirts');
    assert.deepEqual(
      fieldMeta?.queryDefinition,
      query,
      'linksToMany stores the query definition',
    );
    assert.deepEqual(
      singleFieldMeta?.queryDefinition,
      query,
      'linksTo stores the query definition',
    );
  });

  test('referencing a missing field in a query raises a descriptive error', function (assert) {
    class Shirt extends CardDef {}

    assert.throws(
      () => {
        class Person extends CardDef {
          @field shirts = linksToMany(Shirt, {
            query: {
              filter: {
                eq: { size: '$this.missingField' },
              },
            },
          });
        }

        void Person;
      },
      /query field "shirts" references unknown path "\$this\.missingField" on Person/,
      'validation error includes field name and card context',
    );
  });
});
