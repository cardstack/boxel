import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import {
  generateJsonSchemaForCardType,
  basicMappings,
  type LinksToSchema,
  type RelationshipSchema,
  type RelationshipsSchema,
  type ObjectSchema,
  type AttributesSchema,
} from '@cardstack/runtime-common/helpers/ai';
import type { Loader } from '@cardstack/runtime-common/loader';

import type { primitive as primitiveType } from 'https://cardstack.com/base/card-api';

import { setupLocalIndexing, setupOnSave, setupCardLogs } from '../helpers';
import { setupRenderingTest } from '../helpers/setup';

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
    loader = getService('loader-service').loader;
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

  const cardDefAttributesProperties: { [fieldName: string]: AttributesSchema } =
    {
      cardInfo: {
        properties: {
          cardDescription: { type: 'string' },
          notes: { type: 'string' },
          cardThumbnailURL: { type: 'string' },
          cardTitle: { type: 'string' },
        },
        type: 'object',
      },
    };

  const linkedRelationship: RelationshipSchema = {
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

  const linksToManyRelationship: RelationshipSchema = {
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

  const cardDefRelationshipsProperties: {
    [fieldName: string]: RelationshipSchema;
  } = {
    'cardInfo.theme': linkedRelationship,
  };

  const cardDefRelationships: RelationshipsSchema = {
    type: 'object',
    properties: cardDefRelationshipsProperties,
  };

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

    let schema = generateJsonSchemaForCardType(BasicCard, cardApi, mappings);
    assert.deepEqual(schema, {
      attributes: {
        type: 'object',
        properties: {
          ...cardDefAttributesProperties,
          stringField: { type: 'string' },
          numberField: { type: 'number' },
          booleanField: { type: 'boolean' },
          dateField: { type: 'string', format: 'date' },
          dateTimeField: { type: 'string', format: 'date-time' },
          bigIntegerField: { type: 'string', pattern: '^-?[0-9]+$' },
        },
      },
      relationships: cardDefRelationships,
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

    let schema = generateJsonSchemaForCardType(BasicCard, cardApi, mappings);
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
          ...cardDefAttributesProperties,
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
          ...cardDefRelationshipsProperties,
        },
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

    let schema = generateJsonSchemaForCardType(TestCard, cardApi, mappings);
    assert.deepEqual(schema, {
      attributes: {
        type: 'object',
        properties: {
          ...cardDefAttributesProperties,
          containerField: {
            type: 'object',
            properties: {
              innerStringField: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
      relationships: cardDefRelationships,
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

    let schema = generateJsonSchemaForCardType(TestCard, cardApi, mappings);

    let attributes: ObjectSchema = {
      type: 'object',
      properties: {
        simpleField: { type: 'string' },
        ...cardDefAttributesProperties,
      },
    };
    let relationships: RelationshipsSchema = {
      type: 'object',
      properties: {
        linkedCard: linkedRelationship,
        linkedCard2: linkedRelationship,
        ...cardDefRelationshipsProperties,
      },
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

    let schema = generateJsonSchemaForCardType(TestCard, cardApi, mappings);

    let attributes: ObjectSchema = {
      type: 'object',
      properties: {
        simpleField: { type: 'string' },
        ...cardDefAttributesProperties,
      },
    };

    let relationships: RelationshipsSchema = {
      type: 'object',
      properties: {
        linkedCards: {
          type: 'array',
          items: linksToManyRelationship,
        },
        ...cardDefRelationshipsProperties,
      },
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

    let schema = generateJsonSchemaForCardType(ParentCard, cardApi, mappings);

    let attributes: ObjectSchema = {
      type: 'object',
      properties: {
        ...cardDefAttributesProperties,
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
    let relationships: RelationshipsSchema = {
      type: 'object',
      properties: {
        'child.friend.pet': linkedRelationship,
        ...cardDefRelationshipsProperties,
      },
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

    let schema = generateJsonSchemaForCardType(TripInfo, cardApi, mappings);
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
          ...cardDefAttributesProperties,
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
          ...cardDefRelationshipsProperties,
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
      },
    });
  });

  test(`skips over fields that can't be recognised`, async function (assert) {
    assert.expect(2);
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

    let schema = generateJsonSchemaForCardType(TestCard, cardApi, mappings);
    assert.deepEqual(schema, {
      attributes: {
        type: 'object',
        properties: {
          ...cardDefAttributesProperties,
          keepField: { type: 'string' },
        },
      },
      relationships: cardDefRelationships,
    });
    try {
      generateJsonSchemaForCardType(TestCard, cardApi, mappings, {
        strict: true,
      });
    } catch (error) {
      assert.strictEqual(
        (error as any).message,
        "No schema found for field 'skipField'. Ensure the field type is defined in the mappings.",
        'Expected an error to be thrown about the missing field',
      );
    }
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

    let schema = generateJsonSchemaForCardType(TestCard, cardApi, mappings);
    assert.deepEqual(schema, {
      attributes: {
        type: 'object',
        properties: {
          ...cardDefAttributesProperties,
          keepField: { type: 'string' },
        },
      },
      relationships: cardDefRelationships,
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

    let schema = generateJsonSchemaForCardType(TestCard, cardApi, mappings);

    assert.deepEqual(schema, {
      attributes: {
        type: 'object',
        properties: {
          ...cardDefAttributesProperties,
          containingField: {
            type: 'object',
            properties: {
              keepField: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
      relationships: cardDefRelationships,
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
        cardDescription: 'Desc #1',
      });
    }

    let schema = generateJsonSchemaForCardType(BasicCard, cardApi, mappings);
    assert.deepEqual(schema, {
      attributes: {
        type: 'object',
        properties: {
          ...cardDefAttributesProperties,
          containerField: {
            type: 'object',
            cardDescription: 'Desc #1',
            properties: {
              innerStringField: { type: 'string' },
            },
          },
        },
      },
      relationships: cardDefRelationships,
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
        cardDescription: 'Desc #2',
      });
      @field linkedCard = linksTo(InnerCard, {
        cardDescription: 'Desc #3',
      });
      @field linkedCard2 = linksTo(InnerCard);
      @field linkedCards = linksToMany(InnerCard, {
        cardDescription: 'Desc #4',
      });
      @field linkedCards2 = linksToMany(InnerCard);
    }
    class BasicCard extends CardDef {
      @field containerField = contains(InternalField, {
        cardDescription: 'Desc #1',
      });
    }

    let schema = generateJsonSchemaForCardType(BasicCard, cardApi, mappings);
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
          ...cardDefAttributesProperties,
          containerField: {
            type: 'object',
            cardDescription: 'Desc #1',
            properties: {
              innerStringField: { type: 'string', cardDescription: 'Desc #2' },
            },
          },
        },
      },
      relationships: {
        type: 'object',
        properties: {
          'containerField.linkedCard': {
            type: 'object',
            cardDescription: 'Desc #3',
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
            cardDescription: 'Desc #4',
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
          ...cardDefRelationshipsProperties,
        },
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
      @field linkedCard2 = linksTo(OtherCard, { cardDescription: 'linked card' });
    }

    let schema = generateJsonSchemaForCardType(TestCard, cardApi, mappings);

    let attributes: ObjectSchema = {
      type: 'object',
      properties: {
        simpleField: { type: 'string' },
        ...cardDefAttributesProperties,
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
          cardDescription: 'linked card',
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
        ...cardDefRelationshipsProperties,
      },
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
        cardDescription: 'linked cards',
      });
    }

    let schema = generateJsonSchemaForCardType(TestCard, cardApi, mappings);

    let attributes: ObjectSchema = {
      type: 'object',
      properties: {
        simpleField: { type: 'string' },
        ...cardDefAttributesProperties,
      },
    };
    let relationships: RelationshipsSchema = {
      type: 'object',
      properties: {
        linkedCards: {
          type: 'array',
          cardDescription: 'linked cards',
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
        ...cardDefRelationshipsProperties,
      },
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
        cardDescription: 'Desc #1',
      });
    }

    let schema = generateJsonSchemaForCardType(BasicCard, cardApi, mappings);
    assert.deepEqual(schema, {
      attributes: {
        type: 'object',
        properties: {
          ...cardDefAttributesProperties,
          containerField: {
            type: 'array',
            cardDescription: 'Desc #1',
            items: {
              type: 'object',
              properties: {
                innerStringField: { type: 'string' },
              },
            },
          },
        },
      },
      relationships: cardDefRelationships,
    });
  });
});
