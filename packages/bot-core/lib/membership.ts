import { RoomMemberEvent } from 'matrix-js-sdk';
import type { MatrixClient, MatrixEvent, RoomMember } from 'matrix-js-sdk';
import { logger } from '@cardstack/runtime-common';

let log = logger('bot-core:membership');

export interface AutoJoinConfig {
  /** Matrix client instance */
  client: MatrixClient;
  /** The bot's user ID (e.g., '@aibot:localhost') */
  botUserId: string;
  /** Timestamp to ignore events before (prevents processing old invites on startup) */
  ignoreEventsBefore?: number;
  /** Callback when successfully joined a room */
  onRoomJoined?: (roomId: string) => void | Promise<void>;
  /** Bot name for logging (default: 'bot') */
  botName?: string;
}

/**
 * Sets up automatic room joining when the bot is invited.
 *
 * This is a common pattern for Matrix bots - automatically accept
 * room invitations so users can interact with the bot.
 *
 * @example
 * ```ts
 * setupAutoJoinOnInvite({
 *   client,
 *   botUserId: '@mybot:localhost',
 *   ignoreEventsBefore: Date.now(),
 *   onRoomJoined: async (roomId) => {
 *     await client.sendMessage(roomId, { body: 'Hello!', msgtype: 'm.text' });
 *   },
 * });
 * ```
 */
export function setupAutoJoinOnInvite(config: AutoJoinConfig): void {
  const {
    client,
    botUserId,
    ignoreEventsBefore = 0,
    onRoomJoined,
    botName = 'bot',
  } = config;

  client.on(
    RoomMemberEvent.Membership,
    async function (event: MatrixEvent, member: RoomMember) {
      // Ignore old events (from before bot started)
      if (
        ignoreEventsBefore > 0 &&
        event.event.origin_server_ts! < ignoreEventsBefore
      ) {
        return;
      }

      // Only respond to invites for this bot
      if (member.membership === 'invite' && member.userId === botUserId) {
        try {
          await client.joinRoom(member.roomId);
          log.info(`[${botName}] Auto-joined room ${member.roomId}`);

          if (onRoomJoined) {
            await onRoomJoined(member.roomId);
          }
        } catch (err) {
          log.info(
            `[${botName}] Error joining room ${member.roomId}, typically happens when a user invites then leaves before join completes`,
            err,
          );
        }
      }
    },
  );
}
