import { setupRenderingTest } from 'ember-qunit';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import { generatePatchCallSpecification } from '@cardstack/runtime-common/helpers/ai';
import { Loader } from '@cardstack/runtime-common/loader';

import {
  setupLocalIndexing,
  setupServerSentEvents,
  setupOnSave,
  setupCardLogs,
} from '../helpers';

import { RenderingTestContext } from '@ember/test-helpers';

import { shimExternals } from '@cardstack/host/lib/externals';
import type LoaderService from '@cardstack/host/services/loader-service';

import {
  primitive as primitiveType,
  queryableValue as queryableValueType,
} from 'https://cardstack.com/base/card-api';

let cardApi: typeof import('https://cardstack.com/base/card-api');
let string: typeof import('https://cardstack.com/base/string');
let number: typeof import('https://cardstack.com/base/number');
let date: typeof import('https://cardstack.com/base/date');
let datetime: typeof import('https://cardstack.com/base/datetime');
let boolean: typeof import('https://cardstack.com/base/boolean');
let codeRef: typeof import('https://cardstack.com/base/code-ref');
let catalogEntry: typeof import('https://cardstack.com/base/catalog-entry');
let primitive: typeof primitiveType;
let queryableValue: typeof queryableValueType;

let loader: Loader;

module('Unit | ai-function-generation-test', function (hooks) {
  let owner: any;
  setupRenderingTest(hooks);
  hooks.beforeEach(function (this: RenderingTestContext) {
    loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;
  });
  hooks.beforeEach(async function () {
    shimExternals(loader);
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    primitive = cardApi.primitive;
    queryableValue = cardApi.queryableValue;
    string = await loader.import(`${baseRealm.url}string`);
    number = await loader.import(`${baseRealm.url}number`);
    date = await loader.import(`${baseRealm.url}date`);
    datetime = await loader.import(`${baseRealm.url}datetime`);
    boolean = await loader.import(`${baseRealm.url}boolean`);
    codeRef = await loader.import(`${baseRealm.url}code-ref`);
    catalogEntry = await loader.import(`${baseRealm.url}catalog-entry`);
  });

  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );
  setupServerSentEvents(hooks);

  hooks.beforeEach(async function () {
    owner = this.owner;
  });

  test(`generates a simple compliant schema for basic types`, async function (assert) {
    let { field, contains, CardDef } = cardApi;
    let { default: StringField } = string;
    let { default: NumberField } = number;
    class BasicCard extends CardDef {
      @field stringField = contains(StringField);
      @field numberField = contains(NumberField);
    }

    let schema = generatePatchCallSpecification(BasicCard, cardApi);
    assert.deepEqual(schema, {
      type: 'object',
      properties: {
        thumbnailURL: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        stringField: { type: 'string' },
        numberField: { type: 'number' },
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

    let schema = generatePatchCallSpecification(BasicCard, cardApi);
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

    let schema = generatePatchCallSpecification(TestCard, cardApi);
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

    let schema = generatePatchCallSpecification(TestCard, cardApi);
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

    let schema = generatePatchCallSpecification(TestCard, cardApi);
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
    let { field, contains, CardDef, FieldDef } = cardApi;
    let { default: StringField } = string;

    class NewField extends StringField {
      static displayName = 'NewField';
    }

    class TestCard extends CardDef {
      static displayName = 'TestCard';
      @field keepField = contains(NewField);
    }

    let schema = generatePatchCallSpecification(TestCard, cardApi);
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
});
