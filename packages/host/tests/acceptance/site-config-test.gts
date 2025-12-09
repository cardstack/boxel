import { getOwner } from '@ember/owner';
import { click, settled, visit, waitFor, waitUntil } from '@ember/test-helpers';

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

import type { TestRealmAdapter } from '../helpers/adapter';

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
      'Pet/peanut.json': {
        data: {
          attributes: {
            name: 'Peanut',
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
        hostHome: `${testRealmURL}site`,
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

      let contents = {
        ...realmContents,
        '.realm.json': {
          ...(realmContents['.realm.json'] as any),
          hostHome: `${testHostModeRealmURL}site`,
        },
      };
      setExpiresInSec(60 * 60);
      await setupAcceptanceTestRealm({
        realmURL: testHostModeRealmURL,
        mockMatrixUtils,
        contents,
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

    test('host submode updates primary card after home page change', async function (assert) {
      await visitOperatorMode({
        submode: 'interact',
        stacks: [[{ id: `${testRealmURL}`, format: 'isolated' }]],
      });
      await waitFor(`[data-test-stack-card="${testRealmURL}index"]`);

      await click('[data-test-submode-switcher] > [data-test-boxel-button]');
      await click('[data-test-boxel-menu-item-text="Host"]');
      await waitFor('[data-test-submode-switcher="host"]');
      await waitFor(`[data-test-host-mode-card="${testRealmURL}Pet/mango"]`);

      await click('[data-test-submode-switcher] > [data-test-boxel-button]');
      await click('[data-test-boxel-menu-item-text="Interact"]');
      await waitFor('[data-test-submode-switcher="interact"]');
      await waitFor(`[data-test-stack-card="${testRealmURL}index"]`);
      await click('[data-test-boxel-filter-list-button="All Cards"]');
      await click(`[data-cards-grid-item="${testRealmURL}site"]`);

      await click(
        `[data-test-stack-card="${testRealmURL}site"] [data-test-edit-button]`,
      );
      await waitFor(
        `[data-test-links-to-editor="home"] [data-test-remove-card]`,
      );

      await click(`[data-test-links-to-editor="home"] [data-test-remove-card]`);
      await waitFor(`[data-test-links-to-editor="home"] [data-test-add-new]`);

      await click(`[data-test-links-to-editor="home"] [data-test-add-new]`);
      await waitFor('[data-test-card-catalog-modal]');
      await click(`[data-test-card-catalog-item="${testRealmURL}Pet/peanut"]`);
      await click('[data-test-card-catalog-go-button]');
      await waitUntil(
        () => !document.querySelector('[data-test-card-catalog-modal]'),
      );
      await waitFor(
        `[data-test-links-to-editor="home"] [data-test-card="${testRealmURL}Pet/peanut"]`,
      );

      await click(
        `[data-test-stack-card="${testRealmURL}site"] [data-test-edit-button]`,
      );
      await waitFor(
        `[data-test-stack-card="${testRealmURL}site"] [data-test-card-format="isolated"]`,
      );
      await settled();
      await click(
        `[data-test-stack-card="${testRealmURL}site"] [data-test-close-button]`,
      );

      await click('[data-test-submode-switcher] > [data-test-boxel-button]');
      await click('[data-test-boxel-menu-item-text="Host"]');
      await waitFor('[data-test-submode-switcher="host"]');
      await waitFor(`[data-test-host-mode-card="${testRealmURL}Pet/peanut"]`);
      assert
        .dom(`[data-test-host-mode-card="${testRealmURL}Pet/peanut"]`)
        .exists();
      assert
        .dom(`[data-test-host-mode-card="${testRealmURL}Pet/mango"]`)
        .doesNotExist();
    });
  });

  module('set site config command', function () {
    let adapter: TestRealmAdapter;

    module('when site config file does not exist', function (hooks) {
      hooks.beforeEach(async function () {
        let contents = {
          ...realmContents,
          '.realm.json': {
            ...(realmContents['.realm.json'] as any),
            hostHome: null,
          },
        };
        delete contents['site.json'];
        contents['SiteConfig/custom.json'] = {
          data: {
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/site-config',
                name: 'SiteConfig',
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
                  self: '../Pet/peanut',
                },
              },
              'cardInfo.theme': {
                links: {
                  self: null,
                },
              },
            },
          },
        };

        ({ adapter } = await setupAcceptanceTestRealm({
          contents,
          mockMatrixUtils,
        }));
      });

      test('user can create a site config via stack menu', async function (assert) {
        await visitOperatorMode({
          submode: 'interact',
          stacks: [
            [
              {
                id: `${testRealmURL}SiteConfig/custom`,
                format: 'isolated',
              },
            ],
          ],
        });

        await waitFor(
          `[data-test-stack-card="${testRealmURL}SiteConfig/custom"]`,
        );
        await click('[data-test-more-options-button]');
        await click('[data-test-boxel-menu-item-text="Set as site home"]');

        let realmDoc: any;
        await waitUntil(async () => {
          let file = await adapter.openFile('.realm.json');
          if (!file) {
            return false;
          }
          let content =
            typeof file.content === 'string'
              ? file.content
              : JSON.stringify(file.content);
          realmDoc = JSON.parse(content);
          return realmDoc.hostHome === `${testRealmURL}SiteConfig/custom`;
        });

        assert.strictEqual(
          realmDoc.hostHome,
          `${testRealmURL}SiteConfig/custom`,
          '.realm.json updated with selected site config',
        );

        let siteDoc = await adapter.openFile('site.json');
        assert.strictEqual(siteDoc, undefined, 'site.json is not created');
      });
    });

    module('when site config file exists', function (hooks) {
      hooks.beforeEach(async function () {
        let contents = {
          ...realmContents,
          '.realm.json': {
            ...(realmContents['.realm.json'] as any),
          },
        };
        contents['SiteConfig/custom.json'] = {
          data: {
            meta: {
              adoptsFrom: {
                module: 'https://cardstack.com/base/site-config',
                name: 'SiteConfig',
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
                  self: '../Pet/peanut',
                },
              },
              'cardInfo.theme': {
                links: {
                  self: null,
                },
              },
            },
          },
        };

        ({ adapter } = await setupAcceptanceTestRealm({
          contents,
          mockMatrixUtils,
        }));
      });

      test('user can update existing site config via stack menu', async function (assert) {
        let initialDoc = await adapter.openFile('.realm.json');
        assert.ok(initialDoc, '.realm.json exists before update');

        await visitOperatorMode({
          submode: 'interact',
          stacks: [
            [
              {
                id: `${testRealmURL}SiteConfig/custom`,
                format: 'isolated',
              },
            ],
          ],
        });

        await waitFor(
          `[data-test-stack-card="${testRealmURL}SiteConfig/custom"]`,
        );
        await click('[data-test-more-options-button]');
        await click('[data-test-boxel-menu-item-text="Set as site home"]');

        let realmDoc: any;
        await waitUntil(async () => {
          let file = await adapter.openFile('.realm.json');
          if (!file) {
            return false;
          }
          let content =
            typeof file.content === 'string'
              ? file.content
              : JSON.stringify(file.content);
          realmDoc = JSON.parse(content);
          return realmDoc.hostHome === `${testRealmURL}SiteConfig/custom`;
        });

        assert.strictEqual(
          realmDoc.hostHome,
          `${testRealmURL}SiteConfig/custom`,
          'realm config updated with new site home',
        );

        let siteDoc = await adapter.openFile('site.json');
        assert.ok(siteDoc, 'existing site.json remains available');
        if (siteDoc) {
          let content =
            typeof siteDoc.content === 'string'
              ? siteDoc.content
              : JSON.stringify(siteDoc.content);
          let parsedSiteDoc = JSON.parse(content);
          assert.strictEqual(
            parsedSiteDoc.data.relationships.home.links.self,
            './Pet/mango',
            'existing site.json content is unchanged',
          );
        }
      });
    });
  });

  module('site config menu visibility', function (hooks) {
    hooks.beforeEach(async function () {
      await setupAcceptanceTestRealm({
        contents: realmContents,
        mockMatrixUtils,
      });
    });

    test('does not show menu for primary site config card', async function (assert) {
      await visitOperatorMode({
        submode: 'interact',
        stacks: [[{ id: `${testRealmURL}site`, format: 'isolated' }]],
      });

      await waitFor(`[data-test-stack-card="${testRealmURL}site"]`);
      await click('[data-test-more-options-button]');
      assert
        .dom('[data-test-boxel-menu-item-text="Set as site home"]')
        .doesNotExist();
    });
  });
});
