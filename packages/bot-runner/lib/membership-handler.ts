import { logger } from '@cardstack/runtime-common';
import * as Sentry from '@sentry/node';
import type { MatrixClient, MatrixEvent, RoomMember } from 'matrix-js-sdk';

const log = logger('bot-runner');

export interface MembershipHandlerOptions {
  client: MatrixClient;
  authUserId: string;
  startTime: number;
}

export function onMembershipEvent({
  client,
  authUserId,
  startTime,
}: MembershipHandlerOptions) {
  return async function handleMembershipEvent(
    membershipEvent: MatrixEvent,
    member: RoomMember,
  ) {
    try {
      let originServerTs = membershipEvent.event.origin_server_ts;
      if (originServerTs == null || originServerTs < startTime) {
        return;
      }
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
