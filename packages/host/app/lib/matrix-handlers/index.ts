import {
  type MatrixEvent,
  type RoomMember,
  type MatrixClient,
  type IEvent,
} from 'matrix-js-sdk';

import { type LooseCardResource, baseRealm } from '@cardstack/runtime-common';

import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type {
  RoomField,
  MatrixEvent as DiscreteMatrixEvent,
} from 'https://cardstack.com/base/room';

import type LoaderService from '../../services/loader-service';
import type * as MatrixSDK from 'matrix-js-sdk';

export * as Membership from './membership';
export * as Timeline from './timeline';

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

export type Event = Partial<IEvent> & {
  status: MatrixSDK.EventStatus | null;
  error?: MatrixSDK.MatrixError;
};

export interface EventSendingContext {
  rooms: Map<string, Promise<RoomField>>;
  cardAPI: typeof CardAPI;
  loaderService: LoaderService;
}

export interface Context extends EventSendingContext {
  flushTimeline: Promise<void> | undefined;
  flushMembership: Promise<void> | undefined;
  roomMembershipQueue: { event: MatrixEvent; member: RoomMember }[];
  timelineQueue: { event: MatrixEvent; oldEventId?: string }[];
  client: MatrixClient;
  matrixSDK: typeof MatrixSDK;
  handleMessage?: (
    context: Context,
    event: Event,
    roomId: string,
  ) => Promise<void>;
}

export async function addRoomEvent(context: EventSendingContext, event: Event) {
  let { event_id: eventId, room_id: roomId, state_key: stateKey } = event;
  // If we are receiving an event which contains
  // a data field, we need to parse it
  // because matrix doesn't support all json types
  // Corresponding encoding is done in
  // sendEvent in the matrix-service
  if (event.content?.data) {
    event.content.data = JSON.parse(event.content.data);
  }
  eventId = eventId ?? stateKey; // room state may not necessary have an event ID
  if (!eventId) {
    throw new Error(
      `bug: event ID is undefined for event ${JSON.stringify(event, null, 2)}`,
    );
  }
  if (!roomId) {
    throw new Error(
      `bug: roomId is undefined for event ${JSON.stringify(event, null, 2)}`,
    );
  }
  let room = context.rooms.get(roomId);
  if (!room) {
    let data: LooseCardResource = {
      meta: {
        adoptsFrom: {
          name: 'RoomField',
          module: `${baseRealm.url}room`,
        },
      },
    };
    room = context.cardAPI.createFromSerialized<typeof RoomField>(
      data,
      { data },
      undefined,
      context.loaderService.loader,
    );
    context.rooms.set(roomId, room);
  }
  let resolvedRoom = await room;

  // duplicate events may be emitted from matrix, as well as the resolved room card might already contain this event
  if (!resolvedRoom.events.find((e) => e.event_id === eventId)) {
    resolvedRoom.events = [
      ...(resolvedRoom.events ?? []),
      event as unknown as DiscreteMatrixEvent,
    ];
  }
}

export async function updateRoomEvent(
  context: EventSendingContext,
  event: Event,
  oldEventId: string,
) {
  if (event.content?.data && typeof event.content.data === 'string') {
    event.content.data = JSON.parse(event.content.data);
  }
  let { event_id: eventId, room_id: roomId, state_key: stateKey } = event;
  eventId = eventId ?? stateKey; // room state may not necessary have an event ID
  if (!eventId) {
    throw new Error(
      `bug: event ID is undefined for event ${JSON.stringify(event, null, 2)}`,
    );
  }
  if (!roomId) {
    throw new Error(
      `bug: roomId is undefined for event ${JSON.stringify(event, null, 2)}`,
    );
  }
  let room = context.rooms.get(roomId);
  if (!room) {
    throw new Error(
      `bug: unknown room for event ${JSON.stringify(event, null, 2)}`,
    );
  }
  let resolvedRoom = await room;
  let oldEventIndex = resolvedRoom.events.findIndex(
    (e) => e.event_id === oldEventId,
  );
  if (oldEventIndex >= 0) {
    resolvedRoom.events[oldEventIndex] =
      event as unknown as DiscreteMatrixEvent;
    resolvedRoom.events = [...resolvedRoom.events];
  }
}
