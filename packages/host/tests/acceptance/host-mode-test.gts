import { getOwner } from '@ember/owner';
import { visit } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { getPageTitle } from 'ember-page-title/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import HostModeService from '@cardstack/host/services/host-mode-service';

import {
  percySnapshot,
  setupLocalIndexing,
  setupOnSave,
  testHostModeRealmURL,
  setupAcceptanceTestRealm,
  setupAuthEndpoints,
  setupUserSubscription,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

let testHostModeRealmURLWithoutRealm = testHostModeRealmURL.replace(
  /\/test\/?$/,
  '',
);

// Overrides to simulate a request to a host mode domain
class StubHostModeService extends HostModeService {
  get isActive() {
    return true;
  }

  get hostModeOrigin() {
    return removeTrailingSlash(testHostModeRealmURLWithoutRealm);
  }
}

class StubCustomSubdomainHostModeService extends StubHostModeService {
  get hostModeOrigin() {
    return removeTrailingSlash(testHostModeRealmURL);
  }
}

module('Acceptance | host mode tests', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testHostModeRealmURL],
  });

  let { setActiveRealms, setExpiresInSec, createAndJoinRoom } = mockMatrixUtils;

  hooks.beforeEach(function (this) {
    getOwner(this)!.register('service:host-mode-service', StubHostModeService);
  });

  hooks.beforeEach(async function () {
    createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription();
    setupAuthEndpoints();

    setExpiresInSec(60 * 60);

    let loader = getService('loader-service').loader;
    let cardApi: typeof import('https://cardstack.com/base/card-api');
    let string: typeof import('https://cardstack.com/base/string');
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);

    let { field, contains, CardDef, Component } = cardApi;
    let { default: StringField } = string;

    class Pet extends CardDef {
      static displayName = 'Pet';
      static headerColor = '#355e3b';
      @field name = contains(StringField);
      @field title = contains(StringField, {
        computeVia: function (this: Pet) {
          return this.name;
        },
      });
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <h3 data-test-pet={{@model.name}}>
            <@fields.name />
          </h3>
        </template>
      };
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div class='pet-isolated'>
            <h2 data-test-pet-isolated={{@model.name}}>
              <@fields.name />
            </h2>
          </div>
          <style scoped>
            .pet-isolated {
              height: 100%;
              background-color: #355e3b;
            }
            h2 {
              margin: 0;
              padding: 20px;
              color: white;
            }
          </style>
        </template>
      };
    }

    await setupAcceptanceTestRealm({
      realmURL: testHostModeRealmURL,
      mockMatrixUtils,
      permissions: {
        '*': ['read'],
      },
      contents: {
        'pet.gts': { Pet },
        'Pet/mango.json': {
          data: {
            attributes: {
              name: 'Mango',
            },
            meta: {
              adoptsFrom: {
                module: `${testHostModeRealmURL}pet`,
                name: 'Pet',
              },
            },
          },
        },
        'index.json': {
          data: {
            type: 'card',
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/cards-grid',
                name: 'CardsGrid',
              },
            },
          },
        },
        '.realm.json': {
          name: 'Test Workspace B',
          backgroundURL:
            'https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg',
          iconURL: 'https://i.postimg.cc/L8yXRvws/icon.png',
          publishable: true,
        },
      },
    });

    setActiveRealms([testHostModeRealmURL]);
  });

  test('visiting a default width card in host mode', async function (assert) {
    await visit('/test/Pet/mango.json');

    assert.dom('[data-test-host-mode-container]').hasStyle({
      'background-image':
        'url("https://i.postimg.cc/VNvHH93M/pawel-czerwinski-Ly-ZLa-A5jti-Y-unsplash.jpg")',
    });

    assert.dom(`[data-test-card="${testHostModeRealmURL}Pet/mango"]`).exists();
    assert.dom('[data-test-host-mode-container]').hasNoClass('is-wide');
    assert.strictEqual(getPageTitle(), 'Mango');

    await percySnapshot(assert);
  });

  test('visiting a full width card in host mode', async function (assert) {
    await visit('/test');

    assert.dom(`[data-test-card="${testHostModeRealmURL}index"]`).exists();
    assert.strictEqual(getPageTitle(), 'Test Workspace B');
    assert.dom('[data-test-host-mode-container]').hasClass('is-wide');

    await percySnapshot(assert);
  });

  test('visiting a non-existent card shows an error', async function (assert) {
    await visit('/test/Pet/non-existent.json');

    assert
      .dom('[data-test-error="not-found"]')
      .hasText(`Card not found: ${testHostModeRealmURL}Pet/non-existent`);
    assert.strictEqual(
      getPageTitle(),
      `Card not found: ${testHostModeRealmURL}Pet/non-existent`,
    );
  });

  module('with a custom subdomain', function (hooks) {
    hooks.beforeEach(function (this) {
      getOwner(this)!.register(
        'service:host-mode-service',
        StubCustomSubdomainHostModeService,
      );
    });

    test('visiting a card in host mode', async function (assert) {
      await visit('/Pet/mango.json');

      assert
        .dom(`[data-test-card="${testHostModeRealmURL}Pet/mango"]`)
        .exists();
    });
  });
});

function removeTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}
