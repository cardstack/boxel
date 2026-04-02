import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import OpenCreateListingModalCommand from '@cardstack/host/commands/open-create-listing-modal';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | commands | open-create-listing-modal', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function () {
    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'pet.gts': `
            import {
              CardDef,
              Component,
              FieldDef,
              contains,
              field,
            } from "@cardstack/base/card-api";
            import StringField from "@cardstack/base/string";

            export class PetName extends FieldDef {
              static displayName = 'Pet Name';
            }

            export class Pet extends CardDef {
              static displayName = 'Pet';

              @field name = contains(StringField);

              static isolated = class Isolated extends Component<typeof this> {
                <template><@fields.name /></template>
              };
            }
          `,
        },
      }),
    );
  });

  test('stores modal payload in operator mode state', async function (assert) {
    let commandService = getService('command-service');
    let operatorModeStateService = getService('operator-mode-state-service');

    let command = new OpenCreateListingModalCommand(
      commandService.commandContext,
    );

    await command.execute({
      codeRef: {
        module: `${testRealmURL}pet`,
        name: 'Pet',
      },
      targetRealm: testRealmURL,
      openCardIds: [`${testRealmURL}Pet/mango`],
    } as never);

    assert.deepEqual(operatorModeStateService.createListingModalPayload, {
      codeRef: {
        module: `${testRealmURL}pet`,
        name: 'Pet',
      },
      targetRealm: testRealmURL,
      openCardIds: [`${testRealmURL}Pet/mango`],
      declarationKind: 'card',
    });
  });

  test('stores modal payload without openCardIds', async function (assert) {
    let commandService = getService('command-service');
    let operatorModeStateService = getService('operator-mode-state-service');

    let command = new OpenCreateListingModalCommand(
      commandService.commandContext,
    );

    await command.execute({
      codeRef: {
        module: `${testRealmURL}pet`,
        name: 'Pet',
      },
      targetRealm: testRealmURL,
    } as never);

    let payload = operatorModeStateService.createListingModalPayload;
    assert.deepEqual(payload?.codeRef, {
      module: `${testRealmURL}pet`,
      name: 'Pet',
    });
    assert.strictEqual(payload?.targetRealm, testRealmURL);
    assert.deepEqual(
      payload?.openCardIds,
      [],
      'openCardIds is empty when not provided',
    );
    assert.strictEqual(
      payload?.declarationKind,
      'card',
      'card defs are tagged as card listings',
    );
  });

  test('stores modal payload with examples hidden for field defs', async function (assert) {
    let commandService = getService('command-service');
    let operatorModeStateService = getService('operator-mode-state-service');

    let command = new OpenCreateListingModalCommand(
      commandService.commandContext,
    );

    await command.execute({
      codeRef: {
        module: `${testRealmURL}pet`,
        name: 'PetName',
      },
      targetRealm: testRealmURL,
    } as never);

    assert.strictEqual(
      operatorModeStateService.createListingModalPayload?.declarationKind,
      'field',
      'examples are hidden for field defs',
    );
  });

  test('dismissCreateListingModal clears the payload', async function (assert) {
    let commandService = getService('command-service');
    let operatorModeStateService = getService('operator-mode-state-service');

    let command = new OpenCreateListingModalCommand(
      commandService.commandContext,
    );

    await command.execute({
      codeRef: {
        module: `${testRealmURL}pet`,
        name: 'Pet',
      },
      targetRealm: testRealmURL,
      openCardIds: [`${testRealmURL}Pet/mango`],
    } as never);

    assert.ok(
      operatorModeStateService.createListingModalPayload,
      'payload is set after execute',
    );

    operatorModeStateService.dismissCreateListingModal();

    assert.strictEqual(
      operatorModeStateService.createListingModalPayload,
      undefined,
      'payload is cleared after dismissCreateListingModal',
    );
  });
});
