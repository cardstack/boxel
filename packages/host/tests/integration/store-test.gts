import { service } from '@ember/service';
import {
  type RenderingTestContext,
  waitUntil,
  waitFor,
  click,
  typeIn,
} from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  isCardInstance,
  baseRealm,
  localId,
  baseCardRef,
  realmURL,
  Deferred,
  type Loader,
  type Realm,
  type SingleCardDocument,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';

import OperatorMode from '@cardstack/host/components/operator-mode/container';
import type CardStore from '@cardstack/host/lib/gc-card-store';
import { getCardCollection } from '@cardstack/host/resources/card-collection';
import { getCard } from '@cardstack/host/resources/card-resource';
import type LoaderService from '@cardstack/host/services/loader-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';
import type StoreService from '@cardstack/host/services/store';
import type { CardErrorJSONAPI } from '@cardstack/host/services/store';

import type { CardDef as CardDefType } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type { RealmEventContent } from 'https://cardstack.com/base/matrix-event';

import {
  testRealmURL,
  setupLocalIndexing,
  setupOnSave,
  setupCardLogs,
  setupIntegrationTestRealm,
  type TestContextWithSave,
  withSlowSave,
  setupOperatorModeStateCleanup,
} from '../helpers';

import {
  CardDef,
  contains,
  field,
  linksTo,
  linksToMany,
  StringField,
  BooleanField,
  Component,
  setupBaseRealm,
} from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { renderComponent } from '../helpers/render-component';
import { setupRenderingTest } from '../helpers/setup';

import type { TestRealmAdapter } from '../helpers/adapter';

module('Integration | Store', function (hooks) {
  setupRenderingTest(hooks);
  setupOperatorModeStateCleanup(hooks);
  setupBaseRealm(hooks);
  let api: typeof CardAPI;
  let loader: Loader;
  let loaderService: LoaderService;
  let testRealm: Realm;
  let testRealmAdapter: TestRealmAdapter;
  let storeService: StoreService;
  let operatorModeStateService: OperatorModeStateService;
  let cardStore: CardStore;
  let PersonDef: typeof CardDefType;
  let BoomPersonDef: typeof CardDefType;
  let realmService: RealmService;

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
    // it takes 2 sweeps to trigger GC
    cardStore.sweep(api);
    cardStore.sweep(api);
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

    class BoomPerson extends CardDef {
      static displayName = 'Boom Person';
      @field name = contains(StringField);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          Hello
          <@fields.name />!
          {{this.boom}}
        </template>
        // @ts-ignore intentional error
        boom = () => intentionallyNotDefined();
      };
    }
    BoomPersonDef = BoomPerson;
    loaderService = getService('loader-service');
    loader = loaderService.loader;
    api = await loader.import(`${baseRealm.url}card-api`);
    storeService = getService('store');
    operatorModeStateService = getService('operator-mode-state-service');
    cardStore = (storeService as any).store as CardStore;
    realmService = getService('realm');

    ({ adapter: testRealmAdapter, realm: testRealm } =
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'person.gts': { Person },
          'boom-person.gts': { BoomPerson },
          'Person/hassan.json': new Person({ name: 'Hassan' }),
          'Person/jade.json': new Person({ name: 'Jade' }),
          'Person/queenzy.json': new Person({ name: 'Queenzy' }),
          'Person/germaine.json': new Person({ name: 'Germaine' }),
          'Person/boris.json': new Person({ name: 'Boris' }),
        },
      }));
    await realmService.login(testRealmURL);
  });

  test('can peek a card instance', async function (assert) {
    storeService.addReference(`${testRealmURL}Person/hassan`);
    await storeService.flush();
    let instance = storeService.peek(`${testRealmURL}Person/hassan`);
    assert.true(isCardInstance(instance), 'peeked item is a card instance');
  });

  test('can peek a card by local id', async function (assert) {
    storeService.addReference(`${testRealmURL}Person/hassan`);
    await storeService.flush();
    let instanceA = storeService.peek(`${testRealmURL}Person/hassan`);
    let instanceB = storeService.peek((instanceA as CardDefType)[localId]);
    assert.true(isCardInstance(instanceB), 'peeked item is a card instance');
    assert.strictEqual(
      instanceA,
      instanceB,
      'the same instance is returned by both remote ID and local ID',
    );
  });

  test('can peek a card error when no stale instance exists', async function (assert) {
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
    storeService.addReference(`${testRealmURL}Person/hassan`);
    await storeService.flush();
    let error = storeService.peek(`${testRealmURL}Person/hassan`);
    assert.false(isCardInstance(error), 'error is not a card instance');
    assert.ok(
      (error as CardErrorJSONAPI).message.includes('intentional error thrown'),
      'error message is correct',
    );
  });

  test('peek returns a stale instance when the server state reflects an error', async function (assert) {
    storeService.addReference(`${testRealmURL}Person/hassan`);
    await storeService.flush();

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

    await waitUntil(() =>
      storeService.peekError(`${testRealmURL}Person/hassan`),
    );

    let staleInstance = storeService.peek(`${testRealmURL}Person/hassan`);
    assert.true(
      isCardInstance(staleInstance),
      'the peek-ed instance is not an error',
    );
  });

  test('peek for an uncached returns undefined', async function (assert) {
    let instance = storeService.peek(`${testRealmURL}Person/does-not-exist`);
    assert.strictEqual(instance, undefined, 'instance is undefined');
  });

  test('peekError returns the server state error when a stale instance exists', async function (assert) {
    storeService.addReference(`${testRealmURL}Person/hassan`);
    await storeService.flush();

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

    await waitUntil(() =>
      storeService.peekError(`${testRealmURL}Person/hassan`),
    );

    let error = storeService.peekError(`${testRealmURL}Person/hassan`);
    assert.false(isCardInstance(error), 'error is not a card instance');
    assert.ok(
      (error as CardErrorJSONAPI).message.includes('intentional error thrown'),
      'error message is correct',
    );
  });

  test('can add reference to a card url', async function (assert) {
    let instance = storeService.peek(`${testRealmURL}hassan`);
    assert.strictEqual(instance, undefined, 'instance is not in store yet');

    storeService.addReference(`${testRealmURL}Person/hassan`);

    await storeService.flush();
    instance = storeService.peek(`${testRealmURL}Person/hassan`);
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

    instance = storeService.peek(`${testRealmURL}Person/hassan`);
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
    await storeService.add(instance, { doNotPersist: true });
    storeService.addReference(instance[localId]);

    forceGC();

    let peekedInstance = storeService.peek(instance[localId]);
    assert.strictEqual(
      peekedInstance,
      instance,
      'instance is not garbage collected',
    );
  });

  test('can drop reference to a card url', async function (assert) {
    storeService.addReference(`${testRealmURL}Person/hassan`);
    await storeService.flush();
    let instance = storeService.peek(`${testRealmURL}Person/hassan`);
    assert.ok(instance, 'instance is in store');
    storeService.dropReference(`${testRealmURL}Person/hassan`);

    forceGC();

    assert.strictEqual(
      storeService.peek(`${testRealmURL}Person/hassan`),
      undefined,
      'instance has been garbage collected from the store',
    );
  });

  test('can drop reference to a local id', async function (assert) {
    let instance = new PersonDef({ name: 'Andrea' });
    await storeService.add(instance, { doNotPersist: true });
    storeService.addReference(instance[localId]);
    storeService.dropReference(instance[localId]);
    forceGC();

    let peekedInstance = storeService.peek(instance[localId]);
    assert.strictEqual(
      peekedInstance,
      undefined,
      'instance is garbage collected',
    );
  });

  test('garbage collects cards that only consume each other', async function (assert) {
    let alpha = new PersonDef({ name: 'Alpha' });
    let beta = new PersonDef({ name: 'Beta' });
    (alpha as any).bestFriend = beta;
    (beta as any).bestFriend = alpha;

    await storeService.add(alpha, { doNotPersist: true });
    await storeService.add(beta, { doNotPersist: true });

    assert.strictEqual(
      storeService.peek(alpha[localId]),
      alpha,
      'alpha is present before GC',
    );
    assert.strictEqual(
      storeService.peek(beta[localId]),
      beta,
      'beta is present before GC',
    );

    forceGC();

    assert.strictEqual(
      storeService.peek(alpha[localId]),
      undefined,
      'alpha is garbage collected',
    );
    assert.strictEqual(
      storeService.peek(beta[localId]),
      undefined,
      'beta is garbage collected',
    );
  });

  test<TestContextWithSave>('can manually save an instance', async function (assert) {
    assert.expect(2);
    storeService.addReference(`${testRealmURL}Person/hassan`);
    await storeService.flush();

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

    storeService.save(`${testRealmURL}Person/hassan`);
  });

  test('can create an instance', async function (assert) {
    let url = await storeService.create({
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
    assert.strictEqual(typeof url, 'string', 'received a url for new instance');
    let instance = storeService.peek(url as string);
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
    let error = await storeService.create({
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
    });
    assert.strictEqual(
      typeof error,
      'object',
      'received a error for new instance',
    );
    assert.ok(
      (error as any).message.includes(
        'intentional error thrown',
        'the error message is correct',
      ),
    );
  });

  // note this is a unique kind of error where the error occurs after instance has
  // been written to the realm's file system, such that an instance with this error
  // can recover from this error and the host can be notified using the lid to correlate
  test('can handle a rendering card error when creating an instance', async function (assert) {
    let instance = new BoomPersonDef({ name: 'Andrea' });
    let error = await storeService.add(instance, { realm: testRealmURL });
    storeService.addReference(instance[localId]);
    await storeService.flush();

    let stale = storeService.peek(instance[localId])!;
    if (isCardInstance(stale)) {
      assert.strictEqual(
        (stale as any).name,
        'Andrea',
        'the stale card state is correct',
      );
    } else {
      assert.ok(
        false,
        `expected an instance but got a card error: "${stale.message}"`,
      );
    }

    let peekedError = storeService.peekError(instance[localId])!;
    assert.strictEqual(
      peekedError,
      error,
      'the output of store.add is the peek-ed error',
    );
    if (!isCardInstance(error)) {
      assert.strictEqual(
        error.id,
        instance[localId],
        'the error doc id is the local id of the instance',
      );
      assert.ok(
        error.message.includes('intentionallyNotDefined is not defined'),
      );

      // we do this because the loader in our test realm is shared with the loader of the
      // host app--otherwise the broken module stays cached in the loader and is not picked
      // up during re-indexing
      loaderService.resetLoader();

      await testRealm.write(
        `boom-person.gts`,
        `
        import { contains, field, CardDef, Component, StringField } from 'https://cardstack.com/base/card-api';

        export class BoomPerson extends CardDef {
          static displayName = 'Boom Person';
          @field name = contains(StringField);
          static isolated = class Isolated extends Component<typeof this> {
            <template>
              Hello
              <@fields.firstName />!
            </template>
          };
        }
      `.trim(),
      );

      await waitUntil(() => !storeService.peekError(instance[localId]), {
        timeout: 5_000,
      });

      await waitUntil(
        () => {
          let card = storeService.peek(instance[localId]);
          return Boolean(card && isCardInstance(card));
        },
        { timeout: 5_000 },
      );

      let peek = storeService.peek(instance[localId])!;
      assert.strictEqual(
        (peek as any).name,
        'Andrea',
        'peek-ed value has been updated to be the fixed card instance',
      );
    } else {
      assert.ok(false, 'expected a card error but got a running instance');
    }
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
    await storeService.add(instance);
    assert.ok(instance.id, 'instance has been assigned remote id');
    let peekedInstance = storeService.peek(instance.id);
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
    let instance = (await storeService.add({
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
    })) as CardDefType;
    assert.ok(instance.id, 'instance has been assigned remote id');
    let peekedInstance = storeService.peek(instance.id);
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
    let instance = (await storeService.add(
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
    )) as CardDefType;
    assert.strictEqual(
      instance.id,
      undefined,
      'instance has NOT been assigned remote id',
    );
    let peekedInstance = storeService.peek(instance[localId]);
    assert.strictEqual(instance, peekedInstance, 'instance is the same');
    assert.strictEqual(
      (instance as any).name,
      'Andrea',
      'instance data is correct',
    );
  });

  test<TestContextWithSave>('can skip waiting for the save when adding to the store', async function (assert) {
    assert.expect(6);
    let didSave = false;
    this.onSave((_, doc) => {
      didSave = true;
      assert.strictEqual(
        (doc as SingleCardDocument).data.attributes?.name,
        'Andrea',
        'card data is correct',
      );
    });
    let instance = new PersonDef({ name: 'Andrea' });
    await storeService.add(instance, { doNotWaitForPersist: true });
    assert.false(didSave, 'the instance has not saved yet');

    await waitUntil(() => didSave, { timeout: 10000 });

    assert.ok(instance.id, 'instance has been assigned remote id');
    let peekedInstance = storeService.peek(instance.id);
    assert.strictEqual(instance, peekedInstance, 'instance is the same');

    let file = await testRealmAdapter.openFile(
      `${instance.id.substring(testRealmURL.length)}.json`,
    );
    assert.ok(file, 'file exists');
    let fileJSON = JSON.parse(file!.content as string);
    assert.strictEqual(fileJSON.data.attributes.name, 'Andrea', 'file exists');
  });

  test('can set realmURL when adding to the store', async function (assert) {
    let instance = new PersonDef({ name: 'Andrea' });
    assert.strictEqual(
      instance[realmURL]?.href,
      undefined,
      'realmURL meta is not set on the instance',
    );

    await storeService.add(instance, {
      doNotPersist: true,
      realm: testRealmURL,
    });

    assert.strictEqual(
      instance[realmURL]?.href,
      testRealmURL,
      'realmURL meta was set on the instance',
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

    await storeService.add(lin, { doNotPersist: true });

    let peekedMichael = storeService.peek(michael[localId]);
    assert.strictEqual(
      peekedMichael,
      michael,
      'michael instance added to store',
    );
    let peekedWu = storeService.peek(wu[localId]);
    assert.strictEqual(peekedWu, wu, 'wu instance added to store');
  });

  test('can reject a card added to the store that has a conflicting local ID for a given URL', async function (assert) {
    storeService.addReference(`${testRealmURL}Person/hassan`);
    await storeService.flush();
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
      await storeService.add(conflictingInstance, { doNotPersist: true });
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
    await storeService.add(instance);

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
    let instance = await storeService.get(`${testRealmURL}Person/hassan`);

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

  test<TestContextWithSave>('an unsaved instance will auto save when its data changes', async function (assert) {
    assert.expect(2);
    let instance = new PersonDef({ name: 'Andrea' });
    await storeService.add(instance, { doNotPersist: true });

    this.onSave((url, doc) => {
      assert.strictEqual(
        url.href.split('/').pop()!,
        instance[localId],
        'the new card url ends with the local id',
      );
      assert.strictEqual(
        (doc as SingleCardDocument).data.attributes?.name,
        'Air',
        'card data is correct',
      );
    });

    (instance as any).name = 'Air';
  });

  test<TestContextWithSave>('an instance will NOT auto save when its data changes, if the user does not have write permissions', async function (assert) {
    (storeService as any).realm.permissions = () => ({
      get canRead() {
        return true;
      },
      get canWrite() {
        return false;
      },
    });
    let instance = await storeService.get(`${testRealmURL}Person/hassan`);
    this.onSave(() => {
      assert.ok(false, 'should not save');
    });
    (instance as any).name = 'Paper';
    assert.strictEqual((instance as any).name, 'Paper');
    let id = instance.id;
    assert.deepEqual(storeService.getSaveState(id!), {
      hasUnsavedChanges: true,
      isSaving: false,
      lastSaveError: undefined,
      lastSaved: undefined,
      lastSavedErrorMsg: undefined,
    });
  });

  test<TestContextWithSave>('an instance can debounce auto saves', async function (assert) {
    assert.expect(5);

    setCardInOperatorModeState(`${testRealmURL}Person/hassan`, 'edit');
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    let saveCount = 0;
    this.onSave((url, doc) => {
      saveCount++;
      assert.strictEqual(
        url.href,
        `${testRealmURL}Person/hassan`,
        'correct document is saved',
      );
      switch (saveCount) {
        case 1:
          assert.strictEqual(
            (doc as SingleCardDocument).data?.attributes?.name,
            'Hassan ',
            'the initial instance mutation event is saved',
          );
          break;
        case 2:
          assert.strictEqual(
            (doc as SingleCardDocument).data?.attributes?.name,
            'Hassan Paper',
            'the final instance mutation event is saved',
          );
          break;
        default:
          assert.ok(false, `unexpected number of saves: ${saveCount}`);
      }
    });

    // slow down the save so we can get deterministic results
    await withSlowSave(1000, async () => {
      // typeIn will fire an event for each character, which in turn results in multiple instance updated events
      await typeIn(
        `[data-test-stack-card="${testRealmURL}Person/hassan"] [data-test-field="name"] input`,
        ' Paper',
      );

      // the leading edge and trailing edge of the key events are saved and the intermediate events are dropped
      assert.strictEqual(saveCount, 2, 'the number of auto-saves is correct');
    });
  });

  test<TestContextWithSave>('getSaveState works for initially unsaved instance', async function (assert) {
    let instance = new PersonDef({ name: 'Andrea' });
    await storeService.add(instance, { doNotPersist: true });

    assert.strictEqual(
      storeService.getSaveState(instance[localId]),
      undefined,
      'save state is undefined',
    );

    (instance as any).name = 'Air';

    assert.true(
      storeService.getSaveState(instance[localId])?.isSaving,
      'isSaving state is correct',
    );

    await waitUntil(
      () => storeService.getSaveState(instance[localId])?.lastSaved,
      { timeout: 10000 },
    );

    assert.false(
      storeService.getSaveState(instance[localId])?.isSaving,
      'isSaving state is correct',
    );
    assert.false(
      storeService.getSaveState(instance.id)?.isSaving,
      'isSaving state is correct (by remote id)',
    );
    assert.ok(
      storeService.getSaveState(instance.id)?.lastSaved,
      'lastSaved state is correct (by remote id)',
    );
  });

  test('can capture error when auto saving', async function (assert) {
    let instance = await storeService.get(`${testRealmURL}Person/hassan`);
    try {
      (globalThis as any).__emulateServerPatchFailure = true;
      (instance as any).hasError = true; // instance mutation triggers auto save
      await waitUntil(
        () =>
          storeService.getSaveState(`${testRealmURL}Person/hassan`)
            ?.lastSaveError,
        { timeout: 10000 },
      );
      let saveState = storeService.getSaveState(`${testRealmURL}Person/hassan`);
      assert.ok(
        saveState!.lastSavedErrorMsg?.includes('intentional error thrown'),
        'error message is correct',
      );
    } finally {
      delete (globalThis as any).__emulateServerPatchFailure;
    }
  });

  test('can delete card from the store', async function (assert) {
    storeService.addReference(`${testRealmURL}Person/boris`);
    await storeService.flush();
    let instance = storeService.peek(
      `${testRealmURL}Person/boris`,
    ) as CardDefType;

    await storeService.delete(`${testRealmURL}Person/boris`);
    assert.strictEqual(
      storeService.peek(instance.id),
      undefined,
      'the instance is no longer in the store',
    );
    assert.strictEqual(
      storeService.peek(instance[localId]),
      undefined,
      'the instance is no longer in the store (via local id)',
    );

    let file = await testRealmAdapter.openFile(`Person/boris.json`);
    assert.strictEqual(file, undefined, 'file no longer exists');
  });

  test('can patch an instance', async function (assert) {
    let instance = await storeService.patch(`${testRealmURL}Person/hassan`, {
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

    let peekedInstance = storeService.peek(`${testRealmURL}Person/hassan`);
    let jade = storeService.peek(`${testRealmURL}Person/jade`);
    let germaine = storeService.peek(`${testRealmURL}Person/germaine`);
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

  test<TestContextWithSave>('can skip waiting for the save when patching an instance', async function (assert) {
    assert.expect(4);

    let targetId = `${testRealmURL}Person/hassan`;
    let instance = await storeService.get(targetId);

    let didSave = false;
    this.onSave((url, doc) => {
      if (url.href === targetId) {
        didSave = true;
        assert.strictEqual(
          (doc as SingleCardDocument).data.attributes?.name,
          'Hassan Updated',
          'patched data is persisted',
        );
      }
    });

    await storeService.patch(
      targetId,
      {
        attributes: {
          name: 'Hassan Updated',
        },
      },
      { doNotWaitForPersist: true },
    );

    assert.strictEqual(
      (instance as any).name,
      'Hassan Updated',
      'local instance updated immediately',
    );
    assert.false(didSave, 'instance has not been persisted yet');

    await waitUntil(() => didSave);

    let file = await testRealmAdapter.openFile('Person/hassan.json');
    assert.strictEqual(
      JSON.parse(file!.content as string).data.attributes.name,
      'Hassan Updated',
      'remote document reflects patch after persistence completes',
    );
  });

  test('can patch an unsaved instance', async function (assert) {
    let instance = new PersonDef({ name: 'Andrea' });
    await storeService.add(instance, {
      doNotPersist: true,
      realm: testRealmURL,
    });

    await storeService.patch(instance[localId], {
      attributes: {
        name: 'Andrea Updated',
      },
      relationships: {
        bestFriend: {
          links: { self: `${testRealmURL}Person/queenzy` },
        },
        'friends.0': {
          links: { self: `${testRealmURL}Person/germaine` },
        },
      },
    });

    let peekedInstance = storeService.peek(instance[localId]);
    let queenzy = storeService.peek(`${testRealmURL}Person/queenzy`);
    let germaine = storeService.peek(`${testRealmURL}Person/germaine`);
    assert.strictEqual(
      peekedInstance,
      instance,
      'the patched instance is in the store',
    );
    assert.ok(isCardInstance(queenzy), 'queenzy is in the store');
    assert.ok(isCardInstance(germaine), 'germaine is in the store');
    assert.strictEqual(
      instance[realmURL]?.href,
      testRealmURL,
      'the realm config on the instance is preserved',
    );

    assert.strictEqual(
      (instance as any).name,
      'Andrea Updated',
      'the contains field was patched',
    );
    assert.strictEqual(
      (instance as any).bestFriend,
      queenzy,
      'the linksTo field was patched',
    );
    assert.deepEqual(
      (instance as any).friends,
      [germaine],
      'the linksToMany field was patched',
    );

    await waitUntil(() => instance.id, {
      timeoutMessage: 'waiting for instance to get assigned an id',
    });
    assert.ok(instance.id, 'instance was assigned a remote id');
  });

  test<TestContextWithSave>('can skip save when patching an instance', async function (assert) {
    this.onSave(() => {
      assert.ok(false, 'should not save');
    });

    let instance = await storeService.patch(
      `${testRealmURL}Person/hassan`,
      {
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
      },
      { doNotPersist: true },
    );

    let peekedInstance = storeService.peek(`${testRealmURL}Person/hassan`);
    let jade = storeService.peek(`${testRealmURL}Person/jade`);
    let germaine = storeService.peek(`${testRealmURL}Person/germaine`);
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
    let results = await storeService.search(
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
      [testRealmURL],
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

  test<TestContextWithSave>('an instance live updates from indexing events for an instance update', async function (assert) {
    assert.expect(2);
    let didSave = false;
    this.onSave(() => {
      didSave = true;
    });
    setCardInOperatorModeState(`${testRealmURL}Person/hassan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
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
        (storeService.peek(`${testRealmURL}Person/hassan`) as any)?.name ===
        'Hassan updated',
    );
    await storeService.flushSaves();
    assert
      .dom('[data-test-stack-card] [data-test-field="name"]')
      .containsText('Hassan updated', 'card live updated');
    assert.false(didSave, 'indexing updates do not auto save instances');
  });

  test('an instance live updates from indexing events for a code update', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/hassan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    let instance = (await storeService.get(
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
    let newInstance = storeService.peek(
      `${testRealmURL}Person/hassan`,
    ) as CardDefType;
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
      .dom('[data-test-error-message]')
      .containsText('intentional error thrown');
    await click('[data-test-toggle-details]');
    assert
      .dom('[data-test-error-details]')
      .includesText('Stack trace: Error: Encountered error rendering HTML');

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

  test('an instance can be restored after a loader reset', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/hassan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    assert
      .dom(
        `[data-stack-card="${testRealmURL}Person/hassan"] [data-test-field="name"]`,
      )
      .containsText('Hassan', 'the card data is correct');

    // write something that will trigger a loader reset that doesn't invalidate the instance being rendered
    await testRealm.write(
      `foo.gts`,
      `
        import { contains, CardDef } from 'https://cardstack.com/base/card-api';
        export class Foo extends CardDef {}
      `.trim(),
    );

    await waitFor('[data-test-stack-item-loading-card]', {
      count: 0,
      timeout: 5_000,
    });

    assert
      .dom('[data-test-stack-item-loading-card]')
      .doesNotExist('loading state is not displayed');
    assert
      .dom(
        `[data-stack-card="${testRealmURL}Person/hassan"] [data-test-field="name"]`,
      )
      .containsText('Hassan', 'the card data is correct');
  });

  test('an instance that started out with a local ID can be restored after a loader reset', async function (assert) {
    let newInstance = new PersonDef({ name: 'Andrea' });
    await storeService.add(newInstance, { realm: testRealmURL });
    setCardInOperatorModeState(newInstance[localId]);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    assert
      .dom(`[data-stack-card="${newInstance.id}"] [data-test-field="name"]`)
      .containsText('Andrea', 'the card data is correct');

    // write something that will trigger a loader reset that doesn't invalidate the instance being rendered
    await testRealm.write(
      `foo.gts`,
      `
        import { contains, CardDef } from 'https://cardstack.com/base/card-api';
        export class Foo extends CardDef {}
      `.trim(),
    );

    await waitFor('[data-test-stack-item-loading-card]', {
      count: 0,
      timeout: 5_000,
    });

    assert
      .dom('[data-test-stack-item-loading-card]')
      .doesNotExist('loading state is not displayed');
    assert
      .dom(`[data-stack-card="${newInstance.id}"] [data-test-field="name"]`)
      .containsText('Andrea', 'the card data is correct');
  });

  test('an unsaved instance live updates when realm event matching local ID is received', async function (assert) {
    let newInstance = new PersonDef({ name: 'Andrea' });
    await storeService.add(newInstance, { doNotPersist: true });

    storeService.addReference(`${testRealmURL}Person/hassan`);
    await storeService.flush();
    let instance = storeService.peek(
      `${testRealmURL}Person/hassan`,
    ) as CardDefType;

    (instance as any).friends = [newInstance];

    await waitUntil(() => newInstance.id, {
      timeout: 5_000,
    });

    assert.strictEqual(
      newInstance.id.split('/').pop()!,
      newInstance[localId],
      'the new instance was live updated with a remote id',
    );
  });

  test<TestContextWithSave>('an unsaved instance will auto save after it has been assigned a remote ID', async function (assert) {
    assert.expect(2);
    let newInstance = new PersonDef({ name: 'Andrea' });
    await storeService.add(newInstance, { doNotPersist: true });

    storeService.addReference(`${testRealmURL}Person/hassan`);
    await storeService.flush();
    let instance = storeService.peek(
      `${testRealmURL}Person/hassan`,
    ) as CardDefType;

    (instance as any).friends = [newInstance];

    await waitUntil(() => newInstance.id, {
      timeout: 5_000,
    });

    this.onSave((url, doc) => {
      assert.strictEqual(url.href, newInstance.id, 'the save url is correct');
      assert.strictEqual(
        (doc as SingleCardDocument).data.attributes?.name,
        'Air',
        'card data is correct',
      );
    });
    (newInstance as any).name = 'Air';
  });

  test('reference count is balanced when used with CardResource that is destroyed', async function (assert) {
    class Driver {
      @tracked showComponent = false;
      @tracked id: string | undefined;
    }

    let driver = new Driver();

    class ResourceConsumer extends GlimmerComponent {
      resource = getCard(this, () => driver.id);
      get renderedCard() {
        return this.resource.card?.constructor.getComponent(this.resource.card);
      }
      <template>
        {{#if this.resource.card}}
          <this.renderedCard data-test-rendered-card={{this.resource.id}} />
        {{/if}}
      </template>
    }

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          {{#if driver.showComponent}}
            <ResourceConsumer />
          {{/if}}
        </template>
      },
    );

    driver.showComponent = true;
    let jade = `${testRealmURL}Person/jade`;
    let hassan = `${testRealmURL}Person/hassan`;

    driver.id = hassan;
    await waitFor(`[data-test-rendered-card="${hassan}"]`);
    assert.strictEqual(
      storeService.getReferenceCount(jade),
      0,
      `reference count for ${jade} is 0`,
    );
    assert.strictEqual(
      storeService.getReferenceCount(hassan),
      1,
      `reference count for ${hassan} is 1`,
    );

    driver.id = jade;
    await waitFor(`[data-test-rendered-card="${jade}"]`);
    assert.strictEqual(
      storeService.getReferenceCount(jade),
      1,
      `reference count for ${jade} is 1`,
    );
    assert.strictEqual(
      storeService.getReferenceCount(hassan),
      0,
      `reference count for ${hassan} is 0`,
    );

    driver.showComponent = false;
    await waitFor(`[data-test-rendered-card]`, { count: 0 });
    assert.strictEqual(
      storeService.getReferenceCount(jade),
      0,
      `reference count for ${jade} is 0`,
    );
    assert.strictEqual(
      storeService.getReferenceCount(hassan),
      0,
      `reference count for ${hassan} is 0`,
    );
  });

  test<TestContextWithSave>('reference count is balanced during auto saving', async function (assert) {
    let hassan = `${testRealmURL}Person/hassan`;

    setCardInOperatorModeState(hassan, 'edit');
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );

    assert.strictEqual(
      storeService.getReferenceCount(hassan),
      1,
      `reference count for ${hassan} is 1`,
    );
    // slow down the save so we can get deterministic results
    await withSlowSave(1000, async () => {
      // typeIn will fire an event for each character, which in turn results in multiple instance updated events
      await typeIn(
        `[data-test-stack-card="${testRealmURL}Person/hassan"] [data-test-field="name"] input`,
        ' Paper',
      );
      assert.strictEqual(
        storeService.getReferenceCount(hassan),
        1,
        `reference count for ${hassan} is 1`,
      );
    });
    assert.strictEqual(
      storeService.getReferenceCount(hassan),
      1,
      `reference count for ${hassan} is 1`,
    );
  });

  test('reference count is balanced when used with CardCollectionResource that is destroyed', async function (assert) {
    class Driver {
      @tracked showComponent = false;
      @tracked id: string | undefined;
    }

    let driver = new Driver();

    class ResourceConsumer extends GlimmerComponent {
      resource = getCardCollection(this, () => (driver.id ? [driver.id] : []));
      get card() {
        return this.resource.cards[0];
      }
      get renderedCard() {
        return this.card?.constructor.getComponent(this.card);
      }
      <template>
        {{#if this.card}}
          <this.renderedCard data-test-rendered-card={{this.card.id}} />
        {{/if}}
      </template>
    }

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          {{#if driver.showComponent}}
            <ResourceConsumer />
          {{/if}}
        </template>
      },
    );

    driver.showComponent = true;
    let jade = `${testRealmURL}Person/jade`;
    let hassan = `${testRealmURL}Person/hassan`;

    driver.id = hassan;
    await waitFor(`[data-test-rendered-card="${hassan}"]`);
    assert.strictEqual(
      storeService.getReferenceCount(jade),
      0,
      `reference count for ${jade} is 0`,
    );
    assert.strictEqual(
      storeService.getReferenceCount(hassan),
      1,
      `reference count for ${hassan} is 1`,
    );

    driver.id = jade;
    await waitFor(`[data-test-rendered-card="${jade}"]`);
    assert.strictEqual(
      storeService.getReferenceCount(jade),
      1,
      `reference count for ${jade} is 1`,
    );
    assert.strictEqual(
      storeService.getReferenceCount(hassan),
      0,
      `reference count for ${hassan} is 0`,
    );

    driver.showComponent = false;
    await waitFor(`[data-test-rendered-card]`, { count: 0 });
    assert.strictEqual(
      storeService.getReferenceCount(jade),
      0,
      `reference count for ${jade} is 0`,
    );
    assert.strictEqual(
      storeService.getReferenceCount(hassan),
      0,
      `reference count for ${hassan} is 0`,
    );
  });

  test('reference count is balanced when used with SearchResource that is destroyed', async function (assert) {
    class Driver {
      @tracked showComponent = false;
      @tracked id: string | undefined;
    }

    let driver = new Driver();

    class ResourceConsumer extends GlimmerComponent {
      @service declare store: StoreService;
      @cached
      get resource() {
        return this.store.getSearchResource(this, () =>
          driver.id
            ? {
                filter: {
                  on: baseCardRef,
                  eq: {
                    id: driver.id,
                  },
                },
              }
            : undefined,
        );
      }
      get card() {
        return this.resource.instances[0];
      }
      get renderedCard() {
        return this.card?.constructor.getComponent(this.card);
      }
      <template>
        {{#if this.card}}
          <this.renderedCard data-test-rendered-card={{this.card.id}} />
        {{/if}}
      </template>
    }

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          {{#if driver.showComponent}}
            <ResourceConsumer />
          {{/if}}
        </template>
      },
    );

    driver.showComponent = true;
    let jade = `${testRealmURL}Person/jade`;
    let hassan = `${testRealmURL}Person/hassan`;

    driver.id = hassan;
    await waitFor(`[data-test-rendered-card="${hassan}"]`, { timeout: 5_000 });
    assert.strictEqual(
      storeService.getReferenceCount(jade),
      0,
      `reference count for ${jade} is 0`,
    );
    assert.strictEqual(
      storeService.getReferenceCount(hassan),
      1,
      `reference count for ${hassan} is 1`,
    );

    driver.id = jade;
    await waitFor(`[data-test-rendered-card="${jade}"]`, { timeout: 5_000 });
    assert.strictEqual(
      storeService.getReferenceCount(jade),
      1,
      `reference count for ${jade} is 1`,
    );
    assert.strictEqual(
      storeService.getReferenceCount(hassan),
      0,
      `reference count for ${hassan} is 0`,
    );

    driver.showComponent = false;
    await waitFor(`[data-test-rendered-card]`, { count: 0 });
    assert.strictEqual(
      storeService.getReferenceCount(jade),
      0,
      `reference count for ${jade} is 0`,
    );
    assert.strictEqual(
      storeService.getReferenceCount(hassan),
      0,
      `reference count for ${hassan} is 0`,
    );
  });

  test('reference count is balanced when used with SearchResource that live updates when there is a index event', async function (assert) {
    class Driver {
      @tracked id: string | undefined;
    }

    let driver = new Driver();

    class ResourceConsumer extends GlimmerComponent {
      @service declare store: StoreService;
      @cached
      get resource() {
        return this.store.getSearchResource(
          this,
          () =>
            driver.id
              ? {
                  filter: {
                    on: baseCardRef,
                    eq: {
                      id: driver.id,
                    },
                  },
                }
              : undefined,
          undefined,
          { isLive: true },
        );
      }
      get card() {
        return this.resource.instances[0];
      }
      get renderedCard() {
        return this.card?.constructor.getComponent(this.card);
      }
      <template>
        {{#if this.card}}
          <this.renderedCard data-test-rendered-card={{this.card.id}} />
        {{/if}}
      </template>
    }

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <ResourceConsumer />
        </template>
      },
    );

    let jade = `${testRealmURL}Person/jade`;

    driver.id = jade;
    await waitFor(`[data-test-rendered-card="${jade}"]`, { timeout: 5_000 });
    assert.strictEqual(
      storeService.getReferenceCount(jade),
      1,
      `reference count for ${jade} is 1`,
    );

    let deferred = new Deferred<void>();
    getService('message-service')
      .listenerCallbacks.get(testRealmURL)!
      .push((ev: RealmEventContent) => {
        if (ev.eventName === 'index' && ev.indexType === 'incremental') {
          deferred.fulfill();
        }
      });

    await testRealm.write(
      'Person/hassan.json',
      JSON.stringify({
        data: {
          attributes: {
            name: 'Paper',
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

    await deferred.promise;
    deferred = new Deferred();

    // for CS-8632, 2 events triggered the reference count leak
    await testRealm.write(
      'Person/hassan.json',
      JSON.stringify({
        data: {
          attributes: {
            name: 'Paper',
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

    assert.strictEqual(
      storeService.getReferenceCount(jade),
      1,
      `reference count for ${jade} is 1`,
    );
  });

  test('reference count is balanced when used with CardCollectionResource when there is a index event', async function (assert) {
    class Driver {
      @tracked id: string | undefined;
    }

    let driver = new Driver();

    class ResourceConsumer extends GlimmerComponent {
      resource = getCardCollection(this, () => (driver.id ? [driver.id] : []));
      get card() {
        return this.resource.cards[0];
      }
      get renderedCard() {
        return this.card?.constructor.getComponent(this.card);
      }
      <template>
        {{#if this.card}}
          <this.renderedCard data-test-rendered-card={{this.card.id}} />
        {{/if}}
      </template>
    }

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <ResourceConsumer />
        </template>
      },
    );

    let jade = `${testRealmURL}Person/jade`;

    driver.id = jade;
    await waitFor(`[data-test-rendered-card="${jade}"]`, { timeout: 5_000 });
    assert.strictEqual(
      storeService.getReferenceCount(jade),
      1,
      `reference count for ${jade} is 1`,
    );

    let deferred = new Deferred<void>();
    getService('message-service')
      .listenerCallbacks.get(testRealmURL)!
      .push((ev: RealmEventContent) => {
        if (ev.eventName === 'index' && ev.indexType === 'incremental') {
          deferred.fulfill();
        }
      });

    await testRealm.write(
      'Person/hassan.json',
      JSON.stringify({
        data: {
          attributes: {
            name: 'Paper',
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

    await deferred.promise;
    deferred = new Deferred();

    // for CS-8632, 2 events triggered the reference count leak
    await testRealm.write(
      'Person/hassan.json',
      JSON.stringify({
        data: {
          attributes: {
            name: 'Paper',
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

    assert.strictEqual(
      storeService.getReferenceCount(jade),
      1,
      `reference count for ${jade} is 1`,
    );
  });

  test('reference count is balanced when used with CardResource when there is a index event', async function (assert) {
    class Driver {
      @tracked id: string | undefined;
    }

    let driver = new Driver();

    class ResourceConsumer extends GlimmerComponent {
      resource = getCard(this, () => driver.id);
      get renderedCard() {
        return this.resource.card?.constructor.getComponent(this.resource.card);
      }
      <template>
        {{#if this.resource.card}}
          <this.renderedCard data-test-rendered-card={{this.resource.id}} />
        {{/if}}
      </template>
    }

    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <ResourceConsumer />
        </template>
      },
    );

    let jade = `${testRealmURL}Person/jade`;

    driver.id = jade;
    await waitFor(`[data-test-rendered-card="${jade}"]`, { timeout: 5_000 });
    assert.strictEqual(
      storeService.getReferenceCount(jade),
      1,
      `reference count for ${jade} is 1`,
    );

    let deferred = new Deferred<void>();
    getService('message-service')
      .listenerCallbacks.get(testRealmURL)!
      .push((ev: RealmEventContent) => {
        if (ev.eventName === 'index' && ev.indexType === 'incremental') {
          deferred.fulfill();
        }
      });

    await testRealm.write(
      'Person/hassan.json',
      JSON.stringify({
        data: {
          attributes: {
            name: 'Paper',
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

    await deferred.promise;
    deferred = new Deferred();

    // for CS-8632, 2 events triggered the reference count leak
    await testRealm.write(
      'Person/hassan.json',
      JSON.stringify({
        data: {
          attributes: {
            name: 'Paper',
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

    assert.strictEqual(
      storeService.getReferenceCount(jade),
      1,
      `reference count for ${jade} is 1`,
    );
  });
});
