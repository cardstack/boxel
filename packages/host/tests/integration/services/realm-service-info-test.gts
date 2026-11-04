import { settled } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { baseRealm, rri } from '@cardstack/runtime-common';

import { UNKNOWN_REALM_NAME } from '@cardstack/host/services/realm';
import type RealmService from '@cardstack/host/services/realm';

import { setupLocalIndexing, testRealmURL } from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | services | realm-service info()', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
    autostart: true,
  });

  test('a failed background load is swallowed, not leaked as an unhandled rejection', async function (assert) {
    let leaked: unknown[] = [];
    let onRejection = (event: PromiseRejectionEvent) => {
      leaked.push(event.reason);
      // Keep the harness's own unhandledrejection guard from failing the test
      // on the very rejection we are asserting is handled; the captured list is
      // the real assertion.
      event.preventDefault();
    };
    window.addEventListener('unhandledrejection', onRejection);
    try {
      let realm = getService('realm') as RealmService;

      // A realm under the mocked realm-server origin (http://test-realm) that
      // was never registered as an in-process realm: every request for it
      // misses the VirtualNetwork handlers and escapes to the real network,
      // where nothing listens, so info()'s background realm-identifying HEAD
      // rejects with `TypeError: Failed to fetch`. info() must return the
      // placeholder synchronously and absorb that rejection — a leak here would
      // surface as a global error and red whatever test happens to be running.
      let info = realm.info('http://test-realm/never-registered/');
      assert.strictEqual(
        info.name,
        UNKNOWN_REALM_NAME,
        'info() returns the placeholder synchronously while the load runs',
      );

      await settled();
    } finally {
      window.removeEventListener('unhandledrejection', onRejection);
    }

    assert.deepEqual(
      leaked,
      [],
      'the failed background realm-info load did not escape as an unhandled rejection',
    );
  });
  test('a realm is identified from a card URL on a server that also serves the app', async function (assert) {
    // Played the way the realm server answers on a published site: a request
    // that accepts anything gets the app's page, which names no realm, and only
    // a request for the card's document reaches the realm, which names itself.
    const SITE = 'http://published-site.test/site/';
    const CARD = `${SITE}Note/one`;
    let asked: (string | null)[] = [];
    let handler = async (req: Request) => {
      if (!req.url.startsWith(SITE)) {
        return null;
      }
      let accept = req.headers.get('Accept');
      asked.push(accept);
      if (accept?.includes('application/vnd.card+json')) {
        return new Response(null, {
          status: 200,
          headers: { 'x-boxel-realm-url': SITE },
        });
      }
      return new Response(null, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    };
    let network = getService('network');
    network.virtualNetwork.mount(handler, { prepend: true });
    try {
      let realm = getService('realm') as RealmService;
      assert.strictEqual(
        realm.realmOf(rri(CARD)),
        undefined,
        'the card’s realm starts unknown',
      );
      realm.info(CARD);
      await settled();
      assert.strictEqual(
        realm.realmOf(rri(CARD)),
        SITE,
        'and is known once the lookup has asked the realm itself',
      );
      assert.deepEqual(
        asked,
        ['application/vnd.card+json'],
        'the lookup asks for the card’s document, which the realm answers',
      );
    } finally {
      network.virtualNetwork.unmount(handler);
    }
  });
});
