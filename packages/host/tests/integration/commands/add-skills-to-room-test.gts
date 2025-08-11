import { getOwner } from '@ember/owner';
import { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { setupWindowMock } from 'ember-window-mock/test-support';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import { basicMappings } from '@cardstack/runtime-common/helpers/ai';
import { Loader } from '@cardstack/runtime-common/loader';

import AddSkillsToRoomCommand from '@cardstack/host/commands/add-skills-to-room';
import RealmService from '@cardstack/host/services/realm';

import * as CardAPI from 'https://cardstack.com/base/card-api';

import {
  setupCardLogs,
  setupLocalIndexing,
  setupOnSave,
  testRealmURL,
  testRealmInfo,
} from '../../helpers';
import { setupRenderingTest } from '../../helpers/setup';

class StubRealmService extends RealmService {
  get defaultReadableRealm() {
    return {
      path: testRealmURL,
      info: testRealmInfo,
    };
  }
}

module('Integration | Command | add-skills-to-room', function (hooks) {
  setupRenderingTest(hooks);
  setupWindowMock(hooks);

  let loader: Loader;

  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
    loader = getService('loader-service').loader;
  });

  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  let command: AddSkillsToRoomCommand;

  hooks.beforeEach(async function (this: RenderingTestContext) {
    command = new AddSkillsToRoomCommand(
      getService('command-service').commandContext,
    );
  });

  module('command metadata', function () {
    test('has correct description and action verb', function (assert) {
      assert.strictEqual(
        command.description,
        'Adds skills to a room',
        'Command has correct description',
      );
      assert.strictEqual(
        AddSkillsToRoomCommand.actionVerb,
        'Add',
        'Command has correct action verb',
      );
    });

    test('getInputType returns AddSkillsToRoomInput', async function (assert) {
      const inputType = await command.getInputType();
      assert.ok(inputType, 'Input type is defined');
      // We can't easily test the exact type without mocking the command module loading
      // but we can verify that getInputType doesn't throw an error
    });

    test('getInputJsonSchema', async function (assert) {
      let loader = getService('loader-service').loader;
      let mappings = await basicMappings(loader);
      let cardAPI = await loader.import<typeof CardAPI>(
        `${baseRealm.url}card-api`,
      );
      const inputSchema = await command.getInputJsonSchema(cardAPI, mappings);
      assert.ok(inputSchema, 'Input JSON schema is defined');
      assert.deepEqual(
        inputSchema,
        {
          attributes: {
            properties: {
              roomId: { type: 'string' },
            },
            required: ['roomId'],
            type: 'object',
          },
          relationships: {
            properties: {
              skills: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    links: {
                      type: 'object',
                      properties: {
                        self: { type: 'string' },
                      },
                      required: ['self'],
                    },
                  },
                  required: ['links'],
                },
              },
            },
            required: ['skills'],
            type: 'object',
          },
        },
        'Input schema excludes cardInfo, requires cardId',
      );
    });
  });
});
