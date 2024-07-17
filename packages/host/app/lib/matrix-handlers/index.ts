import {
  type MatrixEvent,
  type RoomMember,
  type MatrixClient,
  type IEvent,
} from 'matrix-js-sdk';

import { RoomState } from '@cardstack/host/lib/matrix-classes/room';

import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type { MatrixEvent as DiscreteMatrixEvent } from 'https://cardstack.com/base/matrix-event';

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
  setRoom: (roomId: string, room: RoomState) => void;
  // Note: Notice our implementation looks completely synchronous but bcos of the way we process our matrix event as a subscriber. getRoom is inherently asynchronous
  // getRoom is async because subscribe handlers should be synchronous and we should handle asynchrony outside of the handler code, otherwise, handler/queues will become confused
  // If you look around the codebase, you will see instances of await getRoom which is the correct pattern to use although the types do not reflect so
  // The reason why the types are locked in as synchronous is because we don't have a good way to react or access .events which hides behind this promise
  // If we await getRoom before accessing .events, we lose trackedness
  // TODO: Resolve matrix async types with this https://linear.app/cardstack/issue/CS-6987/get-room-resource-to-register-with-matrix-event-handler
  getRoom: (roomId: string) => RoomState | undefined;
  cardAPI: typeof CardAPI;
}

export interface Context extends EventSendingContext {
  flushTimeline: Promise<void> | undefined;
  flushMembership: Promise<void> | undefined;
  roomMembershipQueue: { event: MatrixEvent; member: RoomMember }[];
  timelineQueue: { event: MatrixEvent; oldEventId?: string }[];
  client: MatrixClient | undefined;
  matrixSDK: typeof MatrixSDK | undefined;
  handleMessage?: (
    context: Context,
    event: Event,
    roomId: string,
  ) => Promise<void>;
  addEventReadReceipt(eventId: string, receipt: { readAt: Date }): void;
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
  let room = context.getRoom(roomId);
  if (!room) {
    room = new RoomState();
    context.setRoom(roomId, room);
  }
  let resolvedRoom = await room; //look at the note in the EventSendingContext interface for why this is awaited

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
  let room = context.getRoom(roomId);
  if (!room) {
    throw new Error(
      `bug: unknown room for event ${JSON.stringify(event, null, 2)}`,
    );
  }
  let resolvedRoom = await room; //look at the note in the EventSendingContext interface for why this is awaited
  let oldEventIndex = resolvedRoom.events.findIndex(
    (e) => e.event_id === oldEventId,
  );
  if (oldEventIndex >= 0) {
    resolvedRoom.events[oldEventIndex] =
      event as unknown as DiscreteMatrixEvent;
    resolvedRoom.events = [...resolvedRoom.events];
  }
}

export async function getRoomEvents(
  context: EventSendingContext,
  roomId: string,
): Promise<DiscreteMatrixEvent[]> {
  if (!roomId) {
    throw new Error(
      `bug: roomId is undefined for event ${JSON.stringify(event, null, 2)}`,
    );
  }
  let room = context.rooms.get(roomId);
  let resolvedRoom = await room;
  return resolvedRoom?.events ?? [];
}

export async function getCommandResultEvents(
  context: EventSendingContext,
  roomId: string,
): Promise<CommandResultEvent[]> {
  let events = await getRoomEvents(context, roomId);
  return events.filter((e) => isCommandResultEvent(e)) as CommandResultEvent[];
}

export async function getCommandReactionEvents(
  context: EventSendingContext,
  roomId: string,
): Promise<ReactionEvent[]> {
  let events = await getRoomEvents(context, roomId);
  return events.filter((e) => isCommandReactionEvent(e)) as ReactionEvent[];
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

export const isCommandReactionEvent = (
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
