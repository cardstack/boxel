import { setupRenderingTest } from 'ember-qunit';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import { loadCard } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';
import { Realm } from '@cardstack/runtime-common/realm';

import type LoaderService from '@cardstack/host/services/loader-service';

import {
  testRealmURL,
  setupCardLogs,
  setupLocalIndexing,
  setupServerSentEvents,
  setupOnSave,
  TestRealmAdapter,
  TestRealm,
  sourceFetchRedirectHandle,
  sourceFetchReturnUrlHandle,
} from '../helpers';

let cardApi: typeof import('https://cardstack.com/base/card-api');

let loader: Loader;

module('Unit | ai-function-generation-test', function (hooks) {
  let adapter: TestRealmAdapter;
  let realm: Realm;
  let owner: any;
  setupRenderingTest(hooks);

  hooks.beforeEach(function () {
    loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;
  });

  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );
  setupServerSentEvents(hooks);

  async function createCard(code: string) {
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    adapter = new TestRealmAdapter({
      'testcard.gts': code,
    });
    realm = await TestRealm.createWithAdapter(adapter, loader, owner, {
      overridingHandlers: [
        async (req: Request) => {
          return sourceFetchRedirectHandle(req, adapter, testRealmURL);
        },
        async (req: Request) => {
          return sourceFetchReturnUrlHandle(req, realm.maybeHandle.bind(realm));
        },
      ],
    });
    await realm.ready;
    return await loadCard(
      { name: 'TestCard', module: 'testcard' },
      { loader: loader, relativeTo: new URL(testRealmURL) },
    );
  }

  hooks.beforeEach(async function () {
    owner = this.owner;
  });

  test(`generates a simple compliant schema for basic types`, async function (assert) {
    let basicCard = await createCard(`
    import StringField from 'https://cardstack.com/base/string';
    import NumberField from 'https://cardstack.com/base/number';
    import {
        Component,
        CardDef,
        field,
        contains,
    } from 'https://cardstack.com/base/card-api';

    export class TestCard extends CardDef {
        static displayName = 'TestCard';
        @field stringField = contains(StringField);
        @field numberField = contains(NumberField);
        @field computedField = contains(StringField, {
        computeVia: function (this: TestCard) {
            return 'generated';
        },
        });
    }
    `);
    let schema = cardApi.generatePatchCallSpecification(basicCard);
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

  test(`generates a simple compliant schema when there are thunks`, async function (assert) {
    let basicCard = await createCard(`
    import StringField from 'https://cardstack.com/base/string';
    import NumberField from 'https://cardstack.com/base/number';
    import {
        Component,
        CardDef,
        field,
        contains,
    } from 'https://cardstack.com/base/card-api';

    export class TestCard extends CardDef {
        static displayName = 'TestCard';
        @field stringField = contains(() => StringField);
    }
    `);
    let schema = cardApi.generatePatchCallSpecification(basicCard);
    assert.deepEqual(schema, {
      type: 'object',
      properties: {
        thumbnailURL: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        stringField: { type: 'string' },
      },
    });
  });

  test(`generates a simple compliant schema for nested types`, async function (assert) {
    let nestedCard = await createCard(`
    import StringField from 'https://cardstack.com/base/string';
    import {
        Component,
        CardDef,
        FieldDef,
        field,
        contains,
    } from 'https://cardstack.com/base/card-api';

    class InternalField extends FieldDef {
        @field innerStringField = contains(StringField);
    }

    export class TestCard extends CardDef {
        static displayName = 'TestCard';
        @field containerField = contains(InternalField);
    }
    `);
    let schema = cardApi.generatePatchCallSpecification(nestedCard);
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
    let nestedCard = await createCard(`
    import StringField from 'https://cardstack.com/base/string';
    import {
        Component,
        CardDef,
        FieldDef,
        field,
        contains,
        containsMany,
    } from 'https://cardstack.com/base/card-api';

    class InternalField extends FieldDef {
        @field innerStringField = containsMany(StringField);
    }

    export class TestCard extends CardDef {
        static displayName = 'TestCard';
        @field containerField = contains(InternalField);
    }
    `);
    let schema = cardApi.generatePatchCallSpecification(nestedCard);
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
    let nestedCard = await createCard(`
    import StringField from 'https://cardstack.com/base/string';
    import {
        Component,
        CardDef,
        FieldDef,
        field,
        linksTo,
        contains
    } from 'https://cardstack.com/base/card-api';

    class OtherCard extends CardDef {
        @field innerStringField = contains(StringField);
    }

    export class TestCard extends CardDef {
        static displayName = 'TestCard';
        @field linkedCard = linksTo(OtherCard);
        @field simpleField = contains(StringField);
    }
    `);
    let schema = cardApi.generatePatchCallSpecification(nestedCard);
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
    let nestedCard = await createCard(`
    import StringField from 'https://cardstack.com/base/string';
    import {
        Component,
        CardDef,
        FieldDef,
        field,
        contains,
        primitive
    } from 'https://cardstack.com/base/card-api';

    class NewField extends FieldDef {
        static displayName = 'NewField';
        static [primitive]: number;
    }

    export class TestCard extends CardDef {
        static displayName = 'TestCard';
        @field keepField = contains(StringField);
        @field skipField = contains(NewField);
    }
    `);
    let schema = cardApi.generatePatchCallSpecification(nestedCard);
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

  test(`Doesn't break when there's a loop`, async function (assert) {
    let nestedCard = await createCard(`
    import StringField from 'https://cardstack.com/base/string';
    import {
        Component,
        CardDef,
        FieldDef,
        field,
        contains,
    } from 'https://cardstack.com/base/card-api';

    class RecursiveField extends FieldDef {
        @field innerRecursiveField = contains(() => RecursiveField);
        @field innerStringField = contains(StringField);
    }

    export class TestCard extends CardDef {
        static displayName = 'TestCard';
        @field keepField = contains(StringField);
        @field recursiveField = contains(RecursiveField);
    }
    `);
    let schema = cardApi.generatePatchCallSpecification(nestedCard);
    assert.deepEqual(schema, {
      type: 'object',
      properties: {
        thumbnailURL: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        keepField: { type: 'string' },
        recursiveField: {
          type: 'object',
          properties: {
            innerStringField: { type: 'string' },
          },
        },
      },
    });
  });
});
