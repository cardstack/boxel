import {
  type MatrixEvent,
  type RoomMember,
  type MatrixClient,
  type IEvent,
} from 'matrix-js-sdk';

import {
  type LooseCardResource,
  type MatrixCardError,
  baseRealm,
  isMatrixCardError,
} from '@cardstack/runtime-common';

import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type {
  RoomField,
  MatrixEvent as DiscreteMatrixEvent,
} from 'https://cardstack.com/base/room';
import type { RoomObjectiveField } from 'https://cardstack.com/base/room-objective';

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

export type Event = Partial<IEvent>;

export interface EventSendingContext {
  rooms: Map<string, Promise<RoomField>>;
  cardAPI: typeof CardAPI;
  loaderService: LoaderService;
}

export interface Context extends EventSendingContext {
  roomObjectives: Map<string, RoomObjectiveField | MatrixCardError>;
  flushTimeline: Promise<void> | undefined;
  flushMembership: Promise<void> | undefined;
  roomMembershipQueue: { event: MatrixEvent; member: RoomMember }[];
  timelineQueue: MatrixEvent[];
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

// our reactive system doesn't cascade "up" through our consumers. meaning that
// when a card's contained field is another card and the interior card's field
// changes, the consuming card's computeds will not automatically recompute. To
// work around that, we are performing the assignment of the interior card to
// the consuming card again which will trigger the consuming card's computeds to
// pick up the interior card's updated fields. In this case the consuming
// card/field is the RoomObjectiveField and the interior field is the RoomField.
export async function recomputeRoomObjective(context: Context, roomId: string) {
  let room = await context.rooms.get(roomId);
  let objective = context.roomObjectives.get(roomId);
  if (objective && room && !isMatrixCardError(objective)) {
    objective.room = room;
  }
}
