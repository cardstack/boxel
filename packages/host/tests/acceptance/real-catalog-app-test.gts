import { getOwner } from '@ember/owner';
import { visit, waitFor } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import HostModeService from '@cardstack/host/services/host-mode-service';

import { setupLocalIndexing } from '../helpers';
import { setupApplicationTest } from '../helpers/setup';

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

    await visit('/catalog/');

    await waitFor('[data-test-catalog-app]');
    assert.dom('[data-test-card-error]').doesNotExist();
    assert.dom('[data-test-catalog-app]').exists();
  });
});
