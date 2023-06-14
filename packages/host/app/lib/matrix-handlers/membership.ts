import debounce from 'lodash/debounce';
import { type MatrixEvent, type RoomMember } from 'matrix-js-sdk';
import {
  type Context,
  type RoomInvite,
  type RoomEvent,
  addRoomEvent,
} from './index';
import { eventDebounceMs } from '../matrix-utils';

type MembershipEvent =
  | (RoomInvite & { type: 'invite' })
  | (RoomEvent & { type: 'join' })
  | { type: 'leave'; roomId: string };

export function onMembership(context: Context) {
  return (event: MatrixEvent, member: RoomMember) => {
    context.roomMembershipQueue.push({ event, member });
    debouncedMembershipDrain(context);
  };
}

const debouncedMembershipDrain = debounce((context: Context) => {
  drainMembership(context);
}, eventDebounceMs);

async function drainMembership(context: Context) {
  await context.flushMembership;

  let eventsDrained: () => void;
  context.flushMembership = new Promise((res) => (eventsDrained = res));

  let tasks = [...context.roomMembershipQueue];
  context.roomMembershipQueue = [];
  let myMemberships: MembershipEvent[] = [];

  for (let {
    event: { event },
    member,
  } of tasks) {
    await addRoomEvent(context, event);

    if (member.userId === context.client.getUserId()) {
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
        myMemberships.push({
          type: 'invite',
          roomId,
          eventId,
          sender: event.sender!,
          timestamp,
        });
      }
      if (member.membership === 'join') {
        myMemberships.push({
          type: 'join',
          roomId,
          eventId,
          timestamp,
        });
      }
      if (member.membership === 'leave') {
        myMemberships.push({ type: 'leave', roomId });
      }
    }
  }

  processMyMemberships(context, myMemberships);
  eventsDrained!();
}

function processMyMemberships(
  context: Context,
  myMemberships: MembershipEvent[]
) {
  let invites: Map<string, RoomInvite> = new Map();
  let joinedRooms: Map<string, RoomEvent> = new Map();
  let removals: Set<
    { type: 'join'; roomId: string } | { type: 'invite'; roomId: string }
  > = new Set();
  // collapse the invites/joins by eliminating rooms that we have joined or left (in order)
  for (let membership of myMemberships) {
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
        joinedRooms.set(roomId, { ...joinedRoom, ...{ name } });
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
}

function assertNever(value: never) {
  throw new Error(`should never happen ${value}`);
}
