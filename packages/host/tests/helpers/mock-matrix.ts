import window from 'ember-window-mock';

import type * as MatrixSDK from 'matrix-js-sdk';

export interface Options {
  loggedInAs?: string;
  displayName?: string;
}

export function setupMockMatrix(hooks: NestedHooks, opts: Options = {}) {
  hooks.beforeEach(function () {
    let sdk = new MockSDK(opts);
    if (opts.loggedInAs) {
      window.localStorage.setItem(
        'auth',
        JSON.stringify({
          access_token: 'mock-access-token',
          device_id: 'mock-device-id',
          user_id: opts.loggedInAs,
        }),
      );
    }
    this.owner.register(
      'service:matrixSDKLoader',
      {
        async load() {
          return sdk;
        },
      },
      {
        instantiate: false,
      },
    );
  });
}

class MockSDK
  implements
    Pick<
      typeof MatrixSDK,
      'createClient' | 'RoomEvent' | 'RoomMemberEvent' | 'Preset'
    >
{
  constructor(private sdkOpts: Options) {}

  createClient(clientOpts: MatrixSDK.ICreateClientOpts) {
    return new MockClient(
      clientOpts,
      this.sdkOpts,
    ) as unknown as MatrixSDK.MatrixClient;
  }

  RoomEvent = {
    Timeline: {},
  };

  RoomMemberEvent = {
    Membership: {},
    Timeline: {},
  };

  Preset = {
    PrivateChat: {},
    TrustedPrivateChat: {},
    PublicChat: {},
  };
}

class MockClient
  implements
    Pick<
      MatrixSDK.MatrixClient,
      | 'isLoggedIn'
      | 'getUserId'
      | 'getProfileInfo'
      | 'getThreePids'
      | 'createRoom'
      | 'setPowerLevel'
      | 'on'
      | 'off'
      | 'startClient'
    >
{
  constructor(
    _clientOpts: MatrixSDK.ICreateClientOpts,
    private sdkOpts: Options,
  ) {}

  async startClient(
    opts?: MatrixSDK.IStartClientOpts | undefined,
  ): Promise<void> {}

  on<T extends MatrixSDK.EmittedEvents | MatrixSDK.EventEmitterEvents>(
    event: T,
    listener: MatrixSDK.Listener<
      MatrixSDK.EmittedEvents,
      MatrixSDK.ClientEventHandlerMap,
      T
    >,
  ): MatrixSDK.MatrixClient {
    return this as unknown as MatrixSDK.MatrixClient;
  }

  off<T extends MatrixSDK.EmittedEvents | MatrixSDK.EventEmitterEvents>(
    event: T,
    listener: MatrixSDK.Listener<
      MatrixSDK.EmittedEvents,
      MatrixSDK.ClientEventHandlerMap,
      T
    >,
  ): MatrixSDK.MatrixClient {
    return this as unknown as MatrixSDK.MatrixClient;
  }

  async setPowerLevel(
    roomId: string,
    userId: string | string[],
    powerLevel: number | undefined,
    event?: MatrixSDK.MatrixEvent | null | undefined,
  ): Promise<MatrixSDK.ISendEventResponse> {
    throw new Error('Method not implemented.');
  }

  async createRoom(
    _options: MatrixSDK.ICreateRoomOpts,
  ): Promise<{ room_id: string }> {
    throw new Error('Method not implemented.');
  }

  async getThreePids(): Promise<{ threepids: MatrixSDK.IThreepid[] }> {
    return {
      threepids: [
        {
          added_at: 0,
          validated_at: 0,
          address: 'testuser@example.com',
          medium: 'email' as MatrixSDK.ThreepidMedium.Email,
        },
      ],
    };
  }

  async getProfileInfo(
    _userId: string,
    _info?: string | undefined,
  ): Promise<{
    avatar_url?: string | undefined;
    displayname?: string | undefined;
  }> {
    return {
      displayname: this.sdkOpts.displayName ?? 'Mock User',
    };
  }

  isLoggedIn() {
    return Boolean(this.sdkOpts.loggedInAs);
  }

  getUserId(): string | null {
    return this.sdkOpts.loggedInAs ?? null;
  }
}
