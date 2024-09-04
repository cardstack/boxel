import window from 'ember-window-mock';

import { ExtendedMatrixSDK } from '@cardstack/host/services/matrix-sdk-loader';

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
      'service:matrixSdkLoader',
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

class MockSDK implements ExtendedMatrixSDK {
  constructor(private sdkOpts: Options) {}

  createClient(clientOpts: MatrixSDK.ICreateClientOpts) {
    return new MockClient(
      this,
      clientOpts,
      this.sdkOpts,
    ) as unknown as MatrixSDK.MatrixClient;
  }

  RoomEvent = {
    Timeline: 'Room.timeline',
    LocalEchoUpdated: 'Room.localEchoUpdated',
    Receipt: 'Room.receipt',
  };

  RoomMemberEvent = {
    Membership: 'RoomMember.membership',
  };

  Preset = {
    PrivateChat: 'private_chat',
    TrustedPrivateChat: 'trusted_private_chat',
    PublicChat: 'public_chat',
  };

  ClientEvent = {
    AccountData: 'accountData',
  } as ExtendedMatrixSDK['ClientEvent'];
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
  private listeners = new Map();

  constructor(
    private sdk: MockSDK,
    _clientOpts: MatrixSDK.ICreateClientOpts,
    private sdkOpts: Options,
  ) {}

  async startClient(
    _opts?: MatrixSDK.IStartClientOpts | undefined,
  ): Promise<void> {
    await this.emitEvent(this.sdk.ClientEvent.AccountData, {
      type: 'com.cardstack.boxel.realms',
      content: {
        realms: [],
      },
    });
  }

  private async emitEvent(
    eventType: MatrixSDK.EmittedEvents | MatrixSDK.EventEmitterEvents,
    event: { type: string; content: any },
  ) {
    let handlers = this.listeners.get(eventType);
    if (handlers) {
      for (let handler of handlers) {
        await handler({ event });
      }
    }
  }

  on<T extends MatrixSDK.EmittedEvents | MatrixSDK.EventEmitterEvents>(
    event: T,
    listener: MatrixSDK.Listener<
      MatrixSDK.EmittedEvents,
      MatrixSDK.ClientEventHandlerMap,
      T
    >,
  ): MatrixSDK.MatrixClient {
    if (!event) {
      throw new Error(`missing event type in matrix mock`);
    }
    let list = this.listeners.get(event);
    if (!list) {
      list = [];
      this.listeners.set(event, list);
    }
    list.push(listener);
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
