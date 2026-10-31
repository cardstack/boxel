import { Sha256 } from '@aws-crypto/sha256-js';
import { uint8ArrayToHex } from './index.ts';
import { REALM_ROOM_RETENTION_POLICY_MAX_LIFETIME } from './realm.ts';
import { APP_BOXEL_REALM_EVENT_ROOM_TYPE } from './matrix-constants.ts';
import type { MatrixEvent } from '@cardstack/base/matrix-event';
import {
  federationBaseURLs,
  isMatrixServerName,
  isUserOfMatrixServer,
} from './matrix-server-name.ts';

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

// A homeserver request that came back with a non-2xx status. The status is
// carried as a field so a caller can tell an overloaded or unreachable
// homeserver (429, 502, 503, 504) from a request the homeserver refused.
// `retryAfterMs` is how long the homeserver asked the caller to wait before
// trying again, from a rate-limit answer's `retry_after_ms` or its
// `Retry-After` header.
export class MatrixRequestError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | undefined;
  constructor(message: string, status: number, retryAfterMs?: number) {
    super(message);
    this.name = 'MatrixRequestError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

// Builds the error for a non-2xx answer. A proxy in front of synapse answers a
// timeout or an unreachable upstream with an HTML page, not a matrix error, so
// the body is read as text and kept out of the message unless it is JSON.
async function matrixRequestError(
  response: Response,
  message: string,
): Promise<MatrixRequestError> {
  let body = await response.text().catch(() => '');
  let detail: string;
  let retryAfterMs: number | undefined;
  try {
    let json = JSON.parse(body);
    detail = JSON.stringify(json);
    if (typeof json?.retry_after_ms === 'number') {
      retryAfterMs = json.retry_after_ms;
    }
  } catch {
    detail = `non-JSON body (${body.length} bytes)`;
  }
  if (retryAfterMs === undefined) {
    let seconds = Number(response.headers.get('Retry-After') ?? NaN);
    if (Number.isFinite(seconds) && seconds >= 0) {
      retryAfterMs = seconds * 1000;
    }
  }
  return new MatrixRequestError(
    `${message}: status ${response.status} - ${detail}`,
    response.status,
    retryAfterMs,
  );
}

// How long a login or a room send waits for synapse to answer. A request
// synapse accepts but never answers would otherwise wait out the HTTP client's
// own headers timeout (minutes), holding up everything queued behind it. When
// it fires the request rejects with a `TimeoutError`, which a caller can retry:
// a send retried with the same transaction id is not stored twice.
const MATRIX_WRITE_TIMEOUT_MS = 30_000;

export interface MatrixAccess {
  accessToken: string;
  deviceId: string;
  userId: string;
}

// How long a federation `openid/userinfo` request to another server's
// homeserver waits for an answer before the next discovered URL is tried.
const OPENID_USERINFO_TIMEOUT_MS = 10_000;

export class MatrixClient {
  readonly matrixURL: URL;
  readonly username: string;
  // The name of the Matrix server this client's user is on: the `:server`
  // suffix of every user id the homeserver issues. Configured, because Matrix
  // delegation lets it differ from the homeserver's hostname (ADR 004 §1.2);
  // login checks that the homeserver agrees.
  readonly serverName: string;
  // The other homeservers whose OpenID tokens this client verifies, by
  // server name. A token naming a server outside this list is refused before
  // that server is looked up, so an unauthenticated caller cannot make the
  // realm server send requests to a host of their choosing. Empty by default:
  // federation is configured, not open (ADR 004 §1.4).
  readonly federationAllowlist: ReadonlySet<string>;
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
    serverName,
    federationAllowlist = [],
  }: {
    matrixURL: URL;
    username: string;
    password?: string;
    seed?: string;
    serverName: string;
    federationAllowlist?: string[];
  }) {
    if (!password && !seed) {
      throw new Error(
        `Either password or a seed must be specified when creating a matrix client`,
      );
    }
    if (!isMatrixServerName(serverName)) {
      throw new Error(
        `${JSON.stringify(serverName)} is not a Matrix server name`,
      );
    }
    this.matrixURL = matrixURL;
    this.username = username;
    this.serverName = serverName;
    this.federationAllowlist = new Set(federationAllowlist);
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
      // Otherwise drop the settled login, which login() would return as is.
      if (this.access?.accessToken === accessToken) {
        this.access = undefined;
        this.loginPromise = undefined;
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
        signal: AbortSignal.timeout(MATRIX_WRITE_TIMEOUT_MS),
      },
      false,
    );

    if (!response.ok) {
      throw await matrixRequestError(
        response,
        `Unable to login to matrix ${this.matrixURL.href} as user ${this.username}`,
      );
    }
    let json = await response.json();
    let {
      access_token: accessToken,
      device_id: deviceId,
      user_id: userId,
    } = json;
    if (!isUserOfMatrixServer(userId, this.serverName)) {
      throw new Error(
        `the homeserver at ${this.matrixURL.href} names ${this.username} ${userId}, who is not a user of the configured Matrix server ${this.serverName}`,
      );
    }
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

  // The room a private realm sends its realm events into. Only a user this
  // client invites may join it, and only this client's user, the one the realm
  // sends its realm events as, may send in it, change its state, invite or
  // kick. So its members are whoever the realm server put there, and none of
  // them can forge a realm event. A member sees the room's history from the
  // moment they were invited, which covers an event sent while their host was
  // still joining, but nothing from before the invite. The retention policy
  // bounds how far back the history goes.
  async createRealmEventRoom(realmURL: string): Promise<string> {
    let response = await this.request('_matrix/client/v3/createRoom', 'POST', {
      body: JSON.stringify({
        preset: 'private_chat',
        visibility: 'private',
        name: `Realm events: ${realmURL}`,
        creation_content: { type: APP_BOXEL_REALM_EVENT_ROOM_TYPE },
        initial_state: [
          {
            type: 'm.room.join_rules',
            state_key: '',
            content: { join_rule: 'invite' },
          },
          {
            type: 'm.room.history_visibility',
            state_key: '',
            content: { history_visibility: 'invited' },
          },
          {
            type: 'm.room.guest_access',
            state_key: '',
            content: { guest_access: 'forbidden' },
          },
          {
            type: 'm.room.retention',
            state_key: '',
            content: { max_lifetime: REALM_ROOM_RETENTION_POLICY_MAX_LIFETIME },
          },
        ],
        power_level_content_override: {
          users_default: 0,
          events_default: 100,
          state_default: 100,
          invite: 100,
          kick: 100,
          ban: 100,
          redact: 100,
          notifications: { room: 100 },
        },
      }),
    });
    if (!response.ok) {
      throw await matrixRequestError(
        response,
        `Unable to create realm event room for ${realmURL}`,
      );
    }
    let json = (await response.json()) as { room_id: string };
    return json.room_id;
  }

  // The membership of every user the room has a membership event for, other
  // than this client's user: 'join', 'invite', 'leave', 'ban' or 'knock'.
  async getRoomMemberships(roomId: string): Promise<Map<string, string>> {
    let response = await this.request(
      `_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/members`,
      'GET',
      { signal: AbortSignal.timeout(MATRIX_WRITE_TIMEOUT_MS) },
    );
    if (!response.ok) {
      throw await matrixRequestError(
        response,
        `Unable to read the members of room ${roomId}`,
      );
    }
    let json = (await response.json()) as {
      chunk: { state_key: string; content: { membership?: string } }[];
    };
    let memberships = new Map<string, string>();
    for (let event of json.chunk) {
      if (event.state_key !== this.access?.userId && event.content.membership) {
        memberships.set(event.state_key, event.content.membership);
      }
    }
    return memberships;
  }

  async inviteUser(roomId: string, userId: string) {
    await this.changeMembership(roomId, 'invite', userId);
  }

  async kickUser(roomId: string, userId: string, reason: string) {
    await this.changeMembership(roomId, 'kick', userId, reason);
  }

  async leaveRoom(roomId: string) {
    let response = await this.request(
      `_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/leave`,
      'POST',
      { body: '{}', signal: AbortSignal.timeout(MATRIX_WRITE_TIMEOUT_MS) },
    );
    if (!response.ok) {
      throw await matrixRequestError(
        response,
        `Unable to leave room ${roomId}`,
      );
    }
  }

  private async changeMembership(
    roomId: string,
    action: 'invite' | 'kick',
    userId: string,
    reason?: string,
  ) {
    let response = await this.request(
      `_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/${action}`,
      'POST',
      {
        body: JSON.stringify({
          user_id: userId,
          ...(reason ? { reason } : {}),
        }),
        signal: AbortSignal.timeout(MATRIX_WRITE_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      throw await matrixRequestError(
        response,
        `Unable to ${action} ${userId} in room ${roomId}`,
      );
    }
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

  // A caller that retries a send passes the same `txnId` on every attempt, so
  // synapse answers a retry of a send it already stored with the stored event
  // rather than storing a second copy. That matters when a proxy in front of
  // synapse times the request out while synapse goes on to complete it.
  async sendEvent<T>(
    roomId: string,
    type: string,
    content: T,
    txnId: string = this.nextTxnId(),
  ) {
    if (!this.access) {
      throw new Error(`Missing matrix access token`);
    }

    let response = await this.request(
      `_matrix/client/v3/rooms/${roomId}/send/${type}/${txnId}`,
      'PUT',
      {
        body: JSON.stringify(content),
        signal: AbortSignal.timeout(MATRIX_WRITE_TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      throw await matrixRequestError(
        response,
        `Unable to send room event '${type}' to room ${roomId}`,
      );
    }
    let json = (await response.json()) as { event_id: string };
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

  // The user an OpenID token vouches for, asked of the homeserver that issued
  // it: the one named by the token's `matrix_server_name` (ADR 004 §1.3). The
  // paired homeserver is asked at this client's URL; any other server is
  // found by Matrix server discovery, and only when `federationAllowlist`
  // names it. Undefined when the server is neither the paired one nor
  // allowlisted, when the token is refused, when no server so named can be
  // reached, or when the user it vouches for is not a user of that server:
  // the name is the caller's claim, and a server may only vouch for its own
  // users.
  async verifyOpenIdToken(
    openIdToken: string,
    matrixServerName: string = this.serverName,
  ): Promise<string | undefined> {
    if (!isMatrixServerName(matrixServerName)) {
      return undefined;
    }
    const path = `_matrix/federation/v1/openid/userinfo?access_token=${encodeURIComponent(
      openIdToken,
    )}`;
    let paired = matrixServerName === this.serverName;
    if (!paired && !this.federationAllowlist.has(matrixServerName)) {
      return undefined;
    }
    let response: Response | undefined;
    if (paired) {
      response = await this.request(path, 'GET', undefined, false);
    } else {
      for (let baseURL of await federationBaseURLs(matrixServerName)) {
        try {
          response = await fetch(`${baseURL}${path}`, {
            signal: AbortSignal.timeout(OPENID_USERINFO_TIMEOUT_MS),
          });
          break;
        } catch {
          // unreachable at this URL; try the next one discovery names
        }
      }
      if (!response) {
        return undefined;
      }
    }
    let json: { sub?: unknown } | undefined;
    const text = await response.text();
    try {
      json = JSON.parse(text);
    } catch (e) {
      if (!paired) {
        return undefined;
      }
      throw new Error(
        `unable to parse response from ${path}, response was not JSON: ${text}`,
      );
    }
    if (!json || !response.ok) {
      return undefined;
    }
    let { sub } = json;
    if (
      typeof sub !== 'string' ||
      !isUserOfMatrixServer(sub, matrixServerName)
    ) {
      return undefined;
    }
    return sub;
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

  nextTxnId() {
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

// The full Matrix user id of a localpart on the server named `serverName`,
// which is the configured server name (ADR 004 §1.2), never a hostname.
export function userIdFromUsername(username: string, serverName: string) {
  return `@${username}:${serverName}`;
}

// Whether the text is a full Matrix user id: `@localpart:server`, the
// localpart in the character set Synapse registers users with, and the server
// a hostname or an IP literal with an optional port. For a value someone typed
// into a setting, where a bare username or a stray space would otherwise name
// no user and fail somewhere far from the setting.
export function isMatrixUserId(text: string): boolean {
  return (
    text.length <= 255 &&
    /^@[a-z0-9._=\-/+]+:(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/.test(
      text,
    )
  );
}

// `userId` as a full Matrix user id: itself when it is one, otherwise the
// localpart it names on the server named `serverName`.
export function ensureFullMatrixUserId(userId: string, serverName: string) {
  if (userId.startsWith('@') && userId.includes(':')) {
    return userId;
  }
  userId = userId.replace(/^@/, '').replace(/:.*$/, '');
  return userIdFromUsername(userId, serverName);
}
