import { Command } from '@cardstack/runtime-common';

import { CreateShowCardRequestInput } from 'https://cardstack.com/base/command';

import UseAiAssistantCommand from '@cardstack/boxel-host/commands/ai-assistant';
import SendBotTriggerEventCommand from '@cardstack/boxel-host/commands/send-bot-trigger-event';
import {
  ensureSubmissionBotIsInRoom,
  realmURLFromCardId,
} from './bot-request-utils';

export default class CreateShowCardRequestCommand extends Command<
  typeof CreateShowCardRequestInput,
  undefined
> {
  description = 'Request showing a card via the bot runner.';

  async getInputType() {
    return CreateShowCardRequestInput;
  }

  protected async run(input: CreateShowCardRequestInput): Promise<undefined> {
    let cardId = input.cardId?.trim();
    if (!cardId) {
      throw new Error('cardId is required');
    }

    let roomId = input.roomId?.trim();
    if (!roomId) {
      let createRoomResult = await new UseAiAssistantCommand(
        this.commandContext,
      ).execute({
        roomId: 'new',
        roomName: `Show Card: ${cardId}`,
        openRoom: true,
      });
      roomId = createRoomResult.roomId;
    }

    await ensureSubmissionBotIsInRoom(this.commandContext, roomId);

    await new SendBotTriggerEventCommand(this.commandContext).execute({
      roomId,
      realm: realmURLFromCardId(cardId),
      type: 'show-card',
      input: {
        cardId,
        format: input.format?.trim() || 'isolated',
      },
    });
  }
}
