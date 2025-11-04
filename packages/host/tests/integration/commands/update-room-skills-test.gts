import { getOwner } from '@ember/owner';
import Service from '@ember/service';
import { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { setupWindowMock } from 'ember-window-mock/test-support';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import { basicMappings } from '@cardstack/runtime-common/helpers/ai';
import { Loader } from '@cardstack/runtime-common/loader';

import UpdateRoomSkillsCommand from '@cardstack/host/commands/update-room-skills';
import { skillCardURL } from '@cardstack/host/lib/utils';
import RealmService from '@cardstack/host/services/realm';

import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type { CardDef } from 'https://cardstack.com/base/card-api';
import type { SerializedFile } from 'https://cardstack.com/base/file-api';
import type * as SkillModule from 'https://cardstack.com/base/skill';

import {
  setupCardLogs,
  setupLocalIndexing,
  setupOnSave,
  testRealmInfo,
  testRealmURL,
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

class StubFileDef {
  constructor(private sourceUrl: string) {}

  serialize(): SerializedFile {
    return {
      sourceUrl: this.sourceUrl,
    } as SerializedFile;
  }
}

class StubMatrixService extends Service {
  currentState: {
    enabledSkillCards: SerializedFile[];
    disabledSkillCards: SerializedFile[];
    commandDefinitions: SerializedFile[];
  } = {
    enabledSkillCards: [],
    disabledSkillCards: [],
    commandDefinitions: [],
  };
  uploadCardsCalls: CardDef[][] = [];
  uploadCommandDefinitionsCalls: SkillModule.CommandField[][] = [];
  updateStateEventArgs: {
    roomId: string;
    eventType: string;
    stateKey: string;
  }[] = [];

  reset() {
    this.currentState = {
      enabledSkillCards: [],
      disabledSkillCards: [],
      commandDefinitions: [],
    };
    this.uploadCardsCalls = [];
    this.uploadCommandDefinitionsCalls = [];
    this.updateStateEventArgs = [];
  }

  async updateStateEvent(
    roomId: string,
    eventType: string,
    stateKey: string,
    updater: (
      currentSkillsConfig: Record<string, any>,
    ) => Promise<Record<string, any>>,
  ) {
    this.updateStateEventArgs.push({ roomId, eventType, stateKey });
    let nextState = await updater(this.currentState);
    this.currentState = nextState as typeof this.currentState;
  }

  async uploadCards(cards: CardDef[]) {
    this.uploadCardsCalls.push(cards);
    return cards.map((card) => new StubFileDef(card.id!));
  }

  getUniqueCommandDefinitions(
    commandDefinitions: SkillModule.CommandField[],
  ): SkillModule.CommandField[] {
    let seen = new Set<string>();
    let result: SkillModule.CommandField[] = [];
    for (let commandDefinition of commandDefinitions) {
      let key = commandDefinition.functionName;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(commandDefinition);
      }
    }
    return result;
  }

  async uploadCommandDefinitions(
    commandDefinitions: SkillModule.CommandField[],
  ) {
    this.uploadCommandDefinitionsCalls.push(commandDefinitions);
    return commandDefinitions.map(
      (commandDefinition) => new StubFileDef(commandDefinition.functionName),
    );
  }
}

module('Integration | Command | update-room-skills', function (hooks) {
  setupRenderingTest(hooks);
  setupWindowMock(hooks);

  let loader: Loader;
  let matrixService: StubMatrixService;

  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
    getOwner(this)!.register('service:matrix-service', StubMatrixService);
    loader = getService('loader-service').loader;
    matrixService = getService(
      'matrix-service',
    ) as unknown as StubMatrixService;
    matrixService.reset();
  });

  setupLocalIndexing(hooks);
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

  module('run', function (hooks) {
    hooks.beforeEach(function () {
      matrixService.reset();
    });

    test('activates new skills and uploads command definitions', async function (assert) {
      let command = new UpdateRoomSkillsCommand(
        getService('command-service').commandContext,
      );
      let skillCardId = skillCardURL('boxel-environment');
      await command.execute({
        roomId: 'room-1',
        skillCardIdsToActivate: [skillCardId],
        skillCardIdsToDeactivate: [],
      });

      assert.deepEqual(
        matrixService.currentState.enabledSkillCards.map(
          (card) => card.sourceUrl,
        ),
        [skillCardId],
        'skill added to enabled list',
      );
      assert.strictEqual(
        matrixService.currentState.disabledSkillCards.length,
        0,
        'no skills are disabled',
      );
      assert.ok(
        matrixService.currentState.commandDefinitions.length > 0,
        'command definitions populated',
      );
      assert.strictEqual(
        matrixService.uploadCardsCalls.length,
        1,
        'card upload performed for new skill',
      );
      assert.strictEqual(
        matrixService.uploadCommandDefinitionsCalls.length,
        1,
        'command definitions uploaded for enabled skill',
      );
    });

    test('deactivates existing skills without reuploading cards', async function (assert) {
      let command = new UpdateRoomSkillsCommand(
        getService('command-service').commandContext,
      );
      let skillCardId = skillCardURL('boxel-environment');
      matrixService.currentState = {
        enabledSkillCards: [{ sourceUrl: skillCardId } as SerializedFile],
        disabledSkillCards: [],
        commandDefinitions: [{ sourceUrl: 'command-def' } as SerializedFile],
      };
      matrixService.uploadCardsCalls = [];
      matrixService.uploadCommandDefinitionsCalls = [];

      await command.execute({
        roomId: 'room-1',
        skillCardIdsToActivate: [],
        skillCardIdsToDeactivate: [skillCardId],
      });

      assert.strictEqual(
        matrixService.currentState.enabledSkillCards.length,
        0,
        'skill removed from enabled list',
      );
      assert.deepEqual(
        matrixService.currentState.disabledSkillCards.map(
          (card) => card.sourceUrl,
        ),
        [skillCardId],
        'skill added to disabled list',
      );
      assert.strictEqual(
        matrixService.currentState.commandDefinitions.length,
        0,
        'command definitions cleared when no skills enabled',
      );
      assert.strictEqual(
        matrixService.uploadCardsCalls.length,
        0,
        'cards not reuploaded during deactivation',
      );
      assert.strictEqual(
        matrixService.uploadCommandDefinitionsCalls.length,
        0,
        'command definitions not reuploaded when none remain',
      );
    });

    test('reactivates skills already present in room', async function (assert) {
      let command = new UpdateRoomSkillsCommand(
        getService('command-service').commandContext,
      );
      let skillCardId = skillCardURL('boxel-environment');
      matrixService.currentState = {
        enabledSkillCards: [],
        disabledSkillCards: [{ sourceUrl: skillCardId } as SerializedFile],
        commandDefinitions: [],
      };
      matrixService.uploadCardsCalls = [];
      matrixService.uploadCommandDefinitionsCalls = [];

      await command.execute({
        roomId: 'room-1',
        skillCardIdsToActivate: [skillCardId],
        skillCardIdsToDeactivate: [],
      });

      assert.deepEqual(
        matrixService.currentState.enabledSkillCards.map(
          (card) => card.sourceUrl,
        ),
        [skillCardId],
        'skill moved from disabled to enabled',
      );
      assert.strictEqual(
        matrixService.currentState.disabledSkillCards.length,
        0,
        'skill removed from disabled list',
      );
      assert.strictEqual(
        matrixService.uploadCardsCalls.length,
        0,
        'card upload skipped when skill already in room',
      );
      assert.strictEqual(
        matrixService.uploadCommandDefinitionsCalls.length,
        1,
        'command definitions reuploaded based on enabled skill set',
      );
      assert.ok(
        matrixService.currentState.commandDefinitions.length > 0,
        'command definitions restored for reactivated skill',
      );
    });
  });
});
