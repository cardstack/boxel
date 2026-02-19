import { Command } from '@cardstack/runtime-common';

import { PatchCardInput } from 'https://cardstack.com/base/command';

import UseAiAssistantCommand from '@cardstack/boxel-host/commands/ai-assistant';
import SendBotTriggerEventCommand from '@cardstack/boxel-host/commands/send-bot-trigger-event';
import {
  ensureSubmissionBotIsInRoom,
  realmURLFromCardId,
} from './bot-request-utils';

export default class CreatePatchCardInstanceRequestCommand extends Command<
  typeof PatchCardInput,
  undefined
> {
  description = 'Request patching a card instance via the bot runner.';

  async getInputType() {
    return PatchCardInput;
  }

  protected async run(input: PatchCardInput): Promise<undefined> {
    let cardId = input.cardId?.trim();
    if (!cardId) {
      throw new Error('cardId is required');
    }
    if (!input.patch || typeof input.patch !== 'object') {
      throw new Error('patch is required');
    }

    let roomId = input.roomId?.trim();
    if (!roomId) {
      let createRoomResult = await new UseAiAssistantCommand(
        this.commandContext,
      ).execute({
        roomId: 'new',
        roomName: `Patch Card: ${cardId}`,
        openRoom: true,
      });
      roomId = createRoomResult.roomId;
    }

    await ensureSubmissionBotIsInRoom(this.commandContext, roomId);

    await new SendBotTriggerEventCommand(this.commandContext).execute({
      roomId,
      realm: realmURLFromCardId(cardId),
      type: 'patch-card-instance',
      input: {
        cardId,
        patch: input.patch,
        roomId,
      },
    });
  }
}
