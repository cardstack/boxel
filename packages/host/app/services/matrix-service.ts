import Service, { service } from '@ember/service';

import { tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';

import { marked } from 'marked';
import {
  type IAuthData,
  type MatrixEvent,
  type RoomMember,
  type EmittedEvents,
  type IEvent,
  type MatrixClient,
} from 'matrix-js-sdk';
import { TrackedMap } from 'tracked-built-ins';

import {
  type LooseSingleCardDocument,
  type CodeRef,
  type MatrixCardError,
  sanitizeHtml,
} from '@cardstack/runtime-common';

import { Submode } from '@cardstack/host/components/submode-switcher';
import ENV from '@cardstack/host/config/environment';

import { type CardDef } from 'https://cardstack.com/base/card-api';
import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type {
  RoomField,
  MatrixEvent as DiscreteMatrixEvent,
} from 'https://cardstack.com/base/room';
import type { RoomObjectiveField } from 'https://cardstack.com/base/room-objective';

import { Timeline, Membership, addRoomEvent } from '../lib/matrix-handlers';
import { importResource } from '../resources/import';

import type LoaderService from './loader-service';

import type CardService from '../services/card-service';
import type * as MatrixSDK from 'matrix-js-sdk';

const { matrixURL } = ENV;
const SET_OBJECTIVE_POWER_LEVEL = 50;
const DEFAULT_PAGE_SIZE = 50;

export type Event = Partial<IEvent>;

export type OperatorModeContext = {
  submode: Submode;
  openCards: CardDef[];
};

export default class MatrixService extends Service {
  @service declare loaderService: LoaderService;
  @service declare cardService: CardService;
  @tracked private _client: MatrixClient | undefined;

  rooms: TrackedMap<string, Promise<RoomField>> = new TrackedMap();
  roomObjectives: TrackedMap<string, RoomObjectiveField | MatrixCardError> =
    new TrackedMap();
  flushTimeline: Promise<void> | undefined;
  flushMembership: Promise<void> | undefined;
  roomMembershipQueue: { event: MatrixEvent; member: RoomMember }[] = [];
  timelineQueue: MatrixEvent[] = [];
  #ready: Promise<void>;
  #matrixSDK: typeof MatrixSDK | undefined;
  #eventBindings: [EmittedEvents, (...arg: any[]) => void][] | undefined;

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
    () => 'https://cardstack.com/base/card-api',
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
      [this.matrixSDK.RoomEvent.Timeline, Timeline.onTimeline(this)],
    ];
  });

  get isLoggedIn() {
    return this.client.isLoggedIn();
  }

  get client() {
    if (!this._client) {
      throw new Error(`cannot use matrix client before matrix SDK has loaded`);
    }
    return this._client;
  }

  get userId() {
    return this.client.getUserId();
  }

  get cardAPI() {
    if (this.cardAPIModule.error) {
      throw new Error(
        `Error loading Card API: ${JSON.stringify(this.cardAPIModule.error)}`,
      );
    }
    if (!this.cardAPIModule.module) {
      throw new Error(
        `bug: Card API has not loaded yet--make sure to await this.loaded before using the api`,
      );
    }
    return this.cardAPIModule.module as typeof CardAPI;
  }

  get matrixSDK() {
    if (!this.#matrixSDK) {
      throw new Error(`cannot use matrix SDK before it has loaded`);
    }
    return this.#matrixSDK;
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
          2,
        )}`,
      );
    }
    if (!userId) {
      throw new Error(
        `Cannot create matrix client from auth that has no user id: ${JSON.stringify(
          auth,
          null,
          2,
        )}`,
      );
    }
    if (!deviceId) {
      throw new Error(
        `Cannot create matrix client from auth that has no device id: ${JSON.stringify(
          auth,
          null,
          2,
        )}`,
      );
    }
    this._client = this.matrixSDK.createClient({
      baseUrl: matrixURL,
      accessToken,
      userId,
      deviceId,
    });
    if (this.isLoggedIn) {
      saveAuth(auth);
      this.bindEventListeners();

      await this._client.startClient();
      await this.initializeRooms();
    }
  }

  async createRoom(
    name: string,
    invites: string[], // these can be local names
    topic?: string,
  ): Promise<string> {
    let userId = this.client.getUserId();
    if (!userId) {
      throw new Error(
        `bug: there is no userId associated with the matrix client`,
      );
    }
    let invite = invites.map((i) =>
      i.startsWith('@') ? i : `@${i}:${userId!.split(':')[1]}`,
    );
    let { room_id: roomId } = await this.client.createRoom({
      preset: this.matrixSDK.Preset.PrivateChat,
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
        `bug: there is no userId associated with the matrix client`,
      );
    }
    await Promise.all(
      invite.map((i) =>
        this.client.invite(
          roomId,
          i.startsWith('@') ? i : `@${i}:${userId!.split(':')[1]}`,
        ),
      ),
    );
  }

  async sendMessage(
    roomId: string,
    body: string | undefined,
    card?: CardDef,
    context?: OperatorModeContext,
  ): Promise<void> {
    let html = body != null ? sanitizeHtml(marked(body)) : '';
    if (context?.submode === Submode.Interact) {
      let serializedCards = await Promise.all(
        context!.openCards.map(async (card) => {
          return await this.cardService.serializeCard(card);
        }),
      );
      await this.client.sendEvent(roomId, 'm.room.message', {
        msgtype: 'org.boxel.message',
        body,
        formatted_body: html,
        context: {
          openCards: serializedCards,
          submode: context.submode,
        },
      });
      return;
    }

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

  async allowedToSetObjective(roomId: string): Promise<boolean> {
    let powerLevels = await this.getPowerLevels(roomId);
    let myUserId = this.client.getUserId();
    if (!myUserId) {
      throw new Error(`bug: cannot get user ID for current matrix client`);
    }

    return (powerLevels[myUserId] ?? 0) >= SET_OBJECTIVE_POWER_LEVEL;
  }

  async setObjective(roomId: string, ref: CodeRef): Promise<void> {
    if (!this.allowedToSetObjective(roomId)) {
      throw new Error(
        `The user '${this.client.getUserId()}' is not permitted to set an objective in room '${roomId}'`,
      );
    }
    await this.client.sendEvent(roomId, 'm.room.message', {
      msgtype: 'org.boxel.objective',
      body: `Objective has been set by ${this.client.getUserId()}`,
      ref,
    });
  }

  async initializeRooms() {
    let { joined_rooms: joinedRooms } = await this.client.getJoinedRooms();
    for (let roomId of joinedRooms) {
      let stateEvents = await this.client.roomState(roomId);
      await Promise.all(stateEvents.map((event) => addRoomEvent(this, event)));
      let messages = await this.allRoomMessages(roomId);
      await Promise.all(messages.map((event) => addRoomEvent(this, event)));
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
        },
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

  // the matrix SDK is using an old version of this API that is not compatible
  // with our current version matrix, so we use the API directly
  async requestRegisterEmailToken(
    email: string,
    clientSecret: string,
    sendAttempt: number,
  ) {
    let response = await fetch(
      `${matrixURL}/_matrix/client/v3/register/email/requestToken`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          client_secret: clientSecret,
          send_attempt: sendAttempt,
        }),
      },
    );
    if (response.ok) {
      return (await response.json()) as MatrixSDK.IRequestTokenResponse;
    } else {
      let data = (await response.json()) as { errcode: string; error: string };
      let error = new Error(data.error) as any;
      error.data = data;
      error.status = response.status;
      throw error;
    }
  }

  async getPowerLevels(roomId: string): Promise<{ [userId: string]: number }> {
    let response = await fetch(
      `${matrixURL}/_matrix/client/v3/rooms/${roomId}/state/m.room.power_levels/`,
      {
        headers: {
          Authorization: `Bearer ${this.client.getAccessToken()}`,
        },
      },
    );
    let { users } = await response.json();
    return users;
  }

  private resetState() {
    this.rooms = new TrackedMap();
    this.roomMembershipQueue = [];
    this.timelineQueue = [];
    this.flushMembership = undefined;
    this.flushTimeline = undefined;
    this.unbindEventListeners();
    this._client = this.matrixSDK.createClient({ baseUrl: matrixURL });
  }

  private bindEventListeners() {
    if (!this.#eventBindings) {
      throw new Error(
        `cannot bind to matrix events before the matrix SDK has loaded`,
      );
    }
    for (let [event, handler] of this.#eventBindings) {
      this.client.on(event, handler);
    }
  }
  private unbindEventListeners() {
    if (!this.#eventBindings) {
      throw new Error(
        `cannot unbind to matrix events before the matrix SDK has loaded`,
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
