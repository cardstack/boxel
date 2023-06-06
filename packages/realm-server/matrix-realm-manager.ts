import './e2ee';
import { Deferred } from '@cardstack/runtime-common';
import { createPrivateRoom } from '@cardstack/matrix/docker/synapse';
import { MatrixRealm } from './matrix-realm';
import {
  createClient,
  RoomEvent,
  RoomMemberEvent,
  type IAuthData,
  type MatrixClient,
  type MatrixEvent,
  type RoomMember,
  type EmittedEvents,
  type Room as MatrixRoom,
} from 'matrix-js-sdk';

interface RoomOptions {
  invite?: string[];
  topic?: string;
}

export class MatrixRealmManager {
  #client: MatrixClient;
  #matrixServerURL;
  #realms: Map<string, MatrixRealm> = new Map();
  #startedUp = new Deferred<void>();
  #eventBindings: [EmittedEvents, (...arg: any[]) => void][];
  #inviteQueue: string[] = []; // roomId's
  #flushInvites: Promise<void> | undefined;
  #joinedRooms: string[] = [];

  constructor(matrixServerURL: string) {
    this.#matrixServerURL = matrixServerURL;
    this.#client = createClient({ baseUrl: matrixServerURL });
    this.#eventBindings = [
      [RoomEvent.Name, this.#onRoom],
      [RoomMemberEvent.Membership, this.#onInvite],
    ];

    this.#startedUp.fulfill((() => this.#startup())());
  }

  get realms() {
    return this.#realms;
  }

  ready(): Promise<void> {
    return this.#startedUp.promise;
  }

  async createPrivateRoom(
    accessToken: string,
    name: string,
    opts?: RoomOptions
  ): Promise<MatrixRealm> {
    let indexUserId = this.#client.getUserId();
    if (!indexUserId) {
      throw new Error(`bug: cannot determine userId from matrix client`);
    }
    let roomId = await createPrivateRoom(
      { baseUrl: this.#matrixServerURL },
      accessToken,
      name,
      [indexUserId, ...(opts?.invite ?? [])],
      opts?.topic
    );
    let realm = new MatrixRealm(roomId, () => this.#client);
    this.#realms.set(roomId, realm);
    await this.#waitUntilJoinedRoom(roomId);
    return realm;
  }

  async shutdown() {
    await this.#flushInvites;
    this.#unbindEventListeners();
    for (let realm of this.#realms.values()) {
      realm.shutdown();
    }

    // note that it takes up to an hour to actually end the process after
    // shutdown() is called due to this bug in the matrix-js-sdk
    // https://github.com/matrix-org/matrix-js-sdk/issues/2472 As a workaround,
    // I identified the problematic timers (there are 2 of them) and we are
    // patching matrix-js-sdk and using `unref()` to tell node that it is ok to
    // exit the process if the problematic timers are still running.
    this.#client.stopClient();
  }

  // a test utility to await for message events to be indexed
  async flushMessages() {
    for (let realm of this.#realms.values()) {
      await realm.flushMessages();
    }
  }

  // a test utility to await for initial room/membership events to be indexed
  async flushRooms() {
    for (let realm of this.#realms.values()) {
      await realm.flushRooms();
    }
  }

  async #startup() {
    let userId = process.env.MATRIX_INDEX_USERID;
    let password = process.env.MATRIX_INDEX_PASSWORD;
    if (!userId) {
      throw new Error(`The env var MATRIX_INDEX_USERID has not been set`);
    }
    if (!password) {
      throw new Error(`The env var MATRIX_INDEX_PASSWORD has not been set`);
    }

    let auth: IAuthData | undefined = await this.#client.loginWithPassword(
      userId,
      password
    );
    if (!auth || !this.#client.isLoggedIn()) {
      throw new Error(`could not authenticate index username '${userId}'`);
    }
    if (!auth.access_token || !auth.device_id) {
      throw new Error(
        `bug: matrix returned auth data with missing access token/device ID`
      );
    }
    this.#client = createClient({
      baseUrl: this.#matrixServerURL,
      accessToken: auth.access_token,
      userId: auth.user_id,
      deviceId: auth.device_id,
    });

    try {
      await this.#client.initCrypto();
    } catch (e) {
      // when there are problems, these exceptions are hard to see so logging them explicitly
      console.error(`Error initializing crypto`, e);
      throw e;
    }

    // this lets us send messages to element clients (useful for testing).
    // probably we wanna verify these unknown devices (when in an encrypted
    // room). need to research how to do that as its undocumented API
    this.#client.setGlobalErrorOnUnknownDevices(false);

    await this.#client.startClient();
    this.#bindEventListeners();

    // TODO need to handle token refresh as our session is very long-lived

    // TODO ON WEDNESDAY: one idea that is probably not bad is to get a list of
    // all the joined rooms from the API and then use this.#waitUntilJoinedRoom
    // to wait for the indexer to get ready
  }

  #onRoom = (room: MatrixRoom) => {
    let { roomId } = room;
    if (room.getMyMembership() === 'join') {
      this.#joinedRooms.push(roomId);
    }
    if (!this.#realms.has(roomId)) {
      let realm = new MatrixRealm(roomId, () => this.#client);
      this.#realms.set(roomId, realm);
    }
  };

  #onInvite = (_e: MatrixEvent, member: RoomMember) => {
    if (
      member.membership === 'invite' &&
      member.userId === process.env.MATRIX_INDEX_USERID
    ) {
      this.#inviteQueue.push(member.roomId);
      this.#drainInviteQueue();
    }
  };

  async #drainInviteQueue() {
    await this.#flushInvites;

    let invitesDrained: () => void;
    this.#flushInvites = new Promise((res) => (invitesDrained = res));
    let invites = [...this.#inviteQueue];
    this.#inviteQueue = [];
    for (let roomId of invites) {
      await this.#client.joinRoom(roomId);
      this.#joinedRooms.push(roomId);
    }
    invitesDrained!();
  }

  async #waitUntilJoinedRoom(roomId: string) {
    const timeout = Date.now() + 30 * 1000;
    for (;;) {
      if (this.#joinedRooms.includes(roomId)) {
        return;
      }
      if (Date.now() > timeout) {
        throw new Error(`Timed out waiting to join room ${roomId}`);
      }
      await new Promise((res) => setTimeout(res, 100));
    }
  }

  #bindEventListeners() {
    for (let [event, handler] of this.#eventBindings) {
      this.#client.on(event, handler);
    }
  }

  #unbindEventListeners() {
    for (let [event, handler] of this.#eventBindings) {
      this.#client.off(event, handler);
    }
  }
}
