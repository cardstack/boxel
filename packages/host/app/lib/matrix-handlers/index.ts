import { type IEvent } from 'matrix-js-sdk';

import { RoomState } from '@cardstack/host/lib/matrix-classes/room';

import type {
  CommandEvent,
  CommandResultEvent,
  MatrixEvent as DiscreteMatrixEvent,
  ReactionEvent,
} from 'https://cardstack.com/base/matrix-event';

import type MatrixService from '../../services/matrix-service';

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

export async function addRoomEvent(context: MatrixService, event: Event) {
  let { event_id: eventId, room_id: roomId, state_key: stateKey } = event;
  // If we are receiving an event which contains
  // a data field, we need to parse it
  // because matrix doesn't support all json types
  // Corresponding encoding is done in
  // sendEvent in the matrix-service
  if (event.content?.data) {
    if (typeof event.content.data !== 'string') {
      console.warn(
        `skipping matrix event ${
          eventId ?? stateKey
        }, event.content.data is not serialized properly`,
      );
      return;
    }
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
  let room = context.getRoom(roomId);
  if (!room) {
    room = new RoomState();
    context.setRoom(roomId, room);
  }

  // duplicate events may be emitted from matrix, as well as the resolved room card might already contain this event
  if (!room.events.find((e) => e.event_id === eventId)) {
    room.events = [
      ...(room.events ?? []),
      event as unknown as DiscreteMatrixEvent,
    ];
  }
}

export async function updateRoomEvent(
  context: MatrixService,
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

  let room = context.getRoom(roomId);
  if (!room) {
    throw new Error(
      `bug: unknown room for event ${JSON.stringify(event, null, 2)}`,
    );
  }
  let oldEventIndex = room.events.findIndex((e) => e.event_id === oldEventId);
  if (oldEventIndex >= 0) {
    room.events[oldEventIndex] = event as unknown as DiscreteMatrixEvent;
    room.events = [...room.events];
  }
}

export async function getRoomEvents(
  context: MatrixService,
  roomId: string,
): Promise<DiscreteMatrixEvent[]> {
  if (!roomId) {
    throw new Error(
      `bug: roomId is undefined for event ${JSON.stringify(event, null, 2)}`,
    );
  }
  let room = context.getRoom(roomId);
  let resolvedRoom = await room;
  return resolvedRoom?.events ?? [];
}

export async function getCommandResultEvents(
  context: MatrixService,
  roomId: string,
): Promise<CommandResultEvent[]> {
  let events = await getRoomEvents(context, roomId);
  return events.filter((e) => isCommandResultEvent(e)) as CommandResultEvent[];
}

export async function getCommandReactionEvents(
  context: MatrixService,
  roomId: string,
): Promise<ReactionEvent[]> {
  let events = await getRoomEvents(context, roomId);
  return events.filter((e) =>
    isCommandReactionStatusApplied(e),
  ) as ReactionEvent[];
}

export function isCommandEvent(
  event: DiscreteMatrixEvent,
): event is CommandEvent {
  return (
    event.type === 'm.room.message' &&
    typeof event.content === 'object' &&
    event.content.msgtype === 'org.boxel.command' &&
    event.content.format === 'org.matrix.custom.html' &&
    typeof event.content.data === 'object' &&
    typeof event.content.data.toolCall === 'object'
  );
}

export const isCommandReactionStatusApplied = (
  event: DiscreteMatrixEvent,
): event is ReactionEvent => {
  return (
    event.type === 'm.reaction' &&
    event.content['m.relates_to']?.rel_type === 'm.annotation' &&
    event.content['m.relates_to']?.key === 'applied'
  );
};

export function isCommandResultEvent(
  event: DiscreteMatrixEvent,
): event is CommandResultEvent {
  return (
    event.type === 'm.room.message' &&
    typeof event.content === 'object' &&
    event.content.msgtype === 'org.boxel.commandResult'
  );
}
