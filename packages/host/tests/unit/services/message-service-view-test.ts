import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import type MessageService from '@cardstack/host/services/message-service';

import type { RealmEventContent } from '@cardstack/base/matrix-event';

const realmURL = 'https://realms.example/cardstack/pretui/';

module('Unit | Service | message-service view isolation', function (hooks) {
  setupTest(hooks);

  hooks.afterEach(function () {
    delete (
      globalThis as unknown as {
        __boxelRealmView?: { realmURL: string; view: string };
      }
    ).__boxelRealmView;
  });

  test('relays only the selected execution view plus branch activity', function (assert) {
    let selectedView = 'a'.repeat(64);
    (
      globalThis as unknown as {
        __boxelRealmView?: { realmURL: string; view: string };
      }
    ).__boxelRealmView = { realmURL, view: selectedView };
    let service = this.owner.lookup(
      'service:message-service',
    ) as MessageService;
    let received: RealmEventContent[] = [];
    let unsubscribe = service.subscribe(realmURL, (event) =>
      received.push(event),
    );

    service.relayRealmEvent({
      eventName: 'index',
      indexType: 'incremental',
      realmURL,
      invalidations: [`${realmURL}button`],
    });
    service.relayRealmEvent({
      eventName: 'prerender_html',
      realmURL,
      realmView: 'b'.repeat(64),
      generation: 2,
      invalidations: [`${realmURL}button`],
    });
    service.relayRealmEvent({
      eventName: 'prerender_html',
      realmURL,
      realmView: selectedView,
      generation: 2,
      invalidations: [`${realmURL}button`],
    });
    service.relayRealmEvent({
      eventName: 'branch',
      realmURL,
      branch: 'ana/compact-status',
      previousRealmView: 'b'.repeat(64),
      realmView: selectedView,
      refGeneration: 3,
      repositoryHash: 'c'.repeat(64),
      treeHash: 'd'.repeat(64),
      historyHead: 'jj-step-3',
      message: 'Tighten compact status spacing',
    });

    assert.deepEqual(
      received.map(({ eventName }) => eventName),
      ['prerender_html', 'branch'],
      'live and sibling execution events are isolated; branch activity remains visible',
    );
    unsubscribe();
  });
});
