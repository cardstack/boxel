import {
  type MatrixEvent,
  type RoomMember,
  type MatrixClient,
  type IEvent,
} from 'matrix-js-sdk';
import type {
  MatrixRoomCard,
  MatrixEvent as DiscreteMatrixEvent,
} from 'https://cardstack.com/base/matrix-room';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import { type LooseCardResource, baseRealm } from '@cardstack/runtime-common';

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
  invites: Map<string, RoomInvite>;
  joinedRooms: Map<string, RoomEvent>;
  rooms: Map<string, RoomMeta>;
  roomEventConsumers: Map<string, MatrixRoomCard>;
  flushTimeline: Promise<void> | undefined;
  flushMembership: Promise<void> | undefined;
  roomMembershipQueue: { event: MatrixEvent; member: RoomMember }[];
  timelineQueue: MatrixEvent[];
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

export async function addRoomEvent(context: Context, event: Event) {
  let { event_id: eventId, room_id: roomId } = event;
  if (!eventId) {
    throw new Error(
      `bug: event ID is undefined for event ${JSON.stringify(event, null, 2)}`
    );
  }
  if (!roomId) {
    throw new Error(
      `bug: roomId is undefined for event ${JSON.stringify(event, null, 2)}`
    );
  }
  let roomCard = context.roomEventConsumers.get(roomId);
  if (!roomCard) {
    let data: LooseCardResource = {
      meta: {
        adoptsFrom: {
          name: 'MatrixRoomCard',
          module: `${baseRealm.url}matrix-room`,
        },
      },
    };
    roomCard = await context.cardAPI.createFromSerialized<
      typeof MatrixRoomCard
    >(data, { data }, undefined);
    context.roomEventConsumers.set(roomId, roomCard);
  }
  // duplicate events may be emitted from matrix
  if (!roomCard.events.find((e) => e.event_id === eventId)) {
    roomCard.events = [
      ...(roomCard.events ?? []),
      event as unknown as DiscreteMatrixEvent,
    ];
  }
}
