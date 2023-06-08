import Service, { service } from '@ember/service';
import { createClient } from 'matrix-js-sdk';
import {
  type IAuthData,
  type MatrixEvent,
  type RoomMember,
  type EmittedEvents,
  type IEvent,
  Preset,
  RoomMemberEvent,
  RoomEvent,
} from 'matrix-js-sdk';
import { tracked } from '@glimmer/tracking';
import { TrackedMap } from 'tracked-built-ins';
import RouterService from '@ember/routing/router-service';
import { marked } from 'marked';
import {
  Timeline,
  Membership,
  Room,
  type RoomEvent as RoomEventInfo,
} from '../lib/matrix-handlers';
import type CardService from '../services/card-service';
import { type Card } from 'https://cardstack.com/base/card-api';
import ENV from '@cardstack/host/config/environment';
import {
  type LooseSingleCardDocument,
  sanitizeHtml,
} from '@cardstack/runtime-common';

const { matrixURL } = ENV;
export const eventDebounceMs = 300;

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
  encrypted?: boolean;
}

export type Event = Partial<IEvent>;

export default class MatrixService extends Service {
  @service private declare router: RouterService;
  @service declare cardService: CardService;
  @tracked
  client = createClient({ baseUrl: matrixURL });
  invites: TrackedMap<string, RoomInvite> = new TrackedMap();
  joinedRooms: TrackedMap<string, RoomEventInfo> = new TrackedMap();
  roomMembers: TrackedMap<
    string,
    TrackedMap<string, { member: RoomMember; status: 'join' | 'invite' }>
  > = new TrackedMap();
  rooms: Map<string, RoomMeta> = new Map();
  timelines: TrackedMap<string, TrackedMap<string, Event>> = new TrackedMap();
  flushTimeline: Promise<void> | undefined;
  mapClazz = TrackedMap as unknown as typeof Map;
  private eventBindings: [EmittedEvents, (...arg: any[]) => void][];
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
    // building the event bindings like this so that we can consistently bind
    // and unbind these events programmatically--this way if we add a new event
    // we won't forget to unbind it.
    this.eventBindings = [
      [RoomMemberEvent.Membership, Membership.onMembership(this)],
      [RoomEvent.Name, Room.onRoomName(this)],
      [RoomEvent.Timeline, Timeline.onTimeline(this)],
    ];
  }

  get isLoggedIn() {
    return this.client.isLoggedIn();
  }

  get userId() {
    return this.client.getUserId();
  }

  getClient() {
    return this.client;
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
    this.client = createClient({
      baseUrl: matrixURL,
      accessToken,
      userId,
      deviceId,
    });
    if (this.isLoggedIn) {
      this.router.transitionTo('chat.index');
      try {
        await this.client.initCrypto();
      } catch (e) {
        // when there are problems, these exceptions are hard to see so logging them explicitly
        console.error(`Error initializing crypto`, e);
        throw e;
      }

      // this let's us send messages to element clients (useful for testing).
      // probably we wanna verify these unknown devices (when in an encrypted
      // room). need to research how to do that as its undocumented API
      this.client.setGlobalErrorOnUnknownDevices(false);
      saveAuth(auth);
      this.bindEventListeners();

      await this.client.startClient();
    }
  }

  async createRoom(
    name: string,
    localInvite: string[], // these are just local names--assume no federation, all users live on the same homeserver
    encrypted: boolean,
    topic?: string
  ): Promise<string> {
    let homeserver = new URL(this.client.getHomeserverUrl());
    let invite = localInvite.map((i) => `@${i}:${homeserver.hostname}`);
    let { room_id: roomId } = await this.client.createRoom({
      preset: Preset.TrustedPrivateChat, // private chat where all members have same power level as user that creates the room
      invite,
      name,
      topic,
      room_alias_name: encodeURIComponent(name),
      ...(encrypted
        ? {
            initial_state: [
              {
                content: { algorithm: 'm.megolm.v1.aes-sha2' },
                type: 'm.room.encryption',
              },
            ],
          }
        : {}),
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
      body = `${body} (Card: ${card.title ?? 'Untitled'}, ${card.id})`.trim();
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
    this.client = createClient({ baseUrl: matrixURL });
  }

  private bindEventListeners() {
    for (let [event, handler] of this.eventBindings) {
      this.client.on(event, handler);
    }
  }
  private unbindEventListeners() {
    for (let [event, handler] of this.eventBindings) {
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
