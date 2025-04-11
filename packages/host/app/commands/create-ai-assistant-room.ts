import { service } from '@ember/service';

import format from 'date-fns/format';

import {
  APP_BOXEL_ACTIVE_LLM,
  DEFAULT_LLM,
} from '@cardstack/runtime-common/matrix-constants';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type MatrixService from '../services/matrix-service';

export default class CreateAiAssistantRoomCommand extends HostBaseCommand<
  typeof BaseCommandModule.CreateAIAssistantRoomInput,
  typeof BaseCommandModule.CreateAIAssistantRoomResult
> {
  @service declare private matrixService: MatrixService;

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CreateAIAssistantRoomInput } = commandModule;
    return CreateAIAssistantRoomInput;
  }

  protected async run(
    input: BaseCommandModule.CreateAIAssistantRoomInput,
  ): Promise<BaseCommandModule.CreateAIAssistantRoomResult> {
    console.time('CreateAIAssistantRoomCommand.run - Total');
    let { matrixService } = this;
    let userId = matrixService.userId;
    let aiBotFullId = matrixService.aiBotUserId;

    console.time('CreateAIAssistantRoomCommand.run - createRoom');
    let { room_id: roomId } = await matrixService.createRoom({
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
      ],
    });
    console.timeEnd('CreateAIAssistantRoomCommand.run - createRoom');

    console.time('CreateAIAssistantRoomCommand.run - loadCommandModule');
    let commandModule = await this.loadCommandModule();
    const { CreateAIAssistantRoomResult } = commandModule;
    console.timeEnd('CreateAIAssistantRoomCommand.run - loadCommandModule');

    console.timeEnd('CreateAIAssistantRoomCommand.run - Total');
    return new CreateAIAssistantRoomResult({ roomId });
  }
}
