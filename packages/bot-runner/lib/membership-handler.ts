import { logger } from '@cardstack/runtime-common';
import * as Sentry from '@sentry/node';
import { MatrixError } from 'matrix-js-sdk';
import type { MatrixClient, MatrixEvent, RoomMember } from 'matrix-js-sdk';

const log = logger('bot-runner');

const MAX_JOIN_ATTEMPTS = 5;
const DEFAULT_RETRY_AFTER_MS = 1000;

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
      await joinRoom(client, member.roomId);
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

// Joining every pending invite at start can exceed Synapse's join rate limit.
async function joinRoom(client: MatrixClient, roomId: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      await client.joinRoom(roomId);
      return;
    } catch (error) {
      if (
        !(error instanceof MatrixError) ||
        !error.isRateLimitError() ||
        attempt >= MAX_JOIN_ATTEMPTS
      ) {
        throw error;
      }
      let retryAfterMs = error.getRetryAfterMs() ?? DEFAULT_RETRY_AFTER_MS;
      await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
    }
  }
}

// Synapse answers a join to a room everyone has left with 404 M_UNKNOWN, so
// the status matters as much as the errcode.
function isUnjoinable(error: unknown): boolean {
  return (
    error instanceof MatrixError &&
    (error.httpStatus === 403 ||
      error.httpStatus === 404 ||
      error.errcode === 'M_FORBIDDEN' ||
      error.errcode === 'M_NOT_FOUND')
  );
}
