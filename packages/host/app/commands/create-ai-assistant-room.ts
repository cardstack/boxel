import { service } from '@ember/service';

import format from 'date-fns/format';

import {
  APP_BOXEL_ACTIVE_LLM,
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
  DEFAULT_LLM,
} from '@cardstack/runtime-common/matrix-constants';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import type { FileDef } from 'https://cardstack.com/base/file-api';

import HostBaseCommand from '../lib/host-base-command';

import type MatrixService from '../services/matrix-service';

export default class CreateAiAssistantRoomCommand extends HostBaseCommand<
  typeof BaseCommandModule.CreateAIAssistantRoomInput,
  typeof BaseCommandModule.CreateAIAssistantRoomResult
> {
  @service declare private matrixService: MatrixService;

  static actionVerb = 'Create';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CreateAIAssistantRoomInput } = commandModule;
    return CreateAIAssistantRoomInput;
  }

  protected async run(
    input: BaseCommandModule.CreateAIAssistantRoomInput,
  ): Promise<BaseCommandModule.CreateAIAssistantRoomResult> {
    let { matrixService } = this;
    let userId = matrixService.userId;
    let aiBotFullId = matrixService.aiBotUserId;

    if (!userId) {
      throw new Error(
        'Requires userId to execute CreateAiAssistantRoomCommand',
      );
    }
    let { enabledSkills, disabledSkills } = input;
    let enabledSkillFileDefs: FileDef[] | undefined;
    let commandFileDefs: FileDef[] | undefined;
    let disabledSkillFileDefs: FileDef[] | undefined;

    if (enabledSkills?.length) {
      enabledSkillFileDefs = await matrixService.uploadCards(enabledSkills);
    }
    if (disabledSkills?.length) {
      disabledSkillFileDefs = await matrixService.uploadCards(disabledSkills);
    } else {
      disabledSkillFileDefs = [];
    }

    // Combine command definitions from both enabled and disabled skills
    const allCommandDefinitions = [
      ...(enabledSkills?.flatMap((skill) => skill.commands) || []),
      ...(disabledSkills?.flatMap((skill) => skill.commands) || []),
    ];

    // Remove duplicates based on command name or ID
    const uniqueCommandDefinitions = allCommandDefinitions.filter(
      (command, index, array) =>
        array.findIndex((cmd) => command.functionName === cmd.functionName) ===
        index,
    );

    if (uniqueCommandDefinitions.length) {
      commandFileDefs = await matrixService.uploadCommandDefinitions(
        uniqueCommandDefinitions,
      );
    }

    // Run room creation and module loading in parallel
    const [roomResult, commandModule] = await Promise.all([
      await matrixService.createRoom({
        preset: matrixService.privateChatPreset,
        invite: [aiBotFullId],
        name: input.name,
        room_alias_name: encodeURIComponent(
          `${input.name} - ${format(
            new Date(),
            "yyyy-MM-dd'T'HH:mm:ss.SSSxxx",
          )} - ${userId}`,
        ),
        power_level_content_override: {
          users: {
            [userId]: 100,
            [aiBotFullId]: matrixService.aiBotPowerLevel,
          },
        },
        initial_state: [
          {
            type: APP_BOXEL_ACTIVE_LLM,
            content: {
              model: DEFAULT_LLM,
            },
          },
          {
            type: APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
            content: {
              enabledSkillCards:
                enabledSkillFileDefs?.map((skillFileDef) =>
                  skillFileDef.serialize(),
                ) ?? [],
              disabledSkillCards:
                disabledSkillFileDefs?.map((skillFileDef) =>
                  skillFileDef.serialize(),
                ) ?? [],
              commandDefinitions:
                commandFileDefs?.map((commandFileDef) =>
                  commandFileDef.serialize(),
                ) ?? [],
            },
          },
        ],
      }),
      await this.loadCommandModule(),
    ]);

    const { room_id: roomId } = roomResult;
    const { CreateAIAssistantRoomResult } = commandModule;
    return new CreateAIAssistantRoomResult({ roomId });
  }
}
