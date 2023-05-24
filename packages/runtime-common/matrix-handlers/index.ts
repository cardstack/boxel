import {
  type MatrixEvent,
  type RoomMember,
  type MatrixClient,
  type IEvent,
} from 'matrix-js-sdk';

export * as Membership from './membership';
export * as Timeline from './timeline';
export * as Room from './room';

export const eventDebounceMs = 300;

export interface Room extends RoomMeta {
  eventId: string;
  roomId: string;
  timestamp: number;
}

export interface RoomInvite extends Room {
  sender: string;
}

export interface RoomMeta {
  name?: string;
  encrypted?: boolean;
}

export type Event = Partial<IEvent>;

export interface Context {
  roomMembers: Map<
    string,
    Map<string, { member: RoomMember; status: 'join' | 'invite' }>
  >;
  invites: Map<string, RoomInvite>;
  joinedRooms: Map<string, Room>;
  rooms: Map<string, RoomMeta>;
  timelines: Map<string, Map<string, Event>>;
  flushTimeline: Promise<void> | undefined;
  // we process the matrix events in batched queues so that we can collapse the
  // interstitial state between events to prevent unnecessary flashing on the
  // screen, i.e. user was invited to a room and then declined the invite should
  // result in nothing happening on the screen as opposed to an item appearing
  // in the invite list and then immediately disappearing.
  roomMembershipQueue: (
    | (RoomInvite & { type: 'invite' })
    | (Room & { type: 'join' })
    | { type: 'leave'; roomId: string }
  )[];
  timelineQueue: MatrixEvent[];
  mapClazz: typeof Map;
  getClient: () => MatrixClient;
  handleMessage?: (
    context: Context,
    event: Event,
    roomId: string
  ) => Promise<void>;
  didReceiveMessages: () => void;
  didReceiveRooms: () => void;
}

export function setRoomMeta(context: Context, roomId: string, meta: RoomMeta) {
  let roomMeta = context.rooms.get(roomId);
  if (!roomMeta) {
    roomMeta = {};
    context.rooms.set(roomId, roomMeta);
  }
  if (meta.name !== undefined) {
    roomMeta.name = meta.name;
  }
  roomMeta.encrypted = roomMeta.encrypted ?? meta.encrypted;
  let invite = context.invites.get(roomId);
  if (invite) {
    context.invites.set(roomId, { ...invite, ...roomMeta });
  }
  let joinedRoom = context.joinedRooms.get(roomId);
  if (joinedRoom) {
    context.joinedRooms.set(roomId, { ...joinedRoom, ...roomMeta });
  }
}
