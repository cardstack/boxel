import {
  type RenderingTestContext,
  waitUntil,
  waitFor,
  settled,
} from '@ember/test-helpers';

import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { isCardInstance, rri, type Loader } from '@cardstack/runtime-common';

import { getCard } from '@cardstack/host/resources/card-resource';
import type {
  RebuildEvent,
  TelemetryEventInput,
} from '@cardstack/host/services/client-telemetry';
import type LoaderService from '@cardstack/host/services/loader-service';
import type RealmService from '@cardstack/host/services/realm';
import type StoreService from '@cardstack/host/services/store';

import {
  testRealmURL,
  setupLocalIndexing,
  setupOnSave,
  setupCardLogs,
  setupIntegrationTestRealm,
} from '../helpers';

import {
  CardDef,
  contains,
  field,
  linksTo,
  StringField,
  Component,
  setupBaseRealm,
} from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { renderComponent } from '../helpers/render-component';
import { setupRenderingTest } from '../helpers/setup';

import type { RealmEventContent } from '@cardstack/base/matrix-event';

module('Integration | Store | module rebuild', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  let loader: Loader;
  let loaderService: LoaderService;
  let storeService: StoreService;
  let realmService: RealmService;

  // These tests are about what the loader and the index do to each other when
  // executable source changes, so they cannot share an index across tests the
  // way the rest of the Store suite does: a restored index means the realm
  // started with `skipBootIndex`, and then no fixture module was ever loaded
  // into the loader for a write to invalidate or a flush to record.
  setupLocalIndexing(hooks);
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

  hooks.beforeEach(async function (this: RenderingTestContext) {
    class Person extends CardDef {
      @field name = contains(StringField);
      @field bestFriend = linksTo(() => Person);
    }

    class Employee extends CardDef {
      static displayName = 'Employee';
      @field name = contains(StringField);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-employee-badge>Employee: <@fields.name /></div>
        </template>
      };
    }

    loaderService = getService('loader-service');
    loader = loaderService.loader;
    storeService = getService('store');
    realmService = getService('realm');

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'person.gts': { Person },
        'employee.gts': { Employee },
        'Person/hassan.json': new Person({ name: 'Hassan' }),
      },
    });
    await realmService.login(testRealmURL);
  });

  // Count full rebuilds by the loader flush each one performs: the coalesced
  // rebuild calls resetLoader exactly once, and nothing else flushes the loader
  // in these tests, so resetLoader-call-count == rebuild-count.
  function countRebuilds() {
    let count = 0;
    let original = loaderService.resetLoader;
    loaderService.resetLoader = function (
      options?: Parameters<LoaderService['resetLoader']>[0],
    ) {
      count++;
      return original.call(loaderService, options);
    } as LoaderService['resetLoader'];
    return {
      get count() {
        return count;
      },
      restore() {
        loaderService.resetLoader = original;
      },
    };
  }

  async function renderCard(id: string) {
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
    driver.id = id;
    await waitFor(`[data-test-rendered-card="${id}"]`, { timeout: 5_000 });
  }

  test('a burst of executable invalidations coalesces to at most two rebuilds', async function (assert) {
    let hassan = `${testRealmURL}Person/hassan`;
    await renderCard(hassan);

    let personModule = `${testRealmURL}person.gts`;
    assert.true(
      loaderService.loader.isModuleLoaded(personModule),
      'precondition: the person module is loaded',
    );

    let rebuilds = countRebuilds();
    try {
      // Deliver executable invalidations faster than a rebuild can complete —
      // synchronously, before the first rebuild's re-fetch settles.
      let event: RealmEventContent = {
        eventName: 'index',
        indexType: 'incremental',
        realmURL: testRealmURL,
        invalidations: [personModule],
      };
      for (let i = 0; i < 6; i++) {
        (storeService as any).handleInvalidations(event);
      }
      await settled();
    } finally {
      rebuilds.restore();
    }

    let coalesced = rebuilds.count >= 1 && rebuilds.count <= 2;
    assert.ok(
      coalesced,
      `6 rapid executable invalidations coalesce to at most 2 rebuilds (saw ${rebuilds.count})`,
    );

    // End state reflects the latest generation: the open card is re-established
    // and rendered against current server state.
    await waitFor(`[data-test-rendered-card="${hassan}"]`, { timeout: 5_000 });
    let instance = storeService.peek(hassan);
    assert.true(
      isCardInstance(instance),
      'the open card is re-established after the burst',
    );
    assert.strictEqual(
      (instance as any).name,
      'Hassan',
      'the re-established card reflects current server state',
    );
    assert.strictEqual(
      storeService.getReferenceCount(hassan),
      1,
      'reference count stays balanced across the burst',
    );
  });

  test('an isolated executable invalidation still triggers exactly one rebuild', async function (assert) {
    let hassan = `${testRealmURL}Person/hassan`;
    await renderCard(hassan);

    let personModule = `${testRealmURL}person.gts`;
    assert.true(
      loaderService.loader.isModuleLoaded(personModule),
      'precondition: the person module is loaded',
    );

    let rebuilds = countRebuilds();
    try {
      (storeService as any).handleInvalidations({
        eventName: 'index',
        indexType: 'incremental',
        realmURL: testRealmURL,
        invalidations: [personModule],
      } as RealmEventContent);
      await settled();
    } finally {
      rebuilds.restore();
    }

    assert.strictEqual(
      rebuilds.count,
      1,
      'a single executable invalidation resets exactly once, as before',
    );
    await waitFor(`[data-test-rendered-card="${hassan}"]`, { timeout: 5_000 });
    assert.true(
      isCardInstance(storeService.peek(hassan)),
      'the card is re-established after the single rebuild',
    );
  });

  // Arms the client-performance instrument (dormant under isTesting() until a
  // test opts in) and captures the events the rebuild path emits. Captured at
  // record time rather than drained afterwards so the assertion can't race the
  // instrument's own flush loop.
  function captureTelemetry() {
    let telemetry = getService('client-telemetry');
    let captured: TelemetryEventInput[] = [];
    telemetry.enableForTest();
    let original = telemetry.recordEvent;
    telemetry.recordEvent = function (evt: TelemetryEventInput) {
      captured.push(evt);
      return original.call(telemetry, evt);
    };
    return {
      events(eventType: string) {
        return captured.filter((e) => e.event_type === eventType);
      },
      summary() {
        return captured.map((e) => e.event_type).join(',') || '<none>';
      },
      // The rebuild event is emitted after the rebuild's re-fetch resolves,
      // which outlives `settled()` — the loader flush and store reset run
      // before the task's first await, so a settled tick proves the rebuild
      // started, not that it finished. Wait for the event itself.
      async waitForEvent(eventType: string) {
        try {
          await waitUntil(() => this.events(eventType).length > 0, {
            timeout: 10_000,
          });
        } catch {
          // Let the caller's assertion report the miss with its own message.
        }
      },
      restore() {
        telemetry.recordEvent = original;
        telemetry.teardown();
      },
    };
  }

  test('a rebuild emits a rebuild telemetry event describing the code change', async function (assert) {
    let hassan = `${testRealmURL}Person/hassan`;
    await renderCard(hassan);

    let personModule = `${testRealmURL}person.gts`;
    assert.true(
      loaderService.loader.isModuleLoaded(personModule),
      'precondition: the person module is loaded',
    );

    let telemetry = captureTelemetry();
    try {
      assert.true(
        getService('client-telemetry').isEnabled,
        'precondition: the instrument is armed',
      );
      (storeService as any).handleInvalidations({
        eventName: 'index',
        indexType: 'incremental',
        realmURL: testRealmURL,
        invalidations: [personModule],
      } as RealmEventContent);
      await telemetry.waitForEvent('rebuild');
      await settled();
    } finally {
      telemetry.restore();
    }

    let rebuilds = telemetry.events('rebuild');
    assert.strictEqual(
      rebuilds.length,
      1,
      `one rebuild event is emitted (captured: ${telemetry.summary()})`,
    );
    let rebuild = rebuilds[0] as RebuildEvent;
    assert.strictEqual(
      rebuild.rebuild_source,
      'realm-event',
      'an event-driven rebuild names its source',
    );
    assert.strictEqual(
      rebuild.trigger_module,
      personModule,
      'the invalidated module is the scalar grouping key',
    );
    assert.deepEqual(
      rebuild.trigger_modules,
      [personModule],
      'the full trigger set names the invalidated module',
    );
    assert.strictEqual(
      rebuild.coalesced_events,
      1,
      'an isolated edit reports a single coalesced event',
    );
    assert.strictEqual(
      rebuild.modules_refetched,
      1,
      'the loaded module counts as refetched',
    );
    assert.strictEqual(
      rebuild.realm,
      testRealmURL,
      'the event is attributed to the realm that was written to',
    );
    assert.true(
      rebuild.cards_reloaded >= 1,
      `the open card graph is re-established (${rebuild.cards_reloaded} reloaded)`,
    );
  });

  test('saving a module from the app rebuilds and reports it', async function (assert) {
    let hassan = `${testRealmURL}Person/hassan`;
    await renderCard(hassan);

    let personModule = `${testRealmURL}person.gts`;
    assert.true(
      loaderService.loader.isModuleLoaded(personModule),
      'precondition: the person module is loaded',
    );
    let cardService = getService('card-service');
    let { content } = await cardService.getSource(rri(personModule));

    let telemetry = captureTelemetry();
    try {
      // Saving a module flushes the loader at write time, well before the
      // realm's index event for that write reaches the store. The flushed
      // loader carries no loaded modules, so the store must not read the
      // invalidation that follows as a change to a module nobody had loaded.
      await cardService.saveSource(new URL(personModule), content, 'editor', {
        resetLoader: true,
      });
      assert.false(
        loaderService.loader.isModuleLoaded(personModule),
        'precondition: the write flushed the module out of the loader',
      );

      (storeService as any).handleInvalidations({
        eventName: 'index',
        indexType: 'incremental',
        realmURL: testRealmURL,
        invalidations: [personModule],
      } as RealmEventContent);
      await telemetry.waitForEvent('rebuild');
      await settled();
    } finally {
      telemetry.restore();
    }

    let rebuilds = telemetry.events('rebuild');
    assert.strictEqual(
      rebuilds.length,
      1,
      `the invalidation after the write still rebuilds (captured: ${telemetry.summary()})`,
    );
    assert.strictEqual(
      (rebuilds[0] as RebuildEvent).trigger_module,
      personModule,
      'the saved module is named as the rebuild trigger',
    );
    assert.strictEqual(
      (rebuilds[0] as RebuildEvent).modules_refetched,
      1,
      'the module the write flushed still counts as refetched',
    );
    await waitFor(`[data-test-rendered-card="${hassan}"]`, { timeout: 5_000 });
    assert.true(
      isCardInstance(storeService.peek(hassan)),
      'the card is re-established after the rebuild',
    );
  });

  test('a write-time rebuild reports the cards it re-established', async function (assert) {
    // The counterpart shape to the code-mode-only session: with a card
    // rendered, the write-time pass re-fetches the live graph, and
    // cards_reloaded is the one field whose value crosses from the
    // re-establishment task into the event.
    let hassan = `${testRealmURL}Person/hassan`;
    await renderCard(hassan);

    let personModule = `${testRealmURL}person.gts`;
    let telemetry = captureTelemetry();
    try {
      storeService.refreshReferencesForCodeChange('file write', {
        triggerModule: personModule,
        realm: testRealmURL,
      });
      await telemetry.waitForEvent('rebuild');
      await settled();
    } finally {
      telemetry.restore();
    }

    let rebuilds = telemetry.events('rebuild');
    assert.strictEqual(
      rebuilds.length,
      1,
      `one write-time rebuild is reported (captured: ${telemetry.summary()})`,
    );
    assert.true(
      (rebuilds[0] as RebuildEvent).cards_reloaded >= 1,
      `the re-established graph is counted (${(rebuilds[0] as RebuildEvent).cards_reloaded} reloaded)`,
    );
    assert.strictEqual(
      (rebuilds[0] as RebuildEvent).rebuild_source,
      'write',
      'the save is the source',
    );
  });

  test('a code-mode save reports the rebuild it performs at write time', async function (assert) {
    // The shape of a code-mode editing session: the module is loaded (the
    // module inspector imports it), but the store holds no instance from its
    // realm — so no realm subscription exists and the index event for the
    // write never reaches the store. Everything that happens on save happens
    // at write time, and it has to be reported from there or the session's
    // rebuilds are invisible.
    let personModule = `${testRealmURL}person.gts`;
    await loaderService.loader.import(personModule);

    let telemetry = captureTelemetry();
    try {
      storeService.refreshReferencesForCodeChange('file write', {
        triggerModule: personModule,
        realm: testRealmURL,
      });
      await telemetry.waitForEvent('rebuild');
      await settled();
    } finally {
      telemetry.restore();
    }

    let rebuilds = telemetry.events('rebuild');
    assert.strictEqual(
      rebuilds.length,
      1,
      `the write-time re-establishment is reported (captured: ${telemetry.summary()})`,
    );
    let rebuild = rebuilds[0] as RebuildEvent;
    assert.strictEqual(
      rebuild.rebuild_source,
      'write',
      'the source names the save',
    );
    assert.strictEqual(
      rebuild.trigger_module,
      personModule,
      'the saved module is the trigger',
    );
    assert.strictEqual(
      rebuild.realm,
      testRealmURL,
      'the event is attributed to the realm written to',
    );
    assert.strictEqual(
      rebuild.coalesced_events,
      0,
      'no index event drove this rebuild',
    );
    assert.strictEqual(
      rebuild.modules_refetched,
      0,
      'a write-sourced rebuild does not claim module re-imports it cannot measure',
    );
  });

  test('a realm event carries its raw args minus the invalidation list', async function (assert) {
    let hassan = `${testRealmURL}Person/hassan`;
    await renderCard(hassan);

    let telemetry = captureTelemetry();
    try {
      (storeService as any).handleInvalidations({
        eventName: 'index',
        indexType: 'incremental',
        realmURL: testRealmURL,
        clientRequestId: 'editor:test-request',
        invalidations: [hassan],
      } as RealmEventContent);
      await settled();
    } finally {
      telemetry.restore();
    }

    let events = telemetry.events('realm-event');
    assert.strictEqual(events.length, 1, 'one realm-event is emitted');
    let args = (events[0] as any).event_args;
    assert.strictEqual(
      args.eventName,
      'index',
      'the raw event name rides along',
    );
    assert.strictEqual(
      args.clientRequestId,
      'editor:test-request',
      'fields beyond the tracked ones are preserved',
    );
    assert.false(
      'invalidations' in args,
      'the invalidation list is tracked separately, not duplicated',
    );
  });

  test('a flush blinds every loaded module, not just the one written', async function (assert) {
    let hassan = `${testRealmURL}Person/hassan`;
    await renderCard(hassan);

    let employeeModule = `${testRealmURL}employee.gts`;
    await loaderService.loader.import(employeeModule);
    assert.true(
      loaderService.loader.isModuleLoaded(employeeModule),
      'precondition: a second module is loaded',
    );

    let telemetry = captureTelemetry();
    try {
      // The flush that a write performs replaces the loader, so every module it
      // held goes with it — not only the one being written. An invalidation
      // naming one of those other modules still has to rebuild.
      loaderService.resetLoader({
        clearFetchCache: true,
        reason: 'source-write',
        codeChange: true,
      });
      assert.false(
        loaderService.loader.isModuleLoaded(employeeModule),
        'precondition: the flush took the second module with it',
      );

      (storeService as any).handleInvalidations({
        eventName: 'index',
        indexType: 'incremental',
        realmURL: testRealmURL,
        invalidations: [employeeModule],
      } as RealmEventContent);
      await telemetry.waitForEvent('rebuild');
      await settled();
    } finally {
      telemetry.restore();
    }

    assert.strictEqual(
      telemetry.events('rebuild').length,
      1,
      `a module the flush discarded still rebuilds (captured: ${telemetry.summary()})`,
    );
  });

  test('a flush during a rebuild is still picked up by the invalidation after it', async function (assert) {
    let hassan = `${testRealmURL}Person/hassan`;
    await renderCard(hassan);

    let personModule = `${testRealmURL}person.gts`;
    let employeeModule = `${testRealmURL}employee.gts`;

    let telemetry = captureTelemetry();
    try {
      (storeService as any).handleInvalidations({
        eventName: 'index',
        indexType: 'incremental',
        realmURL: testRealmURL,
        invalidations: [personModule],
      } as RealmEventContent);
      await waitUntil(
        () => (storeService as any).rebuildForCodeChange.isRunning,
        { timeout: 5_000 },
      );

      // Load the module inside the rebuild's window: the rebuild flushed the
      // loader on the way in, so anything imported before it is gone by now,
      // exactly as a re-established graph re-imports as it re-fetches.
      await loaderService.loader.import(employeeModule);

      // A write landing while a rebuild is in flight describes a code change
      // that rebuild is already too late to pick up, so its record has to
      // outlive the rebuild and be there for the invalidation still to come.
      loaderService.resetLoader({
        clearFetchCache: true,
        reason: 'file-resource-external-invalidation',
        codeChange: true,
      });
      await telemetry.waitForEvent('rebuild');
      await settled();
      let afterFirst = telemetry.events('rebuild').length;

      (storeService as any).handleInvalidations({
        eventName: 'index',
        indexType: 'incremental',
        realmURL: testRealmURL,
        invalidations: [employeeModule],
      } as RealmEventContent);
      await waitUntil(() => telemetry.events('rebuild').length > afterFirst, {
        timeout: 10_000,
      }).catch(() => {});
      await settled();

      assert.true(
        telemetry.events('rebuild').length > afterFirst,
        `the invalidation after the rebuild still rebuilds (captured: ${telemetry.summary()})`,
      );
    } finally {
      telemetry.restore();
    }
  });

  test('an invalidation for a module nothing loaded does not rebuild', async function (assert) {
    let hassan = `${testRealmURL}Person/hassan`;
    await renderCard(hassan);

    let telemetry = captureTelemetry();
    try {
      // The snapshot must not turn every executable invalidation into a
      // rebuild — a module this tab never imported still has nothing to
      // re-establish, flush or no flush.
      loaderService.resetLoader({
        clearFetchCache: true,
        reason: 'source-write',
        codeChange: true,
      });

      (storeService as any).handleInvalidations({
        eventName: 'index',
        indexType: 'incremental',
        realmURL: testRealmURL,
        invalidations: [`${testRealmURL}never-loaded.gts`],
      } as RealmEventContent);
      await settled();
    } finally {
      telemetry.restore();
    }

    assert.strictEqual(
      telemetry.events('rebuild').length,
      0,
      `a module nothing loaded does not rebuild (captured: ${telemetry.summary()})`,
    );
  });

  test('a flush record does not survive a session boundary', async function (assert) {
    let personModule = `${testRealmURL}person.gts`;
    loaderService.resetLoader({
      clearFetchCache: true,
      reason: 'source-write',
      codeChange: true,
    });
    assert.true(
      loaderService.wasModuleFlushedForCodeChange(personModule),
      'precondition: the flush recorded the module',
    );

    // A write whose index event never arrives — the tab logged out first, or
    // indexing failed — leaves a record behind. The next session has its own
    // idea of which modules it loaded, so the record must not survive to make
    // that session rebuild for a module it never had.
    loaderService.resetState();

    assert.false(
      loaderService.wasModuleFlushedForCodeChange(personModule),
      'the record is dropped when the loader crosses a session boundary',
    );
  });

  test('an open editor flushing the loader first does not suppress the rebuild', async function (assert) {
    let hassan = `${testRealmURL}Person/hassan`;
    await renderCard(hassan);

    let personModule = `${testRealmURL}person.gts`;
    assert.true(
      loaderService.loader.isModuleLoaded(personModule),
      'precondition: the person module is loaded',
    );

    let telemetry = captureTelemetry();
    try {
      // The code-mode file resource subscribes to the same realm events as the
      // store and flushes the loader for the file it holds. Either subscriber
      // may run first, so the store's rebuild decision cannot depend on a
      // loader the other one already replaced.
      loaderService.resetLoader({
        clearFetchCache: true,
        reason: 'file-resource-external-invalidation',
        codeChange: true,
      });
      assert.false(
        loaderService.loader.isModuleLoaded(personModule),
        'precondition: the flushed loader reports the module as not loaded',
      );

      (storeService as any).handleInvalidations({
        eventName: 'index',
        indexType: 'incremental',
        realmURL: testRealmURL,
        invalidations: [personModule],
      } as RealmEventContent);
      await telemetry.waitForEvent('rebuild');
      await settled();
    } finally {
      telemetry.restore();
    }

    assert.strictEqual(
      telemetry.events('rebuild').length,
      1,
      `the rebuild survives a flush by the other subscriber (captured: ${telemetry.summary()})`,
    );
    await waitFor(`[data-test-rendered-card="${hassan}"]`, { timeout: 5_000 });
    assert.true(
      isCardInstance(storeService.peek(hassan)),
      'the card is re-established after the rebuild',
    );
  });
});
