import { Command } from '@cardstack/runtime-common';

import { CreateShowCardRequestInput } from 'https://cardstack.com/base/command';

import UseAiAssistantCommand from '@cardstack/boxel-host/commands/ai-assistant';
import InviteUserToRoomCommand from '@cardstack/boxel-host/commands/invite-user-to-room';
import SendBotTriggerEventCommand from '@cardstack/boxel-host/commands/send-bot-trigger-event';

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

async function ensureSubmissionBotIsInRoom(
  commandContext: CreateShowCardRequestCommand['commandContext'],
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
