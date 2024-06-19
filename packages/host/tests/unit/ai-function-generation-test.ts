import { RenderingTestContext } from '@ember/test-helpers';

import { setupRenderingTest } from 'ember-qunit';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import {
  generateCardPatchCallSpecification,
  basicMappings,
  type LinksToSchema,
  type RelationshipSchema,
  type RelationshipsSchema,
  type ObjectSchema,
} from '@cardstack/runtime-common/helpers/ai';
import { Loader } from '@cardstack/runtime-common/loader';

import type LoaderService from '@cardstack/host/services/loader-service';

import { primitive as primitiveType } from 'https://cardstack.com/base/card-api';

import {
  setupLocalIndexing,
  setupServerSentEvents,
  setupOnSave,
  setupCardLogs,
} from '../helpers';

let cardApi: typeof import('https://cardstack.com/base/card-api');
let string: typeof import('https://cardstack.com/base/string');
let number: typeof import('https://cardstack.com/base/number');
let biginteger: typeof import('https://cardstack.com/base/big-integer');
let date: typeof import('https://cardstack.com/base/date');
let datetime: typeof import('https://cardstack.com/base/datetime');
let boolean: typeof import('https://cardstack.com/base/boolean');
let primitive: typeof primitiveType;
let mappings: Map<typeof cardApi.FieldDef, any>;

let loader: Loader;

module('Unit | ai-function-generation-test', function (hooks) {
  setupRenderingTest(hooks);
  hooks.beforeEach(function (this: RenderingTestContext) {
    loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;
  });
  hooks.beforeEach(async function () {
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    primitive = cardApi.primitive;
    string = await loader.import(`${baseRealm.url}string`);
    number = await loader.import(`${baseRealm.url}number`);
    biginteger = await loader.import(`${baseRealm.url}big-integer`);
    date = await loader.import(`${baseRealm.url}date`);
    datetime = await loader.import(`${baseRealm.url}datetime`);
    boolean = await loader.import(`${baseRealm.url}boolean`);
    mappings = await basicMappings(loader);
  });

  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );
  setupServerSentEvents(hooks);

  test(`generates a simple compliant schema for basic types`, async function (assert) {
    let { field, contains, CardDef } = cardApi;
    let { default: StringField } = string;
    let { default: NumberField } = number;
    let { default: BooleanField } = boolean;
    let { default: DateField } = date;
    let { default: DateTimeField } = datetime;
    let { default: BigIntegerField } = biginteger;
    class BasicCard extends CardDef {
      @field stringField = contains(StringField);
      @field numberField = contains(NumberField);
      @field booleanField = contains(BooleanField);
      @field dateField = contains(DateField);
      @field dateTimeField = contains(DateTimeField);
      @field bigIntegerField = contains(BigIntegerField);
    }

    let schema = generateCardPatchCallSpecification(
      BasicCard,
      cardApi,
      mappings,
    );
    assert.deepEqual(schema, {
      attributes: {
        type: 'object',
        properties: {
          thumbnailURL: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          stringField: { type: 'string' },
          numberField: { type: 'number' },
          booleanField: { type: 'boolean' },
          dateField: { type: 'string', format: 'date' },
          dateTimeField: { type: 'string', format: 'date-time' },
          bigIntegerField: { type: 'string', pattern: '^-?[0-9]+$' },
        },
      },
    });
  });

  test(`generates a simple compliant schema for nested types`, async function (assert) {
    let { field, contains, linksTo, linksToMany, CardDef, FieldDef } = cardApi;
    let { default: StringField } = string;

    class InnerCard extends CardDef {
      @field name = contains(StringField);
    }
    class InternalField extends FieldDef {
      @field innerStringField = contains(StringField);
      @field linkedCard = linksTo(InnerCard);
      @field linkedCards = linksToMany(InnerCard);
    }
    class BasicCard extends CardDef {
      @field containerField = contains(InternalField);
    }

    let schema = generateCardPatchCallSpecification(
      BasicCard,
      cardApi,
      mappings,
    );
    const links: LinksToSchema['properties']['links'] = {
      type: 'object',
      properties: {
        self: { type: 'string' },
      },
      required: ['self'],
    };
    assert.deepEqual(schema, {
      attributes: {
        type: 'object',
        properties: {
          thumbnailURL: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          containerField: {
            type: 'object',
            properties: {
              innerStringField: { type: 'string' },
            },
          },
        },
      },
      relationships: {
        type: 'object',
        properties: {
          'containerField.linkedCard': {
            type: 'object',
            properties: { links },
            required: ['links'],
          },
          'containerField.linkedCards': {
            type: 'array',
            items: {
              type: 'object',
              properties: { links },
              required: ['links'],
            },
          },
        },
        required: ['containerField.linkedCard', 'containerField.linkedCards'],
      },
    });
  });

  test(`should support contains many`, async function (assert) {
    let { field, contains, containsMany, CardDef, FieldDef } = cardApi;
    let { default: StringField } = string;

    class InternalField extends FieldDef {
      @field innerStringField = containsMany(StringField);
    }
    class TestCard extends CardDef {
      @field containerField = contains(InternalField);
    }

    let schema = generateCardPatchCallSpecification(
      TestCard,
      cardApi,
      mappings,
    );
    assert.deepEqual(schema, {
      attributes: {
        type: 'object',
        properties: {
          thumbnailURL: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          containerField: {
            type: 'object',
            properties: {
              innerStringField: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    });
  });

  test(`should support linksTo`, async function (assert) {
    let { field, contains, linksTo, CardDef } = cardApi;
    let { default: StringField } = string;
    class OtherCard extends CardDef {
      @field innerStringField = contains(StringField);
    }

    class TestCard extends CardDef {
      static displayName = 'TestCard';
      @field linkedCard = linksTo(OtherCard);
      @field simpleField = contains(StringField);
      @field linkedCard2 = linksTo(OtherCard);
    }

    let schema = generateCardPatchCallSpecification(
      TestCard,
      cardApi,
      mappings,
    );

    let attributes: ObjectSchema = {
      type: 'object',
      properties: {
        simpleField: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        thumbnailURL: { type: 'string' },
      },
    };
    let linkedRelationship: RelationshipSchema = {
      type: 'object',
      properties: {
        links: {
          type: 'object',
          properties: {
            self: { type: 'string' },
          },
          required: ['self'],
        },
      },
      required: ['links'],
    };
    let relationships: RelationshipsSchema = {
      type: 'object',
      properties: {
        linkedCard: linkedRelationship,
        linkedCard2: linkedRelationship,
      },
      required: ['linkedCard', 'linkedCard2'],
    };
    assert.deepEqual(schema, { attributes, relationships });
  });

  test(`should support linksToMany`, async function (assert) {
    let { field, contains, linksToMany, CardDef } = cardApi;
    let { default: StringField } = string;
    class OtherCard extends CardDef {
      @field innerStringField = contains(StringField);
    }
    class TestCard extends CardDef {
      static displayName = 'TestCard';
      @field simpleField = contains(StringField);
      @field linkedCards = linksToMany(OtherCard);
    }

    let schema = generateCardPatchCallSpecification(
      TestCard,
      cardApi,
      mappings,
    );

    let attributes: ObjectSchema = {
      type: 'object',
      properties: {
        simpleField: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        thumbnailURL: { type: 'string' },
      },
    };
    let linksToManyRelationship: RelationshipSchema = {
      type: 'object',
      properties: {
        links: {
          type: 'object',
          properties: {
            self: { type: 'string' },
          },
          required: ['self'],
        },
      },
      required: ['links'],
    };
    let relationships: RelationshipsSchema = {
      type: 'object',
      properties: {
        linkedCards: {
          type: 'array',
          items: linksToManyRelationship,
        },
      },
      required: ['linkedCards'],
    };
    assert.deepEqual(schema, { attributes, relationships });
  });

  test(`supports deeply nested fields`, async function (assert) {
    let { field, contains, linksTo, CardDef, FieldDef } = cardApi;
    let { default: StringField } = string;

    class PetCard extends CardDef {
      @field name = contains(StringField);
    }
    class FriendField extends FieldDef {
      @field name = contains(StringField);
      @field pet = linksTo(PetCard);
    }
    class ChildField extends FieldDef {
      @field name = contains(StringField);
      @field friend = contains(FriendField);
    }
    class ParentCard extends CardDef {
      @field name = contains(StringField);
      @field child = contains(ChildField);
    }

    let schema = generateCardPatchCallSpecification(
      ParentCard,
      cardApi,
      mappings,
    );

    let attributes: ObjectSchema = {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        thumbnailURL: { type: 'string' },
        name: { type: 'string' },
        child: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            friend: {
              type: 'object',
              properties: {
                name: { type: 'string' },
              },
            },
          },
        },
      },
    };
    let linkedRelationship: RelationshipSchema = {
      type: 'object',
      properties: {
        links: {
          type: 'object',
          properties: {
            self: { type: 'string' },
          },
          required: ['self'],
        },
      },
      required: ['links'],
    };
    let relationships: RelationshipsSchema = {
      type: 'object',
      properties: {
        'child.friend.pet': linkedRelationship,
      },
      required: ['child.friend.pet'],
    };
    assert.deepEqual(schema, {
      attributes,
      relationships,
    });
  });

  test(`generates correct schema for nested linksTo and linksToMany fields`, async function (assert) {
    let { field, contains, linksTo, linksToMany, CardDef, FieldDef } = cardApi;
    let { default: StringField } = string;
    class Country extends CardDef {
      @field name = contains(StringField);
    }
    class TravelGoal extends FieldDef {
      @field goalTitle = contains(StringField);
      @field country = linksTo(Country);
    }
    class Traveler extends FieldDef {
      @field name = contains(StringField);
      @field countryOfOrigin = linksTo(Country);
      @field countriesVisited = linksToMany(Country);
      @field nextTravelGoal = contains(TravelGoal);
    }
    class TripInfo extends CardDef {
      @field traveler = contains(Traveler);
    }

    let schema = generateCardPatchCallSpecification(
      TripInfo,
      cardApi,
      mappings,
    );
    const links: LinksToSchema['properties']['links'] = {
      type: 'object',
      properties: {
        self: { type: 'string' },
      },
      required: ['self'],
    };
    assert.deepEqual(schema, {
      attributes: {
        type: 'object',
        properties: {
          thumbnailURL: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          traveler: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              nextTravelGoal: {
                type: 'object',
                properties: {
                  goalTitle: { type: 'string' },
                },
              },
            },
          },
        },
      },
      relationships: {
        type: 'object',
        properties: {
          'traveler.countryOfOrigin': {
            type: 'object',
            properties: { links },
            required: ['links'],
          },
          'traveler.countriesVisited': {
            type: 'array',
            items: {
              type: 'object',
              properties: { links },
              required: ['links'],
            },
          },
          'traveler.nextTravelGoal.country': {
            type: 'object',
            properties: { links },
            required: ['links'],
          },
        },
        required: [
          'traveler.countryOfOrigin',
          'traveler.countriesVisited',
          'traveler.nextTravelGoal.country',
        ],
      },
    });
  });

  test(`skips over fields that can't be recognised`, async function (assert) {
    let { field, contains, CardDef, FieldDef } = cardApi;
    let { default: StringField } = string;

    class NewField extends FieldDef {
      static displayName = 'NewField';
      static [primitive]: number;
    }

    class TestCard extends CardDef {
      static displayName = 'TestCard';
      @field keepField = contains(StringField);
      @field skipField = contains(NewField);
    }

    let schema = generateCardPatchCallSpecification(
      TestCard,
      cardApi,
      mappings,
    );
    assert.deepEqual(schema, {
      attributes: {
        type: 'object',
        properties: {
          thumbnailURL: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          keepField: { type: 'string' },
        },
      },
    });
  });

  test(`handles subclasses`, async function (assert) {
    let { field, contains, CardDef } = cardApi;
    let { default: StringField } = string;

    class NewField extends StringField {
      static displayName = 'NewField';
    }

    class TestCard extends CardDef {
      static displayName = 'TestCard';
      @field keepField = contains(NewField);
    }

    let schema = generateCardPatchCallSpecification(
      TestCard,
      cardApi,
      mappings,
    );
    assert.deepEqual(schema, {
      attributes: {
        type: 'object',
        properties: {
          thumbnailURL: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          keepField: { type: 'string' },
        },
      },
    });
  });

  test(`handles subclasses within nested fields`, async function (assert) {
    let { field, contains, containsMany, CardDef, FieldDef } = cardApi;
    let { default: StringField } = string;

    class NewField extends StringField {
      static displayName = 'NewField';
    }

    class ContainingField extends FieldDef {
      @field keepField = containsMany(NewField);
    }

    class TestCard extends CardDef {
      static displayName = 'TestCard';
      @field containingField = contains(ContainingField);
    }

    let schema = generateCardPatchCallSpecification(
      TestCard,
      cardApi,
      mappings,
    );

    assert.deepEqual(schema, {
      attributes: {
        type: 'object',
        properties: {
          thumbnailURL: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          containingField: {
            type: 'object',
            properties: {
              keepField: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    });
  });

  test(`supports descriptions on fields`, async function (assert) {
    let { field, contains, CardDef, FieldDef } = cardApi;
    let { default: StringField } = string;

    class InternalField extends FieldDef {
      @field innerStringField = contains(StringField);
    }
    class BasicCard extends CardDef {
      @field containerField = contains(InternalField, {
        description: 'Desc #1',
      });
    }

    let schema = generateCardPatchCallSpecification(
      BasicCard,
      cardApi,
      mappings,
    );
    assert.deepEqual(schema, {
      attributes: {
        type: 'object',
        properties: {
          thumbnailURL: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          containerField: {
            type: 'object',
            description: 'Desc #1',
            properties: {
              innerStringField: { type: 'string' },
            },
          },
        },
      },
    });
  });

  test(`supports descriptions on nested fields`, async function (assert) {
    let { field, contains, linksTo, linksToMany, CardDef, FieldDef } = cardApi;
    let { default: StringField } = string;
    class InnerCard extends CardDef {
      @field name = contains(StringField);
    }
    class InternalField extends FieldDef {
      @field innerStringField = contains(StringField, {
        description: 'Desc #2',
      });
      @field linkedCard = linksTo(InnerCard, {
        description: 'Desc #3',
      });
      @field linkedCard2 = linksTo(InnerCard);
      @field linkedCards = linksToMany(InnerCard, {
        description: 'Desc #4',
      });
      @field linkedCards2 = linksToMany(InnerCard);
    }
    class BasicCard extends CardDef {
      @field containerField = contains(InternalField, {
        description: 'Desc #1',
      });
    }

    let schema = generateCardPatchCallSpecification(
      BasicCard,
      cardApi,
      mappings,
    );
    const links: LinksToSchema['properties']['links'] = {
      type: 'object',
      properties: {
        self: { type: 'string' },
      },
      required: ['self'],
    };
    assert.deepEqual(schema, {
      attributes: {
        type: 'object',
        properties: {
          thumbnailURL: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          containerField: {
            type: 'object',
            description: 'Desc #1',
            properties: {
              innerStringField: { type: 'string', description: 'Desc #2' },
            },
          },
        },
      },
      relationships: {
        type: 'object',
        properties: {
          'containerField.linkedCard': {
            type: 'object',
            description: 'Desc #3',
            properties: { links },
            required: ['links'],
          },
          'containerField.linkedCard2': {
            type: 'object',
            properties: { links },
            required: ['links'],
          },
          'containerField.linkedCards': {
            type: 'array',
            description: 'Desc #4',
            items: {
              type: 'object',
              properties: { links },
              required: ['links'],
            },
          },
          'containerField.linkedCards2': {
            type: 'array',
            items: {
              type: 'object',
              properties: { links },
              required: ['links'],
            },
          },
        },
        required: [
          'containerField.linkedCard',
          'containerField.linkedCard2',
          'containerField.linkedCards',
          'containerField.linkedCards2',
        ],
      },
    });
  });

  test(`supports descriptions in linksTo`, async function (assert) {
    let { field, contains, linksTo, CardDef } = cardApi;
    let { default: StringField } = string;
    class OtherCard extends CardDef {
      @field innerStringField = contains(StringField);
    }

    class TestCard extends CardDef {
      static displayName = 'TestCard';
      @field linkedCard = linksTo(OtherCard);
      @field simpleField = contains(StringField);
      @field linkedCard2 = linksTo(OtherCard, { description: 'linked card' });
    }

    let schema = generateCardPatchCallSpecification(
      TestCard,
      cardApi,
      mappings,
    );

    let attributes: ObjectSchema = {
      type: 'object',
      properties: {
        simpleField: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        thumbnailURL: { type: 'string' },
      },
    };
    let relationships: RelationshipsSchema = {
      type: 'object',
      properties: {
        linkedCard: {
          type: 'object',
          properties: {
            links: {
              type: 'object',
              properties: {
                self: { type: 'string' },
              },
              required: ['self'],
            },
          },
          required: ['links'],
        },
        linkedCard2: {
          type: 'object',
          description: 'linked card',
          properties: {
            links: {
              type: 'object',
              properties: {
                self: { type: 'string' },
              },
              required: ['self'],
            },
          },
          required: ['links'],
        },
      },
      required: ['linkedCard', 'linkedCard2'],
    };
    assert.deepEqual(schema, { attributes, relationships });
  });

  test(`supports descriptions in linksToMany`, async function (assert) {
    let { field, contains, linksToMany, CardDef } = cardApi;
    let { default: StringField } = string;
    class OtherCard extends CardDef {
      @field innerStringField = contains(StringField);
    }

    class TestCard extends CardDef {
      static displayName = 'TestCard';
      @field simpleField = contains(StringField);
      @field linkedCards = linksToMany(OtherCard, {
        description: 'linked cards',
      });
    }

    let schema = generateCardPatchCallSpecification(
      TestCard,
      cardApi,
      mappings,
    );

    let attributes: ObjectSchema = {
      type: 'object',
      properties: {
        simpleField: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        thumbnailURL: { type: 'string' },
      },
    };
    let relationships: RelationshipsSchema = {
      type: 'object',
      properties: {
        linkedCards: {
          type: 'array',
          description: 'linked cards',
          items: {
            type: 'object',
            properties: {
              links: {
                type: 'object',
                properties: {
                  self: { type: 'string' },
                },
                required: ['self'],
              },
            },
            required: ['links'],
          },
        },
      },
      required: ['linkedCards'],
    };
    assert.deepEqual(schema, { attributes, relationships });
  });

  test(`supports descriptions on containsMany fields`, async function (assert) {
    let { field, contains, containsMany, CardDef, FieldDef } = cardApi;
    let { default: StringField } = string;

    class InternalField extends FieldDef {
      @field innerStringField = contains(StringField);
    }
    class BasicCard extends CardDef {
      @field containerField = containsMany(InternalField, {
        description: 'Desc #1',
      });
    }

    let schema = generateCardPatchCallSpecification(
      BasicCard,
      cardApi,
      mappings,
    );
    assert.deepEqual(schema, {
      attributes: {
        type: 'object',
        properties: {
          thumbnailURL: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          containerField: {
            type: 'array',
            description: 'Desc #1',
            items: {
              type: 'object',
              properties: {
                innerStringField: { type: 'string' },
              },
            },
          },
        },
      },
    });
  });
});
