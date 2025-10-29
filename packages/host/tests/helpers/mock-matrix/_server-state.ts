import * as MatrixSDK from 'matrix-js-sdk';

type IEvent = MatrixSDK.IEvent;

export class ServerState {
  #roomCounter = 0;
  #eventCounter = 0;
  #rooms: Map<
    string,
    {
      events: IEvent[];
      receipts: IEvent[];
      roomStateEvents: Map<string, Map<string, MatrixSDK.MatrixEvent>>;
    }
  > = new Map();
  #listeners: ((event: IEvent) => void)[] = [];
  #slidingSyncListeners: ((roomId: string, roomName?: string) => void)[] = [];
  #displayName: string;
  #contents: Map<string, ArrayBuffer> = new Map();
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

  onSlidingSyncEvent(callback: (roomId: string, roomName?: string) => void) {
    this.#slidingSyncListeners.push(callback);
  }

  createRoom(
    sender: string,
    name?: string,
    timestamp: number = this.#now(),
    id?: string,
  ): string {
    if (document.querySelector('[data-test-throw-room-error]')) {
      throw new Error('Intentional error thrown');
    }

    let roomId = id ?? `mock_room_${this.#roomCounter++}`;

    if (this.#rooms.has(roomId)) {
      throw new Error(`room ${roomId} already exists`);
    }

    this.#rooms.set(roomId, {
      events: [],
      receipts: [],
      roomStateEvents: new Map(),
    });

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
      { origin_server_ts: timestamp, state_key: '' },
    );

    this.addRoomEvent(
      sender,
      {
        room_id: roomId,
        type: 'm.room.name',
        content: { name: name ?? roomId },
      },
      { origin_server_ts: timestamp, state_key: '' },
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
      { origin_server_ts: timestamp, state_key: sender },
    );

    if (
      !roomId.includes('test-session-room-realm') &&
      roomId !== 'test-auth-realm-server-session-room'
    ) {
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

      this.addRoomEvent(
        '@aibot:localhost',
        {
          room_id: roomId,
          type: 'm.room.member',
          content: {
            displayname: 'aibot',
            membership: 'join',
          },
        },
        {
          origin_server_ts: timestamp,
          // host application expects this for the bot to join the room
          state_key: '@aibot:localhost',
        },
      );
    }

    // Emit sliding sync event for the new room
    setTimeout(() => {
      this.#slidingSyncListeners.forEach((listener) => listener(roomId, name));
    }, 0);

    return roomId;
  }

  getRoomState(
    roomId: string,
    eventType: string,
    stateKey?: string,
  ): Record<string, any> {
    let event = this.#rooms
      .get(roomId)
      ?.roomStateEvents.get(eventType)
      ?.get(stateKey ?? '');
    if (event) {
      return event.event.content || {};
    } else {
      throw new MatrixSDK.MatrixError({
        errcode: 'M_NOT_FOUND',
        error: `room state event ${eventType} does not exist for state key ${stateKey}`,
      });
    }
  }

  setRoomState(
    sender: string,
    roomId: string,
    eventType: string,
    content: Record<string, any>,
    stateKey?: string,
    timestamp: number = this.#now(),
  ) {
    let room = this.#rooms.get(roomId);
    if (!room) {
      throw new Error(`room ${roomId} does not exist`);
    }
    return this.addRoomEvent(
      sender,
      {
        room_id: roomId,
        type: eventType,
        content,
      },
      {
        origin_server_ts: timestamp,
        state_key: stateKey ?? '',
      },
    );
  }

  addRoomEvent(
    sender: string,
    event: Omit<
      IEvent,
      'event_id' | 'origin_server_ts' | 'unsigned' | 'status' | 'sender'
    >,
    overrides?: {
      event_id?: string;
      state_key?: string;
      origin_server_ts?: number;
    },
  ) {
    // duplicate the event fully
    let room = event.room_id && this.#rooms.get(event.room_id);
    if (!room) {
      throw new Error(
        `room ${event.room_id} does not exist, known rooms: ${Array.from(
          this.#rooms.keys(),
        ).join(', ')}`,
      );
    }
    let eventId = overrides?.event_id ?? this.eventId();
    let matrixEvent: IEvent = {
      ...event,
      // Don’t want to list out all the types from MatrixEvent union type
      type: event.type as any,
      event_id: eventId,
      origin_server_ts: overrides?.origin_server_ts ?? this.#now(),
      unsigned: { age: 0 },
      sender,
      state_key: overrides?.state_key,
    };
    let matrixContent = matrixEvent.content as any;
    if (matrixContent?.data?.replace) {
      matrixContent.data = matrixContent.data.replace(/__EVENT_ID__/g, eventId);
    }
    let relatesTo = matrixContent?.['m.relates_to'] as any;
    if (relatesTo?.event_id?.replace) {
      relatesTo.event_id = relatesTo.event_id.replace(/__EVENT_ID__/g, eventId);
    }
    room.events.push(matrixEvent);
    setTimeout(() => {
      this.#listeners.forEach((listener) => listener(matrixEvent));
    }, 0);
    if (typeof overrides?.state_key === 'string') {
      if (!room.roomStateEvents.has(event.type)) {
        room.roomStateEvents.set(event.type, new Map());
      }
      room.roomStateEvents
        .get(event.type)!
        .set(overrides.state_key, new MatrixSDK.MatrixEvent(matrixEvent));
    }
    return matrixEvent.event_id;
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
    return [...room.events];
  }

  getRoomStateUpdatePayload(roomId: string): MatrixSDK.RoomState {
    let room = this.#rooms.get(roomId);
    if (!room) {
      throw new Error(`room ${roomId} does not exist`);
    }
    return { events: room.roomStateEvents, roomId } as MatrixSDK.RoomState;
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

  addContent(mxcUrl: string, content: ArrayBuffer) {
    this.#contents.set(mxcUrl, content);
  }

  getContent(mxcUrl: string) {
    return this.#contents.get(mxcUrl);
  }
}
