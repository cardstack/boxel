import { v4 as uuidV4 } from 'uuid';

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

  async login() {
    let response = await fetch(
      `${this.matrixURL.href}_matrix/client/v3/login`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          identifier: {
            type: 'm.id.user',
            user: this.username,
          },
          password: this.password,
          type: 'm.login.password',
        }),
      },
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

  async createDM(invite: string): Promise<string> {
    if (!this.access) {
      throw new Error(`Missing matrix access token`);
    }
    let response = await fetch(
      `${this.matrixURL.href}_matrix/client/v3/createRoom`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.access.accessToken}`,
        },
        body: JSON.stringify({
          invite: [invite],
          is_direct: true,
        }),
      },
    );
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
    if (!this.access) {
      throw new Error(`Missing matrix access token`);
    }
    let response = await fetch(
      `${this.matrixURL.href}_matrix/client/v3/user/${this.access.userId}/account_data/${type}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.access.accessToken}`,
        },
        body: JSON.stringify(data),
      },
    );
    if (!response.ok) {
      let json = await response.json();
      throw new Error(
        `Unable to set account data '${type}' for ${
          this.access.userId
        }: status ${response.status} - ${JSON.stringify(json)}`,
      );
    }
  }

  async getAccountData<T>(type: string) {
    if (!this.access) {
      throw new Error(`Missing matrix access token`);
    }
    let response = await fetch(
      `${this.matrixURL.href}_matrix/client/v3/user/${this.access.userId}/account_data/${type}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.access.accessToken}`,
        },
      },
    );
    if (response.status === 404) {
      return;
    }
    let json = await response.json();
    if (!response.ok) {
      throw new Error(
        `Unable to get account data '${type}' for ${
          this.access.userId
        }: status ${response.status} - ${JSON.stringify(json)}`,
      );
    }
    return json as T;
  }

  async sendRoomEvent<T>(roomId: string, type: string, content: T) {
    if (!this.access) {
      throw new Error(`Missing matrix access token`);
    }
    let txnId = uuidV4();
    let response = await fetch(
      `${this.matrixURL.href}_matrix/client/v3/rooms/${roomId}/send/${type}/${txnId}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.access.accessToken}`,
        },
        body: JSON.stringify(content),
      },
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
}
