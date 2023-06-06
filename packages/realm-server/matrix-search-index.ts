import { type MatrixClient } from 'matrix-js-sdk';
import {
  type SearchEntry,
  type ModuleWithErrors,
  Stats,
} from '@cardstack/runtime-common/search-index';
import {
  Context,
  Timeline,
  Membership,
  Room,
  Event,
} from '@cardstack/runtime-common/matrix-handlers';
import { type SerializedError } from '@cardstack/runtime-common/error';
import { URLMap } from '@cardstack/runtime-common/url-map';
import { type EmittedEvents, RoomMemberEvent, RoomEvent } from 'matrix-js-sdk';

interface MatrixSearchEntry extends SearchEntry {
  room: string;
}
type MatrixSearchEntryWithErrors =
  | { type: 'entry'; entry: MatrixSearchEntry }
  | { type: 'error'; error: SerializedError };

export class MatrixSearchIndex {
  // A card instance URL probably looks like:
  // http://matrix-realm-server/roomId/eventId
  #instances: URLMap<MatrixSearchEntryWithErrors> = new URLMap();
  #roomId: string;
  #getClient: () => MatrixClient;
  #eventBindings: [EmittedEvents, (...arg: any[]) => void][];
  #modules: Map<string, ModuleWithErrors> = new Map();
  #context: Context;
  #receivedMessages: Promise<void>;
  #receivedRooms: Promise<void>;
  stats: Stats = {
    instancesIndexed: 0,
    instanceErrors: 0,
    moduleErrors: 0,
  };

  // we pass a function to get the matrix client instead of the client directly
  // as the client might actually change as we handle token refresh
  constructor(getClient: () => MatrixClient, roomId: string) {
    this.#roomId = roomId;
    this.#getClient = getClient;
    let didReceiveMessages: () => void;
    this.#receivedMessages = new Promise<void>(
      (res) => (didReceiveMessages = res)
    );
    let didReceiveRooms: () => void;
    this.#receivedRooms = new Promise<void>((res) => (didReceiveRooms = res));
    this.#context = {
      roomMembers: new Map(),
      invites: new Map(),
      joinedRooms: new Map(),
      rooms: new Map(),
      timelines: new Map(),
      roomMembershipQueue: [],
      timelineQueue: [],
      mapClazz: Map,
      flushTimeline: undefined,
      getClient: () => this.#client,
      handleMessage: this.#handleMessage,
      didReceiveMessages: didReceiveMessages!,
      didReceiveRooms: didReceiveRooms!,
    };

    // building the event bindings like this so that we can consistently bind
    // and unbind these events programmatically--this way if we add a new event
    // we won't forget to unbind it.
    this.#eventBindings = [
      [
        RoomMemberEvent.Membership,
        Membership.onMembership(this.#context, this.#roomId),
      ],
      [RoomEvent.Name, Room.onRoomName(this.#context, this.#roomId)],
      [RoomEvent.Timeline, Timeline.onTimeline(this.#context, this.#roomId)],
    ];
  }

  start() {
    this.bindEventListeners();
  }

  async flushMessages() {
    await this.#receivedMessages;
    await this.#context.flushTimeline;
  }

  async flushRooms() {
    await this.#receivedRooms;
  }

  shutdown() {
    this.unbindEventListeners();
  }

  get #client() {
    return this.#getClient();
  }

  private bindEventListeners() {
    for (let [event, handler] of this.#eventBindings) {
      this.#client.on(event, handler);
    }
  }

  private unbindEventListeners() {
    for (let [event, handler] of this.#eventBindings) {
      this.#client.off(event, handler);
    }
  }

  #handleMessage = async (_context: Context, event: Event, roomId: string) => {
    console.log(`=====> Indexing event ${event.event_id} in room ${roomId}`);
  };
}
