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
