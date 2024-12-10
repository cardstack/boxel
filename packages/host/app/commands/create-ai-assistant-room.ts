import { service } from '@ember/service';

import format from 'date-fns/format';

import { aiBotUsername } from '@cardstack/runtime-common';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import { AI_BOT_POWER_LEVEL } from '../services/matrix-service';

import type MatrixService from '../services/matrix-service';

export default class CreateAIAssistantRoomCommand extends HostBaseCommand<
  BaseCommandModule.CreateAIAssistantRoomInput,
  BaseCommandModule.CreateAIAssistantRoomResult
> {
  @service private declare matrixService: MatrixService;

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { CreateAIAssistantRoomInput } = commandModule;
    return CreateAIAssistantRoomInput;
  }

  protected async run(
    input: BaseCommandModule.CreateAIAssistantRoomInput,
  ): Promise<BaseCommandModule.CreateAIAssistantRoomResult> {
    let { client, matrixSDK } = this.matrixService;
    let userId = client.getUserId();
    if (!userId) {
      throw new Error(
        `bug: there is no userId associated with the matrix client`,
      );
    }
    let server = userId!.split(':')[1];
    let aiBotFullId = `@${aiBotUsername}:${server}`;
    let { room_id: roomId } = await client.createRoom({
      preset: matrixSDK.Preset.PrivateChat,
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
    let roomData = this.matrixService.ensureRoomData(roomId);
    roomData.mutex.dispatch(async () => {
      client.setPowerLevel(roomId, aiBotFullId, AI_BOT_POWER_LEVEL, null);
    });
    let commandModule = await this.loadCommandModule();
    const { CreateAIAssistantRoomResult } = commandModule;
    return new CreateAIAssistantRoomResult({ roomId });
  }
}
