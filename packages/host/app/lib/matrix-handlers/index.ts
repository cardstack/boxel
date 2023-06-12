import {
  type MatrixEvent,
  type RoomMember,
  type MatrixClient,
  type IEvent,
} from 'matrix-js-sdk';
import type { Card } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

export * as Membership from './membership';
export * as Timeline from './timeline';
export * as Room from './room';

export interface RoomEvent extends RoomMeta {
  eventId: string;
  roomId: string;
  timestamp: number;
}

export interface RoomInvite extends RoomEvent {
  sender: string;
}

export interface RoomMeta {
  name?: string;
}

export type Event = Partial<IEvent>;

export interface Context {
  roomMembers: Map<
    string,
    Map<string, { member: RoomMember; status: 'join' | 'invite' }>
  >;
  invites: Map<string, RoomInvite>;
  joinedRooms: Map<string, RoomEvent>;
  rooms: Map<string, RoomMeta>;
  timelines: Map<string, Map<string, Event>>;
  roomEventConsumers: Map<string, { card: Card; eventsField: string }>;
  flushTimeline: Promise<void> | undefined;
  // we process the matrix events in batched queues so that we can collapse the
  // interstitial state between events to prevent unnecessary flashing on the
  // screen, i.e. user was invited to a room and then declined the invite should
  // result in nothing happening on the screen as opposed to an item appearing
  // in the invite list and then immediately disappearing.
  roomMembershipQueue: (
    | (RoomInvite & { type: 'invite' })
    | (RoomEvent & { type: 'join' })
    | { type: 'leave'; roomId: string }
  )[];
  timelineQueue: MatrixEvent[];
  mapClazz: typeof Map;
  // TODO remove this if we don't end up using the card API in our matrix
  // handlers
  cardAPI: typeof CardAPI;
  client: MatrixClient;
  handleMessage?: (
    context: Context,
    event: Event,
    roomId: string
  ) => Promise<void>;
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
  let invite = context.invites.get(roomId);
  if (invite) {
    context.invites.set(roomId, { ...invite, ...roomMeta });
  }
  let joinedRoom = context.joinedRooms.get(roomId);
  if (joinedRoom) {
    context.joinedRooms.set(roomId, { ...joinedRoom, ...roomMeta });
  }
}
