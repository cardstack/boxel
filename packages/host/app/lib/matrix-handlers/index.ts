import {
  type MatrixEvent,
  type RoomMember,
  type MatrixClient,
  type IEvent,
} from 'matrix-js-sdk';
import type {
  RoomCard,
  MatrixEvent as DiscreteMatrixEvent,
} from 'https://cardstack.com/base/room';
import type { RoomObjectiveCard } from 'https://cardstack.com/base/room-objective';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import { type LooseCardResource, baseRealm } from '@cardstack/runtime-common';
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

export interface Context {
  roomCards: Map<string, Promise<RoomCard>>;
  // TODO collapse this into the RoomCard
  roomObjectives: Map<string, RoomObjectiveCard>;
  flushTimeline: Promise<void> | undefined;
  flushMembership: Promise<void> | undefined;
  roomMembershipQueue: { event: MatrixEvent; member: RoomMember }[];
  timelineQueue: MatrixEvent[];
  cardAPI: typeof CardAPI;
  client: MatrixClient;
  matrixSDK: typeof MatrixSDK;
  handleMessage?: (
    context: Context,
    event: Event,
    roomId: string
  ) => Promise<void>;
}

export async function addRoomEvent(context: Context, event: Event) {
  let { event_id: eventId, room_id: roomId, state_key: stateKey } = event;
  eventId = eventId ?? stateKey; // room state may not necessary have an event ID
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
  let roomCard = context.roomCards.get(roomId);
  if (!roomCard) {
    let data: LooseCardResource = {
      attributes: {
        id: roomId,
      },
      meta: {
        adoptsFrom: {
          name: 'RoomCard',
          module: `${baseRealm.url}room`,
        },
      },
    };
    roomCard = context.cardAPI.createFromSerialized<typeof RoomCard>(
      data,
      { data },
      undefined
    );
    context.roomCards.set(roomId, roomCard);
  }
  let resolvedRoomCard = await roomCard;

  // duplicate events may be emitted from matrix, as well as the resolved room card might already contain this event
  if (!resolvedRoomCard.events.find((e) => e.event_id === eventId)) {
    resolvedRoomCard.events = [
      ...(resolvedRoomCard.events ?? []),
      event as unknown as DiscreteMatrixEvent,
    ];
  }
}
