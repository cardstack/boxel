import { getOwner } from '@ember/owner';
import { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { setupWindowMock } from 'ember-window-mock/test-support';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import PreviewFormatCommand from '@cardstack/host/commands/preview-format';
import RealmService from '@cardstack/host/services/realm';

import {
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupOnSave,
  testRealmURL,
  testRealmInfo,
  setupSnapshotRealm,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

class StubRealmService extends RealmService {
  get defaultReadableRealm() {
    return {
      path: testRealmURL,
      info: testRealmInfo,
    };
  }
}

module('Integration | Command | preview-format', function (hooks) {
  setupRenderingTest(hooks);
  setupWindowMock(hooks);

  const realmName = 'Preview Format Test Realm';
  let loader: Loader;
  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });
  let snapshot = setupSnapshotRealm(hooks, {
    mockMatrixUtils,
    async build({ loader }) {
      let loaderService = getService('loader-service');
      loaderService.loader = loader;
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'rental-item.gts': `
          import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
          import StringField from 'https://cardstack.com/base/string';
          import NumberField from 'https://cardstack.com/base/number';

          export class RentalItem extends CardDef {
            static displayName = 'RentalItem';
            @field name = contains(StringField);
            @field description = contains(StringField);
            @field price = contains(NumberField);
            @field title = contains(StringField, {
              computeVia: function (this: RentalItem) {
                return this.name;
              },
            });
          }
        `,
          'RentalItem/example.json': {
            data: {
              type: 'card',
              attributes: {
                name: 'Bike Rental',
                description: 'Mountain bike for rent',
                price: 25,
              },
              meta: {
                adoptsFrom: {
                  module: `../rental-item`,
                  name: 'RentalItem',
                },
              },
            },
          },
          '.realm.json': `{ "name": "${realmName}", "iconURL": "https://boxel-images.boxel.ai/icons/Letter-s.png" }`,
        },
        loader,
      });
      return {
        command: new PreviewFormatCommand(
          getService('command-service').commandContext,
        ),
        loader,
      };
    },
  });

  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
    ({ loader, command } = snapshot.get());
  });

  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  let command: PreviewFormatCommand;

  test('switches to code submode and sets up preview', async function (assert) {
    const cardId = `${testRealmURL}RentalItem/example`;
    const modulePath = `${testRealmURL}rental-item.gts`;
    const format = 'isolated';

    await command.execute({ cardId, format, modulePath });

    // Use the real services
    let operatorModeStateService = getService('operator-mode-state-service');
    let playgroundPanelService = getService('playground-panel-service');

    // Verify that code path was updated
    assert.strictEqual(
      operatorModeStateService.state.codePath?.href,
      `${testRealmURL}rental-item.gts`,
      'Code path points to rental-item.gts module',
    );

    // Verify that module inspector view was set to preview
    assert.strictEqual(
      operatorModeStateService.state.moduleInspector,
      'preview',
      'Module inspector view was set to preview',
    );

    // Verify that playground selection was persisted with correct format
    let selection = playgroundPanelService.getSelection(
      `${testRealmURL}rental-item/RentalItem`,
    );
    assert.ok(selection, 'Playground selection exists');
    assert.strictEqual(
      selection.cardId,
      cardId,
      'Persisted selection has correct card ID',
    );
    assert.strictEqual(
      selection.format,
      format,
      'Persisted selection has correct format',
    );
  });

  test('command metadata', function (assert) {
    assert.strictEqual(
      command.description,
      'Open code mode, navigate to a module, set preview panel to isolated view, and show a card in the specified format.',
      'Command has correct description',
    );
    assert.strictEqual(
      PreviewFormatCommand.actionVerb,
      'Preview Format',
      'Command has correct action verb',
    );
  });
});
