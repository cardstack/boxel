import debounce from 'lodash/debounce';
import { type MatrixEvent, type RoomMember } from 'matrix-js-sdk';
import { Context, RoomInvite, RoomEvent } from './index';
import { eventDebounceMs } from '../index';

export function onMembership(context: Context, onlyForRoomId?: string) {
  return (e: MatrixEvent, member: RoomMember) => {
    let { event } = e;
    let { roomId, userId } = member;
    if (onlyForRoomId && roomId !== onlyForRoomId) {
      return;
    }
    let members = context.roomMembers.get(roomId);
    if (!members) {
      members = new context.mapClazz();
      context.roomMembers.set(roomId, members);
    }
    switch (member.membership) {
      case 'leave':
        members.delete(userId);
        break;
      case 'invite':
      case 'join':
        members.set(userId, { member, status: member.membership });
        break;
      default:
        throw new Error(
          `don't know how to handle membership status of '${member.membership}`
        );
    }

    if (member.userId === context.getClient().getUserId()) {
      let {
        event_id: eventId,
        room_id: roomId,
        origin_server_ts: timestamp,
      } = event;
      if (!eventId) {
        throw new Error(
          `received room membership event without an event ID: ${JSON.stringify(
            event,
            null,
            2
          )}`
        );
      }
      if (!roomId) {
        throw new Error(
          `received room membership event without a room ID: ${JSON.stringify(
            event,
            null,
            2
          )}`
        );
      }
      if (timestamp == null) {
        throw new Error(
          `received room membership event without a timestamp: ${JSON.stringify(
            event,
            null,
            2
          )}`
        );
      }
      if (member.membership === 'invite') {
        context.roomMembershipQueue.push({
          type: 'invite',
          roomId,
          eventId,
          sender: event.sender!,
          timestamp,
        });
      }
      if (member.membership === 'join') {
        context.roomMembershipQueue.push({
          type: 'join',
          roomId,
          eventId,
          timestamp,
        });
      }
      if (member.membership === 'leave') {
        context.roomMembershipQueue.push({ type: 'leave', roomId });
      }
      flushMembershipQueue(context);
    }
  };
}

const flushMembershipQueue = debounce((context: Context) => {
  let invites: Map<string, RoomInvite> = new Map();
  let joinedRooms: Map<string, RoomEvent> = new Map();
  let removals: Set<
    { type: 'join'; roomId: string } | { type: 'invite'; roomId: string }
  > = new Set();
  let processingMemberships = [...context.roomMembershipQueue];
  context.roomMembershipQueue = [];

  // collapse the invites/joins by eliminating rooms that we have joined or left (in order)
  for (let membership of processingMemberships) {
    let { roomId } = membership;
    switch (membership.type) {
      case 'invite': {
        let { type: _remove, ...invite } = membership;
        let name = context.rooms.get(roomId)?.name ?? invite.name;
        // note that we can't see room encryption events for rooms we haven't joined
        invites.set(roomId, { ...invite, name });
        break;
      }
      case 'join': {
        let { type: _remove, ...joinedRoom } = membership;
        let name = context.rooms.get(roomId)?.name ?? joinedRoom.name;
        let encrypted =
          context.rooms.get(roomId)?.encrypted ?? joinedRoom.encrypted;
        joinedRooms.set(roomId, { ...joinedRoom, ...{ name, encrypted } });
        // once we join a room we remove any invites for this room that are
        // part of this flush as well as historical invites for this room
        invites.delete(roomId);
        removals.add({ type: 'invite', roomId });
        break;
      }
      case 'leave': {
        // if we leave a room we want to remove any invites for this room that
        // are part of this flush as well as any historical invites and joins
        invites.delete(roomId);
        joinedRooms.delete(roomId);
        removals.add({ type: 'invite', roomId });
        removals.add({ type: 'join', roomId });
        break;
      }
      default:
        assertNever(membership);
    }
  }

  // process any rooms that we have left for rooms that are not part of this flush
  for (let { type, roomId } of removals) {
    if (type === 'invite') {
      context.invites.delete(roomId);
    } else {
      context.joinedRooms.delete(roomId);
    }
  }
  // add all the remaining invites/joins
  for (let invite of invites.values()) {
    context.invites.set(invite.roomId, { ...invite });
  }
  for (let joinedRoom of joinedRooms.values()) {
    context.joinedRooms.set(joinedRoom.roomId, { ...joinedRoom });
  }
  if (context.didReceiveRooms) {
    context.didReceiveRooms();
  }
}, eventDebounceMs);

function assertNever(value: never) {
  throw new Error(`should never happen ${value}`);
}
