import {
  MatrixClient,
  getMatrixUsername,
  userIdFromUsername,
} from '@cardstack/runtime-common/matrix-client';
import type { MatrixEvent } from 'https://cardstack.com/base/matrix-event';

let nextRoomCounter = 1;
let nextEventCounter = 1;
const roomsByUser = new Map<string, Set<string>>();
const messagesByRoom = new Map<string, MatrixEvent[]>();
const accountDataByUser = new Map<string, Map<string, unknown>>();

function ensureUserRooms(userId: string) {
  let rooms = roomsByUser.get(userId);
  if (!rooms) {
    rooms = new Set<string>();
    roomsByUser.set(userId, rooms);
  }
  return rooms;
}

function ensureUserAccountData(userId: string) {
  let accountData = accountDataByUser.get(userId);
  if (!accountData) {
    accountData = new Map<string, unknown>();
    accountDataByUser.set(userId, accountData);
  }
  return accountData;
}

export class MockMatrixClient extends MatrixClient {
  #loggedIn = false;
  #userId: string;

  constructor({
    matrixURL,
    username,
    password,
    seed,
  }: {
    matrixURL: URL;
    username: string;
    password?: string;
    seed?: string;
  }) {
    super({
      matrixURL,
      username,
      password,
      seed: seed ?? 'mock-seed',
    });
    this.#userId = userIdFromUsername(username, matrixURL.href);
  }

  override isLoggedIn() {
    return this.#loggedIn;
  }

  override getUserId() {
    return this.#loggedIn ? this.#userId : undefined;
  }

  override async login() {
    this.#loggedIn = true;
  }

  override async isTokenValid() {
    return this.#loggedIn;
  }

  override async getOpenIdToken() {
    if (!this.#loggedIn) {
      await this.login();
    }

    return {
      access_token: `mock-openid:${encodeURIComponent(this.#userId)}`,
      expires_in: 3600,
      matrix_server_name: new URL(this.matrixURL.href).hostname,
      token_type: 'Bearer',
    };
  }

  override async verifyOpenIdToken(openIdToken: string) {
    let match = openIdToken.match(/^mock-openid:(.+)$/);
    if (match) {
      return decodeURIComponent(match[1]);
    }
    if (openIdToken.startsWith('@')) {
      return openIdToken;
    }
    return this.#userId;
  }

  override async getJoinedRooms() {
    return {
      joined_rooms: [...ensureUserRooms(this.#userId)],
    };
  }

  override async joinRoom(roomId: string) {
    ensureUserRooms(this.#userId).add(roomId);
  }

  override async createDM(inviteeUserId: string): Promise<string> {
    if (!this.#loggedIn) {
      await this.login();
    }
    if (inviteeUserId === this.#userId) {
      throw new Error(`Cannot create a DM with self: ${inviteeUserId}`);
    }
    let roomId = `!mock-dm-${nextRoomCounter++}:localhost`;
    ensureUserRooms(this.#userId).add(roomId);
    ensureUserRooms(inviteeUserId).add(roomId);
    return roomId;
  }

  override async setAccountData<T>(type: string, data: T) {
    ensureUserAccountData(this.#userId).set(type, data);
  }

  override async getAccountDataFromServer<T>(type: string) {
    let accountData = ensureUserAccountData(this.#userId);
    if (accountData.has(type)) {
      return accountData.get(type) as T;
    }
    return null;
  }

  override async getProfile(userId: string): Promise<{ displayname: string }> {
    return { displayname: getMatrixUsername(userId) };
  }

  override async sendEvent<T>(roomId: string, type: string, content: T) {
    ensureUserRooms(this.#userId).add(roomId);
    let eventId = `$mock-event-${nextEventCounter++}`;
    let messages = messagesByRoom.get(roomId) ?? [];
    messages.unshift({
      type,
      content: content as MatrixEvent['content'],
      event_id: eventId,
      origin_server_ts: Date.now(),
      sender: this.#userId,
    } as MatrixEvent);
    messagesByRoom.set(roomId, messages);
    return eventId;
  }

  override async roomMessages(roomId: string) {
    return [...(messagesByRoom.get(roomId) ?? [])];
  }
}
