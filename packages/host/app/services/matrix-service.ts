import Service from '@ember/service';
import { createClient } from 'matrix-js-sdk';
import {
  type IAuthData,
  type Room as MatrixRoom,
  type MatrixEvent,
  type RoomMember,
  type EmittedEvents,
  Preset,
  RoomMemberEvent,
  RoomEvent,
} from 'matrix-js-sdk';
import { tracked } from '@glimmer/tracking';
import { TrackedMap } from 'tracked-built-ins';
import debounce from 'lodash/debounce';
import ENV from '@cardstack/host/config/environment';

const { matrixURL } = ENV;
export const eventDebounceMs = 300;

interface Room {
  eventId: string;
  roomId: string;
  name?: string;
  timestamp: number;
}

interface RoomInvite extends Room {
  sender: string;
}

export default class MatrixService extends Service {
  @tracked
  client = createClient({ baseUrl: matrixURL });
  invites: TrackedMap<string, RoomInvite>;
  joinedRooms: TrackedMap<string, Room>;
  private eventBindings: [EmittedEvents, (...arg: any[]) => void][];
  private roomNames: Map<string, string> = new Map();
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

  constructor(properties: object) {
    super(properties);
    this.invites = new TrackedMap();
    this.joinedRooms = new TrackedMap();

    // building the event bindings like this so that we can consistently bind
    // and unbind these events programmatically--this way if we add a new event
    // we won't forget to unbind it.
    this.eventBindings = [
      [RoomMemberEvent.Membership, this.onMembership],
      [RoomEvent.Name, this.onRoomName],
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
      try {
        await this.client.initCrypto();
      } catch (e) {
        // when there are problems, these exceptions are hard to see so logging them explicitly
        console.error(`Error initializing crypto`, e);
        throw e;
      }

      saveAuth(auth);
      this.bindEventListeners();

      await this.client.startClient();
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
      preset: Preset.TrustedPrivateChat, // private chat where all members have same power level as user that creates the room
      invite,
      name,
      topic,
      room_alias_name: encodeURIComponent(name),
    });
    return roomId;
  }

  private resetState() {
    this.invites = new TrackedMap();
    this.joinedRooms = new TrackedMap();
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

  private onMembership = (e: MatrixEvent, member: RoomMember) => {
    let { event } = e;
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
          let name = this.roomNames.get(roomId) ?? invite.name;
          invites.set(roomId, { ...invite, name });
          break;
        }
        case 'join': {
          let { type: _remove, ...joinedRoom } = membership;
          let name = this.roomNames.get(roomId) ?? joinedRoom.name;
          joinedRooms.set(roomId, { ...joinedRoom, name });
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

    this.roomNames.set(roomId, name);
    let invite = this.invites.get(roomId);
    if (invite) {
      this.invites.set(roomId, { ...invite, name });
    }
    let joinedRoom = this.joinedRooms.get(roomId);
    if (joinedRoom) {
      this.joinedRooms.set(roomId, { ...joinedRoom, name });
    }
  };
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
