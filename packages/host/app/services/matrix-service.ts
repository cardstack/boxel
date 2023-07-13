import Service, { service } from '@ember/service';
import {
  type IAuthData,
  type MatrixEvent,
  type RoomMember,
  type EmittedEvents,
  type IEvent,
  type MatrixClient,
} from 'matrix-js-sdk';
import { task } from 'ember-concurrency';
import { tracked } from '@glimmer/tracking';
import { TrackedMap } from 'tracked-built-ins';
import { importResource } from '../resources/import';
import { marked } from 'marked';
import { Timeline, Membership, addRoomEvent } from '../lib/matrix-handlers';
import type CardService from '../services/card-service';
import ENV from '@cardstack/host/config/environment';
import {
  type LooseSingleCardDocument,
  type CardRef,
  sanitizeHtml,
} from '@cardstack/runtime-common';
import MatrixSDK from 'matrix-js-sdk';
import type LoaderService from './loader-service';
import { type Card } from 'https://cardstack.com/base/card-api';
import type {
  RoomCard,
  MatrixEvent as DiscreteMatrixEvent,
} from 'https://cardstack.com/base/room';
import type { RoomObjectiveCard } from 'https://cardstack.com/base/room-objective';
import type * as CardAPI from 'https://cardstack.com/base/card-api';

const { matrixURL } = ENV;
const SET_OBJECTIVE_POWER_LEVEL = 50;
const DEFAULT_PAGE_SIZE = 25;

export type Event = Partial<IEvent>;

export default class MatrixService extends Service {
  @service declare loaderService: LoaderService;
  @service declare cardService: CardService;
  @tracked client: MatrixClient;

  roomCards: TrackedMap<string, Promise<RoomCard>> = new TrackedMap();
  roomObjectives: TrackedMap<string, RoomObjectiveCard> = new TrackedMap();
  flushTimeline: Promise<void> | undefined;
  flushMembership: Promise<void> | undefined;
  roomMembershipQueue: { event: MatrixEvent; member: RoomMember }[] = [];
  timelineQueue: MatrixEvent[] = [];
  #ready: Promise<void>;
  #eventBindings: [EmittedEvents, (...arg: any[]) => void][] | undefined;

  constructor(properties: object) {
    super(properties);
    this.#ready = this.loadCardAPI.perform();

    this.client = MatrixSDK.createClient({ baseUrl: matrixURL });
    // building the event bindings like this so that we can consistently bind
    // and unbind these events programmatically--this way if we add a new event
    // we won't forget to unbind it.
    this.#eventBindings = [
      [MatrixSDK.RoomMemberEvent.Membership, Membership.onMembership(this)],
      [MatrixSDK.RoomEvent.Timeline, Timeline.onTimeline(this)],
    ];
  }

  get ready() {
    return this.#ready;
  }

  get isLoading() {
    return this.loadCardAPI.isRunning;
  }

  private cardAPIModule = importResource(
    this,
    () => 'https://cardstack.com/base/card-api'
  );

  private loadCardAPI = task(async () => {
    await this.cardAPIModule.loaded;
  });

  get isLoggedIn() {
    return this.client.isLoggedIn();
  }

  get userId() {
    return this.client.getUserId();
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

  async logout() {
    await this.flushMembership;
    await this.flushTimeline;
    clearAuth();
    this.unbindEventListeners();
    await this.client.stopClient();
    await this.client.logout();
    this.resetState();
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
    this.client = MatrixSDK.createClient({
      baseUrl: matrixURL,
      accessToken,
      userId,
      deviceId,
    });
    if (this.isLoggedIn) {
      saveAuth(auth);
      this.bindEventListeners();

      await this.client.startClient();
      await this.initializeRoomStates();
    }
  }

  async createRoom(
    name: string,
    invites: string[], // these can be local names
    topic?: string
  ): Promise<string> {
    let userId = this.client.getUserId();
    if (!userId) {
      throw new Error(
        `bug: there is no userId associated with the matrix client`
      );
    }
    let invite = invites.map((i) =>
      i.startsWith('@') ? i : `@${i}:${userId!.split(':')[1]}`
    );
    let { room_id: roomId } = await this.client.createRoom({
      preset: MatrixSDK.Preset.PrivateChat,
      invite,
      name,
      topic,
      room_alias_name: encodeURIComponent(name),
    });
    return roomId;
  }

  // these can be local names
  async invite(roomId: string, invite: string[]) {
    let userId = this.client.getUserId();
    if (!userId) {
      throw new Error(
        `bug: there is no userId associated with the matrix client`
      );
    }
    await Promise.all(
      invite.map((i) =>
        this.client.invite(
          roomId,
          i.startsWith('@') ? i : `@${i}:${userId!.split(':')[1]}`
        )
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

  canSetObjective(roomId: string): boolean {
    let room = this.client.getRoom(roomId);
    if (!room) {
      throw new Error(`bug: cannot get room for ${roomId}`);
    }
    let myUserId = this.client.getUserId();
    if (!myUserId) {
      throw new Error(`bug: cannot get user ID for current matrix client`);
    }

    let myself = room.getMember(myUserId);
    if (!myself) {
      throw new Error(
        `bug: cannot get room member '${myUserId}' in room '${roomId}'`
      );
    }
    return myself.powerLevel >= SET_OBJECTIVE_POWER_LEVEL;
  }

  async setObjective(roomId: string, ref: CardRef): Promise<void> {
    if (!this.canSetObjective(roomId)) {
      throw new Error(
        `The user '${this.client.getUserId()}' is not permitted to set an objective in room '${roomId}'`
      );
    }
    await this.client.sendEvent(roomId, 'm.room.message', {
      msgtype: 'org.boxel.objective',
      body: `Objective has been set by ${this.client.getUserId()}`,
      ref,
    });
  }

  async initializeRoomStates() {
    let { joined_rooms: joinedRooms } = await this.client.getJoinedRooms();
    for (let roomId of joinedRooms) {
      let stateEvents = await this.client.roomState(roomId);
      await Promise.all(stateEvents.map((event) => addRoomEvent(this, event)));
    }
  }

  async allRoomMessages(roomId: string, opts?: MessageOptions) {
    let messages: DiscreteMatrixEvent[] = [];
    let from: string | undefined;

    do {
      let response = await fetch(
        `${matrixURL}/_matrix/client/v3/rooms/${roomId}/messages?dir=${
          opts?.direction ? opts.direction.slice(0, 1) : 'f'
        }&limit=${opts?.pageSize ?? DEFAULT_PAGE_SIZE}${
          from ? '&from=' + from : ''
        }`,
        {
          headers: {
            Authorization: `Bearer ${this.client.getAccessToken()}`,
          },
        }
      );
      let { chunk, end } = await response.json();
      from = end;
      let events: DiscreteMatrixEvent[] = chunk;
      if (opts?.onMessages) {
        await opts.onMessages(events);
      }
      messages.push(...events);
    } while (!from);
    return messages;
  }

  private resetState() {
    this.roomCards = new TrackedMap();
    this.roomMembershipQueue = [];
    this.timelineQueue = [];
    this.flushMembership = undefined;
    this.flushTimeline = undefined;
    this.unbindEventListeners();
    this.client = MatrixSDK.createClient({ baseUrl: matrixURL });
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

interface MessageOptions {
  direction?: 'forward' | 'backward';
  onMessages?: (messages: DiscreteMatrixEvent[]) => Promise<void>;
  pageSize: number;
}
