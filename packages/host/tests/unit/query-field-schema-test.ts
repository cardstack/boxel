import { module, test } from 'qunit';

import { getField } from '@cardstack/runtime-common/code-ref';
import type { Query } from '@cardstack/runtime-common/query';

import {
  CardDef,
  FieldDef,
  contains,
  containsMany,
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
      realm: '$thisRealm',
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

  test('linksTo and linksToMany queries are preserved when defined inside FieldDefs', function (assert) {
    class Shirt extends CardDef {
      @field name = contains(StringField);
    }

    const query: Query = {
      filter: {
        eq: { size: '$this.size' },
      },
      realm: '$thisRealm',
    };

    class FavoriteField extends FieldDef {
      @field favorite = linksTo(Shirt, { query });
      @field shirts = linksToMany(Shirt, { query });
    }

    class Person extends CardDef {
      @field size = contains(StringField);
      @field favoriteField = contains(FavoriteField);
    }

    let fieldMeta = getField(FavoriteField, 'shirts') as {
      queryDefinition?: Query;
    };
    let singleFieldMeta = getField(FavoriteField, 'favorite') as {
      queryDefinition?: Query;
    };

    assert.ok(fieldMeta, 'field metadata is registered for nested shirts');
    assert.deepEqual(
      fieldMeta?.queryDefinition,
      query,
      'linksToMany query inside FieldDef stores the query definition',
    );
    assert.deepEqual(
      singleFieldMeta?.queryDefinition,
      query,
      'linksTo query inside FieldDef stores the query definition',
    );

    // Ensure the containing card also validates with the nested query fields
    assert.ok(
      getField(Person, 'favoriteField'),
      'containing card can be introspected',
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

  test('referencing nested fields validates each segment', function (assert) {
    class HangerField extends FieldDef {
      @field label = contains(StringField);
    }

    class ClosetField extends FieldDef {
      @field hanging = contains(HangerField);
    }

    class Shirt extends CardDef {}

    assert.throws(
      () => {
        class Person extends CardDef {
          @field closet = contains(ClosetField);
          @field shirts = linksToMany(Shirt, {
            query: {
              filter: {
                eq: { label: '$this.closet.hanging.missingField' },
              },
            },
          });
        }

        void Person;
      },
      /query field "shirts" references unknown path "\$this\.closet\.hanging\.missingField" on HangerField/,
      'validation error reports nested card context',
    );
  });

  test('dereferencing containsMany paths requires numeric indexes', function (assert) {
    class ShirtField extends FieldDef {
      @field label = contains(StringField);
    }

    class WardrobeField extends FieldDef {
      @field shirts = containsMany(ShirtField);
    }

    class Shirt extends CardDef {}

    assert.throws(
      () => {
        class Person extends CardDef {
          @field wardrobe = contains(WardrobeField);
          @field shirts = linksToMany(Shirt, {
            query: {
              filter: {
                eq: { label: '$this.wardrobe.shirts.label' },
              },
            },
          });
        }

        void Person;
      },
      /query field "shirts" must use a numeric index when referencing "\$this\.wardrobe\.shirts\.label"/,
      'validation error requires indexes for containsMany dereferences',
    );

    class Person extends CardDef {
      @field wardrobe = contains(WardrobeField);
      @field shirts = linksToMany(Shirt, {
        query: {
          filter: {
            eq: { label: '$this.wardrobe.shirts.0.label' },
          },
        },
      });
    }

    assert.ok(
      getField(Person, 'shirts'),
      'query passes validation when using numeric index',
    );
  });

  test('dereferencing relationship fields is allowed during validation', function (assert) {
    class Friend extends CardDef {
      @field name = contains(StringField);
    }

    class Shirt extends CardDef {
      @field label = contains(StringField);
    }

    class Person extends CardDef {
      @field favoriteFriend = linksTo(Friend);
      @field shirts = linksToMany(Shirt, {
        query: {
          filter: {
            eq: { label: '$this.favoriteFriend.name' },
          },
        },
      });
    }

    assert.ok(
      getField(Person, 'shirts'),
      'query passes validation when referencing relationship fields',
    );
  });
});
