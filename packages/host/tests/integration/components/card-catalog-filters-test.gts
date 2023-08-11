import { module, test } from 'qunit';
import GlimmerComponent from '@glimmer/component';
import { baseRealm } from '@cardstack/runtime-common';
import { Realm } from '@cardstack/runtime-common/realm';
import { setupRenderingTest } from 'ember-qunit';
import { renderComponent } from '../../helpers/render-component';
import {
  TestRealm,
  TestRealmAdapter,
  testRealmURL,
  setupLocalIndexing,
} from '../../helpers';
import CardPrerender from '@cardstack/host/components/card-prerender';
import OperatorMode from '@cardstack/host/components/operator-mode/container';
import { waitFor, click } from '@ember/test-helpers';
import type LoaderService from '@cardstack/host/services/loader-service';
import type { Loader } from '@cardstack/runtime-common/loader';
import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

const realmName = 'Local Workspace';
let setCardInOperatorModeState: (card: string) => Promise<void>;
let loader: Loader;

module('Integration | card catalog filters', function (hooks) {
  let realm: Realm;
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  // setupOnSave(hooks);
  // setupCardLogs(
  //   hooks,
  //   async () => await loader.import(`${baseRealm.url}card-api`),
  // );

  const files = {
    '.realm.json': `{ "name": "${realmName}", "iconURL": "https://example-icon.test" }`,
    'grid.json': {
      data: {
        type: 'card',
        attributes: {},
        meta: {
          adoptsFrom: {
            module: 'https://cardstack.com/base/cards-grid',
            name: 'CardsGrid',
          },
        },
      },
    },
    'pet.gts': `
      import { contains, field, Component, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Pet extends Card {
        static displayName = 'Pet';
        @field name = contains(StringCard);
        @field title = contains(StringCard, {
          computeVia: function (this: Pet) {
            return this.name;
          },
        });
      }
    `,
    'CatalogEntry/pet.json': {
      data: {
        type: 'card',
        attributes: {
          title: 'Pet',
          description: 'Catalog entry for Pet',
          ref: {
            module: `${testRealmURL}pet`,
            name: 'Pet',
          },
          demo: {
            name: 'Jackie',
          },
        },
        relationships: {
          'demo.blogPost': {
            links: {
              self: '../BlogPost/1',
            },
          },
        },
        meta: {
          fields: {
            demo: {
              adoptsFrom: {
                module: `./pet`,
                name: 'Pet',
              },
            },
          },
          adoptsFrom: {
            module: 'https://cardstack.com/base/catalog-entry',
            name: 'CatalogEntry',
          },
        },
      },
    },
  };

  hooks.beforeEach(async function () {
    let loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;
    realm = await TestRealm.create(loader, files, this.owner);
    await realm.ready;

    setCardInOperatorModeState = async (cardURL: string) => {
      let operatorModeStateService = this.owner.lookup(
        'service:operator-mode-state-service',
      ) as OperatorModeStateService;

      await operatorModeStateService.restore({
        stacks: [
          [
            {
              type: 'card',
              id: cardURL,
              format: 'isolated',
            },
          ],
        ],
      });
    };
  });

  let noop = () => {};

  test('displays all realms by default', async function (assert) {
    await setCardInOperatorModeState(`${testRealmURL}grid`);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
          <CardPrerender />
        </template>
      },
    );

    await waitFor(`[data-test-stack-card="${testRealmURL}grid"]`);
    await click('[data-test-create-new-card-button]');

    await this.pauseTest();

    await waitFor('[data-test-card-catalog-modal] [data-test-realm-name]');
    assert
      .dom('[data-test-card-catalog-modal] [data-test-realm-name]')
      .exists();
  });
});
