import {
  type RenderingTestContext,
  waitUntil,
  waitFor,
} from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';

import { module, test } from 'qunit';

import {
  isCardInstance,
  baseRealm,
  localId,
  type Loader,
  type Realm,
  type SingleCardDocument,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';

import CardPrerender from '@cardstack/host/components/card-prerender';
import OperatorMode from '@cardstack/host/components/operator-mode/container';
import IdentityContext from '@cardstack/host/lib/gc-identity-context';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type StoreService from '@cardstack/host/services/store';
import { type CardErrorJSONAPI } from '@cardstack/host/services/store';

import { CardDef as CardDefType } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

import {
  lookupLoaderService,
  testRealmURL,
  setupLocalIndexing,
  setupOnSave,
  setupCardLogs,
  setupIntegrationTestRealm,
  type TestContextWithSave,
} from '../helpers';
import { TestRealmAdapter } from '../helpers/adapter';
import {
  CardDef,
  contains,
  field,
  linksTo,
  linksToMany,
  StringField,
  BooleanField,
  setupBaseRealm,
} from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { renderComponent } from '../helpers/render-component';
import { setupRenderingTest } from '../helpers/setup';

module('Integration | Store', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  let api: typeof CardAPI;
  let loader: Loader;
  let testRealm: Realm;
  let testRealmAdapter: TestRealmAdapter;
  let store: StoreService;
  let operatorModeStateService: OperatorModeStateService;
  let identityContext: IdentityContext;
  let PersonDef: typeof CardDefType;

  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  function forceGC() {
    identityContext.sweep(api);
    identityContext.sweep(api);
  }

  function setCardInOperatorModeState(
    cardURL?: string,
    format: 'isolated' | 'edit' = 'isolated',
  ) {
    operatorModeStateService.restore({
      stacks: cardURL ? [[{ id: cardURL, format }]] : [[]],
    });
  }

  const noop = () => {};

  hooks.beforeEach(async function (this: RenderingTestContext) {
    class Person extends CardDef {
      @field name = contains(StringField);
      @field hasError = contains(BooleanField);
      @field bestFriend = linksTo(() => Person);
      @field friends = linksToMany(() => Person);
      @field boom = contains(StringField, {
        computeVia: function (this: Person) {
          if (this.hasError) {
            throw new Error('intentional error thrown');
          }
          return 'boom';
        },
      });
    }
    PersonDef = Person;

    loader = lookupLoaderService().loader;
    api = await loader.import(`${baseRealm.url}card-api`);
    store = this.owner.lookup('service:store') as StoreService;
    operatorModeStateService = this.owner.lookup(
      'service:operator-mode-state-service',
    ) as OperatorModeStateService;
    identityContext = (store as any).identityContext as IdentityContext;

    ({ adapter: testRealmAdapter, realm: testRealm } =
      await setupIntegrationTestRealm({
        loader,
        mockMatrixUtils,
        contents: {
          'person.gts': { Person },
          'Person/hassan.json': new Person({ name: 'Hassan' }),
          'Person/jade.json': new Person({ name: 'Jade' }),
          'Person/queenzy.json': new Person({ name: 'Queenzy' }),
          'Person/germaine.json': new Person({ name: 'Germaine' }),
          'Person/boris.json': new Person({ name: 'Boris' }),
        },
      }));
  });

  test('can peek a card instance', async function (assert) {
    store.addReference(`${testRealmURL}Person/hassan`);
    await store.flush();
    let instance = store.peek(`${testRealmURL}Person/hassan`);
    assert.true(isCardInstance(instance), 'peeked item is a card instance');
  });

  test('can peek a card by local id', async function (assert) {
    store.addReference(`${testRealmURL}Person/hassan`);
    await store.flush();
    let instanceA = store.peek(`${testRealmURL}Person/hassan`);
    let instanceB = store.peek((instanceA as CardDefType)[localId]);
    assert.true(isCardInstance(instanceB), 'peeked item is a card instance');
    assert.strictEqual(
      instanceA,
      instanceB,
      'the same instance is returned by both remote ID and local ID',
    );
  });

  test('can peek a card error', async function (assert) {
    await testRealm.write(
      'Person/hassan.json',
      JSON.stringify({
        data: {
          attributes: {
            name: 'Hassan',
            hasError: true,
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}person`,
              name: 'Person',
            },
          },
        },
      } as LooseSingleCardDocument),
    );
    store.addReference(`${testRealmURL}Person/hassan`);
    await store.flush();
    let error = store.peek(`${testRealmURL}Person/hassan`);
    assert.false(isCardInstance(error), 'error is not a card instance');
    assert.ok(
      (error as CardErrorJSONAPI).message.includes('intentional error thrown'),
      'error message is correct',
    );
  });

  test('peek for an uncached returns undefined', async function (assert) {
    let instance = store.peek(`${testRealmURL}Person/does-not-exist`);
    assert.strictEqual(instance, undefined, 'instance is undefined');
  });

  test('can add reference to a card url', async function (assert) {
    let instance = store.peek(`${testRealmURL}hassan`);
    assert.strictEqual(instance, undefined, 'instance is not in store yet');

    store.addReference(`${testRealmURL}Person/hassan`);

    await store.flush();
    instance = store.peek(`${testRealmURL}Person/hassan`);
    if (isCardInstance(instance)) {
      assert.strictEqual(
        (instance as any).name,
        'Hassan',
        'instance is cached in store',
      );
    } else {
      assert.ok(
        false,
        `expected instance to be a card:${JSON.stringify(instance, null, 2)}`,
      );
    }

    forceGC();

    instance = store.peek(`${testRealmURL}Person/hassan`);
    if (isCardInstance(instance)) {
      assert.strictEqual(
        (instance as any).name,
        'Hassan',
        'instance is cached in store after GC',
      );
    } else {
      assert.ok(
        false,
        `expected instance to be a card:${JSON.stringify(
          instance,
          null,
          2,
        )} after GC`,
      );
    }
  });

  test('can add reference to a local id', async function (assert) {
    let instance = new PersonDef({ name: 'Andrea' });
    await store.add(instance, { doNotPersist: true });
    store.addReference(instance[localId]);

    forceGC();

    let peekedInstance = store.peek(instance[localId]);
    assert.strictEqual(
      peekedInstance,
      instance,
      'instance is not garbage collected',
    );
  });

  test('can drop reference to a card url', async function (assert) {
    store.addReference(`${testRealmURL}Person/hassan`);
    await store.flush();
    let instance = store.peek(`${testRealmURL}Person/hassan`);
    assert.ok(instance, 'instance is in store');
    store.dropReference(`${testRealmURL}Person/hassan`);

    forceGC();

    assert.strictEqual(
      store.peek(`${testRealmURL}Person/hassan`),
      undefined,
      'instance has been garbage collected from the store',
    );
  });

  test('can drop reference to a local id', async function (assert) {
    let instance = new PersonDef({ name: 'Andrea' });
    await store.add(instance, { doNotPersist: true });
    store.addReference(instance[localId]);
    store.dropReference(instance[localId]);
    forceGC();

    let peekedInstance = store.peek(instance[localId]);
    assert.strictEqual(
      peekedInstance,
      undefined,
      'instance is garbage collected',
    );
  });

  test<TestContextWithSave>('can manually save an instance', async function (assert) {
    assert.expect(2);
    store.addReference(`${testRealmURL}Person/hassan`);
    await store.flush();

    this.onSave((url, doc) => {
      assert.strictEqual(
        url.href,
        `${testRealmURL}Person/hassan`,
        'the saved card id is correct',
      );
      assert.strictEqual(
        (doc as SingleCardDocument).data.attributes?.name,
        'Hassan',
        'save data is correct',
      );
    });

    store.save(`${testRealmURL}Person/hassan`);
  });

  test('can create an instance', async function (assert) {
    let url = await store.create(
      {
        data: {
          attributes: {
            name: 'Andrea',
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}person`,
              name: 'Person',
            },
          },
        },
      },
      undefined,
    );
    assert.ok(typeof url === 'string', 'received a url for new instance');
    let instance = store.peek(url as string);
    assert.strictEqual((instance as CardDefType).id, url);
    assert.strictEqual((instance as any).name, 'Andrea');

    let file = await testRealmAdapter.openFile(
      `${instance!.id!.substring(testRealmURL.length)}.json`,
    );
    assert.ok(file, 'file exists');
    let fileJSON = JSON.parse(file!.content as string);
    assert.strictEqual(fileJSON.data.attributes.name, 'Andrea', 'file exists');
  });

  test('can handle card error when creating an instance', async function (assert) {
    let error = await store.create(
      {
        data: {
          attributes: {
            name: 'Andrea',
            hasError: true,
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}person`,
              name: 'Person',
            },
          },
        },
      },
      undefined,
    );
    assert.ok(typeof error === 'object', 'received a error for new instance');
    assert.ok(
      (error as any).message.includes(
        'intentional error thrown',
        'the error message is correct',
      ),
    );
  });

  test<TestContextWithSave>('can add a running instance to the store', async function (assert) {
    assert.expect(5);
    this.onSave((_, doc) => {
      assert.strictEqual(
        (doc as SingleCardDocument).data.attributes?.name,
        'Andrea',
        'card data is correct',
      );
    });
    let instance = new PersonDef({ name: 'Andrea' });
    await store.add(instance);
    assert.ok(instance.id, 'instance has been assigned remote id');
    let peekedInstance = store.peek(instance.id);
    assert.strictEqual(instance, peekedInstance, 'instance is the same');

    let file = await testRealmAdapter.openFile(
      `${instance.id.substring(testRealmURL.length)}.json`,
    );
    assert.ok(file, 'file exists');
    let fileJSON = JSON.parse(file!.content as string);
    assert.strictEqual(fileJSON.data.attributes.name, 'Andrea', 'file exists');
  });

  test<TestContextWithSave>('can add a serialized instance to the store', async function (assert) {
    assert.expect(6);
    this.onSave((_, doc) => {
      assert.strictEqual(
        (doc as SingleCardDocument).data.attributes?.name,
        'Andrea',
        'card data is correct',
      );
    });
    let instance = await store.add({
      data: {
        attributes: {
          name: 'Andrea',
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}person`,
            name: 'Person',
          },
        },
      },
    });
    assert.ok(instance.id, 'instance has been assigned remote id');
    let peekedInstance = store.peek(instance.id);
    assert.strictEqual(instance, peekedInstance, 'instance is the same');
    assert.strictEqual(
      (instance as any).name,
      'Andrea',
      'instance data is correct',
    );

    let file = await testRealmAdapter.openFile(
      `${instance.id.substring(testRealmURL.length)}.json`,
    );
    assert.ok(file, 'file exists');
    let fileJSON = JSON.parse(file!.content as string);
    assert.strictEqual(fileJSON.data.attributes.name, 'Andrea', 'file exists');
  });

  test<TestContextWithSave>('can skip saving when adding to the store', async function (assert) {
    assert.expect(3);
    this.onSave(() => {
      assert.ok(false, 'save should not happen');
    });
    let instance = await store.add(
      {
        data: {
          attributes: {
            name: 'Andrea',
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}person`,
              name: 'Person',
            },
          },
        },
      },
      { doNotPersist: true },
    );
    assert.strictEqual(
      instance.id,
      undefined,
      'instance has NOT been assigned remote id',
    );
    let peekedInstance = store.peek(instance[localId]);
    assert.strictEqual(instance, peekedInstance, 'instance is the same');
    assert.strictEqual(
      (instance as any).name,
      'Andrea',
      'instance data is correct',
    );
  });

  test('can add linked cards to the store when adding a card', async function (assert) {
    let wu = new PersonDef({ name: 'Wu' });
    let michael = new PersonDef({ name: 'Michael' });
    let lin = new PersonDef({
      name: 'Lin',
      bestFriend: wu,
      friends: [michael],
    });

    await store.add(lin, { doNotPersist: true });

    let peekedMichael = store.peek(michael[localId]);
    assert.strictEqual(
      peekedMichael,
      michael,
      'michael instance added to store',
    );
    let peekedWu = store.peek(wu[localId]);
    assert.strictEqual(peekedWu, wu, 'wu instance added to store');
  });

  test('can reject a card added to the store that has a conflicting local ID for a given URL', async function (assert) {
    store.addReference(`${testRealmURL}Person/hassan`);
    await store.flush();
    let doc: SingleCardDocument = {
      data: {
        type: 'card',
        id: `${testRealmURL}Person/hassan`,
        attributes: {
          name: 'Hassan',
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}person`,
            name: 'Person',
          },
        },
      },
    };
    let conflictingInstance = await api.createFromSerialized<
      typeof CardDefType
    >(doc.data, doc, undefined);
    try {
      await store.add(conflictingInstance);
      throw new Error('expected exception to be thrown');
    } catch (err: any) {
      assert.ok(
        err.message.includes('has conflicting instance id in store'),
        'the expected error was thrown',
      );
    }
  });

  test<TestContextWithSave>('added instance that was previously not saved will begin to auto save after being added', async function (assert) {
    assert.expect(2);
    let instance = new PersonDef({ name: 'Andrea' });
    await store.add(instance);

    this.onSave((url, doc) => {
      assert.strictEqual(url.href, instance.id, 'the instance URL is correct');
      assert.strictEqual(
        (doc as SingleCardDocument).data.attributes?.name,
        'Air',
        'card data is correct',
      );
    });
    (instance as any).name = 'Air';
  });

  test<TestContextWithSave>('an instance will auto save when its data changes', async function (assert) {
    assert.expect(2);
    let instance = await store.get(`${testRealmURL}Person/hassan`);

    this.onSave((url, doc) => {
      assert.strictEqual(url.href, instance.id, 'the instance URL is correct');
      assert.strictEqual(
        (doc as SingleCardDocument).data.attributes?.name,
        'Paper',
        'card data is correct',
      );
    });
    (instance as any).name = 'Paper';
  });

  test('can capture error when auto saving', async function (assert) {
    let instance = await store.get(`${testRealmURL}Person/hassan`);
    (instance as any).hasError = true;
    await waitUntil(
      () => store.getSaveState(`${testRealmURL}Person/hassan`)?.lastSaveError,
    );
    let saveState = store.getSaveState(`${testRealmURL}Person/hassan`);
    assert.ok(
      saveState!.lastSavedErrorMsg?.includes('intentional error thrown'),
      'error message is correct',
    );
  });

  test('can delete card from the store', async function (assert) {
    store.addReference(`${testRealmURL}Person/boris`);
    await store.flush();
    let instance = store.peek(`${testRealmURL}Person/boris`) as CardDefType;

    await store.delete(`${testRealmURL}Person/boris`);
    assert.strictEqual(
      store.peek(instance.id),
      undefined,
      'the instance is no longer in the store',
    );
    assert.strictEqual(
      store.peek(instance[localId]),
      undefined,
      'the instance is no longer in the store (via local id)',
    );

    let file = await testRealmAdapter.openFile(`Person/boris.json`);
    assert.strictEqual(file, undefined, 'file no longer exists');
  });

  test('can patch an instance', async function (assert) {
    let instance = await store.patch(`${testRealmURL}Person/hassan`, {
      attributes: {
        name: 'Hassan Updated',
      },
      relationships: {
        bestFriend: {
          links: { self: `${testRealmURL}Person/jade` },
        },
        'friends.0': {
          links: { self: `${testRealmURL}Person/germaine` },
        },
      },
    });

    let peekedInstance = store.peek(`${testRealmURL}Person/hassan`);
    let jade = store.peek(`${testRealmURL}Person/jade`);
    let germaine = store.peek(`${testRealmURL}Person/germaine`);
    assert.strictEqual(
      peekedInstance,
      instance,
      'the patched instance is in the store',
    );
    assert.ok(isCardInstance(jade), 'jade is in the store');
    assert.ok(isCardInstance(germaine), 'germaine is in the store');

    assert.strictEqual(
      (instance as any).name,
      'Hassan Updated',
      'the contains field was patched',
    );
    assert.strictEqual(
      (instance as any).bestFriend,
      jade,
      'the linksTo field was patched',
    );
    assert.deepEqual(
      (instance as any).friends,
      [germaine],
      'the linksToMany field was patched',
    );
  });

  test('can search', async function (assert) {
    let results = await store.search(
      {
        filter: {
          on: {
            module: `${testRealmURL}person`,
            name: 'Person',
          },
          eq: {
            name: 'Hassan',
          },
        },
      },
      new URL(testRealmURL),
    );

    assert.strictEqual(
      results.length,
      1,
      'the correct number of results are returned',
    );
    assert.strictEqual(
      results[0].id,
      `${testRealmURL}Person/hassan`,
      'the result is correct',
    );
  });

  test('an instance live updates from indexing events for an instance update', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/hassan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );

    await testRealm.write(
      'Person/hassan.json',
      JSON.stringify({
        data: {
          attributes: {
            name: 'Hassan updated',
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}person`,
              name: 'Person',
            },
          },
        },
      } as LooseSingleCardDocument),
    );
    await waitUntil(
      () =>
        (store.peek(`${testRealmURL}Person/hassan`) as any)?.name ===
        'Hassan updated',
    );
    assert
      .dom('[data-test-stack-card] [data-test-field="name"]')
      .containsText('Hassan updated', 'card live updated');
  });

  test('an instance live updates from indexing events for a code update', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/hassan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );
    let instance = (await store.get(
      `${testRealmURL}Person/hassan`,
    )) as CardDefType;
    await testRealm.write(
      `person.gts`,
      `
      import { contains, field, Component, CardDef, } from 'https://cardstack.com/base/card-api';
      import StringField from 'https://cardstack.com/base/string';

      export class Person extends CardDef {
        @field name = contains(StringField);
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <div test-update>Hello</div>
            <@fields.firstName />
          </template>
        };
      }`.trim(),
    );
    await waitFor('[test-update]', { timeout: 5_000 });
    assert
      .dom('[test-update]')
      .containsText('Hello', 'the instance rendered with the new code');
    let newInstance = store.peek(`${testRealmURL}Person/hassan`) as CardDefType;
    assert.notStrictEqual(
      instance[localId],
      newInstance[localId],
      'the updated instance is a different object than the original instance',
    );
  });

  test('an instance can live update thru an error state', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/hassan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );

    await testRealm.write(
      'Person/hassan.json',
      JSON.stringify({
        data: {
          attributes: {
            name: 'Hassan',
            hasError: true,
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}person`,
              name: 'Person',
            },
          },
        },
      } as LooseSingleCardDocument),
    );

    await waitFor('[data-test-card-error]');
    assert
      .dom('[data-test-error-detail]')
      .includesText('intentional error thrown');

    await testRealm.write(
      'Person/hassan.json',
      JSON.stringify({
        data: {
          attributes: {
            name: 'Hassan',
            hasError: false,
          },
          meta: {
            adoptsFrom: {
              module: `${testRealmURL}person`,
              name: 'Person',
            },
          },
        },
      } as LooseSingleCardDocument),
    );

    await waitFor('[data-test-card-error]', { count: 0 });
    assert.dom('[data-test-card-error]').doesNotExist('the error is dismissed');
    assert
      .dom('[data-test-stack-card] [data-test-field="name"]')
      .containsText('Hassan', 'card is still rendered');
  });
});
