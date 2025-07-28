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
    let { defaultSkills, skillConfig } = input;
    let skillFileDefs: FileDef[] | undefined;
    let commandFileDefs: FileDef[] | undefined;
    let disabledSkillFileDefs: FileDef[] | undefined;

    if (
      skillConfig.enabledSkillCards.length ||
      skillConfig.disabledSkillCards.length ||
      skillConfig.commandDefinitions.length
    ) {
      // Use provided skill configuration
      skillFileDefs = skillConfig.enabledSkillCards.map((fileDef: any) =>
        matrixService.fileAPI.createFileDef(fileDef),
      );
      disabledSkillFileDefs = skillConfig.disabledSkillCards.map(
        (fileDef: any) => matrixService.fileAPI.createFileDef(fileDef),
      );
      commandFileDefs = skillConfig.commandDefinitions.map((fileDef: any) =>
        matrixService.fileAPI.createFileDef(fileDef),
      );
    } else if (defaultSkills) {
      // Fall back to existing defaultSkills logic
      let skills = input.defaultSkills;
      skillFileDefs = await matrixService.uploadCards(input.defaultSkills);
      disabledSkillFileDefs = []; // Default to empty for new rooms
      const commandDefinitions = skills.flatMap((skill) => skill.commands);
      commandFileDefs =
        await matrixService.uploadCommandDefinitions(commandDefinitions);
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
                skillFileDefs?.map((skillFileDef) =>
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
