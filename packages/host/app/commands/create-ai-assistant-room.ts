import { service } from '@ember/service';

import format from 'date-fns/format';

import {
  APP_BOXEL_ACTIVE_LLM,
  DEFAULT_LLM,
} from '@cardstack/runtime-common/matrix-constants';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type MatrixService from '../services/matrix-service';

export default class CreateAIAssistantRoomCommand extends HostBaseCommand<
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
    let { matrixService } = this;
    let userId = matrixService.userId;
    let aiBotFullId = matrixService.aiBotUserId;
    let { room_id: roomId } = await matrixService.createRoom({
      preset: matrixService.privateChatPreset,
      invite: [aiBotFullId],
      name: input.name,
      topic: undefined,
      room_alias_name: encodeURIComponent(
        `${input.name} - ${format(
          new Date(),
          "yyyy-MM-dd'T'HH:mm:ss.SSSxxx",
        )} - ${userId}`,
      ),
    });
    await this.matrixService.setPowerLevel(
      roomId,
      aiBotFullId,
      matrixService.aiBotPowerLevel,
    );
    await this.matrixService.sendStateEvent(roomId, APP_BOXEL_ACTIVE_LLM, {
      model: DEFAULT_LLM,
    });
    let commandModule = await this.loadCommandModule();
    const { CreateAIAssistantRoomResult } = commandModule;
    return new CreateAIAssistantRoomResult({ roomId });
  }
}
