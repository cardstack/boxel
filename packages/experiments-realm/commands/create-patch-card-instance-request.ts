import { Command } from '@cardstack/runtime-common';

import { PatchCardInput } from 'https://cardstack.com/base/command';
import { StringField, contains, field } from 'https://cardstack.com/base/card-api';

import UseAiAssistantCommand from '@cardstack/boxel-host/commands/ai-assistant';
import SendBotTriggerEventCommand from '@cardstack/boxel-host/commands/send-bot-trigger-event';
import { ensureSubmissionBotIsInRoom } from './bot-request-utils';

export class CreatePatchCardInstanceRequestInput extends PatchCardInput {
  @field realm = contains(StringField);
}

export default class CreatePatchCardInstanceRequestCommand extends Command<
  typeof CreatePatchCardInstanceRequestInput,
  undefined
> {
  description = 'Request patching a card instance via the bot runner.';

  async getInputType() {
    return CreatePatchCardInstanceRequestInput;
  }

  protected async run(
    input: CreatePatchCardInstanceRequestInput,
  ): Promise<undefined> {
    let cardId = input.cardId?.trim();
    let realm = input.realm?.trim();
    if (!cardId) {
      throw new Error('cardId is required');
    }
    if (!realm) {
      throw new Error('realm is required');
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
      realm,
      type: 'patch-card-instance',
      input: {
        cardId,
        patch: input.patch,
        roomId,
      },
    });
  }
}
