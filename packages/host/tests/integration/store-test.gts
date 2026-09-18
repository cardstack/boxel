import { service } from '@ember/service';
import {
  type RenderingTestContext,
  waitUntil,
  waitFor,
  click,
  typeIn,
  settled,
} from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  isCardInstance,
  localId,
  meta,
  baseCardRef,
  realmURL,
  ri,
  Deferred,
  type LatticeDisplayBatchRequest,
  SupportedMimeType,
  LATTICE_DISPLAY_HAVE_HEADER,
  type Loader,
  type Realm,
  type SingleCardDocument,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';

import OperatorMode from '@cardstack/host/components/operator-mode/container';
import type CardStore from '@cardstack/host/lib/gc-card-store';
import { LATTICE_NOTICE_IDENTITY_LIMIT } from '@cardstack/host/lib/lattice-publication-notices';
import { getCardCollection } from '@cardstack/host/resources/card-collection';
import { getCard } from '@cardstack/host/resources/card-resource';
import type LoaderService from '@cardstack/host/services/loader-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';
import type StoreService from '@cardstack/host/services/store';
import type { CardErrorJSONAPI } from '@cardstack/host/services/store';

import {
  withCachedRealmSetup,
  setupRealmCacheTeardown,
  testRealmURL,
  testRRI,
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
  FileDef,
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
import {
  registerDefaultRoutes,
  registerRealmServerRoute,
} from '../helpers/realm-server-mock/routes';
import { renderComponent } from '../helpers/render-component';
import { setupRenderingTest } from '../helpers/setup';

import type { TestRealmAdapter } from '../helpers/adapter';
import type * as CardAPI from '@cardstack/base/card-api';
import type { CardDef as CardDefType } from '@cardstack/base/card-api';
import type { RealmEventContent } from '@cardstack/base/matrix-event';

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
  let EmployeeDef: typeof CardDefType;
  let ManagerDef: typeof CardDefType;
  let realmService: RealmService;

  setupLocalIndexing(hooks);
  setupRealmCacheTeardown(hooks);
  setupOnSave(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import('@cardstack/base/card-api'),
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

    class Employee extends CardDef {
      static displayName = 'Employee';
      @field name = contains(StringField);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-employee-badge>Employee: <@fields.name /></div>
        </template>
      };
    }
    EmployeeDef = Employee;

    class Manager extends Employee {
      static displayName = 'Manager';
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-manager-badge>Manager: <@fields.name /></div>
        </template>
      };
    }
    ManagerDef = Manager;
    loaderService = getService('loader-service');
    loader = loaderService.loader;
    api = await loader.import('@cardstack/base/card-api');
    storeService = getService('store');
    operatorModeStateService = getService('operator-mode-state-service');
    cardStore = (storeService as any).store as CardStore;
    realmService = getService('realm');

    // Every test builds these fixtures identically, so the indexed result is
    // cached for the module and restored rather than rebuilt. Tests here do
    // write; that stays with the test that wrote it, since each test restores
    // the snapshot rather than continuing from the previous one.
    await withCachedRealmSetup(async () => {
      ({ adapter: testRealmAdapter, realm: testRealm } =
        await setupIntegrationTestRealm({
          mockMatrixUtils,
          contents: {
            'person.gts': { Person },
            'boom-person.gts': { BoomPerson },
            'employee.gts': { Employee },
            'manager.gts': { Manager },
            'Person/hassan.json': new Person({ name: 'Hassan' }),
            'Person/jade.json': new Person({ name: 'Jade' }),
            'Person/queenzy.json': new Person({ name: 'Queenzy' }),
            'Person/germaine.json': new Person({ name: 'Germaine' }),
            'Person/boris.json': new Person({ name: 'Boris' }),
          },
        }));
    });
    await realmService.login(testRealmURL);
  });

  hooks.afterEach(function () {
    getService('network').virtualNetwork.removeRealmMapping('@test-prefix/');
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
              module: testRRI('person'),
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
              module: testRRI('person'),
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

  test<TestContextWithSave>('can use registered prefix ids across store APIs', async function (assert) {
    getService('network').virtualNetwork.addRealmMapping(
      '@test-prefix/',
      testRealmURL,
    );

    storeService.addReference('@test-prefix/Person/hassan');
    await storeService.flush();

    let byPrefix = storeService.peek('@test-prefix/Person/hassan');
    let byUrl = storeService.peek(`${testRealmURL}Person/hassan`);

    assert.true(isCardInstance(byPrefix), 'prefix id resolves to a card');
    assert.strictEqual(
      byPrefix,
      byUrl,
      'prefix id and resolved URL return the same instance',
    );
    assert.strictEqual(
      storeService.getReferenceCount('@test-prefix/Person/hassan'),
      1,
      'prefix id and resolved URL share a single reference count',
    );
    assert.strictEqual(
      storeService.getReferenceCount(`${testRealmURL}Person/hassan`),
      1,
      'resolved URL sees the same reference count',
    );

    storeService.dropReference('@test-prefix/Person/hassan');

    assert.strictEqual(
      storeService.getReferenceCount(`${testRealmURL}Person/hassan`),
      0,
      'dropping a prefix reference clears the resolved URL reference count',
    );

    let saveFinished = new Deferred<void>();
    this.onSave((url) => {
      if (url.href === `${testRealmURL}Person/hassan`) {
        assert.strictEqual(url.href, `${testRealmURL}Person/hassan`);
        assert.strictEqual(
          storeService.getReferenceCount(`${testRealmURL}Person/hassan`),
          0,
          'save() does not create a separate resolved-url reference count',
        );
        assert.strictEqual(
          storeService.getReferenceCount('@test-prefix/Person/hassan'),
          0,
          'save() does not create a separate prefix reference count',
        );
        saveFinished.fulfill();
      }
    });

    storeService.save('@test-prefix/Person/hassan');
    await saveFinished;

    storeService.addReference('@test-prefix/Person/boris');
    await storeService.flush();

    await storeService.delete('@test-prefix/Person/boris');

    assert.strictEqual(
      storeService.peek('@test-prefix/Person/boris'),
      undefined,
      'delete() clears the prefix-form card identity from the store',
    );
    assert.strictEqual(
      storeService.peek(`${testRealmURL}Person/boris`),
      undefined,
      'delete() clears the resolved card identity from the store',
    );

    let file = await testRealmAdapter.openFile(`Person/boris.json`);
    assert.strictEqual(file, undefined, 'delete() removes the remote card');
  });

  test('deleting a linked target rewrites a loaded consumer linksTo slot to a broken-link sentinel', async function (assert) {
    // Load the consumer and the target, then link them so the consumer holds
    // the target as a resolved (present) link — the state a user is looking at
    // when they delete the linked card. The delete must flip that slot to a
    // broken-link sentinel in place, so the placeholder render takes over
    // without a reload. (delete() evicts the target from the store before its
    // own invalidation event arrives, so the realm-event reload path never
    // sees it; the rewrite has to happen here.)
    storeService.addReference(`${testRealmURL}Person/hassan`);
    storeService.addReference(`${testRealmURL}Person/boris`);
    await storeService.flush();
    let hassan = storeService.peek(
      `${testRealmURL}Person/hassan`,
    ) as CardDefType;
    let boris = storeService.peek(`${testRealmURL}Person/boris`) as CardDefType;
    (hassan as any).bestFriend = boris;
    await settled();

    assert.strictEqual(
      api.getRelationshipMembershipState(hassan, 'bestFriend').membership![0]
        .kind,
      'present',
      'the consumer link resolves to the target before the delete',
    );

    await storeService.delete(`${testRealmURL}Person/boris`);

    let after = api.getRelationshipMembershipState(hassan, 'bestFriend')
      .membership![0];
    assert.strictEqual(
      after.kind,
      'not-found',
      'deleting the target rewrites the consumer slot to a broken-link sentinel without a reload',
    );
    assert.strictEqual(
      after.reference,
      `${testRealmURL}Person/boris`,
      'the sentinel preserves the deleted target reference for the placeholder',
    );
  });

  test('deleting a linked target rewrites only the matching element of a loaded consumer linksToMany slot', async function (assert) {
    storeService.addReference(`${testRealmURL}Person/hassan`);
    storeService.addReference(`${testRealmURL}Person/boris`);
    storeService.addReference(`${testRealmURL}Person/jade`);
    await storeService.flush();
    let hassan = storeService.peek(
      `${testRealmURL}Person/hassan`,
    ) as CardDefType;
    let boris = storeService.peek(`${testRealmURL}Person/boris`) as CardDefType;
    let jade = storeService.peek(`${testRealmURL}Person/jade`) as CardDefType;
    (hassan as any).friends = [jade, boris];
    await settled();

    let before = api.getRelationshipMembershipState(
      hassan,
      'friends',
    ).membership!;
    assert.deepEqual(
      before.map((s) => s.kind),
      ['present', 'present'],
      'both linksToMany elements resolve before the delete',
    );

    await storeService.delete(`${testRealmURL}Person/boris`);

    let after = api.getRelationshipMembershipState(
      hassan,
      'friends',
    ).membership!;
    let borisEntry = after.find(
      (s) => s.reference === `${testRealmURL}Person/boris`,
    );
    let jadeEntry = after.find(
      (s) => s.reference === `${testRealmURL}Person/jade`,
    );
    assert.strictEqual(
      borisEntry?.kind,
      'not-found',
      'the deleted element becomes a broken-link sentinel',
    );
    assert.strictEqual(
      jadeEntry?.kind,
      'present',
      'the surviving element is left untouched',
    );
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
              module: testRRI('person'),
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

  test('a render-context load does not set up the autosave change subscription', async function (assert) {
    // The card-api module's exports are read-only, so we count `subscribeToChanges`
    // by interposing on `cardService.getAPI()` — which the store re-reads each time
    // it sets up autosave — and handing back a proxy that tallies the call.
    let cardService = getService('card-service');
    let originalGetAPI = cardService.getAPI.bind(cardService);
    let realApi = await originalGetAPI();
    let trueSubscribe = realApi.subscribeToChanges;
    let subscribeCount = 0;
    (cardService as any).getAPI = async () =>
      new Proxy(realApi, {
        get(target, prop, receiver) {
          if (prop === 'subscribeToChanges') {
            return (...args: unknown[]) => {
              subscribeCount++;
              return (trueSubscribe as any)(...args);
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      });

    try {
      // The live store wires up the change subscription that drives autosave.
      await storeService.add(new PersonDef({ name: 'Mango' }), {
        doNotPersist: true,
      });
      assert.true(
        subscribeCount > 0,
        'the live store subscribes a loaded instance for autosave',
      );

      // A render store blocks persistence, so autosave can never fire — it must
      // not pay for the per-instance subscribe/unsubscribe churn that drives it.
      subscribeCount = 0;
      (globalThis as any).__boxelRenderContext = true;
      let renderStore = getService('render-store');
      await renderStore.add(new PersonDef({ name: 'Van Gogh' }), {
        doNotPersist: true,
      });
      assert.strictEqual(
        subscribeCount,
        0,
        'the render store does not subscribe a loaded instance for autosave',
      );
    } finally {
      (cardService as any).getAPI = originalGetAPI;
      delete (globalThis as any).__boxelRenderContext;
    }
  });

  test('a card render absorbs a blocked write, a headless command reports it', async function (assert) {
    // `__boxelPrerenderApp` blocks every store's writes in the prerender app.
    // A card render absorbs the block: the prerenderer is not an avenue for
    // mutations, so a card that writes from a template or computed still
    // renders, with the write dropped.
    (globalThis as any).__boxelPrerenderApp = true;
    try {
      let rendered = new PersonDef({ name: 'Andrea' });
      assert.strictEqual(
        await storeService.add(rendered),
        rendered,
        'a render keeps the instance rather than failing',
      );

      // A command is the one caller whose write must land, so the block being
      // up here means the command route did not drop it — and an instance
      // with no id reads as a saved card to every caller.
      (globalThis as any).__boxelHeadlessCommand = true;
      await assert.rejects(
        storeService.add(new PersonDef({ name: 'Van Gogh' })),
        /persistence block still raised/,
        'a command reports the blocked write',
      );

      let ephemeral = new PersonDef({ name: 'Mango' });
      assert.strictEqual(
        await storeService.add(ephemeral, { doNotPersist: true }),
        ephemeral,
        'a memory-only add is served as asked',
      );
    } finally {
      delete (globalThis as any).__boxelHeadlessCommand;
      delete (globalThis as any).__boxelPrerenderApp;
    }
  });

  test('restoring sessions from storage skips the re-walk when the session blob is unchanged', function (assert) {
    // `restoreSessionsFromStorage` is synchronous, so the walk-count delta
    // measured immediately around each call is exactly that call's work — other
    // realm activity can only run at async boundaries, never mid-call. The realms
    // already in storage (from login) are resolved with their own tokens, so the
    // walk has no token-setter side effects.
    let walks = 0;
    let originalGetOrCreate = (
      realmService as any
    ).getOrCreateRealmResource.bind(realmService);
    (realmService as any).getOrCreateRealmResource = (...args: unknown[]) => {
      walks++;
      return originalGetOrCreate(...args);
    };

    try {
      (realmService as any).lastRestoredSessionsString = undefined;

      let before = walks;
      realmService.restoreSessionsFromStorage();
      assert.true(
        walks - before > 0,
        'the first restore walks the stored sessions',
      );

      before = walks;
      realmService.restoreSessionsFromStorage();
      assert.strictEqual(
        walks - before,
        0,
        'a restore with an unchanged blob does not re-walk',
      );

      // When a newly seeded realm session changes the stored blob, the memo no
      // longer matches it, so the next restore re-reads and re-walks.
      (realmService as any).lastRestoredSessionsString = 'stale-sentinel';
      before = walks;
      realmService.restoreSessionsFromStorage();
      assert.true(
        walks - before > 0,
        'a restore re-walks once the stored blob no longer matches the memo',
      );
    } finally {
      (realmService as any).getOrCreateRealmResource = originalGetOrCreate;
    }
  });

  test('getFields is memoized per instance in the render context and invalidates as the instance grows', function (assert) {
    let person = new PersonDef({ name: 'Mango' });
    try {
      (globalThis as any).__boxelRenderContext = true;

      let first = api.getFields(person, { usedLinksToFieldsOnly: true });
      let second = api.getFields(person, { usedLinksToFieldsOnly: true });
      assert.strictEqual(
        first,
        second,
        'a repeat call in the render context returns the memoized field map',
      );
      assert.notOk(
        'bestFriend' in first,
        'an unused linksTo field is absent before it is populated',
      );

      // Populating a linksTo field grows the data bucket, so the memo token no
      // longer matches and the next call recomputes.
      (person as any).bestFriend = new PersonDef({ name: 'Van Gogh' });
      let third = api.getFields(person, { usedLinksToFieldsOnly: true });
      assert.notStrictEqual(
        third,
        first,
        'growing the instance invalidates the memo',
      );
      assert.ok(
        'bestFriend' in third,
        'the now-used linksTo field appears after the bucket grows',
      );

      // Outside the render context the result is never memoized.
      delete (globalThis as any).__boxelRenderContext;
      let live1 = api.getFields(person, { usedLinksToFieldsOnly: true });
      let live2 = api.getFields(person, { usedLinksToFieldsOnly: true });
      assert.notStrictEqual(
        live1,
        live2,
        'the live app always gets a fresh field map',
      );
    } finally {
      delete (globalThis as any).__boxelRenderContext;
    }
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

  test('file-meta instance is retained when referenced', async function (assert) {
    await testRealm.write('hero.png', 'mock hero image');
    let fileUrl = `${testRealmURL}hero.png`;

    let fileInstance = await storeService.get(fileUrl, { type: 'file-meta' });
    assert.ok(fileInstance, 'file meta instance is loaded');
    assert.ok(
      (fileInstance as any).constructor?.isFileDef,
      'file meta instance is a FileDef',
    );

    storeService.addReference(fileUrl);
    forceGC();

    let peekedInstance = cardStore.getFileMeta(fileUrl) as unknown;
    assert.strictEqual(
      peekedInstance,
      fileInstance,
      'file meta instance is retained after GC with reference',
    );
  });

  test('file-meta instance is garbage collected when references drop', async function (assert) {
    await testRealm.write('hero.png', 'mock hero image');
    let fileUrl = `${testRealmURL}hero.png`;

    await storeService.get(fileUrl, { type: 'file-meta' });
    storeService.addReference(fileUrl);
    storeService.dropReference(fileUrl);
    forceGC();

    assert.strictEqual(
      cardStore.getFileMeta(fileUrl),
      undefined,
      'file meta instance is garbage collected after reference drop',
    );
  });

  test('realm subscription is removed when file-meta reference count drops to zero', async function (assert) {
    await testRealm.write('hero.png', 'mock hero image');
    let fileUrl = `${testRealmURL}hero.png`;
    let subscriptions = (storeService as any).subscriptions as Map<
      string,
      { unsubscribe: () => void }
    >;

    assert.false(
      subscriptions.has(testRealmURL),
      'realm is not subscribed before adding file-meta reference',
    );

    storeService.addReference(fileUrl, { type: 'file-meta' });
    assert.true(
      subscriptions.has(testRealmURL),
      'realm subscription is created for file-meta reference',
    );

    storeService.dropReference(fileUrl);
    assert.false(
      subscriptions.has(testRealmURL),
      'realm subscription is removed when file-meta reference reaches zero',
    );
  });

  test('add stores FileDef dependencies', async function (assert) {
    class FileCard extends CardDef {
      @field attachment = linksTo(FileDef);
    }

    let fileUrl = `${testRealmURL}hero.png`;
    let fileDef = new FileDef({
      id: fileUrl,
      sourceUrl: fileUrl,
      url: fileUrl,
      name: 'hero.png',
      contentType: 'image/png',
    });
    let card = new FileCard({ attachment: fileDef });

    await storeService.add(card, { doNotPersist: true });

    assert.strictEqual(
      storeService.peek(fileUrl, { type: 'file-meta' }),
      fileDef,
      'file meta dependency is cached in file-meta store',
    );
  });

  test('card read of a binary file URL is rerouted to file-meta', async function (assert) {
    await testRealm.write('hero.png', 'mock hero image');
    let fileUrl = `${testRealmURL}hero.png`;

    let result = await storeService.get(fileUrl);
    assert.ok(
      (result as any).constructor?.isFileDef,
      'card read returns a FileDef via the safety-net reroute',
    );

    let fileInstance = await storeService.get(fileUrl, { type: 'file-meta' });
    assert.ok(
      (fileInstance as any).constructor?.isFileDef,
      'file-meta read returns a FileDef',
    );

    assert.strictEqual(
      storeService.peekError(fileUrl),
      undefined,
      'no error cached on the card bucket',
    );
    assert.strictEqual(
      storeService.peekError(fileUrl, { type: 'file-meta' }),
      undefined,
      'no error cached on the file-meta bucket',
    );
  });

  test('a file the realm does not hold is reported as a missing file', async function (assert) {
    let missingFileUrl = `${testRealmURL}missing.png`;

    let error = (await storeService.get(missingFileUrl, {
      type: 'file-meta',
    })) as CardErrorJSONAPI;

    assert.strictEqual(error.status, 404, 'the error carries the HTTP status');
    assert.strictEqual(
      error.title,
      'File Not Found',
      'a missing file is titled as a missing file, not a missing card',
    );
    assert.strictEqual(
      error.message,
      `The file ${missingFileUrl} does not exist`,
      'the message names a file, not a card',
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
            module: testRRI('person'),
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
            module: testRRI('person'),
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
        import { contains, field, CardDef, Component, StringField } from '@cardstack/base/card-api';

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

  // The store's single write-permission check lives on the autosave path
  // (`useEphemeralState`, consulted by `doAutoSave`). `persistAndUpdate` has no
  // such guard, so a persist that bypasses the queue must re-apply the check or
  // it will PATCH a realm the user cannot write to.
  test<TestContextWithSave>('add() does not persist an existing card when the realm is read-only', async function (assert) {
    (storeService as any).realm.permissions = () => ({
      get canRead() {
        return true;
      },
      get canWrite() {
        return false;
      },
    });
    let instance = (await storeService.get(
      `${testRealmURL}Person/hassan`,
    )) as any;

    let writes: string[] = [];
    this.onSave((url) => writes.push(url.href));

    instance.name = 'Hassan Updated';
    let result = await storeService.add(instance);
    await settled();

    assert.deepEqual(writes, [], 'no write is attempted without permission');
    assert.true(
      isCardInstance(result),
      'add() still resolves with the instance rather than a permission error',
    );
    let file = await testRealmAdapter.openFile('Person/hassan.json');
    assert.strictEqual(
      JSON.parse(file!.content as string).data.attributes.name,
      'Hassan',
      'the durable document is untouched',
    );
  });

  test('add() reports its save in the card save state', async function (assert) {
    let instance = (await storeService.get(
      `${testRealmURL}Person/hassan`,
    )) as any;
    instance.name = 'Hassan Updated';

    await storeService.add(instance);

    // add() persists outside the autosave queue, so it has to fold its own
    // outcome into the save state the indicator renders.
    let saveState = storeService.getSaveState(instance.id)!;
    assert.false(
      saveState.hasUnsavedChanges,
      'the card no longer reports unsaved changes',
    );
    assert.ok(saveState.lastSaved, 'lastSaved reflects the add()-driven save');
    assert.strictEqual(
      saveState.lastSaveError,
      undefined,
      'no save error is reported',
    );
    assert.false(saveState.isSaving, 'the save is no longer in flight');
  });

  test('add() records a persistence failure in the card save state', async function (assert) {
    let instance = (await storeService.get(
      `${testRealmURL}Person/hassan`,
    )) as any;
    instance.name = 'Hassan Updated';

    let store = storeService as any;
    store.saveCardDocument = async () => {
      throw new Error('intentional persistence failure');
    };
    try {
      await storeService.add(instance);
    } finally {
      delete store.saveCardDocument;
    }

    let saveState = storeService.getSaveState(instance.id)!;
    assert.ok(
      saveState.lastSaveError,
      'the failure is visible to the save indicator, not only to the caller',
    );
    assert.false(saveState.isSaving, 'the save is no longer in flight');
  });

  test('add() awaits durable persistence for an existing card', async function (assert) {
    let queenzy = (await storeService.get(
      `${testRealmURL}Person/queenzy`,
    )) as any;
    let instance = (await storeService.get(
      `${testRealmURL}Person/hassan`,
    )) as any;
    // Mutate a scalar attribute and a relationship together: the two travel
    // through different serialization paths, so a persist that awaited only one
    // of them would still pass a scalar-only assertion.
    instance.name = 'Hassan Updated';
    instance.bestFriend = queenzy;

    let result = await storeService.add(instance);
    assert.true(
      isCardInstance(result),
      'add() resolves with the card instance',
    );

    // Read the backing JSON with no waitUntil: that is what makes this an
    // assertion about ordering rather than about eventual consistency. An
    // add() that resolved before the PATCH landed would still see the
    // pre-mutation state here.
    let file = await testRealmAdapter.openFile('Person/hassan.json');
    let fileJSON = JSON.parse(file!.content as string);
    assert.strictEqual(
      fileJSON.data.attributes.name,
      'Hassan Updated',
      'the scalar mutation is durable as soon as add() resolves',
    );
    assert.ok(
      (fileJSON.data.relationships.bestFriend.links.self as string).endsWith(
        'queenzy',
      ),
      'the link mutation is durable as soon as add() resolves',
    );
  });

  test('add() stays pending until an existing card is durably persisted', async function (assert) {
    let instance = (await storeService.get(
      `${testRealmURL}Person/hassan`,
    )) as any;
    instance.name = 'Hassan Updated';

    let store = storeService as any;
    let gate = new Deferred<void>();
    // Keep the unbound original and call it with an explicit receiver, so the
    // stub can be removed rather than replaced. `persistAndUpdate` lives on the
    // prototype, so deleting the shadowing own property below restores the
    // method exactly — assigning a bound copy back would leave a permanent own
    // property with a different identity and arity.
    let originalPersist = store.persistAndUpdate;
    store.persistAndUpdate = async (...args: any[]) => {
      await gate.promise;
      return await originalPersist.call(store, ...args);
    };

    try {
      let resolved = false;
      let addPromise = storeService.add(instance).then((r) => {
        resolved = true;
        return r;
      });

      // Give a fire-and-forget implementation every opportunity to resolve
      // early; a durable implementation must remain pending while the gate is
      // held closed.
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
      }
      assert.false(
        resolved,
        'add() has not resolved while persistence is gated',
      );

      gate.fulfill();
      await addPromise;
      assert.true(resolved, 'add() resolves once persistence completes');
    } finally {
      delete store.persistAndUpdate;
    }

    let file = await testRealmAdapter.openFile('Person/hassan.json');
    assert.strictEqual(
      JSON.parse(file!.content as string).data.attributes.name,
      'Hassan Updated',
      'the mutation is durably persisted',
    );
  });

  test('add() surfaces persistence failures for an existing card', async function (assert) {
    let instance = (await storeService.get(
      `${testRealmURL}Person/hassan`,
    )) as any;
    instance.name = 'Hassan Updated';

    // Removed rather than reassigned in `finally`, for the reason given on the
    // persistAndUpdate stub above.
    let store = storeService as any;
    store.saveCardDocument = async () => {
      throw new Error('intentional persistence failure');
    };

    let result;
    try {
      result = await storeService.add(instance);
    } finally {
      delete store.saveCardDocument;
    }

    assert.false(
      isCardInstance(result),
      'add() resolves with a card error rather than the instance when persistence fails',
    );
    assert.ok(
      (result as CardErrorJSONAPI).message.includes(
        'intentional persistence failure',
      ),
      'the persistence error propagates to the caller instead of being swallowed',
    );
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
            module: testRRI('person'),
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
              module: testRRI('person'),
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
        id: testRRI('Person/hassan'),
        attributes: {
          name: 'Hassan',
        },
        meta: {
          adoptsFrom: {
            module: testRRI('person'),
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
        <template><OperatorMode @onClose={{noop}} /></template>
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

  test('subscribeToCardInvalidation fires the callback when the card is deleted', async function (assert) {
    storeService.addReference(`${testRealmURL}Person/boris`);
    await storeService.flush();

    let fired = 0;
    let unsubscribe = storeService.subscribeToCardInvalidation(
      `${testRealmURL}Person/boris`,
      () => {
        fired += 1;
      },
    );

    await storeService.delete(`${testRealmURL}Person/boris`);

    assert.strictEqual(
      fired,
      1,
      'the invalidation subscriber fires exactly once on delete',
    );
    unsubscribe();
  });

  test('subscribeToCardInvalidation unsubscribe stops firing the callback', async function (assert) {
    storeService.addReference(`${testRealmURL}Person/boris`);
    await storeService.flush();

    let fired = 0;
    let unsubscribe = storeService.subscribeToCardInvalidation(
      `${testRealmURL}Person/boris`,
      () => {
        fired += 1;
      },
    );
    unsubscribe();

    await storeService.delete(`${testRealmURL}Person/boris`);

    assert.strictEqual(fired, 0, 'no callbacks fire after unsubscribe');
  });

  test('a synchronously throwing invalidation subscriber does not break siblings', async function (assert) {
    storeService.addReference(`${testRealmURL}Person/boris`);
    await storeService.flush();

    let originalError = console.error;
    let captured: unknown[] = [];
    console.error = (...args: unknown[]) => {
      // Scope the count to the invalidation-subscriber errors this test is
      // about. Setup can emit unrelated console.error noise whose timing is not
      // fixed relative to this window — e.g. the fixture realm has no
      // SystemCard, so matrix-service's async load of it 404s and reports here
      // — and that must not race into the assertion. Forward everything else so
      // genuine problems still surface.
      if (
        typeof args[0] === 'string' &&
        args[0].includes('card invalidation subscriber')
      ) {
        captured.push(args);
      } else {
        originalError(...args);
      }
    };

    let secondFired = 0;
    let unsubscribeA = storeService.subscribeToCardInvalidation(
      `${testRealmURL}Person/boris`,
      () => {
        throw new Error('intentional sync throw from invalidation subscriber');
      },
    );
    let unsubscribeB = storeService.subscribeToCardInvalidation(
      `${testRealmURL}Person/boris`,
      () => {
        secondFired += 1;
      },
    );

    try {
      await storeService.delete(`${testRealmURL}Person/boris`);

      assert.strictEqual(
        secondFired,
        1,
        'the second subscriber still runs after the first one throws',
      );
      assert.strictEqual(
        captured.length,
        1,
        'the synchronous throw is reported via console.error exactly once',
      );
    } finally {
      unsubscribeA();
      unsubscribeB();
      console.error = originalError;
    }
  });

  test('an async-rejecting invalidation subscriber does not break siblings and does not surface as an unhandled rejection', async function (assert) {
    storeService.addReference(`${testRealmURL}Person/boris`);
    await storeService.flush();

    let originalError = console.error;
    let captured: unknown[] = [];
    console.error = (...args: unknown[]) => {
      // Scope the count to the invalidation-subscriber errors this test is
      // about. Setup can emit unrelated console.error noise whose timing is not
      // fixed relative to this window — e.g. the fixture realm has no
      // SystemCard, so matrix-service's async load of it 404s and reports here
      // — and that must not race into the assertion. Forward everything else so
      // genuine problems still surface.
      if (
        typeof args[0] === 'string' &&
        args[0].includes('card invalidation subscriber')
      ) {
        captured.push(args);
      } else {
        originalError(...args);
      }
    };

    let secondFired = 0;
    let unsubscribeA = storeService.subscribeToCardInvalidation(
      `${testRealmURL}Person/boris`,
      async () => {
        await Promise.resolve();
        throw new Error(
          'intentional async rejection from invalidation subscriber',
        );
      },
    );
    let unsubscribeB = storeService.subscribeToCardInvalidation(
      `${testRealmURL}Person/boris`,
      () => {
        secondFired += 1;
      },
    );

    try {
      await storeService.delete(`${testRealmURL}Person/boris`);
      // Drain the microtask queue so the rejected promise's catch handler runs
      // and any unhandled-rejection event would have already fired.
      await settled();

      assert.strictEqual(
        secondFired,
        1,
        'the second subscriber still runs alongside the async-rejecting one',
      );
      assert.strictEqual(
        captured.length,
        1,
        'the async rejection is reported via console.error exactly once',
      );
    } finally {
      unsubscribeA();
      unsubscribeB();
      console.error = originalError;
    }
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

  // Loading is a read. Resolving a linksTo assigns the loaded target back onto
  // the field, which notifies change subscribers — the same signal a user edit
  // produces — so without care the mere act of viewing a card can dirty it and
  // trigger an auto-save. That write is invisible to the user, bumps the
  // instance's version, and schedules a reindex.
  test<TestContextWithSave>('resolving a linksTo lazily issues no save', async function (assert) {
    let hassanId = `${testRealmURL}Person/hassan`;
    // A target of its own: deserialization resolves a link straight from the
    // identity map when the target is already in the store, which skips the
    // lazy path just as surely as side-loading does.
    await testRealm.write(
      'Person/ghost-friend.json',
      JSON.stringify({
        data: {
          attributes: { name: 'Ghost' },
          meta: { adoptsFrom: { module: testRRI('person'), name: 'Person' } },
        },
      }),
    );
    await testRealm.write(
      'Person/hassan.json',
      JSON.stringify({
        data: {
          attributes: { name: 'Hassan' },
          relationships: {
            bestFriend: {
              links: { self: `${testRealmURL}Person/ghost-friend` },
            },
          },
          meta: {
            adoptsFrom: { module: testRRI('person'), name: 'Person' },
          },
        },
      }),
    );

    // A card GET side-loads its linksTo targets into `included`, and
    // deserialization resolves the field from there synchronously — never
    // touching the lazy path this test is about. Writing the link unresolved
    // on disk does not change that. Drop the side-load for this one document
    // so the field deserializes to a not-loaded marker, and reading it drives
    // the real lazy load — the path that assigns the target onto the field.
    let cardService = getService('card-service');
    let fetchJSON = cardService.fetchJSON.bind(cardService);
    let intercepted = 0;
    cardService.fetchJSON = (async (
      url: string | URL,
      args?: Parameters<typeof fetchJSON>[1],
    ) => {
      let doc = await fetchJSON(url, args);
      if (String(url).replace(/\.json$/, '') === hassanId) {
        intercepted++;
        delete (doc as any)?.included;
      }
      return doc;
    }) as typeof cardService.fetchJSON;

    let saved: string[] = [];
    this.onSave((url) => {
      saved.push(url.href);
    });

    try {
      let instance = (await storeService.get(hassanId)) as any;

      // These two keep the test honest rather than describing behaviour: if
      // the fetch is never intercepted, or the link arrives already resolved,
      // the lazy path did not run and a save during it would go unnoticed.
      assert.ok(intercepted > 0, 'the card fetch was intercepted');
      assert.strictEqual(
        instance.bestFriend,
        undefined,
        'the link is not loaded yet, so reading it takes the lazy path',
      );

      await storeService.flush();
      await settled();

      assert.strictEqual(
        instance.bestFriend?.name,
        'Ghost',
        'the lazy load resolved the target and assigned it to the field',
      );
      assert.deepEqual(saved, [], 'no save was issued while loading');
    } finally {
      cardService.fetchJSON = fetchJSON;
    }
  });

  // The plural sibling of the test above. It resolves through a different
  // mechanism — a WatchedArray slot rather than a field setter — so suppressing
  // the change notification in one says nothing about the other.
  test<TestContextWithSave>('resolving a linksToMany lazily issues no save', async function (assert) {
    let hassanId = `${testRealmURL}Person/hassan`;
    await testRealm.write(
      'Person/ghost-friend.json',
      JSON.stringify({
        data: {
          attributes: { name: 'Ghost' },
          meta: { adoptsFrom: { module: testRRI('person'), name: 'Person' } },
        },
      }),
    );
    await testRealm.write(
      'Person/hassan.json',
      JSON.stringify({
        data: {
          attributes: { name: 'Hassan' },
          relationships: {
            'friends.0': {
              links: { self: `${testRealmURL}Person/ghost-friend` },
            },
          },
          meta: {
            adoptsFrom: { module: testRRI('person'), name: 'Person' },
          },
        },
      }),
    );

    let cardService = getService('card-service');
    let fetchJSON = cardService.fetchJSON.bind(cardService);
    let intercepted = 0;
    cardService.fetchJSON = (async (
      url: string | URL,
      args?: Parameters<typeof fetchJSON>[1],
    ) => {
      let doc = await fetchJSON(url, args);
      if (String(url).replace(/\.json$/, '') === hassanId) {
        intercepted++;
        delete (doc as any)?.included;
      }
      return doc;
    }) as typeof cardService.fetchJSON;

    let saved: string[] = [];
    this.onSave((url) => {
      saved.push(url.href);
    });

    try {
      let instance = (await storeService.get(hassanId)) as any;

      assert.ok(intercepted > 0, 'the card fetch was intercepted');
      // The proxy hides an unresolved slot, so an unloaded element reads as
      // absent. Seeing the target here instead would mean it arrived resolved
      // and the lazy path never ran.
      assert.deepEqual(
        instance.friends.map((f: any) => f?.name),
        [undefined],
        'the element is not loaded yet, so reading it takes the lazy path',
      );

      await storeService.flush();
      await settled();

      assert.deepEqual(
        instance.friends.map((f: any) => f?.name),
        ['Ghost'],
        'the lazy load resolved the target into its slot',
      );
      assert.deepEqual(saved, [], 'no save was issued while loading');
    } finally {
      cardService.fetchJSON = fetchJSON;
    }
  });

  test('a concurrent field write during store.patch is not clobbered by the patch’s stale snapshot', async function (assert) {
    let targetId = `${testRealmURL}Person/hassan`;
    let instance = (await storeService.get(targetId)) as any;

    let gate = new Deferred<void>();
    let enteredGate = new Deferred<void>();
    let originalLoadPatchedInstances = (storeService as any)
      .loadPatchedInstances;
    (storeService as any).loadPatchedInstances = async function (
      this: unknown,
      ...args: any[]
    ) {
      let result = await originalLoadPatchedInstances.apply(this, args);
      // simulate a slow relationship load (e.g. fetching a not-yet-cached
      // linked card) so a concurrent field write on the same live instance
      // can land in the window between the patch's snapshot and its
      // eventual write-back
      enteredGate.fulfill();
      await gate.promise;
      return result;
    };

    try {
      let patchPromise = storeService.patch(targetId, {
        relationships: {
          bestFriend: {
            links: { self: `${testRealmURL}Person/jade` },
          },
        },
      });

      // wait until the patch has actually reached the gated relationship
      // load before mutating a sibling field, so the write lands squarely in
      // the window the patch's snapshot needs to still be sensitive to
      await enteredGate.promise;

      // a sibling background task (e.g. an unrelated auto-linking step, as in
      // the catalog listing-create flow) mutates a different field on the
      // same live instance while the patch above is still in flight
      instance.name = 'Race Winner';

      gate.fulfill();
      await patchPromise;
    } finally {
      (storeService as any).loadPatchedInstances = originalLoadPatchedInstances;
    }

    assert.strictEqual(
      instance.name,
      'Race Winner',
      "the concurrent field write is not clobbered by the patch's stale snapshot",
    );
    assert.strictEqual(
      instance.bestFriend?.id,
      `${testRealmURL}Person/jade`,
      'the patch itself was still applied',
    );
  });

  test('a create gives the instance a remote identity the rest of the store can use', async function (assert) {
    // Deliberately not put in the store first: the identity-map registration
    // and the autosave subscription asserted below are the create's own doing,
    // and `add` would have supplied both before any save ran.
    let instance = new PersonDef({ name: 'Sequence' });
    let instanceLocalId = instance[localId];
    let subscriptions = (storeService as any).subscriptions as Map<
      string,
      { unsubscribe: () => void }
    >;
    assert.false(
      subscriptions.has(testRealmURL),
      'the realm is not subscribed before the create',
    );

    let result = await (storeService as any).persistAndUpdate(instance);
    assert.true(isCardInstance(result), 'the create resolved to the instance');

    // The realm named the card, and the store left it reachable under both the
    // id the browser picked and the one the realm assigned.
    assert.ok(
      instance.id?.startsWith(testRealmURL),
      'the instance took a remote id in the realm',
    );
    assert.strictEqual(
      storeService.peek(instanceLocalId),
      instance,
      'the local id still resolves to this instance',
    );
    assert.strictEqual(
      storeService.peek(instance.id!),
      instance,
      'the remote id resolves to the same instance',
    );
    assert.true(
      subscriptions.has(testRealmURL),
      "the store is listening for the realm's index events",
    );

    let cardPath = `${instance.id!.substring(testRealmURL.length)}.json`;
    assert.ok(
      await testRealmAdapter.openFile(cardPath),
      'the realm holds the created card',
    );

    // Autosave is live on the instance the create just named, so an edit
    // reaches the realm without anyone asking for a save.
    (instance as any).name = 'Sequence Edited';
    await waitUntil(
      () => storeService.getSaveState(instanceLocalId)?.lastSaved,
      { timeout: 10000 },
    );
    await settled();
    let file = await testRealmAdapter.openFile(cardPath);
    assert.strictEqual(
      JSON.parse(file!.content as string).data.attributes.name,
      'Sequence Edited',
      'an edit after the create autosaves to the realm',
    );
  });

  test('a save overlapping a create PATCHes instead of issuing a second POST', async function (assert) {
    // Driven through `persistAndUpdate` rather than `save`, because the
    // autosave queue awaits the in-flight mutation before it saves at all —
    // it never reaches the window the mutation lock covers, which is the
    // window under test here.
    let instance = new PersonDef({ name: 'Overlap' });
    await storeService.add(instance, { doNotPersist: true });

    // Hold the POST open so the second save is guaranteed to arrive while the
    // create is still in flight — the window the per-instance mutation lock
    // exists to cover. Without it the second save serializes a card that still
    // has no remote id and issues a second create for a card the realm has
    // already named, rather than updating it.
    let cardService = getService('card-service') as any;
    let originalFetchJSON = cardService.fetchJSON.bind(cardService);
    let methods: string[] = [];
    let reachedPost = new Deferred<void>();
    let releasePost = new Deferred<void>();
    cardService.fetchJSON = async (url: string | URL, args?: any) => {
      if (args?.method !== 'POST' && args?.method !== 'PATCH') {
        return originalFetchJSON(url, args);
      }
      methods.push(args.method);
      if (args.method === 'POST') {
        reachedPost.fulfill();
        await releasePost.promise;
      }
      return originalFetchJSON(url, args);
    };

    try {
      let creating = (storeService as any).persistAndUpdate(instance);
      // `persistAndUpdate` absorbs its errors and resolves to a card error, so
      // a create that dies before its POST would otherwise leave this parked on
      // `reachedPost` until the qunit timeout, with nothing saying why. Racing
      // the two turns that into an assertion failure naming the error.
      let reachedPostFirst = await Promise.race([
        reachedPost.promise.then(() => true),
        creating.then(() => false),
      ]);
      assert.true(
        reachedPostFirst,
        `the create reached its POST (resolved early as: ${JSON.stringify(
          await Promise.race([creating, Promise.resolve('still in flight')]),
        )})`,
      );
      let overlapping = (storeService as any).persistAndUpdate(instance);
      releasePost.fulfill();
      await Promise.all([creating, overlapping]);
    } finally {
      releasePost.fulfill();
      delete cardService.fetchJSON;
    }
    await settled();

    assert.deepEqual(
      methods,
      ['POST', 'PATCH'],
      'the overlapping save waited for the remote id and updated the created card',
    );
    assert.ok(
      await testRealmAdapter.openFile(
        `${instance.id!.substring(testRealmURL.length)}.json`,
      ),
      'the realm holds the created card',
    );
  });

  test('loads FileDef links from included resources', async function (assert) {
    await testRealm.writeMany(
      new Map<string, string>([
        [
          'gallery.gts',
          `
            import { CardDef, field, linksTo, linksToMany } from "@cardstack/base/card-api";
            import { FileDef } from "@cardstack/base/file-api";

            export class Gallery extends CardDef {
              @field hero = linksTo(FileDef);
              @field attachments = linksToMany(FileDef);
            }
          `,
        ],
        [
          'Gallery/hero.json',
          JSON.stringify({
            data: {
              attributes: {
                cardInfo: {},
              },
              relationships: {
                hero: {
                  links: {
                    self: `${testRealmURL}hero.png`,
                  },
                  data: { type: 'file-meta', id: `${testRealmURL}hero.png` },
                },
                'attachments.0': {
                  links: {
                    self: `${testRealmURL}first.png`,
                  },
                  data: { type: 'file-meta', id: `${testRealmURL}first.png` },
                },
                'attachments.1': {
                  links: {
                    self: `${testRealmURL}second.png`,
                  },
                  data: { type: 'file-meta', id: `${testRealmURL}second.png` },
                },
              },
              meta: {
                adoptsFrom: {
                  module: testRRI('gallery'),
                  name: 'Gallery',
                },
              },
            },
            included: [
              {
                type: 'file-meta',
                id: `${testRealmURL}hero.png`,
                attributes: {
                  name: 'hero.png',
                  url: `${testRealmURL}hero.png`,
                  sourceUrl: `${testRealmURL}hero.png`,
                  contentType: 'image/png',
                },
                meta: {
                  adoptsFrom: {
                    module: '@cardstack/base/card-api',
                    name: 'FileDef',
                  },
                },
              },
              {
                type: 'file-meta',
                id: `${testRealmURL}first.png`,
                attributes: {
                  name: 'first.png',
                  url: `${testRealmURL}first.png`,
                  sourceUrl: `${testRealmURL}first.png`,
                  contentType: 'image/png',
                },
                meta: {
                  adoptsFrom: {
                    module: '@cardstack/base/card-api',
                    name: 'FileDef',
                  },
                },
              },
              {
                type: 'file-meta',
                id: `${testRealmURL}second.png`,
                attributes: {
                  name: 'second.png',
                  url: `${testRealmURL}second.png`,
                  sourceUrl: `${testRealmURL}second.png`,
                  contentType: 'image/png',
                },
                meta: {
                  adoptsFrom: {
                    module: '@cardstack/base/card-api',
                    name: 'FileDef',
                  },
                },
              },
            ],
          }),
        ],
        ['hero.png', 'mock hero image'],
        ['first.png', 'mock first image'],
        ['second.png', 'mock second image'],
      ]),
    );

    let gallery = (await storeService.get(
      `${testRealmURL}Gallery/hero`,
    )) as CardDefType;

    assert.ok((gallery as any).hero, 'hero is loaded from included resources');
    assert.strictEqual(
      (gallery as any).hero?.id,
      `${testRealmURL}hero.png`,
      'hero FileDef has id set from file meta',
    );
    assert.strictEqual(
      (gallery as any).hero?.name,
      'hero.png',
      'hero FileDef uses file meta name',
    );
    assert.strictEqual(
      (gallery as any).hero?.url,
      `${testRealmURL}hero.png`,
      'hero FileDef uses file meta url',
    );

    let attachments = (gallery as any).attachments ?? [];
    assert.strictEqual(
      attachments.length,
      2,
      'attachments are loaded from included resources',
    );
    assert.strictEqual(
      attachments[0]?.id,
      `${testRealmURL}first.png`,
      'first attachment has id set from file meta',
    );
    assert.strictEqual(
      attachments[0]?.name,
      'first.png',
      'first attachment uses file meta name',
    );
    assert.strictEqual(
      attachments[1]?.id,
      `${testRealmURL}second.png`,
      'second attachment has id set from file meta',
    );
    assert.strictEqual(
      attachments[1]?.name,
      'second.png',
      'second attachment uses file meta name',
    );
  });

  test('uses cached FileDef for links.self when field expects FileDef', async function (assert) {
    await testRealm.writeMany(
      new Map<string, string>([
        [
          'gallery.gts',
          `
            import { CardDef, field, linksTo } from "@cardstack/base/card-api";
            import { FileDef } from "@cardstack/base/file-api";

            export class Gallery extends CardDef {
              @field hero = linksTo(FileDef);
            }
          `,
        ],
        [
          'Gallery/cached.json',
          JSON.stringify({
            data: {
              attributes: {
                cardInfo: {},
              },
              relationships: {
                hero: {
                  links: {
                    self: `${testRealmURL}hero.png`,
                  },
                  data: { type: 'file-meta', id: `${testRealmURL}hero.png` },
                },
              },
              meta: {
                adoptsFrom: {
                  module: testRRI('gallery'),
                  name: 'Gallery',
                },
              },
            },
          }),
        ],
        ['hero.png', 'mock hero image'],
      ]),
    );

    let cachedFile = (await storeService.get(`${testRealmURL}hero.png`, {
      type: 'file-meta',
    })) as unknown as FileDef;

    let gallery = (await storeService.get(
      `${testRealmURL}Gallery/cached`,
    )) as CardDefType;

    assert.strictEqual(
      (gallery as any).hero,
      cachedFile,
      'links.self resolves to cached FileDef for FileDef fields',
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

    // The fire-and-forget save (doNotWaitForPersist) completes a write +
    // incremental index round-trip before onSave fires — comfortably over the
    // 1s waitUntil default under load. Match the save slack the sibling
    // "adding to the store" test uses.
    await waitUntil(() => didSave, { timeout: 10000 });

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
            module: testRRI('person'),
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

  // A search result can resolve to prerendered HTML with no `item`
  // serialization (the engine's prefer-HTML branch). The instances-level
  // search must never fabricate or deposit anything for such an entry — an
  // attribute-less stub would misrepresent the instance and could clobber a
  // correctly-loaded full one. The route is overridden to return such a doc.
  function overrideSearchWith(doc: unknown) {
    registerRealmServerRoute({
      path: '/_federated-search',
      handler: async () =>
        new Response(JSON.stringify(doc), {
          status: 200,
          headers: { 'content-type': SupportedMimeType.CardJson },
        }),
    });
  }

  // An entry that carries only an `html` rendering — no `item`.
  function htmlOnlyEntryDoc(id: string, opts?: { isFileMeta?: boolean }) {
    let htmlId = opts?.isFileMeta
      ? `${id}#fitted`
      : `${id}#fitted#${testRealmURL}person/Person`;
    return {
      data: [
        {
          type: 'entry',
          id,
          relationships: {
            html: { data: [{ type: 'html', id: htmlId }] },
          },
        },
      ],
      included: [
        {
          type: 'html',
          id: htmlId,
          attributes: {
            html: '<div>prerendered</div>',
            cardType: 'Person',
            format: 'fitted',
          },
          relationships: { styles: { data: [] } },
        },
      ],
      meta: { page: { total: 1 } },
    };
  }

  let personQuery = {
    filter: {
      on: { module: testRRI('person'), name: 'Person' },
      eq: { name: 'Hassan' },
    },
  };

  test('a search result with no item serialization is not deposited into the Store', async function (assert) {
    let id = `${testRealmURL}Person/html-only`;
    overrideSearchWith(htmlOnlyEntryDoc(id));
    try {
      let results = await storeService.search(personQuery, [testRealmURL]);
      assert.strictEqual(
        results.length,
        0,
        'the html-only entry is not returned as a hydrated instance',
      );
      assert.notOk(
        isCardInstance(storeService.peek(id)),
        'the html-only entry is not deposited in the Store',
      );
    } finally {
      registerDefaultRoutes();
    }
  });

  test('a search result with no item serialization leaves a resident full instance untouched', async function (assert) {
    let id = `${testRealmURL}Person/hassan`;
    // Seed the full instance into the Store first.
    storeService.addReference(id);
    await storeService.flush();
    let before = storeService.peek(id);
    assert.true(
      isCardInstance(before),
      'the full instance is resident before the search',
    );

    overrideSearchWith(htmlOnlyEntryDoc(id));
    try {
      let results = await storeService.search(personQuery, [testRealmURL]);
      assert.strictEqual(
        results.length,
        0,
        'an entry with no serialization contributes no instance',
      );
      let after = storeService.peek(id);
      assert.strictEqual(
        after,
        before,
        'the html-only entry left the resident full instance untouched',
      );
      assert.true(isCardInstance(after), 'still a full card instance');
    } finally {
      registerDefaultRoutes();
    }
  });

  test('a file-meta search result with no item serialization leaves a resident FileDef untouched', async function (assert) {
    await testRealm.write('hero.png', 'mock hero image');
    let fileUrl = `${testRealmURL}hero.png`;
    // Seed the live FileDef into the Store and retain it across the search.
    let before = await storeService.get(fileUrl, { type: 'file-meta' });
    storeService.addReference(fileUrl, { type: 'file-meta' });
    assert.true(
      (before as any)?.constructor?.isFileDef,
      'the live FileDef is resident before the search',
    );

    overrideSearchWith(htmlOnlyEntryDoc(fileUrl, { isFileMeta: true }));
    try {
      let results = await storeService.search(personQuery, [testRealmURL]);
      assert.strictEqual(
        results.length,
        0,
        'an entry with no serialization contributes no instance',
      );
      assert.true(
        (storeService.peek(fileUrl, { type: 'file-meta' }) as any)?.constructor
          ?.isFileDef,
        'the resident live FileDef is untouched',
      );
      assert.ok(
        Object.is(storeService.peek(fileUrl, { type: 'file-meta' }), before),
        'still the same resident FileDef',
      );
    } finally {
      storeService.dropReference(fileUrl);
      registerDefaultRoutes();
    }
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
        <template><OperatorMode @onClose={{noop}} /></template>
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
              module: testRRI('person'),
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
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    let instance = (await storeService.get(
      `${testRealmURL}Person/hassan`,
    )) as CardDefType;
    await testRealm.write(
      `person.gts`,
      `
      import { contains, field, Component, CardDef, } from '@cardstack/base/card-api';
      import StringField from '@cardstack/base/string';

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

  test('an instance live updates to a new type when its adoptsFrom changes', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/hassan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    let original = storeService.peek(
      `${testRealmURL}Person/hassan`,
    ) as CardDefType;
    assert.true(
      original instanceof PersonDef,
      'the card starts out as a Person',
    );
    assert.dom('[data-test-employee-badge]').doesNotExist();

    // Re-point the card's meta.adoptsFrom at an unrelated type — mirrors a user
    // changing the adoptsFrom of a realm index card (CardsGrid) to a custom
    // index card by editing its JSON.
    await testRealm.write(
      'Person/hassan.json',
      JSON.stringify({
        data: {
          attributes: {
            name: 'Hassan',
          },
          meta: {
            adoptsFrom: {
              module: testRRI('employee'),
              name: 'Employee',
            },
          },
        },
      } as LooseSingleCardDocument),
    );

    await waitUntil(
      () =>
        storeService.peek(`${testRealmURL}Person/hassan`) instanceof
        EmployeeDef,
      { timeout: 5_000 },
    );
    let reloaded = storeService.peek(
      `${testRealmURL}Person/hassan`,
    ) as CardDefType;
    assert.true(
      reloaded instanceof EmployeeDef,
      'the store now holds an Employee instance for the same id',
    );

    await waitFor('[data-test-employee-badge]', { timeout: 5_000 });
    assert
      .dom('[data-test-employee-badge]')
      .containsText(
        'Employee: Hassan',
        'the card re-rendered using the new type',
      );
  });

  test('an instance rebuilds when its adoptsFrom changes to an ancestor type', async function (assert) {
    await testRealm.write(
      'Manager/m1.json',
      JSON.stringify({
        data: {
          attributes: { name: 'Hassan' },
          meta: {
            adoptsFrom: { module: testRRI('manager'), name: 'Manager' },
          },
        },
      } as LooseSingleCardDocument),
    );
    setCardInOperatorModeState(`${testRealmURL}Manager/m1`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor('[data-test-manager-badge]');
    let original = storeService.peek(
      `${testRealmURL}Manager/m1`,
    ) as CardDefType;
    assert.true(original instanceof ManagerDef, 'the card starts as a Manager');

    // Re-point at the ancestor type. A subtype check would treat the Manager
    // instance as already compatible and keep rendering the subclass; the
    // store must rebuild it as exactly Employee.
    await testRealm.write(
      'Manager/m1.json',
      JSON.stringify({
        data: {
          attributes: { name: 'Hassan' },
          meta: {
            adoptsFrom: { module: testRRI('employee'), name: 'Employee' },
          },
        },
      } as LooseSingleCardDocument),
    );

    await waitUntil(
      () => {
        let c = storeService.peek(`${testRealmURL}Manager/m1`);
        return c instanceof EmployeeDef && !(c instanceof ManagerDef);
      },
      { timeout: 5_000 },
    );
    await waitFor('[data-test-employee-badge]', { timeout: 5_000 });
    assert
      .dom('[data-test-employee-badge]')
      .containsText('Employee: Hassan', 'rebuilt as the ancestor type');
    assert
      .dom('[data-test-manager-badge]')
      .doesNotExist('no longer rendered as the Manager subclass');
  });

  test('an instance can live update thru an error state', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/hassan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
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
              module: testRRI('person'),
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
              module: testRRI('person'),
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

  test('a card the realm holds but has not indexed yet shows as being prepared, then renders once indexing lands', async function (assert) {
    // Writing through the adapter puts the source on the realm without
    // enqueuing an indexing pass — the state a card+json read sees between a
    // write landing and the index catching up with it.
    await testRealmAdapter.write(
      'Person/pending.json',
      JSON.stringify({
        data: {
          attributes: { name: 'Pending' },
          meta: {
            adoptsFrom: { module: testRRI('person'), name: 'Person' },
          },
        },
      } as LooseSingleCardDocument),
    );

    setCardInOperatorModeState(`${testRealmURL}Person/pending`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );

    await waitFor('[data-test-card-awaiting-index]');
    assert
      .dom('[data-test-card-awaiting-index]')
      .containsText(
        'Preparing this card',
        'the card reads as on its way rather than missing',
      );
    assert
      .dom('[data-test-card-error]')
      .doesNotExist('no card error is reported');

    // The realm indexes the file and broadcasts the invalidation, which is
    // what the placeholder is waiting on.
    await testRealm.write(
      'Person/pending.json',
      JSON.stringify({
        data: {
          attributes: { name: 'Pending Person' },
          meta: {
            adoptsFrom: { module: testRRI('person'), name: 'Person' },
          },
        },
      } as LooseSingleCardDocument),
    );

    await waitFor('[data-test-card-awaiting-index]', { count: 0 });
    assert
      .dom(
        `[data-stack-card="${testRealmURL}Person/pending"] [data-test-field="name"]`,
      )
      .containsText(
        'Pending Person',
        'the real card takes over once it is indexed',
      );
  });

  test('an index event that lands while the first read is in flight still resolves the placeholder', async function (assert) {
    // The store subscribes to a realm's index events when something first
    // references a card in it, so give it the same footing the app has by the
    // time it reads a brand-new card.
    storeService.addReference(`${testRealmURL}Person/hassan`);
    await storeService.flush();

    // On the realm's file system, never seen by the index: the read below
    // comes back as the awaiting-index 404.
    await testRealmAdapter.write(
      'Person/racing.json',
      JSON.stringify({
        data: {
          attributes: { name: 'Racing' },
          meta: {
            adoptsFrom: { module: testRRI('person'), name: 'Person' },
          },
        },
      } as LooseSingleCardDocument),
    );

    // Hold that 404 open after the realm has produced it but before the store
    // records it, so the invalidation below arrives in the gap. Without the
    // in-flight check the store finds nothing to reload, drops the event, and
    // then installs a placeholder that no later event ever clears.
    let cardService = getService('card-service') as any;
    let originalFetchJSON = cardService.fetchJSON.bind(cardService);
    let reached404 = new Deferred<void>();
    let release404 = new Deferred<void>();
    cardService.fetchJSON = async (url: string | URL, args?: any) => {
      if (!String(url).includes('Person/racing')) {
        return originalFetchJSON(url, args);
      }
      try {
        return await originalFetchJSON(url, args);
      } catch (err) {
        reached404.fulfill();
        await release404.promise;
        throw err;
      }
    };

    // Deliver exactly one index event, inside the window. The realm broadcasts
    // its own when it indexes the file below, and matrix hands that over some
    // time later — after the read has settled, where the ordinary error-reload
    // path would pick it up and the window would never be exercised.
    let messageService = getService('message-service');
    let deliverRealmEvents =
      messageService.relayRealmEvent.bind(messageService);
    messageService.relayRealmEvent = () => {};

    try {
      let reading = storeService.get(`${testRealmURL}Person/racing`);
      await reached404.promise;

      await testRealm.write(
        'Person/racing.json',
        JSON.stringify({
          data: {
            attributes: { name: 'Racing Person' },
            meta: {
              adoptsFrom: { module: testRRI('person'), name: 'Person' },
            },
          },
        } as LooseSingleCardDocument),
      );
      deliverRealmEvents({
        eventName: 'index',
        indexType: 'incremental',
        invalidations: [`${testRealmURL}Person/racing`],
        realmURL: testRealmURL,
      });

      release404.fulfill();
      await reading;
      await settled();
    } finally {
      // Released here too: if the read never reaches the 404, or the write
      // throws, the intercepted fetch would otherwise never return and the
      // test would hang to the qunit timeout instead of failing with a reason.
      release404.fulfill();
      delete cardService.fetchJSON;
      messageService.relayRealmEvent = deliverRealmEvents;
    }

    let instance = storeService.peek(`${testRealmURL}Person/racing`);
    assert.true(
      isCardInstance(instance),
      'the store holds the card rather than the stale placeholder',
    );
    assert.strictEqual(
      (instance as any).name,
      'Racing Person',
      'and it is the indexed state',
    );
  });

  test('a full reindex resolves a placeholder even though it names no cards', async function (assert) {
    // A realm reindexing at startup announces itself with a bare `full` event
    // and no per-card invalidations, so this is the only word the store gets
    // that the awaited row now exists.
    storeService.addReference(`${testRealmURL}Person/hassan`);
    await storeService.flush();

    await testRealmAdapter.write(
      'Person/swept.json',
      JSON.stringify({
        data: {
          attributes: { name: 'Swept' },
          meta: {
            adoptsFrom: { module: testRRI('person'), name: 'Person' },
          },
        },
      } as LooseSingleCardDocument),
    );

    let placeholder = await storeService.get(`${testRealmURL}Person/swept`);
    assert.true(
      (placeholder as CardErrorJSONAPI).awaitingIndex,
      'the read leaves an awaiting-index placeholder',
    );

    // Withhold the realm's own broadcasts so the only event the store sees is
    // the bare full one handed over below.
    let messageService = getService('message-service');
    let deliverRealmEvents =
      messageService.relayRealmEvent.bind(messageService);
    messageService.relayRealmEvent = () => {};
    try {
      await testRealm.write(
        'Person/swept.json',
        JSON.stringify({
          data: {
            attributes: { name: 'Swept Person' },
            meta: {
              adoptsFrom: { module: testRRI('person'), name: 'Person' },
            },
          },
        } as LooseSingleCardDocument),
      );
      deliverRealmEvents({
        eventName: 'index',
        indexType: 'full',
        realmURL: testRealmURL,
      });
      await settled();
    } finally {
      messageService.relayRealmEvent = deliverRealmEvents;
    }

    let instance = storeService.peek(`${testRealmURL}Person/swept`);
    assert.true(
      isCardInstance(instance),
      'the sweep replaced the placeholder with the card',
    );
    assert.strictEqual(
      (instance as any).name,
      'Swept Person',
      'and it is the indexed state',
    );
  });

  function publicationDocument(
    path: string,
    realm = testRealmURL,
  ): SingleCardDocument {
    return {
      data: {
        id: testRRI(path),
        type: 'card',
        attributes: { name: path, boom: 'published' },
        meta: {
          adoptsFrom: { module: testRRI('person'), name: 'Person' },
          realmURL: realm,
          publication: {
            version: 1,
            state: 'ready',
            validatedThrough: 1,
            outputRevision: 2,
            definitionRevision: 'reviewed',
            computedFields: ['boom'],
            queryFields: [],
            watches: [],
            hasPublishedSnapshot: true,
          },
        },
      },
    };
  }

  // Existing per-card fixtures retain their held responses, now wrapped in
  // the actual batch wire shape. The real server adapter is covered separately.
  function batchExistingDisplayFixtures() {
    let network = getService('network');
    let authedFetch = network.authedFetch;
    let cardService = getService('card-service');
    Object.defineProperty(network, 'authedFetch', {
      configurable: true,
      value: async (url: string | URL, init?: RequestInit) => {
        if (!String(url).endsWith('/_lattice-read'))
          return authedFetch(url, init);
        let request = JSON.parse(
          String(init?.body),
        ) as LatticeDisplayBatchRequest;
        let results = await Promise.all(
          request.required.map(async (url) => {
            let token = request.have.find((entry) => entry.url === url)?.token;
            try {
              let publication = await cardService.fetchJSON(
                network.virtualNetwork.unresolveURL(url),
                {
                  signal: init?.signal,
                  headers: token
                    ? { [LATTICE_DISPLAY_HAVE_HEADER]: token }
                    : {},
                },
              );
              return { url, publication };
            } catch (error: any) {
              return {
                url,
                error: { status: error.status ?? 500, message: error.message },
              };
            }
          }),
        );
        return new Response(JSON.stringify({ ...request, results }), {
          headers: {
            'Content-Type': SupportedMimeType.CardJson,
            'x-boxel-realm-url': String(url).replace('_lattice-read', ''),
          },
        });
      },
    });
    return () => {
      delete (network as any).authedFetch;
    };
  }

  test('Lattice Store batches declare exact required cards and partial Have before applying in place', async function (assert) {
    await storeService.ensureSetupComplete();
    let messages = getService('message-service');
    let relay = messages.relayRealmEvent.bind(messages);
    messages.relayRealmEvent = () => {};
    messages.latticeConnectionChanged(false);
    let documents = [0, 1, 2].map((i) =>
      publicationDocument(`Person/batch-${i}`),
    );
    let instances: CardDefType[] = [];
    let token = 'lattice-display-v1:' + 'a'.repeat(64);
    documents[0].data.meta.publication!.have = token;
    for (let doc of documents) {
      let instance = new PersonDef();
      await api.updateFromSerialized(instance, doc, cardStore, {
        latticePublication: 'display',
      });
      instances.push(instance);
    }
    let network = getService('network');
    let authedFetch = network.authedFetch;
    let requests: LatticeDisplayBatchRequest[] = [];
    let transports: RequestInit[] = [];
    let cardService = getService('card-service');
    let fetchJSON = cardService.fetchJSON.bind(cardService);
    let singleReads = 0;
    cardService.fetchJSON = async (...args) => {
      let doc = documents.find((item) => item.data.id === String(args[0]));
      if (!doc) return fetchJSON(...args);
      singleReads++;
      return structuredClone(doc);
    };
    Object.defineProperty(network, 'authedFetch', {
      configurable: true,
      value: async (url: string | URL, init?: RequestInit) => {
        if (!String(url).endsWith('/_lattice-read'))
          return authedFetch(url, init);
        transports.push(init!);
        let request = JSON.parse(
          String(init?.body),
        ) as LatticeDisplayBatchRequest;
        requests.push(request);
        let results = request.required.map((url) => {
          let doc = documents.find(
            (item) => network.virtualNetwork.toURL(item.data.id!).href === url,
          )!;
          return request.have.some((entry) => entry.url === url)
            ? {
                url,
                publication: {
                  lattice: {
                    version: 1,
                    reuse: true,
                    token,
                    id: doc.data.id,
                    state: 'ready',
                  },
                },
              }
            : {
                url,
                publication: {
                  ...doc,
                  data: {
                    ...doc.data,
                    attributes: {
                      ...doc.data.attributes,
                      boom: 'new publication',
                    },
                  },
                },
              };
        });
        return new Response(
          JSON.stringify({ ...request, results: results.reverse() }),
          {
            headers: {
              'Content-Type': SupportedMimeType.CardJson,
              'x-boxel-realm-url': testRealmURL,
            },
          },
        );
      },
    });
    try {
      messages.latticeConnectionChanged(true);
      await settled();
      for (let init of transports) {
        assert.strictEqual(init.method, 'POST');
        assert.strictEqual(
          new Headers(init.headers).get('X-HTTP-Method-Override'),
          'QUERY',
        );
      }
      assert.strictEqual(
        requests.length,
        1,
        'same-turn admitted identities share one exchange',
      );
      assert.strictEqual(
        singleReads,
        0,
        'publication refresh does not issue per-card GETs',
      );
      assert.deepEqual(
        requests[0]?.required,
        instances.map(
          (instance) => network.virtualNetwork.toURL(instance.id!).href,
        ),
      );
      assert.deepEqual(
        requests[0]?.have,
        [{ url: network.virtualNetwork.toURL(instances[0].id!).href, token }],
        'only a retained token is advertised',
      );
      for (let [i, instance] of instances.entries()) {
        assert.strictEqual(instance.publicationState, 'ready');
        assert.strictEqual(cardStore.getCard(instance.id!), instance);
        assert.strictEqual(
          (instance as any).boom,
          i === 0 ? 'published' : 'new publication',
        );
      }
    } finally {
      delete (network as any).authedFetch;
      cardService.fetchJSON = fetchJSON;
      messages.relayRealmEvent = relay;
    }
  });

  test('Lattice Store batches repair only lost retained bodies once without Have', async function (assert) {
    await storeService.ensureSetupComplete();
    let messages = getService('message-service');
    let relay = messages.relayRealmEvent.bind(messages);
    messages.relayRealmEvent = () => {};
    messages.latticeConnectionChanged(false);
    let documents = [0, 1].map((i) =>
      publicationDocument(`Person/batch-repair-${i}`),
    );
    let instances: CardDefType[] = [];
    let token = 'lattice-display-v1:' + 'a'.repeat(64);
    for (let doc of documents) {
      doc.data.meta.publication!.have = token;
      let instance = new PersonDef();
      await api.updateFromSerialized(instance, doc, cardStore, {
        latticePublication: 'display',
      });
      instances.push(instance);
    }
    let network = getService('network');
    let authedFetch = network.authedFetch;
    let requests: LatticeDisplayBatchRequest[] = [];
    Object.defineProperty(network, 'authedFetch', {
      configurable: true,
      value: async (url: string | URL, init?: RequestInit) => {
        if (!String(url).endsWith('/_lattice-read'))
          return authedFetch(url, init);
        let request = JSON.parse(
          String(init?.body),
        ) as LatticeDisplayBatchRequest;
        requests.push(request);
        let first = requests.length === 1;
        if (first) delete instances[0][meta]!.publication!.have;
        let results = request.required.map((url) => {
          let doc = documents.find(
            (item) => network.virtualNetwork.toURL(item.data.id!).href === url,
          )!;
          return {
            url,
            publication: first
              ? {
                  lattice: {
                    version: 1,
                    reuse: true,
                    token,
                    id: doc.data.id,
                    state: 'ready',
                  },
                }
              : doc,
          };
        });
        return new Response(JSON.stringify({ ...request, results }), {
          headers: {
            'Content-Type': SupportedMimeType.CardJson,
            'x-boxel-realm-url': testRealmURL,
          },
        });
      },
    });
    try {
      messages.latticeConnectionChanged(true);
      await settled();
      assert.strictEqual(requests.length, 2, 'one full repair exchange');
      assert.deepEqual(
        requests[1]?.required,
        [network.virtualNetwork.toURL(instances[0].id!).href],
        'repair contains only the actual reuse miss',
      );
      assert.deepEqual(
        requests[1]?.have,
        [],
        'repair cannot ask to reuse the lost body',
      );
      for (let instance of instances) {
        assert.strictEqual(instance.publicationState, 'ready');
        assert.strictEqual(cardStore.getCard(instance.id!), instance);
        assert.strictEqual((instance as any).boom, 'published');
      }
    } finally {
      delete (network as any).authedFetch;
      messages.relayRealmEvent = relay;
    }
  });

  test('Lattice Store batches fall back only for the identity with an unavailable artifact', async function (assert) {
    await storeService.ensureSetupComplete();
    let messages = getService('message-service');
    let relay = messages.relayRealmEvent.bind(messages);
    messages.relayRealmEvent = () => {};
    messages.latticeConnectionChanged(false);
    let documents = [0, 1].map((i) =>
      publicationDocument(`Person/batch-unavailable-${i}`),
    );
    let instances: CardDefType[] = [];
    for (let doc of documents) {
      let instance = new PersonDef();
      await api.updateFromSerialized(instance, doc, cardStore, {
        latticePublication: 'display',
      });
      instances.push(instance);
    }
    let network = getService('network');
    let authedFetch = network.authedFetch;
    let cardService = getService('card-service');
    let fetchJSON = cardService.fetchJSON.bind(cardService);
    let fallback: Array<{ id: string; have: string | null }> = [];
    cardService.fetchJSON = async (...args) => {
      let doc = documents.find((item) => item.data.id === String(args[0]));
      if (!doc) return fetchJSON(...args);
      fallback.push({
        id: String(args[0]),
        have: new Headers(args[1]?.headers).get(LATTICE_DISPLAY_HAVE_HEADER),
      });
      return structuredClone(doc);
    };
    Object.defineProperty(network, 'authedFetch', {
      configurable: true,
      value: async (url: string | URL, init?: RequestInit) => {
        if (!String(url).endsWith('/_lattice-read'))
          return authedFetch(url, init);
        let request = JSON.parse(
          String(init?.body),
        ) as LatticeDisplayBatchRequest;
        return new Response(
          JSON.stringify({
            ...request,
            results: request.required.map((url, i) =>
              i === 0
                ? {
                    url,
                    error: { status: 409, message: 'publication unavailable' },
                  }
                : { url, publication: documents[1] },
            ),
          }),
          {
            headers: {
              'Content-Type': SupportedMimeType.CardJson,
              'x-boxel-realm-url': testRealmURL,
            },
          },
        );
      },
    });
    try {
      messages.latticeConnectionChanged(true);
      await settled();
      assert.deepEqual(
        fallback,
        [{ id: instances[0].id!, have: null }],
        'only the unavailable identity takes the ordinary read, without Have',
      );
      for (let instance of instances) {
        assert.strictEqual(cardStore.getCard(instance.id!), instance);
        assert.strictEqual(instance.publicationState, 'ready');
        assert.strictEqual((instance as any).boom, 'published');
      }
    } finally {
      delete (network as any).authedFetch;
      cardService.fetchJSON = fetchJSON;
      messages.relayRealmEvent = relay;
    }
  });

  for (let scenario of [
    'named notice',
    'duplicate and out-of-order notices',
    'full notice',
    'quiet publication',
    'unrelated notice',
    'ordinary card',
    'render-store publication',
  ]) {
    test(`Lattice first GET reconciles ${scenario}`, async function (assert) {
      let readingStore =
        scenario === 'render-store publication'
          ? getService('render-store')
          : storeService;
      await readingStore.ensureSetupComplete();
      let messages = getService('message-service');
      let relay = messages.relayRealmEvent;
      messages.relayRealmEvent = () => {};
      messages.latticeConnectionChanged(true);
      let path = 'Person/first-publication';
      let url = `${testRealmURL}${path}`;
      let original = publicationDocument(path);
      original.data.attributes = { name: 'Before', boom: 'old output' };
      let current = structuredClone(original);
      current.data.attributes = { name: 'After', boom: 'current output' };
      current.data.meta.publication!.validatedThrough = 3;
      current.data.meta.publication!.outputRevision = 3;
      if (scenario === 'ordinary card') delete original.data.meta.publication;
      let first = new Deferred<SingleCardDocument>();
      let entered = new Deferred<void>();
      let reads = 0;
      let restoreBatchTransport = batchExistingDisplayFixtures();
      let cardService = getService('card-service');
      let fetchJSON = cardService.fetchJSON.bind(cardService);
      cardService.fetchJSON = async (...args) => {
        if (![url, original.data.id].includes(String(args[0])))
          return fetchJSON(...args);
        reads++;
        if (reads === 1) {
          entered.fulfill();
          return first.promise;
        }
        return structuredClone(current);
      };
      let deliver = (event: RealmEventContent) =>
        (readingStore as any).handleInvalidations(event);
      let notice = (generation: number, invalidation = url) =>
        deliver({
          eventName: 'index',
          indexType: 'incremental',
          realmURL: testRealmURL,
          generation,
          invalidations: [invalidation],
        });
      try {
        let reading = readingStore.get(url);
        await entered.promise;
        assert.strictEqual(
          readingStore.peek(url),
          undefined,
          'not yet resident',
        );
        if (scenario === 'full notice') {
          deliver({
            eventName: 'index',
            indexType: 'full',
            realmURL: testRealmURL,
          });
        } else if (scenario === 'duplicate and out-of-order notices') {
          notice(3);
          notice(2, `${url}.json`);
          notice(3, original.data.id!);
          notice(3);
        } else if (scenario === 'unrelated notice') {
          notice(3, `${testRealmURL}Person/other`);
        } else if (scenario !== 'quiet publication') {
          notice(3);
        }
        assert.strictEqual(
          reads,
          1,
          'no competing read during the initial GET',
        );
        first.fulfill(original);
        let instance = await reading;
        if (!isCardInstance(instance))
          throw new Error('The first GET did not admit a card');
        await settled();
        let shouldRepair = [
          'named notice',
          'duplicate and out-of-order notices',
          'full notice',
        ].includes(scenario);
        assert.strictEqual(
          reads,
          shouldRepair ? 2 : 1,
          'one current read for affected publications; no speculative read',
        );
        assert.strictEqual(
          readingStore.peek(url),
          instance,
          'same initial identity',
        );
        assert.strictEqual(
          (instance as any).name,
          shouldRepair ? 'After' : 'Before',
        );
        if (scenario !== 'ordinary card') {
          assert.strictEqual(
            (instance as any).boom,
            shouldRepair ? 'current output' : 'old output',
            'complete server computed output is applied',
          );
          assert.strictEqual(instance.publicationState, 'ready');
        } else {
          assert.false(api.hasLatticeSnapshot(instance));
        }
      } finally {
        first.fulfill(original);
        await settled();
        cardService.fetchJSON = fetchJSON;
        restoreBatchTransport();
        messages.relayRealmEvent = relay;
      }
    });
  }

  for (let scenario of [
    'search admission',
    'included child',
    'reconnect',
    'offline',
    'resetCache',
    'resetState',
    'quiet admission',
    'ordinary admission',
  ] as const) {
    test(`Lattice hydration retains ${scenario}`, async function (assert) {
      await storeService.ensureSetupComplete();
      let messages = getService('message-service');
      let relay = messages.relayRealmEvent;
      messages.relayRealmEvent = () => {};
      messages.latticeConnectionChanged(true);
      let doc = publicationDocument('Person/hydrating');
      let child = publicationDocument('Person/hydrating-child');
      if (scenario === 'included child') {
        doc.data.relationships = {
          bestFriend: {
            links: { self: child.data.id! },
            data: { type: 'card', id: child.data.id! },
          },
        };
        doc.included = [child.data];
      }
      if (scenario === 'ordinary admission') delete doc.data.meta.publication;
      let target = scenario === 'included child' ? child : doc;
      let latest = structuredClone(target);
      latest.data.attributes = { name: 'Current', boom: 'current output' };
      if (latest.data.meta.publication) {
        latest.data.meta.publication.validatedThrough = 3;
        latest.data.meta.publication.outputRevision = 3;
      }
      let cardService = getService('card-service');
      let getAPI = cardService.getAPI.bind(cardService);
      let fetchJSON = cardService.fetchJSON.bind(cardService);
      let entered = new Deferred<void>();
      let release = new Deferred<void>();
      let hold = true;
      let reads: string[] = [];
      let restoreBatchTransport = batchExistingDisplayFixtures();
      cardService.getAPI = async () => {
        if (hold) {
          hold = false;
          entered.fulfill();
          await release.promise;
        }
        return getAPI();
      };
      cardService.fetchJSON = async (...args) => {
        if (String(args[0]) !== target.data.id) return fetchJSON(...args);
        reads.push(String(args[0]));
        return structuredClone(latest);
      };
      let deliver = (event: RealmEventContent) =>
        (storeService as any).handleInvalidations(event);
      try {
        let reading: Promise<CardDefType> =
          scenario === 'search admission'
            ? (storeService as any).addResourceFromSearchData(doc.data)
            : storeService.add(doc, {
                doNotPersist: true,
                relativeTo: doc.data.id,
                latticeUseSnapshot: true,
              });
        // Observe both outcomes immediately; a cancelled read is an expected
        // result of replacing the Store, not an unhandled promise rejection.
        let outcome = reading.then(
          (value) => ({ value, error: undefined }),
          (error: Error) => ({ value: undefined, error }),
        );
        await entered.promise;
        if (scenario === 'resetCache' || scenario === 'resetState') {
          storeService[scenario]();
        } else if (scenario === 'reconnect' || scenario === 'offline') {
          messages.latticeConnectionChanged(false);
          if (scenario === 'reconnect') messages.latticeConnectionChanged(true);
        } else if (scenario !== 'quiet admission') {
          if (scenario !== 'included child') {
            deliver({
              eventName: 'update',
              realmURL: testRealmURL,
            } as RealmEventContent);
          }
          deliver({
            eventName: 'index',
            indexType: 'incremental',
            realmURL: testRealmURL,
            invalidations: [target.data.id!],
            generation: 3,
          });
        }
        assert.deepEqual(reads, [], 'no refresh before assembly is admitted');
        release.fulfill();
        let { value, error } = await outcome;
        await settled();
        if (scenario === 'resetCache' || scenario === 'resetState') {
          assert.strictEqual(
            error?.name,
            'AbortError',
            'obsolete admission is cancelled',
          );
          assert.strictEqual(storeService.peek(doc.data.id!), undefined);
          assert.strictEqual(storeService.peekError(doc.data.id!), undefined);
          assert.deepEqual(
            reads,
            [],
            'reset does not trigger an obsolete repair',
          );
        } else {
          if (!value || error) throw error ?? new Error('No hydrated card');
          let instance =
            scenario === 'included child'
              ? cardStore.getCard(child.data.id!)!
              : value;
          if (scenario === 'offline') {
            assert.strictEqual(instance.publicationState, 'pending');
            assert.deepEqual(
              reads,
              [],
              'offline admission waits for connectivity',
            );
            messages.latticeConnectionChanged(true);
            await settled();
          }
          let repairs = !['quiet admission', 'ordinary admission'].includes(
            scenario,
          );
          assert.deepEqual(reads, repairs ? [target.data.id!] : []);
          assert.strictEqual(
            (instance as any).name,
            repairs ? 'Current' : target.data.attributes!.name,
          );
          assert.strictEqual(
            cardStore.getCard(doc.data.id!),
            value,
            'root identity stays stable',
          );
          if (scenario !== 'ordinary admission') {
            assert.strictEqual(instance.publicationState, 'ready');
            assert.strictEqual(
              (instance as any).boom,
              repairs ? 'current output' : 'published',
            );
          }
          if (scenario === 'included child') {
            assert.strictEqual(
              (value as any).bestFriend,
              instance,
              'the existing link keeps the refreshed child',
            );
            assert.strictEqual(
              (value as any).name,
              doc.data.attributes!.name,
              'the root was not refetched',
            );
          }
        }
      } finally {
        release.fulfill();
        await settled();
        cardService.getAPI = getAPI;
        cardService.fetchJSON = fetchJSON;
        restoreBatchTransport();
        messages.relayRealmEvent = relay;
      }
    });
  }

  for (let reset of [false, true]) {
    test(`Lattice hydration fences partial field assembly${reset ? ' across reset' : ''}`, async function (assert) {
      await storeService.ensureSetupComplete();
      let messages = getService('message-service');
      let relay = messages.relayRealmEvent;
      messages.relayRealmEvent = () => {};
      messages.latticeConnectionChanged(true);
      let doc = publicationDocument('Person/field-assembly');
      let latest = structuredClone(doc);
      latest.data.attributes = { name: 'Current', boom: 'current output' };
      latest.data.meta.publication!.validatedThrough = 3;
      latest.data.meta.publication!.outputRevision = 3;
      let { Person } = await loader.import<{ Person: typeof CardDefType }>(
        testRRI('person'),
      );
      let field = api.getFields(Person).name!;
      let deserialize = field.deserialize;
      let entered = new Deferred<void>();
      let release = new Deferred<void>();
      field.deserialize = async (...args) => {
        if (args[0] === doc.data.attributes!.name) {
          entered.fulfill();
          await release.promise;
        }
        return deserialize.apply(field, args);
      };
      let cardService = getService('card-service');
      let fetchJSON = cardService.fetchJSON.bind(cardService);
      let reads = 0;
      let restoreBatchTransport = batchExistingDisplayFixtures();
      cardService.fetchJSON = async (...args) => {
        if (String(args[0]) !== doc.data.id) return fetchJSON(...args);
        reads++;
        return structuredClone(latest);
      };
      try {
        let outcome = storeService
          .add(doc, {
            doNotPersist: true,
            latticeUseSnapshot: true,
            relativeTo: doc.data.id,
          })
          .then(
            (value) => ({ value, error: undefined }),
            (error: Error) => ({ value: undefined, error }),
          );
        await entered.promise;
        let partial = cardStore.getCard(doc.data.id!);
        assert.true(
          isCardInstance(partial),
          'the identity exists before all fields finish',
        );
        assert.false(
          api.hasLatticeSnapshot(partial!),
          'the partial instance is not an admitted snapshot',
        );
        if (reset) storeService.resetCache();
        else
          (storeService as any).handleInvalidations({
            eventName: 'index',
            indexType: 'incremental',
            realmURL: testRealmURL,
            invalidations: [doc.data.id!],
            generation: 3,
          });
        // Let any incorrect eager reload actually reach the transport.
        await Promise.resolve();
        await Promise.resolve();
        assert.strictEqual(reads, 0, 'no competing read of a partial instance');
        release.fulfill();
        let { value, error } = await outcome;
        await settled();
        if (reset) {
          assert.strictEqual(error?.name, 'AbortError');
          assert.strictEqual(storeService.peek(doc.data.id!), undefined);
          assert.strictEqual(storeService.peekError(doc.data.id!), undefined);
          assert.strictEqual(reads, 0);
        } else {
          if (!value || error) throw error ?? new Error('No hydrated card');
          assert.strictEqual(reads, 1);
          assert.strictEqual(value, partial, 'the first identity survives');
          assert.strictEqual((value as any).boom, 'current output');
          assert.strictEqual(value.publicationState, 'ready');
        }
      } finally {
        release.fulfill();
        await settled();
        field.deserialize = deserialize;
        cardService.fetchJSON = fetchJSON;
        restoreBatchTransport();
        messages.relayRealmEvent = relay;
      }
    });
  }

  for (let scenario of [
    'reconnect',
    'resetCache',
    'resetState',
    'notices across both waits',
    'reconnect after admission',
  ] as const) {
    test(`Lattice hydration fences first GET ${scenario}`, async function (assert) {
      await storeService.ensureSetupComplete();
      let messages = getService('message-service');
      let relay = messages.relayRealmEvent;
      messages.relayRealmEvent = () => {};
      messages.latticeConnectionChanged(true);
      let doc = publicationDocument('Person/request-assembly');
      let latest = structuredClone(doc);
      latest.data.attributes = { name: 'Current', boom: 'current output' };
      latest.data.meta.publication!.validatedThrough = 3;
      latest.data.meta.publication!.outputRevision = 3;
      let entered = new Deferred<void>();
      let release = new Deferred<void>();
      let apiEntered = new Deferred<void>();
      let releaseAPI = new Deferred<void>();
      let cardService = getService('card-service');
      let fetchJSON = cardService.fetchJSON.bind(cardService);
      let getAPI = cardService.getAPI.bind(cardService);
      let reads = 0;
      let holdAPI =
        scenario === 'notices across both waits' ||
        scenario === 'reconnect after admission';
      let apiCalls = 0;
      let restoreBatchTransport = batchExistingDisplayFixtures();
      cardService.fetchJSON = async (...args) => {
        if (String(args[0]) !== doc.data.id) return fetchJSON(...args);
        reads++;
        if (reads === 1) {
          entered.fulfill();
          await release.promise;
          return structuredClone(doc);
        }
        return structuredClone(latest);
      };
      cardService.getAPI = async () => {
        if (
          holdAPI &&
          ++apiCalls === (scenario === 'reconnect after admission' ? 2 : 1)
        ) {
          holdAPI = false;
          apiEntered.fulfill();
          await releaseAPI.promise;
        }
        return getAPI();
      };
      let notice = () =>
        (storeService as any).handleInvalidations({
          eventName: 'index',
          indexType: 'incremental',
          realmURL: testRealmURL,
          invalidations: [doc.data.id!],
          generation: 3,
        });
      try {
        let reading = storeService.get(doc.data.id!);
        let coalesced = storeService.get(doc.data.id!);
        let outcomes = Promise.allSettled([reading, coalesced]);
        await entered.promise;
        if (scenario === 'resetCache' || scenario === 'resetState')
          storeService[scenario]();
        else if (scenario === 'reconnect') {
          messages.latticeConnectionChanged(false);
          messages.latticeConnectionChanged(true);
        } else if (scenario === 'notices across both waits') notice();
        release.fulfill();
        if (
          scenario === 'notices across both waits' ||
          scenario === 'reconnect after admission'
        ) {
          await apiEntered.promise;
          if (scenario === 'reconnect after admission') {
            messages.latticeConnectionChanged(false);
            messages.latticeConnectionChanged(true);
          } else notice();
          releaseAPI.fulfill();
        }
        let results = await outcomes;
        await settled();
        if (scenario === 'resetCache' || scenario === 'resetState') {
          assert.true(
            results.every(
              (result) =>
                result.status === 'rejected' &&
                result.reason.name === 'AbortError',
            ),
          );
          assert.strictEqual(storeService.peek(doc.data.id!), undefined);
          assert.strictEqual(storeService.peekError(doc.data.id!), undefined);
          assert.strictEqual(
            reads,
            1,
            'obsolete GET does not repopulate or retry',
          );
          let fresh = await storeService.get(doc.data.id!);
          assert.strictEqual(
            (fresh as any).boom,
            'current output',
            'a new request uses the new Store',
          );
          assert.strictEqual(reads, 2);
        } else {
          assert.true(results.every((result) => result.status === 'fulfilled'));
          assert.strictEqual(
            reads,
            2,
            'one current read covers all earlier notices',
          );
          let instance = storeService.peek(doc.data.id!);
          assert.strictEqual((instance as any).boom, 'current output');
          for (let result of results) {
            if (result.status === 'fulfilled')
              assert.strictEqual(result.value, instance);
          }
        }
      } finally {
        release.fulfill();
        releaseAPI.fulfill();
        await settled();
        cardService.fetchJSON = fetchJSON;
        cardService.getAPI = getAPI;
        restoreBatchTransport();
        messages.relayRealmEvent = relay;
      }
    });
  }

  for (let scenario of [
    'notice before root GET',
    'notice during ordinary parent admission',
    'quiet ordinary parent',
    'older notice',
    'already current input',
    'unrelated identity',
    'different realm',
    'pending equal generation',
    'overflow with lost child',
    'overflow with uncertain child',
  ] as const) {
    test(`Lattice unknown child repairs ${scenario}`, async function (assert) {
      await storeService.ensureSetupComplete();
      let messages = getService('message-service');
      let relay = messages.relayRealmEvent;
      messages.relayRealmEvent = () => {};
      messages.latticeConnectionChanged(true);
      let parent = publicationDocument('Person/unknown-parent');
      let child = publicationDocument('Person/unknown-child');
      if (scenario !== 'notice before root GET')
        delete parent.data.meta.publication;
      if (scenario === 'already current input')
        child.data.meta.publication!.validatedThrough = 3;
      if (scenario === 'pending equal generation') {
        child.data.meta.publication!.validatedThrough = 3;
        child.data.meta.publication!.state = 'pending';
      }
      parent.data.relationships = {
        bestFriend: {
          links: { self: child.data.id! },
          data: { type: 'card', id: child.data.id! },
        },
      };
      parent.included = [child.data];
      let current = structuredClone(child);
      current.data.attributes = {
        name: 'Current child',
        boom: 'current child output',
      };
      current.data.meta.publication!.state = 'ready';
      current.data.meta.publication!.validatedThrough = 3;
      current.data.meta.publication!.outputRevision = 3;
      if (scenario === 'overflow with uncertain child')
        current = structuredClone(child);
      let entered = new Deferred<void>();
      let release = new Deferred<void>();
      let cardService = getService('card-service');
      let getAPI = cardService.getAPI.bind(cardService);
      let fetchJSON = cardService.fetchJSON.bind(cardService);
      let holdAPI = scenario !== 'notice before root GET';
      let repairs: string[] = [];
      let restoreBatchTransport = batchExistingDisplayFixtures();
      cardService.getAPI = async () => {
        if (holdAPI) {
          holdAPI = false;
          entered.fulfill();
          await release.promise;
        }
        return getAPI();
      };
      cardService.fetchJSON = async (...args) => {
        if (String(args[0]) === parent.data.id) {
          entered.fulfill();
          await release.promise;
          return structuredClone(parent);
        }
        if (String(args[0]) !== child.data.id) return fetchJSON(...args);
        repairs.push(String(args[0]));
        return structuredClone(current);
      };
      try {
        let reading =
          scenario === 'notice before root GET'
            ? storeService.get(parent.data.id!)
            : storeService.add(parent, {
                doNotPersist: true,
                latticeUseSnapshot: true,
                relativeTo: parent.data.id,
              });
        await entered.promise;
        if (scenario.startsWith('overflow')) {
          let target =
            scenario === 'overflow with lost child'
              ? child.data.id!
              : `${testRealmURL}Unrelated/first`;
          (storeService as any).handleInvalidations({
            eventName: 'index',
            indexType: 'incremental',
            realmURL: testRealmURL,
            invalidations: [target],
            generation: 3,
            publicationId: 'synthetic-first',
          });
          for (let i = 0; i < LATTICE_NOTICE_IDENTITY_LIMIT; i++) {
            (storeService as any).handleInvalidations({
              eventName: 'index',
              indexType: 'incremental',
              realmURL: testRealmURL,
              invalidations: [`${testRealmURL}Unrelated/${i}`],
              generation: i + 4,
              publicationId: `synthetic-overflow-${i}`,
            });
          }
        } else if (scenario !== 'quiet ordinary parent') {
          (storeService as any).handleInvalidations({
            eventName: 'index',
            indexType: 'incremental',
            realmURL:
              scenario === 'different realm'
                ? `${testRealmURL}nested/`
                : testRealmURL,
            invalidations: [
              scenario === 'unrelated identity'
                ? `${testRealmURL}Person/other`
                : scenario === 'different realm'
                  ? `${testRealmURL}nested/Person/other`
                  : `${child.data.id}.json`,
            ],
            generation: scenario === 'older notice' ? 1 : 3,
            publicationId: 'synthetic-child-publication-3',
          });
        }
        assert.deepEqual(
          repairs,
          [],
          'no speculative child read before admission',
        );
        release.fulfill();
        let instance = await reading;
        if (!isCardInstance(instance)) throw new Error('Expected parent card');
        let admittedChild = (instance as any).bestFriend as CardDefType;
        await settled();
        let shouldRepair = [
          'notice before root GET',
          'notice during ordinary parent admission',
          'pending equal generation',
          'overflow with lost child',
          'overflow with uncertain child',
        ].includes(scenario);
        assert.deepEqual(
          repairs,
          shouldRepair ? [child.data.id!] : [],
          'only a missed publication needs a repair',
        );
        assert.strictEqual(
          cardStore.getCard(parent.data.id!),
          instance,
          'parent identity stays',
        );
        assert.strictEqual(
          cardStore.getCard(child.data.id!),
          admittedChild,
          'child identity stays',
        );
        assert.strictEqual(
          (instance as any).bestFriend,
          admittedChild,
          'the existing link stays',
        );
        assert.strictEqual(
          (instance as any).name,
          parent.data.attributes!.name,
        );
        assert.strictEqual(
          (admittedChild as any).boom,
          shouldRepair && scenario !== 'overflow with uncertain child'
            ? 'current child output'
            : 'published',
        );
        assert.strictEqual(admittedChild.publicationState, 'ready');
        if (scenario !== 'notice before root GET')
          assert.false(
            api.hasLatticeSnapshot(instance),
            'the ordinary parent stays ordinary',
          );
      } finally {
        release.fulfill();
        await settled();
        cardService.getAPI = getAPI;
        cardService.fetchJSON = fetchJSON;
        restoreBatchTransport();
        messages.relayRealmEvent = relay;
      }
    });
  }

  for (let boundary of ['GET', 'API'] as const) {
    test(`Lattice unknown child cancels an ordinary parent across reset during ${boundary}`, async function (assert) {
      await storeService.ensureSetupComplete();
      let messages = getService('message-service');
      let relay = messages.relayRealmEvent;
      messages.relayRealmEvent = () => {};
      messages.latticeConnectionChanged(true);
      let parent = publicationDocument('Person/reset-parent');
      delete parent.data.meta.publication;
      let child = publicationDocument('Person/reset-child');
      parent.data.relationships = {
        bestFriend: {
          links: { self: child.data.id! },
          data: { type: 'card', id: child.data.id! },
        },
      };
      parent.included = [child.data];
      let entered = new Deferred<void>();
      let release = new Deferred<void>();
      let holdAPI = boundary === 'API';
      let cardService = getService('card-service');
      let getAPI = cardService.getAPI.bind(cardService);
      let fetchJSON = cardService.fetchJSON.bind(cardService);
      let repairs = 0;
      let restoreBatchTransport = batchExistingDisplayFixtures();
      cardService.getAPI = async () => {
        if (holdAPI) {
          holdAPI = false;
          entered.fulfill();
          await release.promise;
        }
        return getAPI();
      };
      cardService.fetchJSON = async (...args) => {
        if (String(args[0]) === parent.data.id) {
          entered.fulfill();
          await release.promise;
          return structuredClone(parent);
        }
        if (String(args[0]) === child.data.id) {
          repairs++;
          return structuredClone(child);
        }
        return fetchJSON(...args);
      };
      try {
        let reading =
          boundary === 'GET'
            ? storeService.get(parent.data.id!)
            : storeService.add(parent, {
                doNotPersist: true,
                latticeUseSnapshot: true,
                relativeTo: parent.data.id,
              });
        let outcome = Promise.allSettled([reading]);
        await entered.promise;
        (storeService as any).handleInvalidations({
          eventName: 'index',
          indexType: 'incremental',
          realmURL: testRealmURL,
          invalidations: [child.data.id!],
          generation: 3,
          publicationId: 'synthetic-before-reset',
        });
        storeService.resetCache();
        release.fulfill();
        let [result] = await outcome;
        await settled();
        assert.strictEqual(result.status, 'rejected');
        if (result.status === 'rejected') {
          assert.strictEqual(result.reason.name, 'AbortError');
        }
        for (let id of [parent.data.id!, child.data.id!]) {
          assert.strictEqual(
            storeService.peek(id),
            undefined,
            'neither old identity enters the new Store',
          );
          assert.strictEqual(storeService.peekError(id), undefined);
        }
        assert.strictEqual(repairs, 0);
        // A new read is allowed to admit the serving realm's current body.
        // Prior-session notice evidence must not independently trigger repair.
        child.data.attributes!.boom = 'new session output';
        child.data.meta.publication!.validatedThrough = 3;
        child.data.meta.publication!.outputRevision = 3;
        let fresh = await storeService.get(parent.data.id!);
        assert.strictEqual(
          (fresh as any).bestFriend.boom,
          'new session output',
        );
        await settled();
        assert.strictEqual(repairs, 0);
      } finally {
        release.fulfill();
        await settled();
        cardService.getAPI = getAPI;
        cardService.fetchJSON = fetchJSON;
        restoreBatchTransport();
        messages.relayRealmEvent = relay;
      }
    });
  }

  for (let scenario of [
    'ordinary GET',
    'published GET',
    'ordinary API',
    'quiet ordinary API',
  ] as const) {
    test(`Lattice convergence repairs undiscovered child after ${scenario}`, async function (assert) {
      await storeService.ensureSetupComplete();
      let messages = getService('message-service');
      let relay = messages.relayRealmEvent;
      messages.relayRealmEvent = () => {};
      messages.latticeConnectionChanged(true);
      let parent = publicationDocument('Person/reconnect-parent');
      if (scenario !== 'published GET') delete parent.data.meta.publication;
      let child = publicationDocument('Person/reconnect-child');
      parent.data.relationships = {
        bestFriend: {
          links: { self: child.data.id! },
          data: { type: 'card', id: child.data.id! },
        },
      };
      parent.included = [child.data];
      let latest = structuredClone(child);
      latest.data.attributes = {
        name: 'Current child',
        boom: 'missed publication',
      };
      latest.data.meta.publication!.validatedThrough = 3;
      latest.data.meta.publication!.outputRevision = 3;
      let entered = new Deferred<void>();
      let release = new Deferred<void>();
      let holdAPI = scenario.endsWith('API');
      let cardService = getService('card-service');
      let getAPI = cardService.getAPI.bind(cardService);
      let fetchJSON = cardService.fetchJSON.bind(cardService);
      let reads: string[] = [];
      let restoreBatchTransport = batchExistingDisplayFixtures();
      cardService.getAPI = async () => {
        if (holdAPI) {
          holdAPI = false;
          entered.fulfill();
          await release.promise;
        }
        return getAPI();
      };
      cardService.fetchJSON = async (...args) => {
        if (String(args[0]) === parent.data.id) {
          reads.push(parent.data.id!);
          entered.fulfill();
          await release.promise;
          return structuredClone(parent);
        }
        if (String(args[0]) === child.data.id) {
          reads.push(child.data.id!);
          return structuredClone(latest);
        }
        return fetchJSON(...args);
      };
      try {
        let reading = scenario.endsWith('GET')
          ? storeService.get(parent.data.id!)
          : storeService.add(parent, {
              doNotPersist: true,
              latticeUseSnapshot: true,
              relativeTo: parent.data.id,
            });
        await entered.promise;
        if (scenario !== 'quiet ordinary API') {
          messages.latticeConnectionChanged(false);
          // The serving realm published while disconnected. There is no
          // notice to replay and the response was captured before that write.
          messages.latticeConnectionChanged(true);
        }
        assert.false(
          reads.includes(child.data.id!),
          'no speculative child read',
        );
        release.fulfill();
        let instance = await reading;
        await settled();
        let admitted = cardStore.getCard(child.data.id!)!;
        assert.strictEqual((instance as any).bestFriend, admitted);
        assert.strictEqual(cardStore.getCard(parent.data.id!), instance);
        assert.strictEqual(admitted.publicationState, 'ready');
        assert.strictEqual(
          (admitted as any).boom,
          scenario === 'quiet ordinary API'
            ? 'published'
            : 'missed publication',
          'complete current child output survives missed delivery',
        );
        assert.strictEqual(
          reads.filter((id) => id === child.data.id).length,
          scenario === 'quiet ordinary API' ? 0 : 1,
          'only the missed child needs one confirming read',
        );
        if (scenario !== 'published GET') {
          assert.false(api.hasLatticeSnapshot(instance as CardDefType));
          assert.strictEqual(
            reads.filter((id) => id === parent.data.id).length,
            scenario.endsWith('GET') ? 1 : 0,
            'ordinary parent is never refreshed',
          );
        }
      } finally {
        release.fulfill();
        await settled();
        cardService.getAPI = getAPI;
        cardService.fetchJSON = fetchJSON;
        restoreBatchTransport();
        messages.relayRealmEvent = relay;
      }
    });
  }

  for (let childAdmitted of [false, true]) {
    test(`Lattice convergence reconnects while child is ${childAdmitted ? 'admitted' : 'partially assembled'}`, async function (assert) {
      await storeService.ensureSetupComplete();
      let messages = getService('message-service');
      let relay = messages.relayRealmEvent;
      messages.relayRealmEvent = () => {};
      messages.latticeConnectionChanged(true);
      let parent = publicationDocument('Person/reconnect-field-parent');
      delete parent.data.meta.publication;
      let child = publicationDocument('Person/reconnect-field-child');
      parent.data.relationships = {
        bestFriend: {
          links: { self: child.data.id! },
          data: { type: 'card', id: child.data.id! },
        },
      };
      parent.included = [child.data];
      let latest = structuredClone(child);
      latest.data.attributes = {
        name: 'Current child',
        boom: 'current field value',
      };
      latest.data.meta.publication!.validatedThrough = 3;
      latest.data.meta.publication!.outputRevision = 3;
      let { Person } = await loader.import<{ Person: typeof CardDefType }>(
        testRRI('person'),
      );
      let field = api.getFields(Person).name!;
      let deserialize = field.deserialize;
      let entered = new Deferred<void>();
      let release = new Deferred<void>();
      let heldName = (childAdmitted ? parent : child).data.attributes!.name;
      field.deserialize = async (...args) => {
        if (args[0] === heldName) {
          entered.fulfill();
          await release.promise;
        }
        return deserialize.apply(field, args);
      };
      let cardService = getService('card-service');
      let fetchJSON = cardService.fetchJSON.bind(cardService);
      let reads = 0;
      let restoreBatchTransport = batchExistingDisplayFixtures();
      cardService.fetchJSON = async (...args) => {
        if (String(args[0]) !== child.data.id) return fetchJSON(...args);
        reads++;
        return structuredClone(latest);
      };
      try {
        let reading = storeService.add(parent, {
          doNotPersist: true,
          latticeUseSnapshot: true,
          relativeTo: parent.data.id,
        });
        await entered.promise;
        if (childAdmitted) {
          await waitUntil(() => {
            let instance = cardStore.getCard(child.data.id!);
            return !!instance && api.hasLatticeSnapshot(instance);
          });
        }
        messages.latticeConnectionChanged(false);
        messages.latticeConnectionChanged(true);
        if (childAdmitted) {
          await waitUntil(
            () =>
              (cardStore.getCard(child.data.id!) as any).boom ===
              'current field value',
          );
          assert.strictEqual(
            reads,
            1,
            'resident child can recover while the ordinary parent is assembling',
          );
        } else {
          assert.strictEqual(reads, 0, 'never refresh a partial child');
        }
        release.fulfill();
        let instance = await reading;
        await settled();
        let admitted = cardStore.getCard(child.data.id!)!;
        assert.strictEqual((instance as any).bestFriend, admitted);
        assert.strictEqual((admitted as any).boom, 'current field value');
        assert.strictEqual(admitted.publicationState, 'ready');
        assert.strictEqual(
          reads,
          1,
          'completed parent assembly does not repeat a repair',
        );
        assert.false(api.hasLatticeSnapshot(instance));
      } finally {
        release.fulfill();
        await settled();
        field.deserialize = deserialize;
        cardService.fetchJSON = fetchJSON;
        restoreBatchTransport();
        messages.relayRealmEvent = relay;
      }
    });
  }

  for (let failure of [false, true]) {
    test(`Lattice convergence reconnects after ${failure ? 'failed' : 'missed'} delivery and orders notices`, async function (assert) {
      await storeService.ensureSetupComplete();
      let messages = getService('message-service');
      let relay = messages.relayRealmEvent;
      messages.relayRealmEvent = () => {};
      messages.latticeConnectionChanged(true);
      let doc = publicationDocument('Person/converging');
      let instance = await storeService.add(doc, {
        doNotPersist: true,
        latticeUseSnapshot: true,
      });
      let current = structuredClone(doc);
      current.data.attributes = {
        name: 'Confirmed',
        boom: 'complete current value',
      };
      current.data.meta.publication!.validatedThrough = 3;
      current.data.meta.publication!.outputRevision = 3;
      let cardService = getService('card-service');
      let fetchJSON = cardService.fetchJSON.bind(cardService);
      let reads = 0;
      let fail = failure;
      let held: Deferred<SingleCardDocument> | undefined;
      let restoreBatchTransport = batchExistingDisplayFixtures();
      cardService.fetchJSON = async (...args) => {
        if (String(args[0]) !== instance.id) return fetchJSON(...args);
        reads++;
        if (fail) throw new Error('synthetic temporary transport failure');
        if (held) return held.promise;
        return structuredClone(current);
      };
      let notice = (generation: number) =>
        (storeService as any).handleInvalidations({
          eventName: 'index',
          indexType: 'incremental',
          realmURL: testRealmURL,
          invalidations: [instance.id!],
          generation,
          publicationId: `synthetic-${generation}`,
        });
      try {
        if (failure) {
          notice(3);
          await settled();
          assert.strictEqual(storeService.peek(instance.id!), instance);
          assert.strictEqual(storeService.peekError(instance.id!), undefined);
          assert.strictEqual(instance.publicationState, 'pending');
          assert.strictEqual((instance as any).boom, 'published');
        }
        fail = false;
        messages.latticeConnectionChanged(false);
        messages.latticeConnectionChanged(true);
        await settled();
        assert.strictEqual((instance as any).boom, 'complete current value');
        assert.strictEqual(instance.publicationState, 'ready');
        assert.strictEqual(reads, failure ? 2 : 1);
        // Delay one response, then deliver a newer notice, an older one and
        // a duplicate. The in-flight older body cannot clear pending state.
        held = new Deferred<SingleCardDocument>();
        let readStart = reads;
        notice(4);
        await waitUntil(() => reads === readStart + 1);
        notice(5);
        notice(4);
        notice(5);
        current.data.attributes = {
          name: 'Newest',
          boom: 'newest complete value',
        };
        current.data.meta.publication!.validatedThrough = 5;
        current.data.meta.publication!.outputRevision = 5;
        let oldReply = held;
        held = undefined;
        oldReply.fulfill(structuredClone(doc));
        await settled();
        assert.strictEqual(
          reads,
          readStart + 2,
          'one guarded follow-up covers all notices',
        );
        assert.strictEqual(storeService.peek(instance.id!), instance);
        assert.strictEqual((instance as any).name, 'Newest');
        assert.strictEqual((instance as any).boom, 'newest complete value');
        assert.strictEqual(instance.publicationState, 'ready');
      } finally {
        held?.fulfill(structuredClone(current));
        await settled();
        cardService.fetchJSON = fetchJSON;
        restoreBatchTransport();
        messages.relayRealmEvent = relay;
      }
    });
  }

  test('Lattice reconciliation bounds reconnect and coalesces queued and in-flight notices', async function (assert) {
    await storeService.ensureSetupComplete();
    let messages = getService('message-service');
    let relay = messages.relayRealmEvent.bind(messages);
    messages.relayRealmEvent = () => {};
    messages.latticeConnectionChanged(false);
    let documents = new Map<string, SingleCardDocument>();
    let instances: CardDefType[] = [];
    for (let i = 0; i < 6; i++) {
      let doc = publicationDocument(`Person/reconcile-${i}`);
      let instance = new PersonDef();
      await api.updateFromSerialized(instance, doc, cardStore, {
        latticePublication: 'display',
      });
      documents.set(instance.id!, doc);
      instances.push(instance);
    }
    let restoreBatchTransport = batchExistingDisplayFixtures();
    let cardService = getService('card-service');
    let fetchJSON = cardService.fetchJSON.bind(cardService);
    let reads: Array<{ id: string; result: Deferred<any> }> = [];
    let active = 0;
    let peak = 0;
    let hold = true;
    cardService.fetchJSON = async (...args) => {
      let id = String(args[0]);
      let doc = documents.get(id);
      if (!doc) return fetchJSON(...args);
      let result = new Deferred<any>();
      reads.push({ id, result });
      peak = Math.max(peak, ++active);
      if (!hold) result.fulfill(structuredClone(doc));
      try {
        return await result.promise;
      } finally {
        active--;
      }
    };
    try {
      messages.latticeConnectionChanged(true);
      await waitUntil(() => reads.length >= 4);
      assert.strictEqual(reads.length, 4, 'reconnect admits four reads');
      let started = new Set(reads.map((read) => read.id));
      for (let i = 0; i < 3; i++) {
        (storeService as any).handleInvalidations({
          eventName: 'index',
          indexType: 'incremental',
          invalidations: instances.map((instance) => instance.id!),
          realmURL: testRealmURL,
        });
      }
      assert.strictEqual(active, 4, 'notices do not start parallel reads');
      for (let read of reads.slice(0, 4))
        read.result.fulfill(structuredClone(documents.get(read.id)));
      await waitUntil(() => reads.length > started.size);
      assert.strictEqual(
        instances[0].publicationState,
        'pending',
        'the invalidated first response cannot mark the card current',
      );
      hold = false;
      for (let read of reads) {
        read.result.fulfill(structuredClone(documents.get(read.id)));
      }
      await settled();
      assert.strictEqual(peak, 4, 'all reconciliation respects the bound');
      for (let instance of instances) {
        assert.strictEqual(
          reads.filter((read) => read.id === instance.id).length,
          started.has(instance.id!) ? 2 : 1,
          'active reads get one follow-up; queued notices collapse',
        );
        assert.strictEqual(instance.publicationState, 'ready');
        assert.strictEqual(cardStore.getCard(instance.id!), instance);
        assert.strictEqual((instance as any).boom, 'published');
      }
    } finally {
      hold = false;
      for (let read of reads) {
        read.result.fulfill(structuredClone(documents.get(read.id)));
      }
      await settled();
      cardService.fetchJSON = fetchJSON;
      restoreBatchTransport();
      messages.relayRealmEvent = relay;
    }
  });

  test('Lattice reconciliation releases capacity on failure and skips evicted or locally edited cards', async function (assert) {
    await storeService.ensureSetupComplete();
    let ordinary = await storeService.get(`${testRealmURL}Person/hassan`);
    let messages = getService('message-service');
    let relay = messages.relayRealmEvent.bind(messages);
    messages.relayRealmEvent = () => {};
    messages.latticeConnectionChanged(false);
    let documents = new Map<string, SingleCardDocument>();
    let instances: CardDefType[] = [];
    for (let i = 0; i < 7; i++) {
      let doc = publicationDocument(`Person/reconcile-lifetime-${i}`);
      let instance = new PersonDef();
      await api.updateFromSerialized(instance, doc, cardStore, {
        latticePublication: 'display',
      });
      documents.set(instance.id!, doc);
      instances.push(instance);
    }
    let reads: Array<{ id: string; result: Deferred<any> }> = [];
    let restoreBatchTransport = batchExistingDisplayFixtures();
    let cardService = getService('card-service');
    let fetchJSON = cardService.fetchJSON.bind(cardService);
    let ordinaryReads = 0;
    let hold = true;
    cardService.fetchJSON = async (...args) => {
      let id = String(args[0]);
      if (id === ordinary.id) {
        ordinaryReads++;
        return fetchJSON(...args);
      }
      let doc = documents.get(id);
      if (!doc) return fetchJSON(...args);
      let result = new Deferred<any>();
      reads.push({ id, result });
      if (!hold) result.fulfill(structuredClone(doc));
      return result.promise;
    };
    try {
      messages.latticeConnectionChanged(true);
      await waitUntil(() => reads.length >= 4);
      cardStore.delete(instances[1].id!);
      cardStore.delete(instances[4].id!);
      (instances[5] as any).name = 'keep this local draft';
      await (storeService as any).reloadTask.perform(ordinary);
      assert.strictEqual(
        ordinaryReads,
        1,
        'ordinary reload does not wait for publication capacity',
      );
      let error = Object.assign(new Error('temporary read failure'), {
        status: 503,
      });
      reads[0].result.reject(error);
      for (let read of reads.slice(1, 4))
        read.result.fulfill(structuredClone(documents.get(read.id)));
      await waitUntil(() => reads.some((read) => read.id === instances[6].id));
      hold = false;
      for (let read of reads)
        read.result.fulfill(structuredClone(documents.get(read.id)));
      await settled();
      assert.deepEqual(
        reads.map((read) => read.id),
        [
          instances[0],
          instances[1],
          instances[2],
          instances[3],
          instances[6],
        ].map((instance) => instance.id),
        'failure releases a slot and queued eviction/edit skip their reads',
      );
      assert.strictEqual(
        cardStore.getCard(instances[1].id!),
        undefined,
        'an in-flight read cannot resurrect an evicted card',
      );
      assert.strictEqual(cardStore.getCard(instances[4].id!), undefined);
      assert.strictEqual((instances[5] as any).name, 'keep this local draft');
      assert.false(api.hasLatticeSnapshot(instances[5]));
      assert.strictEqual(
        instances[6].publicationState,
        'ready',
        'the queued current card converges after a failed read',
      );
    } finally {
      hold = false;
      for (let read of reads)
        read.result.fulfill(structuredClone(documents.get(read.id)));
      await settled();
      cardService.fetchJSON = fetchJSON;
      restoreBatchTransport();
      messages.relayRealmEvent = relay;
    }
  });

  for (let reset of ['resetCache', 'resetState'] as const) {
    test(`Lattice reconciliation cancels queued and in-flight reads on ${reset}`, async function (assert) {
      await storeService.ensureSetupComplete();
      let messages = getService('message-service');
      let relay = messages.relayRealmEvent.bind(messages);
      messages.relayRealmEvent = () => {};
      messages.latticeConnectionChanged(false);
      let documents = new Map<string, SingleCardDocument>();
      let instances: CardDefType[] = [];
      for (let i = 0; i < 5; i++) {
        let doc = publicationDocument(`Person/reconcile-reset-${i}`);
        let instance = new PersonDef();
        await api.updateFromSerialized(instance, doc, cardStore, {
          latticePublication: 'display',
        });
        documents.set(instance.id!, doc);
        instances.push(instance);
      }
      let reads: Array<{
        id: string;
        result: Deferred<any>;
        signal?: AbortSignal | null;
      }> = [];
      let restoreBatchTransport = batchExistingDisplayFixtures();
      let cardService = getService('card-service');
      let fetchJSON = cardService.fetchJSON.bind(cardService);
      cardService.fetchJSON = async (...args) => {
        let id = String(args[0]);
        if (!documents.has(id)) return fetchJSON(...args);
        let result = new Deferred<any>();
        reads.push({ id, result, signal: args[1]?.signal });
        return result.promise;
      };
      try {
        messages.latticeConnectionChanged(true);
        await waitUntil(() => reads.length >= 4);
        storeService[reset]();
        for (let read of reads) {
          assert.true(
            read.signal?.aborted,
            'reset aborts the old session transport',
          );
          let doc = structuredClone(documents.get(read.id)!);
          doc.data.attributes!.name = 'obsolete response';
          read.result.fulfill(doc);
        }
        await settled();
        assert.strictEqual(
          reads.length,
          4,
          'the queued fifth request is cancelled',
        );
        for (let instance of instances) {
          assert.strictEqual(
            storeService.peek(instance.id!),
            undefined,
            'old identity is not planted in the new Store',
          );
          assert.notStrictEqual((instance as any).name, 'obsolete response');
        }
      } finally {
        for (let read of reads)
          read.result.fulfill(structuredClone(documents.get(read.id)));
        await settled();
        cardService.fetchJSON = fetchJSON;
        restoreBatchTransport();
        messages.relayRealmEvent = relay;
      }
    });
  }

  test('Lattice publication residency limits events to admitted exact realms including linked children', async function (assert) {
    await storeService.ensureSetupComplete();
    let ordinary = await storeService.get(`${testRealmURL}Person/hassan`);
    let doc = publicationDocument('Person/published');
    let childDoc = publicationDocument(
      'nested/Person/child',
      ri(`${testRealmURL}nested/`),
    );
    doc.data.relationships = {
      bestFriend: {
        links: { self: childDoc.data.id! },
        data: { type: 'card', id: childDoc.data.id! },
      },
    };
    doc.included = [childDoc.data];
    let published = new PersonDef();
    await api.updateFromSerialized(published, doc, cardStore, {
      latticePublication: 'display',
    });
    let child = cardStore.getCard(childDoc.data.id!)!;
    assert.true(
      api.hasLatticeSnapshot(child),
      'included identity is admitted separately',
    );
    let documents = new Map<string, SingleCardDocument>([
      [doc.data.id!, doc],
      [childDoc.data.id!, childDoc],
    ]);
    let reads: string[] = [];
    let restoreBatchTransport = batchExistingDisplayFixtures();
    let cardService = getService('card-service');
    let fetchJSON = cardService.fetchJSON.bind(cardService);
    cardService.fetchJSON = async (...args) => {
      let incoming = documents.get(String(args[0]));
      if (!incoming) return fetchJSON(...args);
      reads.push(String(args[0]));
      return structuredClone(incoming);
    };
    let scans = 0;
    let allCards = cardStore.allCardInstances.bind(cardStore);
    cardStore.allCardInstances = () => {
      scans++;
      return allCards();
    };
    let messages = getService('message-service');
    let deliver = (event: RealmEventContent) =>
      (storeService as any).handleInvalidations(event);
    try {
      // Establish a connected session, then count only the events under test.
      messages.latticeConnectionChanged(true);
      await settled();
      reads.length = 0;
      scans = 0;
      deliver({
        eventName: 'update',
        realmURL: testRealmURL,
      } as RealmEventContent);
      assert.strictEqual(published.publicationState, 'pending');
      assert.strictEqual(
        child.publicationState,
        'ready',
        'a nested realm is not the parent realm',
      );
      assert.false(api.hasLatticeSnapshot(ordinary as CardDefType));
      deliver({
        eventName: 'index',
        indexType: 'incremental',
        invalidations: [],
        realmURL: testRealmURL,
      });
      await settled();
      assert.deepEqual(
        reads,
        [published.id!],
        'unchanged owner is revalidated once after routing settles',
      );
      assert.strictEqual(published.publicationState, 'ready');
      reads.length = 0;
      deliver({
        eventName: 'index',
        indexType: 'full',
        realmURL: testRealmURL,
      });
      await settled();
      assert.deepEqual(
        reads,
        [published.id!],
        'full indexing touches only the exact published realm',
      );
      reads.length = 0;
      messages.latticeConnectionChanged(false);
      assert.strictEqual(published.publicationState, 'pending');
      assert.strictEqual(child.publicationState, 'pending');
      messages.latticeConnectionChanged(true);
      await settled();
      assert.deepEqual(
        reads.sort(),
        [published.id!, child.id!].sort(),
        'reconnect repairs both admitted identities once',
      );
      assert.strictEqual(
        scans,
        0,
        'publication events never enumerate ordinary card instances',
      );
      assert.strictEqual(cardStore.getCard(published.id!), published);
      assert.strictEqual(cardStore.getCard(child.id!), child);
    } finally {
      cardService.fetchJSON = fetchJSON;
      restoreBatchTransport();
      cardStore.allCardInstances = allCards;
    }
  });

  test('Lattice publication residency follows edits, deletion, GC and Store resets', async function (assert) {
    await storeService.ensureSetupComplete();
    let incoming = publicationDocument('Person/lifetime');
    let publish = async () => {
      let instance = new PersonDef();
      await api.updateFromSerialized(instance, incoming, cardStore, {
        latticePublication: 'display',
      });
      return instance;
    };
    let event = {
      eventName: 'index',
      indexType: 'full',
      realmURL: testRealmURL,
    } as RealmEventContent;
    let refreshes = 0;
    let task = (storeService as any).reloadTask;
    let perform = task.perform;
    task.perform = () => {
      refreshes++;
    };
    let check = async (expected: number, message: string) => {
      refreshes = 0;
      (storeService as any).handleInvalidations(event);
      await settled();
      assert.strictEqual(refreshes, expected, message);
    };
    try {
      let instance = await publish();
      await check(1, 'admitted identity is registered once');
      (instance as any).name = 'local draft';
      await check(0, 'a local edit is no longer a publication consumer');
      assert.strictEqual((instance as any).name, 'local draft');
      await api.updateFromSerialized(instance, incoming, cardStore, {
        latticePublication: 'display',
      });
      await check(
        1,
        'a later admitted publication registers the existing identity again',
      );
      cardStore.delete(`${testRealmURL}Person/lifetime.json`);
      await check(1, 'file-meta deletion leaves the card identity registered');
      cardStore.delete(incoming.data.id!);
      await check(0, 'card deletion removes its registration');
      await publish();
      cardStore.sweep(api);
      await check(
        1,
        'publication bookkeeping does not rescue a first-sweep GC candidate',
      );
      cardStore.sweep(api);
      await check(0, 'second sweep evicts the publication with its identity');
      await publish();
      cardStore.reset();
      await check(0, 'code reset forgets registrations');
      await publish();
      storeService.resetCache();
      await check(0, 'cache replacement cannot retain the old registrations');
      cardStore = (storeService as any).store;
      await storeService.add(incoming, {
        doNotPersist: true,
        latticeUseSnapshot: true,
      });
      await check(
        1,
        'the next admitted read registers in the replacement Store',
      );
      storeService.resetState();
      await storeService.ensureSetupComplete();
      await check(0, 'session reset cannot retain old publications');
    } finally {
      task.perform = perform;
    }
  });

  test('Lattice aliases reload one resident card per event and subsequent events still refresh it', async function (assert) {
    let url = `${testRealmURL}Person/hassan`;
    storeService.addReference(url);
    await storeService.flush();
    let original = storeService.peek(url);
    assert.true(isCardInstance(original));

    let messages = getService('message-service');
    let deliver = messages.relayRealmEvent.bind(messages);
    messages.relayRealmEvent = () => {};
    let cardService = getService('card-service');
    let fetchJSON = cardService.fetchJSON.bind(cardService);
    let reads = 0;
    cardService.fetchJSON = async (...args) => {
      if (String(args[0]) === url) reads++;
      return fetchJSON(...args);
    };
    try {
      for (let name of ['First publication', 'Next publication']) {
        await testRealm.write(
          'Person/hassan.json',
          JSON.stringify({
            data: {
              attributes: { name },
              meta: {
                adoptsFrom: { module: testRRI('person'), name: 'Person' },
              },
            },
          } as LooseSingleCardDocument),
        );
        reads = 0;
        deliver({
          eventName: 'index',
          indexType: 'incremental',
          invalidations: [`${url}.json`, url, `${url}.json`],
          realmURL: testRealmURL,
        });
        await settled();
        assert.strictEqual(reads, 1, `${name} fetches the card once`);
        assert.strictEqual(
          storeService.peek(url),
          original,
          'resident identity survives',
        );
        assert.strictEqual(
          (original as any).name,
          name,
          'the published value arrives',
        );
      }
    } finally {
      cardService.fetchJSON = fetchJSON;
      messages.relayRealmEvent = deliver;
    }
  });

  test('Lattice applyPublication reports applied, ignored and missing without reading a body', async function (assert) {
    let instance = new PersonDef() as CardDefType & {
      name: string;
      boom: string;
    };
    let doc: SingleCardDocument = {
      data: {
        id: testRRI('Person/hassan'),
        type: 'card',
        attributes: { name: 'Hassan', boom: 'stored computation' },
        meta: {
          adoptsFrom: { module: testRRI('person'), name: 'Person' },
          realmURL: testRealmURL,
          generation: 2,
          publication: {
            have: 'lattice-display-v1:' + 'a'.repeat(64),
            version: 1,
            state: 'ready',
            validatedThrough: 1,
            outputRevision: 2,
            definitionRevision: 'reviewed',
            computedFields: ['boom'],
            queryFields: [],
            watches: [],
            hasPublishedSnapshot: true,
          },
        },
      },
    };
    await api.updateFromSerialized(instance, doc, cardStore, {
      latticePublication: 'display',
    });
    await storeService.add(instance, { doNotPersist: true });
    let cardService = getService('card-service');
    let fetchJSON = cardService.fetchJSON;
    let reads = 0;
    cardService.fetchJSON = async () => {
      reads++;
      throw new Error('Publication application must not read its body');
    };
    let current = true;
    let appliedBodies = 0;
    let context = {
      api,
      canApply: () => current,
      didApply: () => appliedBodies++,
    };
    let reuse = {
      lattice: {
        version: 1,
        reuse: true,
        token: doc.data.meta.publication!.have!,
        id: instance.id,
        state: 'pending',
      },
    };
    try {
      let result = await storeService.applyPublication(
        instance,
        reuse,
        context,
      );
      assert.strictEqual(result.status, 'applied');
      if (result.status !== 'missing')
        assert.strictEqual(result.instance, instance);
      assert.strictEqual(instance.publicationState, 'pending');
      result = await storeService.applyPublication(instance, doc, context);
      assert.strictEqual(result.status, 'applied');
      if (result.status !== 'missing')
        assert.strictEqual(result.instance, instance);
      assert.strictEqual(
        instance.boom,
        'stored computation',
        'uses the covered value',
      );
      assert.strictEqual(instance.publicationState, 'ready');
      assert.strictEqual(appliedBodies, 1);

      result = await storeService.applyPublication(
        instance,
        {
          lattice: {
            ...reuse.lattice,
            token: 'lattice-display-v1:' + 'b'.repeat(64),
          },
        },
        context,
      );
      assert.deepEqual(
        result,
        { status: 'missing' },
        'reader owns bounded repair',
      );
      assert.strictEqual(
        instance.publicationState,
        'ready',
        'miss cannot erase the current body',
      );
      current = false;
      instance.name = 'Unsaved local draft';
      result = await storeService.applyPublication(instance, doc, context);
      assert.deepEqual(result, { status: 'ignored', instance });
      assert.strictEqual(instance.name, 'Unsaved local draft');
      assert.strictEqual(appliedBodies, 1, 'obsolete read cannot apply a body');
      assert.strictEqual(reads, 0);
    } finally {
      cardService.fetchJSON = fetchJSON;
    }
  });

  test('Lattice display reuse preserves Store identity and fences reordered freshness replies', async function (assert) {
    let url = `${testRealmURL}Person/hassan`;
    let instance = new PersonDef();
    let doc: SingleCardDocument = {
      data: {
        id: testRRI('Person/hassan'),
        type: 'card',
        attributes: { name: 'Hassan', boom: 'boom' },
        meta: {
          adoptsFrom: { module: testRRI('person'), name: 'Person' },
          realmURL: testRealmURL,
        },
      },
    };
    let token = 'lattice-display-v1:' + 'a'.repeat(64);
    Object.assign(doc.data.meta, {
      generation: 2,
      publication: {
        have: token,
        version: 1,
        state: 'ready',
        validatedThrough: 1,
        outputRevision: 2,
        definitionRevision: 'reviewed',
        computedFields: ['boom'],
        queryFields: [],
        watches: [],
        hasPublishedSnapshot: true,
      },
    });
    await api.updateFromSerialized(instance, doc, cardStore, {
      latticePublication: 'display',
    });
    await storeService.add(instance, { doNotPersist: true });
    storeService.addReference(url);
    await storeService.flush();
    let messages = getService('message-service');
    let deliver = messages.relayRealmEvent.bind(messages);
    // This test supplies its publication sequence explicitly, just like the
    // alias test above. Do not interleave fixture setup's background events.
    messages.relayRealmEvent = () => {};
    let restoreBatchTransport = batchExistingDisplayFixtures();
    let cardService = getService('card-service');
    let fetchJSON = cardService.fetchJSON.bind(cardService);
    let reads: Array<{ result: Deferred<any>; token: string | null }> = [];
    cardService.fetchJSON = async (...args) => {
      if (String(args[0]) !== instance.id) return fetchJSON(...args);
      let result = new Deferred<any>();
      reads.push({
        result,
        token: new Headers(args[1]?.headers).get(LATTICE_DISPLAY_HAVE_HEADER),
      });
      return result.promise;
    };
    let invalidate = () =>
      deliver({
        eventName: 'index',
        indexType: 'incremental',
        invalidations: [url],
        realmURL: testRealmURL,
      });
    let reply = (pending: boolean) => ({
      lattice: {
        version: 1,
        reuse: true,
        token,
        id: instance.id,
        state: pending ? 'pending' : 'ready',
      },
    });
    try {
      invalidate();
      await waitUntil(() => reads.length === 1);
      assert.strictEqual(
        reads[0].token,
        token,
        'Store advertises applied inventory',
      );
      deliver({
        eventName: 'update',
        realmURL: testRealmURL,
      } as RealmEventContent);
      reads[0].result.fulfill(reply(false));
      await settled();
      assert.strictEqual(
        instance.publicationState,
        'pending',
        'earlier ready response cannot clear a later invalidation',
      );
      invalidate();
      await waitUntil(() => reads.length === 2);
      reads[1].result.fulfill(reply(false));
      await settled();
      assert.strictEqual(
        instance.publicationState,
        'ready',
        'current validation clears pending',
      );
      invalidate();
      await waitUntil(() => reads.length === 3);
      invalidate();
      assert.strictEqual(
        reads.length,
        3,
        'same-card notices wait for the active read',
      );
      reads[2].result.fulfill(reply(false));
      await waitUntil(() => reads.length === 4);
      assert.strictEqual(
        instance.publicationState,
        'pending',
        'the older reply cannot clear the new notice',
      );
      reads[3].result.fulfill(reply(false));
      await settled();
      assert.strictEqual(
        instance.publicationState,
        'ready',
        'the current follow-up clears pending after the older reply is discarded',
      );
      assert.strictEqual(storeService.peek(url), instance);
      assert.strictEqual((instance as any).name, 'Hassan');
      assert.strictEqual((instance as any).boom, 'boom');
      assert.strictEqual(
        reads.length,
        4,
        'no full repair needed for matching inventory',
      );
    } finally {
      for (let read of reads) read.result.fulfill(reply(false));
      cardService.fetchJSON = fetchJSON;
      restoreBatchTransport();
      messages.relayRealmEvent = deliver;
    }
  });

  test('a reload that 404s while the row is being rebuilt keeps the card instead of deleting it', async function (assert) {
    let url = `${testRealmURL}Person/rebuilt`;
    await testRealm.write(
      'Person/rebuilt.json',
      JSON.stringify({
        data: {
          attributes: { name: 'Rebuilt' },
          meta: {
            adoptsFrom: { module: testRRI('person'), name: 'Person' },
          },
        },
      } as LooseSingleCardDocument),
    );
    storeService.addReference(url);
    await storeService.flush();
    assert.true(
      isCardInstance(storeService.peek(url)),
      'the card starts out loaded',
    );

    // Take the row away and put the file back, without the store hearing
    // either step — the state a reload meets when the index no longer has a
    // row but the realm still holds the source.
    let messageService = getService('message-service');
    let deliverRealmEvents =
      messageService.relayRealmEvent.bind(messageService);
    messageService.relayRealmEvent = () => {};
    try {
      await testRealm.delete('Person/rebuilt.json');
      await testRealmAdapter.write(
        'Person/rebuilt.json',
        JSON.stringify({
          data: {
            attributes: { name: 'Rebuilt' },
            meta: {
              adoptsFrom: { module: testRRI('person'), name: 'Person' },
            },
          },
        } as LooseSingleCardDocument),
      );
      deliverRealmEvents({
        eventName: 'index',
        indexType: 'incremental',
        invalidations: [url],
        realmURL: testRealmURL,
      });
      await settled();
    } finally {
      messageService.relayRealmEvent = deliverRealmEvents;
    }

    assert.true(
      isCardInstance(storeService.peek(url)),
      'the card is still in the store — nothing was deleted',
    );
    assert.strictEqual(
      storeService.peekError(url),
      undefined,
      'and it is left alone rather than covered by a placeholder',
    );
  });

  test('a card already running in the store is never displaced by the awaiting-index placeholder', async function (assert) {
    // A card created in this tab is live under its local id and editable long
    // before the realm has indexed it. The realm reporting that it has not
    // caught up says nothing about that instance, and must not put a
    // placeholder in front of it or detach its autosave.
    let instance = (await storeService.add(
      new PersonDef({ name: 'Brand New' }),
    )) as CardDefType;
    let url = instance.id!;
    assert.ok(url, 'the new card was assigned a remote id');

    let messageService = getService('message-service');
    let deliverRealmEvents =
      messageService.relayRealmEvent.bind(messageService);
    messageService.relayRealmEvent = () => {};
    let cardService = getService('card-service') as any;
    let originalFetchJSON = cardService.fetchJSON.bind(cardService);
    // The realm has the file but no row for it yet, so a read of this card
    // comes back as the awaiting-index 404 while the instance stays live.
    cardService.fetchJSON = async (fetchUrl: string | URL, args?: any) => {
      if (String(fetchUrl).includes(url)) {
        let err = new Error('awaiting index') as any;
        err.status = 404;
        err.responseText = JSON.stringify({
          errors: [
            {
              id: url,
              status: 404,
              title: 'Not Found',
              message: `${url} has not finished indexing`,
              isCardError: true,
              awaitingIndex: true,
              additionalErrors: null,
            },
          ],
        });
        throw err;
      }
      return originalFetchJSON(fetchUrl, args);
    };

    try {
      deliverRealmEvents({
        eventName: 'index',
        indexType: 'incremental',
        invalidations: [url],
        realmURL: testRealmURL,
      });
      await settled();
    } finally {
      delete cardService.fetchJSON;
      messageService.relayRealmEvent = deliverRealmEvents;
    }

    assert.strictEqual(
      storeService.peek(url),
      instance,
      'the running instance is still the one the store hands out',
    );
    assert.strictEqual(
      storeService.peekError(url),
      undefined,
      'no placeholder stands in front of it',
    );
    assert.ok(
      storeService.getSaveState(url),
      'and it is still autosaving, so the user can keep editing',
    );
  });

  test('a full reindex resolves a placeholder whose read was still in flight when it landed', async function (assert) {
    // The sweep a bare `full` event triggers can only find placeholders the
    // store has already recorded. A read still in flight has recorded nothing
    // yet, and the placeholder it goes on to install is stale the moment it
    // lands — this pass is what it would be waiting for.
    storeService.addReference(`${testRealmURL}Person/hassan`);
    await storeService.flush();

    await testRealmAdapter.write(
      'Person/swept-inflight.json',
      JSON.stringify({
        data: {
          attributes: { name: 'Swept In Flight' },
          meta: {
            adoptsFrom: { module: testRRI('person'), name: 'Person' },
          },
        },
      } as LooseSingleCardDocument),
    );

    let url = `${testRealmURL}Person/swept-inflight`;
    let cardService = getService('card-service') as any;
    let originalFetchJSON = cardService.fetchJSON.bind(cardService);
    let reached404 = new Deferred<void>();
    let release404 = new Deferred<void>();
    cardService.fetchJSON = async (fetchUrl: string | URL, args?: any) => {
      if (!String(fetchUrl).includes('Person/swept-inflight')) {
        return originalFetchJSON(fetchUrl, args);
      }
      try {
        return await originalFetchJSON(fetchUrl, args);
      } catch (err) {
        reached404.fulfill();
        await release404.promise;
        throw err;
      }
    };

    let messageService = getService('message-service');
    let deliverRealmEvents =
      messageService.relayRealmEvent.bind(messageService);
    messageService.relayRealmEvent = () => {};

    try {
      let reading = storeService.get(url);
      await reached404.promise;

      // Indexing lands while the read is parked, and announces itself the way
      // a from-scratch pass at realm startup does: a bare `full` event naming
      // no cards at all.
      await testRealm.write(
        'Person/swept-inflight.json',
        JSON.stringify({
          data: {
            attributes: { name: 'Swept In Flight Person' },
            meta: {
              adoptsFrom: { module: testRRI('person'), name: 'Person' },
            },
          },
        } as LooseSingleCardDocument),
      );
      deliverRealmEvents({
        eventName: 'index',
        indexType: 'full',
        realmURL: testRealmURL,
      });

      release404.fulfill();
      await reading;
      await settled();
    } finally {
      release404.fulfill();
      delete cardService.fetchJSON;
      messageService.relayRealmEvent = deliverRealmEvents;
    }

    let instance = storeService.peek(url);
    assert.true(
      isCardInstance(instance),
      'the card takes over rather than the placeholder being stranded',
    );
    assert.strictEqual(
      (instance as any).name,
      'Swept In Flight Person',
      'and it is the indexed state',
    );
  });

  test('an instance can be restored after a loader reset', async function (assert) {
    setCardInOperatorModeState(`${testRealmURL}Person/hassan`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
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
        import { contains, CardDef } from '@cardstack/base/card-api';
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
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    assert
      .dom(`[data-stack-card="${newInstance.id}"] [data-test-field="name"]`)
      .containsText('Andrea', 'the card data is correct');

    // write something that will trigger a loader reset that doesn't invalidate the instance being rendered
    await testRealm.write(
      `foo.gts`,
      `
        import { contains, CardDef } from '@cardstack/base/card-api';
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
      // hassan may also save around this time - only assert on newInstance's save
      if (url.href === newInstance.id) {
        assert.strictEqual(url.href, newInstance.id, 'the save url is correct');
        assert.strictEqual(
          (doc as SingleCardDocument).data.attributes?.name,
          'Air',
          'card data is correct',
        );
      }
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

  test('reference count is balanced when used with CardResource for file-meta that is destroyed', async function (assert) {
    class Driver {
      @tracked showComponent = false;
      @tracked id: string | undefined;
    }

    let driver = new Driver();
    let firstFile = `${testRealmURL}notes.txt`;
    let secondFile = `${testRealmURL}README.txt`;
    await testRealm.write('notes.txt', 'notes');
    await testRealm.write('README.txt', 'readme');

    class ResourceConsumer extends GlimmerComponent {
      resource = getCard(this, () => driver.id, { type: 'file-meta' });
      <template>
        {{#if this.resource.card}}
          <div data-test-rendered-file={{this.resource.id}} />
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
    driver.id = firstFile;
    await waitFor(`[data-test-rendered-file="${firstFile}"]`);
    assert.strictEqual(
      storeService.getReferenceCount(firstFile),
      1,
      `reference count for ${firstFile} is 1`,
    );
    assert.strictEqual(
      storeService.getReferenceCount(secondFile),
      0,
      `reference count for ${secondFile} is 0`,
    );

    driver.id = secondFile;
    await waitFor(`[data-test-rendered-file="${secondFile}"]`);
    assert.strictEqual(
      storeService.getReferenceCount(firstFile),
      0,
      `reference count for ${firstFile} is 0`,
    );
    assert.strictEqual(
      storeService.getReferenceCount(secondFile),
      1,
      `reference count for ${secondFile} is 1`,
    );

    driver.showComponent = false;
    await waitFor(`[data-test-rendered-file]`, { count: 0 });
    assert.strictEqual(
      storeService.getReferenceCount(firstFile),
      0,
      `reference count for ${firstFile} is 0`,
    );
    assert.strictEqual(
      storeService.getReferenceCount(secondFile),
      0,
      `reference count for ${secondFile} is 0`,
    );
  });

  test<TestContextWithSave>('reference count is balanced during auto saving', async function (assert) {
    let hassan = `${testRealmURL}Person/hassan`;

    setCardInOperatorModeState(hassan, 'edit');
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
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
      <template>
        {{#if this.card}}
          <div data-test-rendered-card={{this.card.id}}>
            {{this.card.id}}
          </div>
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
    await waitUntil(
      () =>
        storeService.getReferenceCount(hassan) === 1 &&
        storeService.getReferenceCount(jade) === 0,
      { timeout: 10_000 },
    );
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
    await waitUntil(
      () =>
        storeService.getReferenceCount(jade) === 1 &&
        storeService.getReferenceCount(hassan) === 0,
      { timeout: 10_000 },
    );
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
    await waitUntil(
      () =>
        storeService.getReferenceCount(jade) === 0 &&
        storeService.getReferenceCount(hassan) === 0,
      { timeout: 10_000 },
    );
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
        <template><ResourceConsumer /></template>
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
    let unsubscribe = getService('message-service').subscribe(
      testRealmURL,
      (ev: RealmEventContent) => {
        if (ev.eventName === 'index' && ev.indexType === 'incremental') {
          unsubscribe();
          deferred.fulfill();
        }
      },
    );

    await testRealm.write(
      'Person/hassan.json',
      JSON.stringify({
        data: {
          attributes: {
            name: 'Paper',
          },
          meta: {
            adoptsFrom: {
              module: testRRI('person'),
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
              module: testRRI('person'),
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
        <template><ResourceConsumer /></template>
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
    let unsubscribe = getService('message-service').subscribe(
      testRealmURL,
      (ev: RealmEventContent) => {
        if (ev.eventName === 'index' && ev.indexType === 'incremental') {
          unsubscribe();
          deferred.fulfill();
        }
      },
    );

    await testRealm.write(
      'Person/hassan.json',
      JSON.stringify({
        data: {
          attributes: {
            name: 'Paper',
          },
          meta: {
            adoptsFrom: {
              module: testRRI('person'),
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
              module: testRRI('person'),
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
        <template><ResourceConsumer /></template>
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
    let unsubscribe = getService('message-service').subscribe(
      testRealmURL,
      (ev: RealmEventContent) => {
        if (ev.eventName === 'index' && ev.indexType === 'incremental') {
          unsubscribe();
          deferred.fulfill();
        }
      },
    );

    await testRealm.write(
      'Person/hassan.json',
      JSON.stringify({
        data: {
          attributes: {
            name: 'Paper',
          },
          meta: {
            adoptsFrom: {
              module: testRRI('person'),
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
              module: testRRI('person'),
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
