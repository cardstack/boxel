import { logger } from '@cardstack/runtime-common';
import * as Sentry from '@sentry/node';
import type { MatrixClient, MatrixEvent, RoomMember } from 'matrix-js-sdk';

const log = logger('bot-runner');

export interface MembershipHandlerOptions {
  client: MatrixClient;
  authUserId: string;
}

export function onMembershipEvent({
  client,
  authUserId,
}: MembershipHandlerOptions) {
  // An invite arrives as stripped state, which carries no origin_server_ts, so
  // it can't be dated. Every pending invite is accepted, including ones sent
  // while the bot was down.
  return async function handleMembershipEvent(
    _membershipEvent: MatrixEvent,
    member: RoomMember,
  ) {
    if (member.membership !== 'invite' || member.userId !== authUserId) {
      return;
    }
    try {
      log.info(`joining room ${member.roomId} from invite`);
      await client.joinRoom(member.roomId);
    } catch (error) {
      if (isUnjoinable(error)) {
        // Otherwise the dead invite is retried, and fails, on every start.
        log.info(`rejecting invite to unjoinable room ${member.roomId}`);
        try {
          await client.leave(member.roomId);
        } catch (leaveError) {
          log.error('error rejecting invite', leaveError);
          Sentry.captureException(leaveError);
        }
        return;
      }
      log.error('error handling membership event', error);
      Sentry.captureException(error);
    }
  };
}

function isUnjoinable(error: unknown): boolean {
  let errcode = (error as { errcode?: unknown } | undefined)?.errcode;
  return errcode === 'M_FORBIDDEN' || errcode === 'M_NOT_FOUND';
}
