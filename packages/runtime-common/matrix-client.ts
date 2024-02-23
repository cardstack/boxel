export interface MatrixAccess {
  accessToken: string;
  deviceId: string;
  userId: string;
}

export class MatrixClient {
  private access: MatrixAccess | undefined;

  constructor(
    private matrixURL: URL,
    private username: string,
    private password: string,
  ) {}

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
    let response = await this.request(
      '_matrix/client/v3/login',
      'POST',
      {
        body: JSON.stringify({
          identifier: {
            type: 'm.id.user',
            user: this.username,
          },
          password: this.password,
          type: 'm.login.password',
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

  async createDM(invite: string): Promise<string> {
    if (invite === this.access!.userId) {
      throw new Error(`Cannot create DM with self`);
    }
    let response = await this.request('_matrix/client/v3/createRoom', 'POST', {
      body: JSON.stringify({ invite: [invite], is_direct: true }),
    });
    let json = (await response.json()) as { room_id: string };
    if (!response.ok) {
      throw new Error(
        `Unable to create DM for invitee ${invite}: status ${
          response.status
        } - ${JSON.stringify(json)}`,
      );
    }
    return json.room_id;
  }

  async setAccountData<T>(type: string, data: T) {
    let response = await this.request(
      `_matrix/client/v3/user/${this.access!.userId}/account_data/${type}`,
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

  async getAccountData<T>(type: string) {
    let response = await this.request(
      `_matrix/client/v3/user/${this.access!.userId}/account_data/${type}`,
    );
    if (response.status === 404) {
      return;
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

  async sendEvent<T>(roomId: string, type: string, content: T) {
    if (!this.access) {
      throw new Error(`Missing matrix access token`);
    }
    let txnId = Date.now();

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
      chunk: {
        type: string;
        sender: string;
        origin_server_ts: number;
        event_id: string;
        content: {
          body: string;
        };
      }[];
    };
    return json.chunk;
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
    let json = (await response.json()) as {
      user_id: string;
      device_id: string;
    };
    if (!response.ok) {
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
