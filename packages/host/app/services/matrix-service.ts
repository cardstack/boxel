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
import ENV from '@cardstack/host/config/environment';

const { matrixURL } = ENV;

export interface Room {
  roomId: string;
  name?: string;
  timestamp: number;
}

export interface RoomInvite extends Room {
  sender: string;
}

export default class MatrixService extends Service {
  @tracked
  client = createClient({ baseUrl: matrixURL });
  invites: TrackedMap<string, RoomInvite>;
  joinedRooms: TrackedMap<string, Room>;
  eventBindings: [EmittedEvents, (...arg: any[]) => void][];

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
      let { room_id: roomId, origin_server_ts: timestamp } = event;
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
        this.invites.set(roomId, {
          roomId,
          sender: event.sender!,
          timestamp,
        });
      }
      if (member.membership === 'join') {
        this.joinedRooms.set(roomId, {
          roomId,
          timestamp,
        });
      }
    }
  };

  // populate room names in the joined/invited rooms. This event seems to always
  // come after the room membership events above
  private onRoomName = (room: MatrixRoom) => {
    let { roomId, name } = room;
    // This seems to be some kind of matrix default which is not helpful
    if (name === 'Empty room') {
      return;
    }

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
