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
    try {
      if (member.membership === 'invite' && member.userId === authUserId) {
        log.info(`joining room ${member.roomId} from invite`);
        await client.joinRoom(member.roomId);
      }
    } catch (error) {
      log.error('error handling membership event', error);
      Sentry.captureException(error);
    }
  };
}
