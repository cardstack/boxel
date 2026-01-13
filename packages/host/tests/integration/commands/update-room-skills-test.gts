import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { setupWindowMock } from 'ember-window-mock/test-support';

import { module, test } from 'qunit';

import {
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  baseRealm,
} from '@cardstack/runtime-common';
import { basicMappings } from '@cardstack/runtime-common/helpers/ai';
import type { Loader } from '@cardstack/runtime-common/loader';

import UpdateRoomSkillsCommand from '@cardstack/host/commands/update-room-skills';
import RealmService from '@cardstack/host/services/realm';

import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type { SerializedFile } from 'https://cardstack.com/base/file-api';

import {
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupOnSave,
  testRealmInfo,
  testRealmURL,
} from '../../helpers';
import { setupBaseRealm, CommandField, Skill } from '../../helpers/base-realm';
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

module('Integration | Command | update-room-skills', function (hooks) {
  setupRenderingTest(hooks);
  setupWindowMock(hooks);

  let loader: Loader;

  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
    loader = getService('loader-service').loader;
  });

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
  });
  setupLocalIndexing(hooks);
  setupBaseRealm(hooks);
  setupOnSave(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  module('command metadata', function () {
    test('has correct description and action verb', function (assert) {
      let command = new UpdateRoomSkillsCommand(
        getService('command-service').commandContext,
      );
      assert.strictEqual(
        command.description,
        'Updates the enabled and disabled skills for a room',
        'Command has correct description',
      );
      assert.strictEqual(
        UpdateRoomSkillsCommand.actionVerb,
        'Update',
        'Command has correct action verb',
      );
    });

    test('getInputType returns UpdateRoomSkillsInput', async function (assert) {
      let command = new UpdateRoomSkillsCommand(
        getService('command-service').commandContext,
      );
      const inputType = await command.getInputType();
      assert.ok(inputType, 'Input type is defined');
    });

    test('getInputJsonSchema', async function (assert) {
      let command = new UpdateRoomSkillsCommand(
        getService('command-service').commandContext,
      );
      let loader = getService('loader-service').loader;
      let mappings = await basicMappings(loader);
      let cardAPI = await loader.import<typeof CardAPI>(
        `${baseRealm.url}card-api`,
      );
      const inputSchema = await command.getInputJsonSchema(cardAPI, mappings);
      assert.deepEqual(
        inputSchema,
        {
          attributes: {
            properties: {
              roomId: { type: 'string' },
              skillCardIdsToActivate: {
                items: { type: 'string' },
                type: 'array',
              },
              skillCardIdsToDeactivate: {
                items: { type: 'string' },
                type: 'array',
              },
            },
            required: ['roomId'],
            type: 'object',
          },
        },
        'Input schema includes roomId and skill card id arrays',
      );
    });
  });

  let matrixRoomId: string;
  module('run', function (hooks) {
    hooks.beforeEach(async function () {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        realmURL: testRealmURL,
        contents: {
          'test-command.gts': `import { Command } from '@cardstack/runtime-common';

export class DoThing extends Command {
  static displayName = 'Test Command';
    async getInputType() {
    return undefined;
  }
}`,
          'skill-with-commands.json': new Skill({
            title: 'Skill with invalid command',
            description: 'test',
            instructions: 'test',
            commands: [
              new CommandField({
                codeRef: { module: '', name: '' },
                requiresApproval: false,
              }),
              new CommandField({
                codeRef: {
                  module: `${testRealmURL}test-command.gts`,
                  name: 'DoThing',
                },
                requiresApproval: false,
              }),
            ],
          }),
          'Skill/boxel-environment.json': new Skill({
            title: 'Boxel Environment',
            description: 'Test environment skill',
            instructions: 'Test skill card for environment commands',
            commands: [
              new CommandField({
                codeRef: {
                  module: `${testRealmURL}test-command.gts`,
                  name: 'DoThing',
                },
                requiresApproval: false,
              }),
            ],
          }),
        },
      });
      let matrixService = getService('matrix-service') as any;
      await matrixService.ready;
      matrixRoomId = mockMatrixUtils.createAndJoinRoom({
        sender: '@testuser:localhost',
        name: 'room-test',
      });
    });
    test('activates new skills and uploads command definitions', async function (assert) {
      let command = new UpdateRoomSkillsCommand(
        getService('command-service').commandContext,
      );
      let skillCardId = `${testRealmURL}Skill/boxel-environment`;
      await command.execute({
        roomId: matrixRoomId,
        skillCardIdsToActivate: [skillCardId],
        skillCardIdsToDeactivate: [],
      });

      let skillsRoomState = mockMatrixUtils.getRoomState(
        matrixRoomId,
        APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
      );
      assert.deepEqual(
        skillsRoomState.enabledSkillCards.map((card: any) => card.sourceUrl),
        [skillCardId],
        'skill added to enabled list',
      );
      assert.strictEqual(
        skillsRoomState.disabledSkillCards.length,
        0,
        'no skills are disabled',
      );
      assert.ok(
        skillsRoomState.commandDefinitions.length > 0,
        'command definitions populated',
      );
      let uploadedContents = mockMatrixUtils.getUploadedContents();
      assert.ok(
        [...uploadedContents.entries()].length > 1,
        'skill and some command defs uploaded',
      );
      assert.strictEqual(
        [...uploadedContents.values()]
          .map((s) => JSON.parse(s as any))
          .filter((json) => json.data?.type === 'card').length,
        1,
        'one skill card uploaded',
      );
    });

    test('deactivates existing skills without reuploading cards', async function (assert) {
      let command = new UpdateRoomSkillsCommand(
        getService('command-service').commandContext,
      );
      let skillCardId = `${testRealmURL}Skill/boxel-environment`;
      mockMatrixUtils.setRoomState(
        matrixRoomId,
        APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
        {
          enabledSkillCards: [{ sourceUrl: skillCardId } as SerializedFile],
          disabledSkillCards: [],
          commandDefinitions: [{ sourceUrl: 'command-def' } as SerializedFile],
        },
      );

      await command.execute({
        roomId: matrixRoomId,
        skillCardIdsToActivate: [],
        skillCardIdsToDeactivate: [skillCardId],
      });

      let skillsRoomState = mockMatrixUtils.getRoomState(
        matrixRoomId,
        APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
      );
      assert.strictEqual(
        skillsRoomState.enabledSkillCards.length,
        0,
        'skill removed from enabled list',
      );
      assert.deepEqual(
        skillsRoomState.disabledSkillCards.map((card: any) => card.sourceUrl),
        [skillCardId],
        'skill added to disabled list',
      );
      assert.strictEqual(
        skillsRoomState.commandDefinitions.length,
        0,
        'command definitions cleared when no skills enabled',
      );
      let uploadedContents = mockMatrixUtils.getUploadedContents();
      assert.strictEqual(
        [...uploadedContents.entries()].length,
        0,
        'no reuploads during deactivation',
      );
    });

    test('reactivates skills already present in room', async function (assert) {
      let command = new UpdateRoomSkillsCommand(
        getService('command-service').commandContext,
      );
      let skillCardId = `${testRealmURL}Skill/boxel-environment`;
      await command.execute({
        roomId: matrixRoomId,
        skillCardIdsToActivate: [skillCardId],
        skillCardIdsToDeactivate: [],
      });

      await command.execute({
        roomId: matrixRoomId,
        skillCardIdsToActivate: [],
        skillCardIdsToDeactivate: [skillCardId],
      });

      let initiallyUploadedContents = [
        ...mockMatrixUtils.getUploadedContents().values(),
      ];
      await command.execute({
        roomId: matrixRoomId,
        skillCardIdsToActivate: [skillCardId],
        skillCardIdsToDeactivate: [],
      });

      let skillsRoomState = mockMatrixUtils.getRoomState(
        matrixRoomId,
        APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
      );
      assert.deepEqual(
        skillsRoomState.enabledSkillCards.map((card: any) => card.sourceUrl),
        [skillCardId],
        'skill moved from disabled to enabled',
      );
      assert.strictEqual(
        skillsRoomState.disabledSkillCards.length,
        0,
        'skill removed from disabled list',
      );
      assert.ok(
        skillsRoomState.commandDefinitions.length > 0,
        'command definitions restored for reactivated skill',
      );
      let uploadedContents = mockMatrixUtils.getUploadedContents();
      assert.strictEqual(
        [...uploadedContents.values()].length,
        initiallyUploadedContents.length,
        'no new uploads during reactivation',
      );
    });

    test('skips invalid command definitions when uploading skills', async function (assert) {
      let command = new UpdateRoomSkillsCommand(
        getService('command-service').commandContext,
      );

      await command.execute({
        roomId: matrixRoomId,
        skillCardIdsToActivate: [`${testRealmURL}skill-with-commands`],
        skillCardIdsToDeactivate: [],
      });

      let uploadedContents = mockMatrixUtils.getUploadedContents();
      assert.strictEqual(
        [...uploadedContents.entries()].length,
        2,
        'skill plus one command definitions were uploaded',
      );
      let commandDefJson = JSON.parse(
        [...uploadedContents.values()][1] as unknown as string,
      );
      assert.deepEqual(
        commandDefJson.codeRef.name,
        'DoThing',
        'only valid command definition is uploaded',
      );
    });
  });
});
