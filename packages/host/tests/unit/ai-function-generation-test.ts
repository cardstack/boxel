import { RenderingTestContext } from '@ember/test-helpers';

import { setupRenderingTest } from 'ember-qunit';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import {
  generatePatchCallSpecification,
  basicMappings,
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

    let schema = generatePatchCallSpecification(BasicCard, cardApi, mappings);
    assert.deepEqual(schema, {
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
    });
  });

  test(`generates a simple compliant schema for nested types`, async function (assert) {
    let { field, contains, CardDef, FieldDef } = cardApi;
    let { default: StringField } = string;

    class InternalField extends FieldDef {
      @field innerStringField = contains(StringField);
    }
    class BasicCard extends CardDef {
      @field containerField = contains(InternalField);
    }

    let schema = generatePatchCallSpecification(BasicCard, cardApi, mappings);
    assert.deepEqual(schema, {
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

    let schema = generatePatchCallSpecification(TestCard, cardApi, mappings);
    assert.deepEqual(schema, {
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
    });
  });

  test(`does not generate anything for linksTo`, async function (assert) {
    let { field, contains, linksTo, CardDef } = cardApi;
    let { default: StringField } = string;
    class OtherCard extends CardDef {
      @field innerStringField = contains(StringField);
    }

    class TestCard extends CardDef {
      static displayName = 'TestCard';
      @field linkedCard = linksTo(OtherCard);
      @field simpleField = contains(StringField);
    }

    let schema = generatePatchCallSpecification(TestCard, cardApi, mappings);
    assert.deepEqual(schema, {
      type: 'object',
      properties: {
        thumbnailURL: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        simpleField: { type: 'string' },
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

    let schema = generatePatchCallSpecification(TestCard, cardApi, mappings);
    assert.deepEqual(schema, {
      type: 'object',
      properties: {
        thumbnailURL: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        keepField: { type: 'string' },
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

    let schema = generatePatchCallSpecification(TestCard, cardApi, mappings);
    assert.deepEqual(schema, {
      type: 'object',
      properties: {
        thumbnailURL: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        keepField: { type: 'string' },
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

    let schema = generatePatchCallSpecification(TestCard, cardApi, mappings);

    assert.deepEqual(schema, {
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
    });
  });
});
