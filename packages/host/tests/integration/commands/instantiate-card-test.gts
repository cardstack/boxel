import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import InstantiateCardCommand from '@cardstack/host/commands/instantiate-card';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

const VALID_MODULE = `
  import { contains, field, CardDef } from "https://cardstack.com/base/card-api";
  import StringField from "https://cardstack.com/base/string";
  export class ValidCard extends CardDef {
    static displayName = 'Valid Card';
    @field name = contains(StringField);
  }
`;

const PHONE_NUMBER_FIELD = `
  import { FieldDef, field, contains } from "https://cardstack.com/base/card-api";
  import StringField from "https://cardstack.com/base/string";
  export class PhoneNumber extends FieldDef {
    static displayName = 'Phone Number';
    @field number = contains(StringField);
  }
`;

const BAD_LINKS_TO_MODULE = `
  import { CardDef, field, linksTo, contains } from "https://cardstack.com/base/card-api";
  import StringField from "https://cardstack.com/base/string";
  import { PhoneNumber } from "./phone-number-field";
  export class ContactCard extends CardDef {
    static displayName = 'Contact Card';
    @field name = contains(StringField);
    @field phone = linksTo(PhoneNumber);
  }
`;

module('Integration | commands | instantiate-card', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function () {
    await withCachedRealmSetup(async () => {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        realmURL: testRealmURL,
        contents: {
          'valid-card.gts': VALID_MODULE,
          'phone-number-field.gts': PHONE_NUMBER_FIELD,
          'bad-links-to-card.gts': BAD_LINKS_TO_MODULE,
        },
      });
    });
  });

  test('valid card with instance data passes instantiation', async function (assert) {
    let commandService = getService('command-service');
    let command = new InstantiateCardCommand(commandService.commandContext);

    let InputType = await command.getInputType();
    let instanceDoc = {
      data: {
        type: 'card',
        attributes: { name: 'Test Card' },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}valid-card`,
            name: 'ValidCard',
          },
        },
      },
    };
    let input = new InputType({
      moduleUrl: `${testRealmURL}valid-card`,
      cardName: 'ValidCard',
      realmUrl: testRealmURL,
      instanceData: JSON.stringify(instanceDoc),
    });

    let result = await command.execute(input);

    assert.true(result.passed, 'valid card with instance data should pass');
    assert.notOk(result.error, 'no error for valid instantiation');
  });

  test('valid card with no instance data passes instantiation', async function (assert) {
    let commandService = getService('command-service');
    let command = new InstantiateCardCommand(commandService.commandContext);

    let InputType = await command.getInputType();
    let input = new InputType({
      moduleUrl: `${testRealmURL}valid-card`,
      cardName: 'ValidCard',
      realmUrl: testRealmURL,
    });

    let result = await command.execute(input);

    assert.true(result.passed, 'valid card with no instance data should pass');
    assert.notOk(result.error, 'no error for empty instantiation');
  });

  test('card with linksTo consuming a FieldDef fails instantiation', async function (assert) {
    let commandService = getService('command-service');
    let command = new InstantiateCardCommand(commandService.commandContext);

    let InputType = await command.getInputType();
    let instanceDoc = {
      data: {
        type: 'card',
        attributes: { name: 'Test Contact' },
        relationships: {
          phone: {
            links: { self: null },
          },
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}bad-links-to-card`,
            name: 'ContactCard',
          },
        },
      },
    };
    let input = new InputType({
      moduleUrl: `${testRealmURL}bad-links-to-card`,
      cardName: 'ContactCard',
      realmUrl: testRealmURL,
      instanceData: JSON.stringify(instanceDoc),
    });

    let result = await command.execute(input);

    assert.false(result.passed, 'linksTo with FieldDef should fail instantiation');
    assert.ok(result.error, 'should have an error message');
  });
});
