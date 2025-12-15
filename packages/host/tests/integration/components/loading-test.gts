import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import {
  testRealmURL,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupOnSave,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | loading', function (hooks) {
  setupRenderingTest(hooks);

  const realmName = 'Operator Mode Workspace';
  let loader: Loader;
  let cardApi: typeof import('https://cardstack.com/base/card-api');

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
  });

  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  hooks.beforeEach(async function () {
    let cardWithBrokenIconDefSource = `
      import NonExistentIcon from '@cardstack/boxel-icons/non-existent';

      import { CardDef } from 'https://cardstack.com/base/card-api';

      export class CardWithBrokenIcon extends CardDef {
        static icon = NonExistentIcon;
      }
    `;

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'card-with-broken-icon.gts': cardWithBrokenIconDefSource,
        '.realm.json': `{ "name": "${realmName}", "iconURL": "https://boxel-images.boxel.ai/icons/Letter-o.png" }`,
      },
    });
  });

  test('Cards attempting to import boxel icon that does not exist renders a 404 icon instead', async function (assert) {
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    let { createFromSerialized } = cardApi;
    let doc = {
      data: {
        attributes: {
          cardInfo: { title: 'Example' },
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}card-with-broken-icon`,
            name: 'CardWithBrokenIcon',
          },
        },
      },
    };
    let exampleCard = await createFromSerialized<typeof CardDef>(
      doc.data,
      doc,
      undefined,
    );
    await renderCard(loader, exampleCard, 'fitted');

    assert.dom('[data-test-card-title]').containsText('Example');
    assert.dom('svg.card-type-icon.icon-tabler-error-404').exists();
  });
});
