import { getOwner } from '@ember/owner';
import { visit, waitFor } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import {
  testHostModeRealmURL,
  testRealmURL,
} from '@cardstack/runtime-common/helpers/const';

import HostModeService from '@cardstack/host/services/host-mode-service';

import {
  setupAcceptanceTestRealm,
  setupAuthEndpoints,
  setupLocalIndexing,
  setupOnSave,
  setupUserSubscription,
  SYSTEM_CARD_FIXTURE_CONTENTS,
} from '../helpers';
import { setupBaseRealm } from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';
import visitOperatorMode from '../helpers/visit-operator-mode';

let testHostModeRealmURLWithoutRealm = testHostModeRealmURL.replace(
  '/user/test/',
  '',
);

class StubHostModeService extends HostModeService {
  get isActive() {
    return true;
  }

  get hostModeOrigin() {
    return removeTrailingSlash(testHostModeRealmURLWithoutRealm);
  }
}

function removeTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

module('Acceptance | site config home page', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
  });

  setupBaseRealm(hooks);
  let realmContents: any;

  hooks.beforeEach(async function () {
    let loader = getService('loader-service').loader;
    let { field, contains, CardDef, Component } = await loader.import<
      typeof import('https://cardstack.com/base/card-api')
    >(`${baseRealm.url}card-api`);
    let { default: StringField } = await loader.import<
      typeof import('https://cardstack.com/base/string')
    >(`${baseRealm.url}string`);

    class Pet extends CardDef {
      static displayName = 'Pet';
      @field name = contains(StringField);
      @field title = contains(StringField, {
        computeVia(this: Pet) {
          return this.name;
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-pet-isolated={{@model.name}}>
            <@fields.name />
          </div>
        </template>
      };
    }

    realmContents = {
      ...SYSTEM_CARD_FIXTURE_CONTENTS,
      'pet.gts': { Pet },
      'Pet/mango.json': {
        data: {
          attributes: {
            name: 'Mango',
          },
          meta: {
            adoptsFrom: {
              module: `../pet`,
              name: 'Pet',
            },
          },
        },
      },
      'site.json': {
        data: {
          meta: {
            adoptsFrom: {
              name: 'SiteConfig',
              module: 'https://cardstack.com/base/site-config',
            },
          },
          type: 'card',
          attributes: {
            cardInfo: {
              notes: null,
              title: null,
              description: null,
              thumbnailURL: null,
            },
          },
          relationships: {
            home: {
              links: {
                self: `./Pet/mango`,
              },
            },
            'cardInfo.theme': {
              links: {
                self: null,
              },
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
        publishable: true,
        name: 'Site Config Workspace',
      },
    };
  });

  module('host mode', function (hooks) {
    let { setActiveRealms, setExpiresInSec, createAndJoinRoom } =
      mockMatrixUtils;

    hooks.beforeEach(async function () {
      createAndJoinRoom({
        sender: '@testuser:localhost',
        name: 'room-test',
      });
      setupUserSubscription();
      setupAuthEndpoints();

      setExpiresInSec(60 * 60);
      await setupAcceptanceTestRealm({
        realmURL: testHostModeRealmURL,
        mockMatrixUtils,
        contents: realmContents,
        permissions: {
          '*': ['read'],
        },
      });

      setActiveRealms([testHostModeRealmURL]);
    });

    hooks.beforeEach(function (this) {
      getOwner(this)!.register(
        'service:host-mode-service',
        StubHostModeService,
      );
    });

    test('host mode uses home card from site config', async function (assert) {
      await visit(`/user/test/`);

      await waitFor(
        `[data-test-host-mode-card="${testHostModeRealmURL}Pet/mango"]`,
      );
      assert
        .dom(`[data-test-host-mode-card="${testHostModeRealmURL}Pet/mango"]`)
        .exists();
    });
  });

  module('host submode', function (hooks) {
    hooks.beforeEach(async function () {
      await setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: realmContents,
      });
    });

    test('host submode uses home card from site config', async function (assert) {
      await visitOperatorMode({
        submode: 'host',
        stacks: [],
      });

      await waitFor('[data-test-host-mode-card]');
      assert
        .dom(`[data-test-host-mode-card="${testRealmURL}Pet/mango"]`)
        .exists();
    });
  });
});
