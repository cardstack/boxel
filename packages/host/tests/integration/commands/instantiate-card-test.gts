import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import InstantiateCardCommand from '@cardstack/host/tools/instantiate-card';

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

const TAGS_MODULE = `
  import { CardDef, field, contains, containsMany } from "https://cardstack.com/base/card-api";
  import StringField from "https://cardstack.com/base/string";
  export class TagsCard extends CardDef {
    static displayName = 'Tags Card';
    @field name = contains(StringField);
    @field tags = containsMany(StringField);
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
          'tags-card.gts': TAGS_MODULE,
        },
      });
    });
  });

  test('valid card with instance data passes instantiation', async function (assert) {
    let toolService = getService('tool-service');
    let command = new InstantiateCardCommand(toolService.commandContext);

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
      moduleIdentifier: `${testRealmURL}valid-card`,
      cardName: 'ValidCard',
      realmIdentifier: testRealmURL,
      instanceData: JSON.stringify(instanceDoc),
    });

    let result = await command.execute(input);

    assert.true(result.passed, 'valid card with instance data should pass');
    assert.notOk(result.error, 'no error for valid instantiation');
  });

  test('valid card with no instance data passes instantiation', async function (assert) {
    let toolService = getService('tool-service');
    let command = new InstantiateCardCommand(toolService.commandContext);

    let InputType = await command.getInputType();
    let input = new InputType({
      moduleIdentifier: `${testRealmURL}valid-card`,
      cardName: 'ValidCard',
      realmIdentifier: testRealmURL,
    });

    let result = await command.execute(input);

    assert.true(result.passed, 'valid card with no instance data should pass');
    assert.notOk(result.error, 'no error for empty instantiation');
  });

  test('containsMany field with non-array value fails instantiation', async function (assert) {
    let toolService = getService('tool-service');
    let command = new InstantiateCardCommand(toolService.commandContext);

    let InputType = await command.getInputType();
    // Provide a string instead of an array for the containsMany field.
    // Field.validate() should reject this during deserialization.
    let instanceDoc = {
      data: {
        type: 'card',
        attributes: {
          name: 'Bad Tags Card',
          tags: 'not-an-array',
        },
        meta: {
          adoptsFrom: {
            module: `${testRealmURL}tags-card`,
            name: 'TagsCard',
          },
        },
      },
    };
    let input = new InputType({
      moduleIdentifier: `${testRealmURL}tags-card`,
      cardName: 'TagsCard',
      realmIdentifier: testRealmURL,
      instanceData: JSON.stringify(instanceDoc),
    });

    let result = await command.execute(input);

    assert.false(result.passed, 'non-array containsMany value should fail');
    assert.ok(result.error, 'should have an error message');
    assert.ok(
      result.error?.includes('Expected array for field value'),
      `error should mention array field validation, got: ${result.error}`,
    );
  });
});
