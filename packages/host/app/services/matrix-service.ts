import Service, { service } from '@ember/service';
import {
  type IAuthData,
  type MatrixEvent,
  type RoomMember,
  type EmittedEvents,
  type IEvent,
  type MatrixClient,
} from 'matrix-js-sdk';
import type * as MatrixSDK from 'matrix-js-sdk';
import { task } from 'ember-concurrency';
import { tracked } from '@glimmer/tracking';
import { TrackedMap } from 'tracked-built-ins';
import RouterService from '@ember/routing/router-service';
import { importResource } from '../resources/import';
import { marked } from 'marked';
import {
  Timeline,
  Membership,
  Room,
  type RoomEvent as RoomEventInfo,
} from '../lib/matrix-handlers';
import type CardService from '../services/card-service';
import ENV from '@cardstack/host/config/environment';
import {
  type LooseSingleCardDocument,
  sanitizeHtml,
  baseRealm,
} from '@cardstack/runtime-common';
import type LoaderService from './loader-service';
import { type Card } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

const { matrixURL } = ENV;

interface Room extends RoomMeta {
  eventId: string;
  roomId: string;
  timestamp: number;
}

interface RoomInvite extends Room {
  sender: string;
}

interface RoomMeta {
  name?: string;
}

export type Event = Partial<IEvent>;

export default class MatrixService extends Service {
  @service private declare router: RouterService;
  @service declare loaderService: LoaderService;
  @service declare cardService: CardService;
  @tracked private _client: MatrixClient | undefined;
  invites: TrackedMap<string, RoomInvite> = new TrackedMap();
  joinedRooms: TrackedMap<string, RoomEventInfo> = new TrackedMap();
  roomMembers: TrackedMap<
    string,
    TrackedMap<string, { member: RoomMember; status: 'join' | 'invite' }>
  > = new TrackedMap();
  rooms: Map<string, RoomMeta> = new Map();
  timelines: TrackedMap<string, TrackedMap<string, Event>> = new TrackedMap();
  roomEventConsumers: TrackedMap<string, { card: Card; eventsField: string }> =
    new TrackedMap();
  flushTimeline: Promise<void> | undefined;
  mapClazz = TrackedMap as unknown as typeof Map;
  #ready: Promise<void>;
  #matrixSDK: typeof MatrixSDK | undefined;
  #eventBindings: [EmittedEvents, (...arg: any[]) => void][] | undefined;
  // we process the matrix events in batched queues so that we can collapse the
  // interstitial state between events to prevent unnecessary flashing on the
  // screen, i.e. user was invited to a room and then declined the invite should
  // result in nothing happening on the screen as opposed to an item appearing
  // in the invite list and then immediately disappearing.
  roomMembershipQueue: (
    | (RoomInvite & { type: 'invite' })
    | (RoomEventInfo & { type: 'join' })
    | { type: 'leave'; roomId: string }
  )[] = [];
  timelineQueue: MatrixEvent[] = [];

  constructor(properties: object) {
    super(properties);
    this.#ready = this.loadSDK.perform();
  }

  get ready() {
    return this.#ready;
  }

  get isLoading() {
    return this.loadSDK.isRunning;
  }

  private cardAPIModule = importResource(
    this,
    () => 'https://cardstack.com/base/card-api'
  );

  private loadSDK = task(async () => {
    await this.cardAPIModule.loaded;
    // The matrix SDK is VERY big so we only load it when we need it
    this.#matrixSDK = await import('matrix-js-sdk');
    this._client = this.matrixSDK.createClient({ baseUrl: matrixURL });
    // building the event bindings like this so that we can consistently bind
    // and unbind these events programmatically--this way if we add a new event
    // we won't forget to unbind it.
    this.#eventBindings = [
      [
        this.matrixSDK.RoomMemberEvent.Membership,
        Membership.onMembership(this),
      ],
      [this.matrixSDK.RoomEvent.Name, Room.onRoomName(this)],
      [this.matrixSDK.RoomEvent.Timeline, Timeline.onTimeline(this)],
    ];
  });

  get isLoggedIn() {
    return this.client.isLoggedIn();
  }

  get userId() {
    return this.client.getUserId();
  }

  get client() {
    if (!this._client) {
      throw new Error(`cannot use matrix client before matrix SDK has loaded`);
    }
    return this._client;
  }

  get cardAPI() {
    if (this.cardAPIModule.error) {
      throw new Error(
        `Error loading Card API: ${JSON.stringify(this.cardAPIModule.error)}`
      );
    }
    if (!this.cardAPIModule.module) {
      throw new Error(
        `bug: Card API has not loaded yet--make sure to await this.loaded before using the api`
      );
    }
    return this.cardAPIModule.module as typeof CardAPI;
  }

  private get matrixSDK() {
    if (!this.#matrixSDK) {
      throw new Error(`cannot use matrix SDK before it has loaded`);
    }
    return this.#matrixSDK;
  }

  async logout() {
    clearAuth();
    this.unbindEventListeners();
    await this.client.stopClient();
    await this.client.logout();
    this.resetState();
    this.router.transitionTo('chat');
  }

  async start(auth?: IAuthData) {
    if (!auth) {
      auth = getAuth();
      if (!auth) {
        return;
      }
    }

    let {
      access_token: accessToken,
      user_id: userId,
      device_id: deviceId,
    } = auth;
    if (!accessToken) {
      throw new Error(
        `Cannot create matrix client from auth that has no access token: ${JSON.stringify(
          auth,
          null,
          2
        )}`
      );
    }
    if (!userId) {
      throw new Error(
        `Cannot create matrix client from auth that has no user id: ${JSON.stringify(
          auth,
          null,
          2
        )}`
      );
    }
    if (!deviceId) {
      throw new Error(
        `Cannot create matrix client from auth that has no device id: ${JSON.stringify(
          auth,
          null,
          2
        )}`
      );
    }
    this._client = this.matrixSDK.createClient({
      baseUrl: matrixURL,
      accessToken,
      userId,
      deviceId,
    });
    if (this.isLoggedIn) {
      this.router.transitionTo('chat.index');
      saveAuth(auth);
      this.bindEventListeners();

      await this._client.startClient();
    }
  }

  async createRoom(
    name: string,
    localInvite: string[], // these are just local names--assume no federation, all users live on the same homeserver
    topic?: string
  ): Promise<string> {
    let homeserver = new URL(this.client.getHomeserverUrl());
    let invite = localInvite.map((i) => `@${i}:${homeserver.hostname}`);
    let { room_id: roomId } = await this.client.createRoom({
      preset: this.matrixSDK.Preset.TrustedPrivateChat, // private chat where all members have same power level as user that creates the room
      invite,
      name,
      topic,
      room_alias_name: encodeURIComponent(name),
      initial_state: [
        {
          type: 'org.boxel.roomEventConsumer',
          content: {
            eventsField: 'events',
            ref: {
              name: 'MatrixRoomCard',
              module: `${baseRealm.url}matrix-room`,
            },
          },
        },
      ],
    });
    return roomId;
  }

  // these are just local names--assume no federation, all users live on the same homeserver
  async invite(roomId: string, localInvites: string[]) {
    let homeserver = new URL(this.client.getHomeserverUrl());
    await Promise.all(
      localInvites.map((localName) =>
        this.client.invite(roomId, `@${localName}:${homeserver.hostname}`)
      )
    );
  }

  async sendMessage(
    roomId: string,
    body: string | undefined,
    card?: Card
  ): Promise<void> {
    let html = body != null ? sanitizeHtml(marked(body)) : '';
    let serializedCard: LooseSingleCardDocument | undefined;
    if (card) {
      serializedCard = await this.cardService.serializeCard(card);
      body = `${body ?? ''} (Card: ${card.title ?? 'Untitled'}, ${
        card.id
      })`.trim();
    }
    if (card) {
      await this.client.sendEvent(roomId, 'm.room.message', {
        msgtype: 'org.boxel.card',
        body,
        formatted_body: html,
        instance: serializedCard,
      });
    } else {
      await this.client.sendHtmlMessage(roomId, body ?? '', html);
    }
  }

  async sendMarkdownMessage(roomId: string, markdown: string): Promise<void> {
    let html = sanitizeHtml(marked(markdown));
    await this.client.sendHtmlMessage(roomId, markdown, html);
  }

  private resetState() {
    this.invites = new TrackedMap();
    this.joinedRooms = new TrackedMap();
    this.roomMembers = new TrackedMap();
    this.rooms = new Map();
    this.timelines = new TrackedMap();
    this.roomMembershipQueue = [];
    this.unbindEventListeners();
    this._client = this.matrixSDK.createClient({ baseUrl: matrixURL });
  }

  private bindEventListeners() {
    if (!this.#eventBindings) {
      throw new Error(
        `cannot bind to matrix events before the matrix SDK has loaded`
      );
    }
    for (let [event, handler] of this.#eventBindings) {
      this.client.on(event, handler);
    }
  }
  private unbindEventListeners() {
    if (!this.#eventBindings) {
      throw new Error(
        `cannot unbind to matrix events before the matrix SDK has loaded`
      );
    }
    for (let [event, handler] of this.#eventBindings) {
      this.client.off(event, handler);
    }
  }
}

function saveAuth(auth: IAuthData) {
  localStorage.setItem('auth', JSON.stringify(auth));
}

function clearAuth() {
  localStorage.removeItem('auth');
}

function getAuth(): IAuthData | undefined {
  let auth = localStorage.getItem('auth');
  if (!auth) {
    return;
  }
  return JSON.parse(auth) as IAuthData;
}
