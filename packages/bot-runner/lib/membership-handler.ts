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
  return function handleMembershipEvent(
    membershipEvent: MatrixEvent,
    member: RoomMember,
  ) {
    if (membershipEvent.event.origin_server_ts! < startTime) {
      return;
    }
    if (member.membership === 'invite' && member.userId === authUserId) {
      client.joinRoom(member.roomId);
    }
  };
}
