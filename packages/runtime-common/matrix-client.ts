import { Sha256 } from '@aws-crypto/sha256-js';
import { uint8ArrayToHex } from './index';
import { REALM_ROOM_RETENTION_POLICY_MAX_LIFETIME } from './realm';
import { Deferred } from './deferred';
import type { MatrixEvent } from 'https://cardstack.com/base/matrix-event';

export interface MatrixAccess {
  accessToken: string;
  deviceId: string;
  userId: string;
}

export class MatrixClient {
  readonly matrixURL: URL;
  readonly username: string;
  private access: MatrixAccess | undefined;
  private password?: string;
  private seed?: string;
  private loggedInDeferred: Deferred<void> | undefined;
  private lastTxnTimestamp = 0;
  private txnSequence = 0;

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
    if (!password && !seed) {
      throw new Error(
        `Either password or a seed must be specified when creating a matrix client`,
      );
    }
    this.matrixURL = matrixURL;
    this.username = username;
    this.password = password;
    this.seed = seed;
  }

  getUserId() {
    return this.access?.userId;
  }

  isLoggedIn() {
    return this.access !== undefined;
  }

  private async request(
    path: string,
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'GET' = 'GET',
    options: RequestInit = {},
    includeAuth = true,
  ) {
    options.method = method;

    if (includeAuth) {
      if (!this.access) {
        throw new Error(`Missing matrix access token`);
      }
      options.headers = {
        ...options.headers,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.access.accessToken}`,
      };
    }
    return fetch(`${this.matrixURL.href}${path}`, options);
  }

  async login() {
    if (this.loggedInDeferred) {
      return await this.loggedInDeferred.promise;
    }
    this.loggedInDeferred = new Deferred();
    let password: string | undefined;
    if (this.password) {
      password = this.password;
    } else if (this.seed) {
      password = await passwordFromSeed(this.username, this.seed);
    } else {
      throw new Error(
        'bug: should never be here, we ensure password or seed exists in constructor',
      );
    }

    let response = await this.request(
      '_matrix/client/v3/login',
      'POST',
      {
        body: JSON.stringify({
          identifier: {
            type: 'm.id.user',
            user: this.username,
          },
          password,
          type: 'm.login.password',
        }),
      },
      false,
    );

    let json = await response.json();

    if (!response.ok) {
      let error = new Error(
        `Unable to login to matrix ${this.matrixURL.href} as user ${
          this.username
        }: status ${response.status} - ${JSON.stringify(json)}`,
      );
      this.loggedInDeferred.reject(error);
      throw error;
    }
    let {
      access_token: accessToken,
      device_id: deviceId,
      user_id: userId,
    } = json;
    this.access = { accessToken, deviceId, userId };
    this.loggedInDeferred.fulfill();
  }

  async getJoinedRooms() {
    let response = await this.request('_matrix/client/v3/joined_rooms');

    return (await response.json()) as { joined_rooms: string[] };
  }

  async joinRoom(roomId: string) {
    let response = await this.request(
      `_matrix/client/v3/rooms/${roomId}/join`,
      'POST',
    );
    if (!response.ok) {
      let json = await response.json();
      throw new Error(
        `Unable to join room ${roomId}: status ${
          response.status
        } - ${JSON.stringify(json)}`,
      );
    }
  }

  async createDM(inviteeUserId: string): Promise<string> {
    if (inviteeUserId === this.access!.userId) {
      throw new Error(`Cannot create a DM with self: ${inviteeUserId}`);
    }
    let response = await this.request('_matrix/client/v3/createRoom', 'POST', {
      body: JSON.stringify({ invite: [inviteeUserId], is_direct: true }),
    });
    let json = (await response.json()) as { room_id: string };
    if (!response.ok) {
      throw new Error(
        `Unable to create DM for invitee ${inviteeUserId}: status ${
          response.status
        } - ${JSON.stringify(json)}`,
      );
    }

    await this.setRoomRetentionPolicy(
      json.room_id,
      REALM_ROOM_RETENTION_POLICY_MAX_LIFETIME,
    );

    return json.room_id;
  }

  async setRoomRetentionPolicy(roomId: string, maxLifetimeMs: number) {
    try {
      let roomState = await this.request(
        `_matrix/client/v3/rooms/${roomId}/state`,
      );

      let roomStateJson = await roomState.json();

      let retentionState = roomStateJson.find(
        (event: any) => event.type === 'm.room.retention',
      );

      let retentionStateKey = retentionState?.content.key ?? '';

      await this.request(
        `_matrix/client/v3/rooms/${roomId}/state/m.room.retention/${retentionStateKey}`,
        'PUT',
        {
          body: JSON.stringify({ max_lifetime: maxLifetimeMs }),
        },
      );
    } catch (e) {
      console.error('error setting retention policy', e);
    }
  }

  async setAccountData<T>(type: string, data: T) {
    let response = await this.request(
      `_matrix/client/v3/user/${encodeURIComponent(
        this.access!.userId,
      )}/account_data/${type}`,
      'PUT',
      {
        body: JSON.stringify(data),
      },
    );
    if (!response.ok) {
      let json = await response.json();
      throw new Error(
        `Unable to set account data '${type}' for ${
          this.access!.userId
        }: status ${response.status} - ${JSON.stringify(json)}`,
      );
    }
  }

  async getAccountDataFromServer<T>(type: string) {
    if (!this.access) {
      await this.login();
    }
    let response = await this.request(
      `_matrix/client/v3/user/${encodeURIComponent(
        this.access!.userId,
      )}/account_data/${type}`,
    );
    if (response.status === 404) {
      return null;
    }
    let json = await response.json();
    if (!response.ok) {
      throw new Error(
        `Unable to get account data '${type}' for ${
          this.access!.userId
        }: status ${response.status} - ${JSON.stringify(json)}`,
      );
    }
    return json as T;
  }

  async getProfile(
    userId: string,
  ): Promise<{ displayname: string } | undefined> {
    let response = await this.request(
      `_matrix/client/v3/profile/${encodeURIComponent(userId)}`,
      'GET',
      undefined,
      false,
    );
    if (!response.ok) {
      return undefined;
    }
    let json = await response.json();
    return json;
  }

  async sendEvent<T>(roomId: string, type: string, content: T) {
    if (!this.access) {
      throw new Error(`Missing matrix access token`);
    }
    let txnId = this.nextTxnId();

    let response = await this.request(
      `_matrix/client/v3/rooms/${roomId}/send/${type}/${txnId}`,
      'PUT',
      { body: JSON.stringify(content) },
    );

    let json = (await response.json()) as { event_id: string };
    if (!response.ok) {
      throw new Error(
        `Unable to send room event '${type}' to room ${roomId}: status ${
          response.status
        } - ${JSON.stringify(json)}`,
      );
    }
    return json.event_id;
  }

  // This defaults to the last 10 messages in reverse chronological order
  async roomMessages(roomId: string) {
    let response = await this.request(
      `_matrix/client/v3/rooms/${roomId}/messages?dir=b`,
    );
    let json = (await response.json()) as {
      chunk: MatrixEvent[];
    };
    return json.chunk;
  }

  async getOpenIdToken(): Promise<
    | {
        access_token: string;
        expires_in: number;
        matrix_server_name: string;
        token_type: string;
      }
    | undefined
  > {
    const url = `_matrix/client/v3/user/${encodeURIComponent(this.access!.userId)}/openid/request_token`;
    // The body must be an empty JSON object, otherwise this request will fail
    const response = await this.request(url, 'POST', { body: '{}' });
    let json:
      | {
          access_token: string;
          expires_in: number;
          matrix_server_name: string;
          token_type: string;
        }
      | undefined;
    const text = await response.text();
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error(
        `unable to parse response from ${url}, response was not JSON: ${text}`,
      );
    }
    if (!json || !response.ok) {
      return undefined;
    } else {
      return json;
    }
  }

  async verifyOpenIdToken(openIdToken: string): Promise<string | undefined> {
    const url = `_matrix/federation/v1/openid/userinfo?access_token=${encodeURIComponent(
      openIdToken,
    )}`;
    const response = await this.request(url, 'GET', undefined, false);
    let json:
      | {
          sub: string;
        }
      | undefined;
    const text = await response.text();
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error(
        `unable to parse response from ${url}, response was not JSON: ${text}`,
      );
    }
    if (!json || !response.ok) {
      return undefined;
    } else {
      return json.sub;
    }
  }

  async isTokenValid() {
    if (!this.access) {
      return false;
    }
    let userId = await this.whoami();
    if (userId === this.access.userId) {
      return true;
    }
    return false;
  }

  async whoami() {
    if (!this.access) {
      throw new Error(`Missing matrix access token`);
    }
    let response = await this.request('_matrix/client/v3/account/whoami');
    let json:
      | {
          user_id: string;
          device_id: string;
        }
      | undefined;
    let text = await response.text();
    try {
      json = JSON.parse(text);
    } catch (e) {
      throw new Error(
        `unable to parse response from ${this.matrixURL.href}_matrix/client/v3/account/whoami, response was not JSON: ${text}`,
      );
    }
    if (!json || !response.ok) {
      return undefined;
    } else {
      return json.user_id;
    }
  }

  async sendMessage(roomId: string, message: string) {
    return this.sendEvent(roomId, 'm.room.message', {
      body: message,
      msgtype: 'm.text',
    });
  }

  async hashMessageWithSecret(message: string) {
    let hash = new Sha256();
    hash.update(message);
    if (this.seed) {
      hash.update(await passwordFromSeed(this.username, this.seed));
    } else if (this.password) {
      hash.update(this.password);
    }
    return uint8ArrayToHex(await hash.digest());
  }

  private nextTxnId() {
    // Ensure unique txn ids even when multiple events are sent in the same millisecond
    let now = Date.now();
    if (now === this.lastTxnTimestamp) {
      this.txnSequence++;
    } else {
      this.lastTxnTimestamp = now;
      this.txnSequence = 0;
    }
    return `${now}-${this.txnSequence}`;
  }
}

export function getMatrixUsername(userId: string) {
  return userId.replace(/^@/, '').replace(/:.*$/, '');
}

export async function passwordFromSeed(username: string, seed: string) {
  let hash = new Sha256();
  let cleanUsername = getMatrixUsername(username);
  hash.update(cleanUsername);
  hash.update(seed);
  return uint8ArrayToHex(await hash.digest());
}

export async function waitForMatrixMessage(
  matrixClient: MatrixClient,
  roomId: string,
  filter: (m: any) => boolean,
  waitBetweenChecksMs = 200,
  timeoutMs = 10000,
) {
  let waitedMs = 0;

  let messages = await matrixClient.roomMessages(roomId);

  while (waitedMs < timeoutMs) {
    let message = messages.find(filter);
    if (message) {
      return message;
    }

    await new Promise((res) => setTimeout(res, waitBetweenChecksMs));
    waitedMs += waitBetweenChecksMs;
  }

  return null;
}

export function userIdFromUsername(username: string, matrixURL: string) {
  let host = new URL(matrixURL).hostname.split('.').slice(-2).join('.');
  return `@${username}:${host}`;
}

export function ensureFullMatrixUserId(userId: string, matrixURL: string) {
  if (userId.startsWith('@') && userId.includes(':')) {
    return userId;
  }
  userId = userId.replace(/^@/, '').replace(/:.*$/, '');
  return userIdFromUsername(userId, matrixURL);
}
