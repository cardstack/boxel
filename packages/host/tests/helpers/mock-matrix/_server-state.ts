import type * as MatrixSDK from 'matrix-js-sdk';
type IEvent = MatrixSDK.IEvent;

export class ServerState {
  #roomCounter = 0;
  #eventCounter = 0;
  #rooms: Map<string, { events: IEvent[]; receipts: IEvent[] }> = new Map();
  #listeners: ((event: IEvent) => void)[] = [];
  #displayName: string;
  #now: () => number;

  constructor(opts: { displayName: string; now: () => number }) {
    this.#displayName = opts.displayName;
    this.#now = opts.now;
  }

  get displayName() {
    return this.#displayName;
  }

  onEvent(callback: (event: IEvent) => void) {
    this.addListener(callback);
  }

  get rooms(): { id: string }[] {
    return Array.from(this.#rooms.keys()).map((id) => ({ id }));
  }

  addListener(callback: (event: IEvent) => void) {
    this.#listeners.push(callback);
  }

  createRoom(
    sender: string,
    name?: string,
    timestamp: number = this.#now(),
  ): string {
    if (document.querySelector('[data-test-throw-room-error]')) {
      throw new Error('Intentional error thrown');
    }

    let roomId = `mock_room_${this.#roomCounter++}`;

    if (this.#rooms.has(roomId)) {
      throw new Error(`room ${roomId} already exists`);
    }

    this.#rooms.set(roomId, { events: [], receipts: [] });

    this.addRoomEvent(
      sender,
      {
        room_id: roomId,
        type: 'm.room.create',
        content: {
          creator: sender,
          room_version: '0',
        },
      },
      { origin_server_ts: timestamp },
    );

    this.addRoomEvent(
      sender,
      {
        room_id: roomId,
        type: 'm.room.name',
        content: { name: name ?? roomId },
      },
      { origin_server_ts: timestamp },
    );

    this.addRoomEvent(
      sender,
      {
        room_id: roomId,
        type: 'm.room.member',
        content: {
          displayname: 'testuser',
          membership: 'join',
          membershipTs: timestamp,
          membershipInitiator: sender,
        },
      },
      { origin_server_ts: timestamp },
    );

    this.addRoomEvent(
      sender,
      {
        room_id: roomId,
        type: 'm.room.member',
        content: {
          displayname: 'aibot',
          membership: 'invite',
        },
      },
      {
        origin_server_ts: timestamp,
        // host application expects this for the bot to join the room
        state_key: '@aibot:localhost',
      },
    );

    return roomId;
  }

  addRoomEvent(
    sender: string,
    event: Omit<
      IEvent,
      'event_id' | 'origin_server_ts' | 'unsigned' | 'status' | 'sender'
    >,
    overrides?: { state_key?: string; origin_server_ts?: number },
  ) {
    let room = event.room_id && this.#rooms.get(event.room_id);
    if (!room) {
      throw new Error(`room ${event.room_id} does not exist`);
    }
    let eventId = this.eventId();
    let matrixEvent: IEvent = {
      ...event,
      // Don’t want to list out all the types from MatrixEvent union type
      type: event.type as any,
      event_id: eventId,
      origin_server_ts: overrides?.origin_server_ts ?? this.#now(),
      unsigned: { age: 0 },
      sender,
      state_key: overrides?.state_key ?? sender,
    };
    let matrixContent = matrixEvent.content as any;
    if (matrixContent?.data?.replace) {
      matrixContent.data = matrixContent.data.replace(/__EVENT_ID__/g, eventId);
    }
    let relatesTo = matrixContent?.['m.relates_to'] as any;
    if (relatesTo?.event_id?.replace) {
      relatesTo.event_id = relatesTo.event_id.replace(/__EVENT_ID__/g, eventId);
    }
    console.log('adding event', matrixEvent);
    room.events.push(matrixEvent);
    this.#listeners.forEach((listener) => listener(matrixEvent));

    return matrixEvent.event_id;
  }

  addReactionEvent(
    sender: string,
    roomId: string,
    eventId: string,
    status: string,
  ) {
    let room = this.#rooms.get(roomId);
    if (!room) {
      throw new Error(`room ${roomId} does not exist`);
    }

    let content = {
      'm.relates_to': {
        event_id: eventId,
        key: status,
        rel_type: 'm.annotation' as MatrixSDK.RelationType.Annotation,
      },
    };

    let reactionEvent = {
      event_id: this.eventId(),
      origin_server_ts: this.#now(),
      room_id: roomId,
      type: 'm.reaction' as MatrixSDK.EventType.Reaction,
      sender,
      content,
      state_key: '',
      unsigned: { age: 0 },
      status: 'sent' as MatrixSDK.EventStatus.SENT,
    };

    room.events.push(reactionEvent);
    this.#listeners.forEach((listener) => listener(reactionEvent));

    return reactionEvent;
  }

  addReceiptEvent(
    roomId: string,
    eventId: string,
    sender: string,
    receiptType: MatrixSDK.ReceiptType,
  ) {
    let room = this.#rooms.get(roomId);
    if (!room) {
      throw new Error(`room ${roomId} does not exist`);
    }

    let ts = this.#now();
    let content: Record<string, any> = {
      [eventId]: {
        [receiptType]: {
          [sender]: {
            thread_id: 'main',
            ts,
          },
        },
      },
    };

    let receiptEvent: IEvent = {
      event_id: this.eventId(),
      origin_server_ts: ts,
      room_id: roomId,
      type: 'm.receipt' as any,
      sender,
      unsigned: { age: 0 },
      state_key: '',
      content,
    };

    room.receipts.push(receiptEvent);
    this.#listeners.forEach((listener) => listener(receiptEvent));

    return receiptEvent;
  }

  getRoomEvents(roomId: string): IEvent[] {
    let room = this.#rooms.get(roomId);
    if (!room) {
      throw new Error(`room ${roomId} does not exist`);
    }
    return room.events;
  }

  eventId(): string {
    return `!mock_event_${this.#eventCounter++}`;
  }

  setDisplayName(name: string) {
    if (name === 'MAKEMECRASH') {
      throw new Error('BOOM!');
    } else {
      this.#displayName = name;
    }
  }
}
