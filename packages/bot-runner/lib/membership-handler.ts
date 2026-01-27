import type { MatrixClient, MatrixEvent, RoomMember } from 'matrix-js-sdk';

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
    let originServerTs = membershipEvent.event.origin_server_ts;
    if (originServerTs == null || originServerTs < startTime) {
      return;
    }
    if (member.membership === 'invite' && member.userId === authUserId) {
      await client.joinRoom(member.roomId);
    }
  };
}
