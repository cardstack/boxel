import { Command } from '@cardstack/runtime-common';

import { PatchCardInput } from 'https://cardstack.com/base/command';

import UseAiAssistantCommand from '@cardstack/boxel-host/commands/ai-assistant';
import InviteUserToRoomCommand from '@cardstack/boxel-host/commands/invite-user-to-room';
import SendBotTriggerEventCommand from '@cardstack/boxel-host/commands/send-bot-trigger-event';

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

async function ensureSubmissionBotIsInRoom(
  commandContext: CreatePatchCardInstanceRequestCommand['commandContext'],
  roomId: string,
) {
  try {
    await new InviteUserToRoomCommand(commandContext).execute({
      roomId,
      userId: 'submissionbot',
    });
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.includes('user already in room')
    ) {
      throw error;
    }
  }
}

function realmURLFromCardId(cardId: string): string {
  let url: URL;
  try {
    url = new URL(cardId);
  } catch {
    throw new Error('cardId must be an absolute URL');
  }

  let pathSegments = url.pathname.split('/').filter(Boolean);
  if (pathSegments.length < 2) {
    throw new Error('cardId must include card type and card slug');
  }

  let realmSegments = pathSegments.slice(0, -2);
  url.pathname = `/${realmSegments.join('/')}${realmSegments.length ? '/' : ''}`;
  url.search = '';
  url.hash = '';
  return url.href;
}
