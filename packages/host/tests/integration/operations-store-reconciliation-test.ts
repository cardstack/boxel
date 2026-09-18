import { settled } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { localId as localIdSymbol } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import {
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
} from '../helpers';
import { setupBaseRealm } from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

import type { CardDef as CardDefType } from '@cardstack/base/card-api';
import type * as OperationsModule from '@cardstack/base/operations';

// ============================================================================
// What the store is left holding after a batch writes.
//
// The store keeps one object per card and has to stay consistent with what the
// realm has on disk. A batch is a second way for a card to come into existence,
// so everything the store's own create path does when the realm names a card —
// give the instance its id, index it under both ids, subscribe to its realm,
// fix up cards in other realms that linked to it while it had no URL, start
// autosaving it — has to happen for a batch-created card too, and has to happen
// once.
//
// The two flavors are what most of this suite is about. A batch can mint a card
// from an instance the store is already holding, which is the one that needs
// reconciling; or from plain data, which the store has never seen and has
// nothing to reconcile. The second flavor still touches the store, because the
// card the batch *changed* to link the new one may well be resident.
//
// The realm under test is the in-browser one, so a batch here is carried out by
// the operation core and the assertions read what the realm and the store are
// actually left holding.
// ============================================================================

const testRealm2URL = 'http://test-realm/test2/';

let loader: Loader;
let operations: (typeof OperationsModule)['operations'];

const REPORT_MODULE = `
  import {
    contains,
    field,
    linksToMany,
    CardDef,
    Component,
  } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation, params, card, linkTo } from "@cardstack/base/operations";

  export class Activity extends CardDef {
    @field headline = contains(StringField);
    static isolated = class Isolated extends Component<typeof this> {
      <template><h1><@fields.headline /></h1></template>
    }
    static embedded = class Embedded extends Component<typeof this> {
      <template><h1><@fields.headline /></h1></template>
    }
    static fitted = class Fitted extends Component<typeof this> {
      <template><h1><@fields.headline /></h1></template>
    }
  }

  export class Report extends CardDef {
    @field headline = contains(StringField);
    @field status = contains(StringField);
    @field activities = linksToMany(() => Activity);

    @operation static addActivity = {
      base: 'transform',
      params: { activity: linkTo(() => Activity) },
      append: { to: 'activities', value: card(params('activity')) },
    };

    @operation static escalate = {
      base: 'transform',
      set: { status: 'escalated' },
    };

    static isolated = class Isolated extends Component<typeof this> {
      <template><h1><@fields.headline /></h1></template>
    }
    static embedded = class Embedded extends Component<typeof this> {
      <template><h1><@fields.headline /></h1></template>
    }
    static fitted = class Fitted extends Component<typeof this> {
      <template><h1><@fields.headline /></h1></template>
    }
  }
`;

function reportRef() {
  return { module: `${testRealmURL}report`, name: 'Report' };
}

function reportFile(headline: string) {
  return {
    data: {
      type: 'card',
      attributes: { headline, status: 'open' },
      meta: { adoptsFrom: reportRef() },
    },
  };
}

// One report per test that writes to one, so no test reads another's
// leftovers.
function realmContents() {
  return {
    'report.gts': REPORT_MODULE,
    'report-adopted.json': reportFile('Adopted'),
    'report-data-only.json': reportFile('Data Only'),
    'report-racing.json': reportFile('Racing'),
    'report-foreign.json': reportFile('Foreign'),
    'report-conflicting.json': reportFile('Conflicting'),
  };
}

module('Integration | operations store reconciliation', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);
  setupCardLogs(hooks, async () =>
    getService('loader-service').loader.import('@cardstack/base/card-api'),
  );

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  hooks.beforeEach(async function () {
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: realmContents(),
    });
    // Imported after the realm is up, and through the loader the realm's own
    // instances were built by: `operations()` reads a def's declarations and
    // asks what a value is an instance of, so a copy of the module from an
    // earlier loader would not recognize the very cards the store hands back.
    loader = getService('loader-service').loader;
    ({ operations } = await loader.import<typeof OperationsModule>(
      '@cardstack/base/operations',
    ));
    await getService('realm').login(testRealmURL);
    // Looking the service up is what arms the bridge a card reads the transport
    // back through, the same as the app's own boot does.
    getService('operations');
  });

  async function cardAt(localPath: string): Promise<CardDefType> {
    let instance = await getService('store').get<CardDefType>(
      `${testRealmURL}${localPath}`,
    );
    if (!instance || !('id' in instance)) {
      throw new Error(`${localPath} did not load: ${JSON.stringify(instance)}`);
    }
    return instance as CardDefType;
  }

  // An unsaved card the store is holding — what a browser has after the user
  // makes a card and before anything writes it.
  async function unsavedActivity(headline: string): Promise<CardDefType> {
    let { Activity } = await loader.import<any>(`${testRealmURL}report`);
    return await getService('store').add<CardDefType>(
      new Activity({ headline }),
      { doNotPersist: true, realm: testRealmURL },
    );
  }

  // The invalidation event the realm broadcasts for a batch, delivered by hand.
  // The realm broadcasts its own, and matrix hands it over some time later —
  // after the assertions have run, which is why a test that is about what the
  // event does delivers one itself.
  function deliverIndexEvent(content: {
    invalidations: string[];
    clientRequestId?: string;
    clientAuthored?: string[];
  }) {
    getService('message-service').relayRealmEvent({
      eventName: 'index',
      indexType: 'incremental',
      realmURL: testRealmURL,
      ...content,
    } as any);
  }

  // The request id the transport registered for the batch it just sent. What
  // the realm stamps on the event, and what the store reads the event's
  // ownership from.
  function lastClientRequestId(): string {
    let ids = [...getService('card-service').clientRequestIds];
    return ids[ids.length - 1];
  }

  test('a batch promotes the instance it minted a card from', async function (assert) {
    let report = await cardAt('report-adopted');
    let activity = await unsavedActivity('Lab safety');
    let localId = activity[localIdSymbol];
    let store = getService('store');

    assert.strictEqual(activity.id, undefined, 'the card starts out unsaved');

    let [created] = (await (operations(report) as any).atomic((b: any) => {
      let minted = b.create(activity);
      b.addActivity({ activity: minted });
      return [minted];
    })) as [{ id: string; lid?: string }];

    assert.strictEqual(
      created.lid,
      localId,
      'the realm minted the card under the name the store knows it by',
    );
    assert.strictEqual(
      activity.id,
      created.id,
      'and the instance the store was holding took that id',
    );
    assert.strictEqual(
      created.id.split('/').pop(),
      localId,
      "so the URL's last segment is the local id, which is what pairs the two",
    );
    assert.strictEqual(
      store.peek(localId),
      activity,
      'the store answers for the local id with that same object',
    );
    assert.strictEqual(
      store.peek(created.id),
      activity,
      'and answers for the remote id with it too',
    );
  });

  test("the realm's own event names the card the batch carried our content for", async function (assert) {
    let report = await cardAt('report-adopted');
    let activity = await unsavedActivity('Lab safety');
    let localId = activity[localIdSymbol];

    // The realm's own broadcast, not one this test wrote. Which cards an event
    // names is the one thing a hand-delivered event cannot check: the name has
    // to be spelled the way the invalidation list spells it, and the coordinator
    // and the indexer arrive at that spelling separately.
    let events: any[] = [];
    let unsubscribe = getService('message-service').subscribe(
      testRealmURL,
      (event: any) => {
        if (event.eventName === 'index' && event.indexType === 'incremental') {
          events.push(event);
        }
      },
    );

    let created: { id: string };
    try {
      [created] = (await (operations(report) as any).atomic((b: any) => {
        let minted = b.create(activity);
        b.addActivity({ activity: minted });
        return [minted];
      })) as [{ id: string }];
      await settled();
    } finally {
      unsubscribe();
    }

    let batchEvent = events.find((event) =>
      (event.invalidations ?? []).includes(created.id),
    );
    assert.ok(batchEvent, 'the realm announced what the batch invalidated');
    assert.deepEqual(
      batchEvent.clientAuthored,
      [created.id],
      'naming the card it minted under our name, and not the report it computed for us',
    );
    assert.strictEqual(
      batchEvent.clientRequestId,
      lastClientRequestId(),
      "stamped with the batch's own request id, which is what makes the naming ours to read",
    );
    assert.true(
      (batchEvent.invalidations ?? []).includes(
        `${testRealmURL}report-adopted`,
      ),
      'while the report the batch changed is in the same pass, unnamed',
    );
    assert.strictEqual(
      created.id.split('/').pop(),
      localId,
      'and the card it named is the one the store was holding',
    );
  });

  test("the batch's own event leaves the promoted instance alone", async function (assert) {
    let report = await cardAt('report-adopted');
    let activity = await unsavedActivity('Lab safety');
    let store = getService('store');

    let [created] = (await (operations(report) as any).atomic((b: any) => {
      let minted = b.create(activity);
      b.addActivity({ activity: minted });
      return [minted];
    })) as [{ id: string }];

    // What a user typing during the write leaves behind: the realm holds what
    // the batch sent, the instance holds something newer.
    (activity as any).headline = 'Lab safety, revised';

    deliverIndexEvent({
      invalidations: [created.id, `${testRealmURL}report-adopted`],
      clientRequestId: lastClientRequestId(),
      clientAuthored: [created.id],
    });
    await settled();

    assert.strictEqual(
      store.peek(created.id),
      activity,
      'the event left one instance for the card, not a second',
    );
    assert.strictEqual(
      (activity as any).headline,
      'Lab safety, revised',
      'holding the edit made while the batch was in flight, not the pre-edit state the realm has',
    );
  });

  test('a card the batch changed reloads even though the batch was ours', async function (assert) {
    let report = await cardAt('report-adopted');
    let activity = await unsavedActivity('Lab safety');
    let store = getService('store');

    let [created] = (await (operations(report) as any).atomic((b: any) => {
      let minted = b.create(activity);
      b.addActivity({ activity: minted });
      return [minted];
    })) as [{ id: string }];

    // The realm appended the link, so the report the store is holding is a
    // version behind by construction: nothing local produced this state, and
    // the event is the only word the store gets that it exists.
    deliverIndexEvent({
      invalidations: [created.id, `${testRealmURL}report-adopted`],
      clientRequestId: lastClientRequestId(),
      clientAuthored: [created.id],
    });
    await settled();

    let links = (report as any).activities ?? [];
    assert.strictEqual(
      links.length,
      1,
      'the report re-read the state the realm computed for it',
    );
    assert.strictEqual(
      links[0]?.id,
      created.id,
      'and holds the card the batch minted',
    );
    assert.strictEqual(
      store.peek(`${testRealmURL}report-adopted`),
      report,
      'in the object the store was already holding',
    );
  });

  test('a save that starts during the batch patches the card the batch named', async function (assert) {
    let report = await cardAt('report-racing');
    let activity = await unsavedActivity('Lab safety');
    let localId = activity[localIdSymbol];
    let store = getService('store');
    let cardService = getService('card-service');

    // Every write the store itself issues, in order. The batch does not appear
    // here — it goes to the realm over the authenticated fetch — so what this
    // records is exactly the saves that raced it.
    let writes: { method: string; url: string }[] = [];
    let originalFetchJSON = cardService.fetchJSON.bind(cardService);
    cardService.fetchJSON = async (url: any, args: any) => {
      if (args?.method === 'POST' || args?.method === 'PATCH') {
        writes.push({ method: args.method, url: String(url) });
      }
      return await originalFetchJSON(url, args);
    };

    // The edit is made from inside the batch's own lock, which is the window
    // the lock exists for: the realm is being asked to mint the card while the
    // user is still typing into it. Hooking the lock is what puts the edit
    // there — before it the save could reach the realm first and create a
    // second card, which is a race the lock does not claim to settle.
    let originalLocks = store.withMutationLocks.bind(store);
    let raced = false;
    (store as any).withMutationLocks = async (
      localIds: readonly string[],
      fn: () => Promise<unknown>,
    ) =>
      await originalLocks(localIds, async () => {
        if (!raced) {
          raced = true;
          (activity as any).headline = 'Lab safety, revised';
          store.save(localId);
        }
        return await fn();
      });

    let created: { id: string };
    try {
      [created] = (await (operations(report) as any).atomic((b: any) => {
        let minted = b.create(activity);
        b.addActivity({ activity: minted });
        return [minted];
      })) as [{ id: string }];
      await settled();
    } finally {
      (store as any).withMutationLocks = originalLocks;
      delete (cardService as any).fetchJSON;
    }

    assert.true(raced, 'the save was issued while the batch held the lock');
    assert.deepEqual(
      writes,
      [{ method: 'PATCH', url: created.id }],
      'the save waited for the realm to name the card and then patched it, rather than creating a second one',
    );

    let stored = (await originalFetchJSON(created.id)) as any;
    assert.strictEqual(
      stored.data.attributes.headline,
      'Lab safety, revised',
      'so the realm holds the edit that was typed while the batch was in flight',
    );
  });

  test('a card minted from plain data is not the store’s to hold', async function (assert) {
    let report = await cardAt('report-data-only');
    let { Activity } = await loader.import<any>(`${testRealmURL}report`);
    let store = getService('store');

    let [created] = (await (operations(report) as any).atomic((b: any) => {
      let minted = b.create(Activity, { headline: 'Lab safety' });
      b.addActivity({ activity: minted });
      return [minted];
    })) as [{ id: string; lid?: string }];

    assert.strictEqual(
      store.peek(created.id),
      undefined,
      'nothing was holding this card, so the batch left nothing to reconcile',
    );
    assert.notStrictEqual(
      created.lid,
      undefined,
      `the batch named the card itself: ${created.lid}`,
    );
    assert.notStrictEqual(
      created.lid,
      created.id,
      'under a name of its own rather than the URL the realm minted',
    );

    deliverIndexEvent({
      invalidations: [created.id, `${testRealmURL}report-data-only`],
      clientRequestId: lastClientRequestId(),
      clientAuthored: [created.id],
    });
    await settled();

    let links = (report as any).activities ?? [];
    assert.strictEqual(
      links.length,
      1,
      'the report the batch changed reloaded and lazy-loaded the new card',
    );
    assert.strictEqual((links[0] as any)?.headline, 'Lab safety');
  });

  test('a consumer in another realm is re-saved with the URL the batch minted', async function (assert) {
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: testRealm2URL,
      contents: {
        'consumer.json': {
          data: {
            type: 'card',
            attributes: { headline: 'Consumer', status: 'open' },
            relationships: { 'activities.0': { links: { self: null } } },
            meta: { adoptsFrom: reportRef() },
          },
        },
      },
    });
    await getService('realm').login(testRealm2URL);
    // Mounting a realm resets the loader, so the module, the entry point and
    // every card are read after it: `operations()` asks what a value is an
    // instance of, and a copy from the earlier loader would not recognize a
    // card the store built with the new one.
    loader = getService('loader-service').loader;
    ({ operations } = await loader.import<typeof OperationsModule>(
      '@cardstack/base/operations',
    ));

    let report = await cardAt('report-foreign');
    let activity = await unsavedActivity('Lab safety');
    let consumer = (await getService('store').get<CardDefType>(
      `${testRealm2URL}consumer`,
    )) as CardDefType;
    // The link a browser makes before the target has a URL: the consumer in the
    // other realm points at a card that exists only in this tab.
    (consumer as any).activities = [activity];

    let [created] = (await (operations(report) as any).atomic((b: any) => {
      let minted = b.create(activity);
      b.addActivity({ activity: minted });
      return [minted];
    })) as [{ id: string }];
    await settled();

    let stored = (await getService('card-service').fetchJSON(
      `${testRealm2URL}consumer`,
    )) as any;
    let links = Object.values(
      (stored.data.relationships ?? {}) as Record<string, any>,
    ).map((relationship) => relationship?.links?.self);
    assert.true(
      links.some((link: string | undefined) => link === created.id),
      `the consumer's stored link names the URL the batch minted: ${JSON.stringify(
        links,
      )}`,
    );
  });

  test('a pairing that contradicts one the store already made is reported to the caller', async function (assert) {
    let report = await cardAt('report-conflicting');
    let activity = await unsavedActivity('Lab safety');
    let store = getService('store');
    let { Activity } = await loader.import<any>(`${testRealmURL}report`);

    // A second instance, already holding the URL the batch is about to mint for
    // the first. Only one object can be the card at that URL.
    let taken = `${testRealmURL}Activity/${activity[localIdSymbol]}`;
    let impostor = new Activity({ headline: 'Impostor' });
    await store.add<CardDefType>(impostor, {
      doNotPersist: true,
      realm: testRealmURL,
    });
    (store as any).store.setCard(taken, impostor);

    await assert.rejects(
      (operations(report) as any).atomic((b: any) => {
        let minted = b.create(activity);
        b.addActivity({ activity: minted });
        return [minted];
      }),
      /already holds that card under local id/,
      'the batch that caused it is what reports it, rather than an event handler far from the cause',
    );
  });
});
