import Service, { service } from '@ember/service';
import { createClient } from 'matrix-js-sdk';
import {
  type IAuthData,
  type Room as MatrixRoom,
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
import debounce from 'lodash/debounce';
import RouterService from '@ember/routing/router-service';
import ENV from '@cardstack/host/config/environment';

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
  @tracked
  client = createClient({ baseUrl: matrixURL });
  invites: TrackedMap<string, RoomInvite> = new TrackedMap();
  joinedRooms: TrackedMap<string, Room> = new TrackedMap();
  roomMembers: TrackedMap<
    string,
    TrackedMap<string, { member: RoomMember; status: 'join' | 'invite' }>
  > = new TrackedMap();
  rooms: Map<string, RoomMeta> = new Map();
  timelines: TrackedMap<string, TrackedMap<string, Event>> = new TrackedMap();
  flushTimeline: Promise<void> | undefined;
  private eventBindings: [EmittedEvents, (...arg: any[]) => void][];
  // we process the matrix events in batched queues so that we can collapse the
  // interstitial state between events to prevent unnecessary flashing on the
  // screen, i.e. user was invited to a room and then declined the invite should
  // result in nothing happening on the screen as opposed to an item appearing
  // in the invite list and then immediately disappearing.
  private roomMembershipQueue: (
    | (RoomInvite & { type: 'invite' })
    | (Room & { type: 'join' })
    | { type: 'leave'; roomId: string }
  )[] = [];
  private timelineQueue: MatrixEvent[] = [];

  constructor(properties: object) {
    super(properties);
    // building the event bindings like this so that we can consistently bind
    // and unbind these events programmatically--this way if we add a new event
    // we won't forget to unbind it.
    this.eventBindings = [
      [RoomMemberEvent.Membership, this.onMembership],
      [RoomEvent.Name, this.onRoomName],
      [RoomEvent.Timeline, this.onTimeline],
    ];
  }

  get isLoggedIn() {
    return this.client.isLoggedIn();
  }

  get userId() {
    return this.client.getUserId();
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

  private onTimeline = (e: MatrixEvent) => {
    let { event } = e;
    if (
      event.type === 'm.room.encryption' &&
      // this is the only algorithm that matrix supports for room encryption
      event.content?.algorithm === 'm.megolm.v1.aes-sha2'
    ) {
      let { room_id: roomId } = event;
      if (!roomId) {
        throw new Error(
          `bug: roomId is undefined for message event ${JSON.stringify(
            event,
            null,
            2
          )}`
        );
      }
      this.setRoomMeta(roomId, { encrypted: true });
    } else {
      this.timelineQueue.push(e);
      this.debouncedTimelineDrain();
    }
  };

  private debouncedTimelineDrain = debounce(() => {
    this.drainTimeline();
  }, eventDebounceMs);

  private async drainTimeline() {
    await this.flushTimeline;

    let eventsDrained: () => void;
    this.flushTimeline = new Promise((res) => (eventsDrained = res));
    let events = [...this.timelineQueue];
    this.timelineQueue = [];
    for (let event of events) {
      await this.client.decryptEventIfNeeded(event);
      this.processDecryptedEvent({
        ...event.event,
        content: event.getContent() || undefined,
      });
    }
    eventsDrained!();
  }

  private processDecryptedEvent(event: Event) {
    let { event_id: eventId, room_id: roomId } = event;
    if (!eventId) {
      throw new Error(
        `bug: event ID is undefined for event ${JSON.stringify(event, null, 2)}`
      );
    }
    if (event.type === 'm.room.message' || event.type === 'm.room.encrypted') {
      if (!roomId) {
        throw new Error(
          `bug: roomId is undefined for message event ${JSON.stringify(
            event,
            null,
            2
          )}`
        );
      }
      let timeline = this.timelines.get(roomId);
      if (!timeline) {
        timeline = new TrackedMap<string, Event>();
        this.timelines.set(roomId, timeline);
      }
      // we use a map for the timeline to de-dupe events
      timeline.set(eventId, event);
    }
  }

  private onMembership = (e: MatrixEvent, member: RoomMember) => {
    let { event } = e;
    let { roomId, userId } = member;
    let members = this.roomMembers.get(roomId);
    if (!members) {
      members = new TrackedMap();
      this.roomMembers.set(roomId, members);
    }
    switch (member.membership) {
      case 'leave':
        members.delete(userId);
        break;
      case 'invite':
      case 'join':
        members.set(userId, { member, status: member.membership });
        break;
      default:
        throw new Error(
          `don't know how to handle membership status of '${member.membership}`
        );
    }

    if (member.userId === this.client.getUserId()) {
      let {
        event_id: eventId,
        room_id: roomId,
        origin_server_ts: timestamp,
      } = event;
      if (!eventId) {
        throw new Error(
          `received room membership event without an event ID: ${JSON.stringify(
            event,
            null,
            2
          )}`
        );
      }
      if (!roomId) {
        throw new Error(
          `received room membership event without a room ID: ${JSON.stringify(
            event,
            null,
            2
          )}`
        );
      }
      if (timestamp == null) {
        throw new Error(
          `received room membership event without a timestamp: ${JSON.stringify(
            event,
            null,
            2
          )}`
        );
      }
      if (member.membership === 'invite') {
        this.roomMembershipQueue.push({
          type: 'invite',
          roomId,
          eventId,
          sender: event.sender!,
          timestamp,
        });
      }
      if (member.membership === 'join') {
        this.roomMembershipQueue.push({
          type: 'join',
          roomId,
          eventId,
          timestamp,
        });
      }
      if (member.membership === 'leave') {
        this.roomMembershipQueue.push({ type: 'leave', roomId });
      }
      this.flushMembershipQueue();
    }
  };

  private flushMembershipQueue = debounce(() => {
    let invites: Map<string, RoomInvite> = new Map();
    let joinedRooms: Map<string, Room> = new Map();
    let removals: Set<
      { type: 'join'; roomId: string } | { type: 'invite'; roomId: string }
    > = new Set();
    let processingMemberships = [...this.roomMembershipQueue];
    this.roomMembershipQueue = [];

    // collapse the invites/joins by eliminating rooms that we have joined or left (in order)
    for (let membership of processingMemberships) {
      let { roomId } = membership;
      switch (membership.type) {
        case 'invite': {
          let { type: _remove, ...invite } = membership;
          let name = this.rooms.get(roomId)?.name ?? invite.name;
          // note that we can't see room encryption events for rooms we haven't joined
          invites.set(roomId, { ...invite, name });
          break;
        }
        case 'join': {
          let { type: _remove, ...joinedRoom } = membership;
          let name = this.rooms.get(roomId)?.name ?? joinedRoom.name;
          let encrypted =
            this.rooms.get(roomId)?.encrypted ?? joinedRoom.encrypted;
          joinedRooms.set(roomId, { ...joinedRoom, ...{ name, encrypted } });
          // once we join a room we remove any invites for this room that are
          // part of this flush as well as historical invites for this room
          invites.delete(roomId);
          removals.add({ type: 'invite', roomId });
          break;
        }
        case 'leave': {
          // if we leave a room we want to remove any invites for this room that
          // are part of this flush as well as any historical invites and joins
          invites.delete(roomId);
          joinedRooms.delete(roomId);
          removals.add({ type: 'invite', roomId });
          removals.add({ type: 'join', roomId });
          break;
        }
        default:
          assertNever(membership);
      }
    }

    // process any rooms that we have left for rooms that are not part of this flush
    for (let { type, roomId } of removals) {
      if (type === 'invite') {
        this.invites.delete(roomId);
      } else {
        this.joinedRooms.delete(roomId);
      }
    }
    // add all the remaining invites/joins
    for (let invite of invites.values()) {
      this.invites.set(invite.roomId, { ...invite });
    }
    for (let joinedRoom of joinedRooms.values()) {
      this.joinedRooms.set(joinedRoom.roomId, { ...joinedRoom });
    }
  }, eventDebounceMs);

  // populate room names in the joined/invited rooms. This event seems to always
  // come after the room membership events above
  private onRoomName = (room: MatrixRoom) => {
    let { roomId, name } = room;
    // This seems to be some kind of matrix default which is not helpful
    if (name === 'Empty room') {
      return;
    }

    this.setRoomMeta(roomId, { name });
  };

  private setRoomMeta(roomId: string, meta: RoomMeta) {
    let roomMeta = this.rooms.get(roomId);
    if (!roomMeta) {
      roomMeta = {};
      this.rooms.set(roomId, roomMeta);
    }
    if (meta.name !== undefined) {
      roomMeta.name = meta.name;
    }
    roomMeta.encrypted = roomMeta.encrypted ?? meta.encrypted;
    let invite = this.invites.get(roomId);
    if (invite) {
      this.invites.set(roomId, { ...invite, ...roomMeta });
    }
    let joinedRoom = this.joinedRooms.get(roomId);
    if (joinedRoom) {
      this.joinedRooms.set(roomId, { ...joinedRoom, ...roomMeta });
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

function assertNever(value: never) {
  throw new Error(`should never happen ${value}`);
}
