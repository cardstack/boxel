import { getOwner } from '@ember/owner';
import { visit, waitFor, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { ensureTrailingSlash, isCardInstance } from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';
import HostModeService from '@cardstack/host/services/host-mode-service';

import { setupLocalIndexing } from '../helpers';
import { setupApplicationTest } from '../helpers/setup';

const catalogRealmURL = ensureTrailingSlash(ENV.resolvedCatalogRealmURL);
const CATALOG_READINESS_URL = `${catalogRealmURL}_readiness-check?acceptHeader=application%2Fvnd.api%2Bjson`;
const CATALOG_SITE_URL = `${catalogRealmURL}site.json`;
const CATALOG_INDEX_URL = `${catalogRealmURL}index`;
const CATALOG_INDEX_JSON_URL = `${CATALOG_INDEX_URL}.json`;

class StubHostModeService extends HostModeService {
  override get isActive() {
    return true;
  }

  override get hostModeOrigin() {
    return 'http://localhost:4201';
  }
}

module('Acceptance | Catalog | real catalog app', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);

  hooks.beforeEach(function () {
    getOwner(this)!.register('service:host-mode-service', StubHostModeService);
  });

  test('visiting /catalog/ renders the catalog index card', async function (assert) {
    let realmServer = getService('realm-server');
    await realmServer.ready;
    await ensureCatalogRealmReady();
    await ensureCatalogCardLoaded(CATALOG_SITE_URL, 'site config');
    await ensureCatalogCardLoaded(CATALOG_INDEX_URL, 'index card');
    await ensureCatalogCardLoaded(CATALOG_INDEX_JSON_URL, 'index JSON');

    await visit('/catalog/');

    await waitFor('[data-test-catalog-app]', { timeout: 30_000 });
    assert.dom('[data-test-card-error]').doesNotExist();
    assert.dom('[data-test-catalog-app]').exists();
  });
});

async function ensureCatalogRealmReady() {
  let network = getService('network');
  await waitUntil(
    async () => {
      try {
        let response = await network.fetch(CATALOG_READINESS_URL);
        return response.ok;
      } catch (e) {
        return false;
      }
    },
    {
      timeout: 30_000,
      timeoutMessage: `Timed out waiting for catalog realm readiness at ${CATALOG_READINESS_URL}`,
    },
  );
}

async function ensureCatalogCardLoaded(url: string, description: string) {
  let store = getService('store');
  await waitUntil(
    async () => {
      try {
        let card = await store.get(url);
        return Boolean(card && isCardInstance(card));
      } catch (_e) {
        return false;
      }
    },
    {
      timeout: 60_000,
      timeoutMessage: `Timed out waiting for catalog ${description} card at ${url}`,
    },
  );
}
