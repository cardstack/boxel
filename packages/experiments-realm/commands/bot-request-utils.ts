import type { CommandContext } from '@cardstack/runtime-common';

import InviteUserToRoomTool from '@cardstack/boxel-host/commands/invite-user-to-room';

export async function ensureSubmissionBotIsInRoom(
  commandContext: CommandContext,
  roomId: string,
) {
  try {
    await new InviteUserToRoomTool(commandContext).execute({
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
