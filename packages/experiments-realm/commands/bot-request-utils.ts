import type { CommandContext } from '@cardstack/runtime-common';

import InviteUserToRoomCommand from '@cardstack/boxel-host/commands/invite-user-to-room';

export async function ensureSubmissionBotIsInRoom(
  commandContext: CommandContext,
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

export function realmURLFromCardId(cardId: string): string {
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
