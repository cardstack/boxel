import { createHash } from 'node:crypto';
import { Deferred } from '@cardstack/runtime-common';
import {
  existsSync,
  ensureFileSync,
  readJSONSync,
  writeJSONSync,
} from 'fs-extra';
import { join } from 'path';
import {
  registerUser,
  createPrivateRoom,
  type Credentials,
} from '@cardstack/matrix/docker/synapse';
import { MatrixRealm } from './matrix-realm';
import { createClient, type IAuthData } from 'matrix-js-sdk';

// TODO this probably belongs in a DB. Note that we can't really use matrix to
// discover all the rooms to index since we are leveraging private rooms whose
// index usernames are based on the room name. matrix will not leak private room
// names to requests whose access code does not correspond to a member of the
// room--so we have to store the rooms we are interested indexing outside of
// matrix.
function getRoomsFile() {
  return process.env.ROOMS_FILE ?? join(__dirname, 'data', 'rooms.json');
}

interface RoomOptions {
  invite?: string[];
  topic?: string;
}

interface Room {
  roomId: string;
  credentials: Credentials;
  realm: MatrixRealm;
}

export class MatrixRealmManager {
  #matrixServerURL;
  #rooms: Room[] = [];
  #startedUp = new Deferred<void>();

  constructor(matrixServerURL: string) {
    this.#matrixServerURL = matrixServerURL;

    this.#startedUp.fulfill((() => this.#startup())());
  }

  get ready(): Promise<void> {
    return this.#startedUp.promise;
  }

  async createPrivateRoom(
    accessToken: string,
    name: string,
    opts?: RoomOptions
  ): Promise<{ roomId: string; realm: MatrixRealm; indexUserId: string }> {
    const indexUserSecret = process.env.INDEX_USER_SECRET;
    if (indexUserSecret == null) {
      throw new Error(`the env var INDEX_USER_SECRET is not set`);
    }
    const registrationSecret = process.env.MATRIX_REGISTRATION_SECRET;
    if (registrationSecret == null) {
      throw new Error(`the env var MATRIX_REGISTRATION_SECRET is not set`);
    }
    let indexUsername = `realm_index__${encodeURIComponent(name)
      .toLowerCase()
      .replace(/%/g, '_')}`;
    const sha256 = createHash('sha256');
    let indexPassword = sha256
      .update(indexUsername)
      .update(indexUserSecret)
      .digest('hex');
    let credentials = await registerUser(
      { baseUrl: this.#matrixServerURL, registrationSecret },
      indexUsername,
      indexPassword
    );

    let roomId = await createPrivateRoom(
      { baseUrl: this.#matrixServerURL },
      accessToken,
      name,
      [credentials.userId, ...(opts?.invite ?? [])],
      opts?.topic
    );
    let realm = new MatrixRealm({
      matrixServerURL: this.#matrixServerURL,
      ...credentials,
    });
    await realm.ready;
    serializeNewRoom(roomId, credentials.userId);
    this.#rooms.push({ roomId, credentials, realm });
    return {
      roomId,
      realm,
      indexUserId: credentials.userId, // used by tests
    };
  }

  shutdown() {
    for (let { realm } of this.#rooms) {
      realm.shutdown();
    }
  }

  async #startup() {
    await Promise.resolve();
    const indexUserSecret = process.env.INDEX_USER_SECRET;
    if (indexUserSecret == null) {
      throw new Error(`the env var INDEX_USER_SECRET is not set`);
    }
    let rooms = getSerializedRooms();
    for (let [roomId, { userId }] of Object.entries(rooms)) {
      let client = createClient({ baseUrl: this.#matrixServerURL });
      const sha256 = createHash('sha256');
      let password = sha256
        .update(userId.slice(1, userId.indexOf(':')))
        .update(indexUserSecret)
        .digest('hex');
      let auth: IAuthData | undefined = await client.loginWithPassword(
        userId,
        password
      );
      if (!auth || !client.isLoggedIn()) {
        throw new Error(
          `could not authenticate index user '${userId}' for room ${roomId}`
        );
      }
      if (!auth.access_token || !auth.device_id) {
        throw new Error(
          `bug: matrix returned auth data with missing access token/device ID`
        );
      }
      let credentials: Credentials = {
        accessToken: auth.access_token,
        deviceId: auth.device_id,
        userId,
        homeServer: this.#matrixServerURL,
      };
      let realm = new MatrixRealm({
        matrixServerURL: this.#matrixServerURL,
        accessToken: credentials.accessToken,
        userId,
        deviceId: credentials.deviceId,
      });
      await realm.ready;
      this.#rooms.push({
        roomId,
        credentials,
        realm,
      });
    }
  }
}

interface RoomsSerialization {
  rooms: {
    [roomId: string]: {
      userId: string;
    };
  };
}

// how do we remove a room from the serialized rooms file--would we ever want to
// do that? (this would mean that we are no longer interested in maintaining an
// index for a room)
function serializeNewRoom(roomId: string, userId: string) {
  let rooms = getSerializedRooms();
  rooms[roomId] = {
    userId,
  };
  writeJSONSync(getRoomsFile(), rooms, { spaces: 2 });
}

function getSerializedRooms() {
  let roomsFile = getRoomsFile();
  if (!existsSync(roomsFile)) {
    ensureFileSync(roomsFile);
    writeJSONSync(roomsFile, { rooms: {} } as RoomsSerialization);
  }
  let serialized: RoomsSerialization = readJSONSync(roomsFile);
  if (!serialized) {
    serialized = { rooms: {} };
    writeJSONSync(roomsFile, serialized, { spaces: 2 });
  }
  return serialized.rooms;
}
