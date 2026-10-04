import { Sha256 } from '@aws-crypto/sha256-js';
import { uint8ArrayToHex } from './index.ts';
import { REALM_ROOM_RETENTION_POLICY_MAX_LIFETIME } from './realm.ts';
import type { MatrixEvent } from '@cardstack/base/matrix-event';

type JoinedRoomsResponse = { joined_rooms: string[] };

async function isUnknownToken(response: Response) {
  try {
    let json = (await response.clone().json()) as { errcode?: string };
    return json.errcode === 'M_UNKNOWN_TOKEN';
  } catch {
    return false;
  }
}

const joinedRoomsRequests = new WeakMap<object, Promise<JoinedRoomsResponse>>();

// Every login from this client reuses one device per matrix user. A login
// without a device_id makes synapse mint a new device, and each new device
// writes a device-list change row for every room the user has joined, rows
// synapse never prunes. Server users join a session room per user they
// authenticate, so fresh devices grow that table with logins × rooms. Logging
// in to an existing device writes no change rows, and each login still gets
// its own access token, so concurrent processes sharing the device don't
// invalidate each other. Logging out, or deleting the device through the
// admin API, deletes the device and so revokes every process's token at once;
// nothing logs out with this client's token.
//
// Synapse dedupes sends by user, device and transaction id, so processes
// sharing the device must never reuse a transaction id; see nextTxnId.
export const SERVER_MATRIX_DEVICE_ID = 'boxel-server';

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
  private loginPromise: Promise<void> | undefined;
  private readonly txnPrefix = globalThis.crypto.randomUUID();
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

  getDeviceId() {
    return this.access?.deviceId;
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
    let url = `${this.matrixURL.href}${path}`;
    if (!includeAuth) {
      return fetch(url, options);
    }
    if (!this.access) {
      throw new Error(`Missing matrix access token`);
    }
    let accessToken = this.access.accessToken;
    let response = await fetch(url, this.withAuth(options, accessToken));
    if (response.status === 401 && (await isUnknownToken(response))) {
      // Every process shares one device, so deleting it revokes all of
      // their tokens at once. Logging in again recreates the device.
      // A concurrent request may already have logged in again; reuse that.
      if (this.access?.accessToken === accessToken) {
        this.access = undefined;
      }
      if (!this.access) {
        await this.login();
      }
      response = await fetch(
        url,
        this.withAuth(options, this.access!.accessToken),
      );
    }
    return response;
  }

  private withAuth(options: RequestInit, accessToken: string): RequestInit {
    return {
      ...options,
      headers: {
        ...options.headers,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    };
  }

  async login() {
    if (this.loginPromise) {
      return await this.loginPromise;
    }
    // Cache the in-flight login promise so concurrent callers share the
    // same network roundtrip. On failure, clear the cache so retries
    // get a fresh attempt — without this, a transient network blip on
    // the very first login (e.g. matrix not yet reachable during boot)
    // would leave every future `login()` awaiting a never-resolving
    // promise, surfacing as every `/_server-session` hanging forever.
    // The `.catch(() => {})` is mandatory: if `login()` is called with
    // no concurrent awaiter and the request rejects, Node 19+ treats
    // the unawaited rejection as fatal and tears the process down.
    // Pre-attaching a no-op handler claims the rejection so the
    // caller's own `await` is the only thing that re-surfaces it.
    let promise = this.doLogin();
    this.loginPromise = promise;
    promise.catch(() => {
      if (this.loginPromise === promise) {
        this.loginPromise = undefined;
      }
    });
    return await promise;
  }

  private async doLogin(): Promise<void> {
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
          device_id: SERVER_MATRIX_DEVICE_ID,
        }),
      },
      false,
    );

    let json = await response.json();

    if (!response.ok) {
      throw new Error(
        `Unable to login to matrix ${this.matrixURL.href} as user ${
          this.username
        }: status ${response.status} - ${JSON.stringify(json)}`,
      );
    }
    let {
      access_token: accessToken,
      device_id: deviceId,
      user_id: userId,
    } = json;
    this.access = { accessToken, deviceId, userId };
  }

  async getJoinedRooms() {
    let existing = joinedRoomsRequests.get(this);
    if (existing) {
      return existing;
    }
    let request = (async () => {
      let response = await this.request('_matrix/client/v3/joined_rooms');
      return (await response.json()) as JoinedRoomsResponse;
    })();
    joinedRoomsRequests.set(this, request);
    try {
      return await request;
    } finally {
      if (joinedRoomsRequests.get(this) === request) {
        joinedRoomsRequests.delete(this);
      }
    }
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
    return await fetchMatrixProfile(this.matrixURL, userId);
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

  // Every event in the room whose `origin_server_ts` is at or after `since`,
  // newest first. `/messages` answers one page at a time — ten events when no
  // limit is asked for — so a window holding more than a page is read by
  // following the `end` token back until a page reaches past `since` or the
  // room's history runs out. Each page asks for the server's ceiling (Synapse
  // caps a page at 1000), so a window that fits one page costs one request.
  async roomMessagesSince(
    roomId: string,
    since: number,
  ): Promise<MatrixEvent[]> {
    let events: MatrixEvent[] = [];
    let from: string | undefined;
    for (;;) {
      let params = new URLSearchParams({ dir: 'b', limit: '1000' });
      if (from) {
        params.set('from', from);
      }
      let response = await this.request(
        `_matrix/client/v3/rooms/${roomId}/messages?${params}`,
      );
      if (!response.ok) {
        throw new Error(
          `Unable to read messages of room ${roomId}: status ${
            response.status
          } - ${await response.text()}`,
        );
      }
      let json = (await response.json()) as {
        chunk: MatrixEvent[];
        end?: string;
      };
      for (let event of json.chunk) {
        if (event.origin_server_ts >= since) {
          events.push(event);
        }
      }
      let oldest = json.chunk[json.chunk.length - 1];
      if (!json.end || !oldest || oldest.origin_server_ts < since) {
        return events;
      }
      from = json.end;
    }
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
    try {
      let userId = await this.whoami();
      if (userId === this.access.userId) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
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
    // Unique per client instance, and within it even when several events are
    // sent in the same millisecond. Every process logs in to the same device,
    // and synapse answers a repeated (device, transaction id) send with the
    // earlier event instead of storing the new one.
    let now = Date.now();
    if (now === this.lastTxnTimestamp) {
      this.txnSequence++;
    } else {
      this.lastTxnTimestamp = now;
      this.txnSequence = 0;
    }
    return `${this.txnPrefix}-${now}-${this.txnSequence}`;
  }
}

// A homeserver that answers this at all answers it quickly. The ceiling exists
// so an unresponsive one — accepting connections but never replying — fails the
// caller instead of holding it for the platform's default socket timeout, which
// is minutes.
const MATRIX_PROFILE_TIMEOUT_MS = 10_000;

// Profile lookup is unauthenticated on the matrix client-server API, so it is
// reachable from a homeserver URL alone. `MatrixClient#getProfile` is the entry
// point for a caller that holds a client; this one serves the callers that hold
// only a URL — a worker child process has no matrix client, but still has to
// answer "is this a registered matrix user?" to resolve a realm's `users` grant.
//
// `undefined` means the account is absent or the homeserver declines to say —
// a 4xx, which covers a missing account, a profile endpoint kept behind auth,
// and a rate-limited lookup alike. Only a homeserver that cannot answer at all
// throws, because that case is not interchangeable with the others to a caller
// deriving permissions: silently reading an outage as "not registered" drops a
// realm's `users` grant, and a token minted from that reduced set is one the
// realm will reject for the whole of its life.
export async function fetchMatrixProfile(
  matrixURL: URL,
  userId: string,
): Promise<{ displayname: string } | undefined> {
  let response = await fetch(
    `${matrixURL.href}_matrix/client/v3/profile/${encodeURIComponent(userId)}`,
    { signal: AbortSignal.timeout(MATRIX_PROFILE_TIMEOUT_MS) },
  );
  if (response.status >= 500) {
    throw new Error(
      `Matrix profile lookup for ${userId} failed: homeserver responded ${response.status}`,
    );
  }
  if (!response.ok) {
    return undefined;
  }
  return await response.json();
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

export function userIdFromUsername(username: string, matrixURL: string) {
  let hostname = new URL(matrixURL).hostname;
  // For *.localhost subdomains (environment mode), the Matrix server_name is
  // always "localhost" — the subdomains are just Traefik routing labels.
  let host = hostname.endsWith('.localhost')
    ? 'localhost'
    : hostname.split('.').slice(-2).join('.');
  return `@${username}:${host}`;
}

export function ensureFullMatrixUserId(userId: string, matrixURL: string) {
  if (userId.startsWith('@') && userId.includes(':')) {
    return userId;
  }
  userId = userId.replace(/^@/, '').replace(/:.*$/, '');
  return userIdFromUsername(userId, matrixURL);
}
