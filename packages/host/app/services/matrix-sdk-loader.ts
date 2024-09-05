import Service from '@ember/service';

import type { MatrixEvent as DiscreteMatrixEvent } from 'https://cardstack.com/base/matrix-event';

import type * as MatrixSDK from 'matrix-js-sdk';

const DEFAULT_PAGE_SIZE = 50;

/*
  This abstracts over the matrix SDK, including several extra functions that are
  actually implemented via direct HTTP.
*/
export default class MatrixSDKLoader extends Service {
  #extended: ExtendedMatrixSDK | undefined;

  async load(): Promise<ExtendedMatrixSDK> {
    if (!this.#extended) {
      let sdk = await import('matrix-js-sdk');
      this.#extended = new ExtendedMatrixSDK(sdk);
    }
    return this.#extended;
  }
}

export class ExtendedMatrixSDK {
  #sdk: typeof MatrixSDK;

  constructor(sdk: typeof MatrixSDK) {
    this.#sdk = sdk;
  }

  get RoomMemberEvent() {
    return this.#sdk.RoomMemberEvent;
  }

  get RoomEvent() {
    return this.#sdk.RoomEvent;
  }

  get ClientEvent() {
    return this.#sdk.ClientEvent;
  }

  get Preset() {
    return this.#sdk.Preset;
  }

  createClient(opts: MatrixSDK.ICreateClientOpts): ExtendedClient {
    return extendedClient(this.#sdk.createClient(opts));
  }
}

export type ExtendedClient = Pick<
  MatrixSDK.MatrixClient,
  | 'addThreePidOnly'
  | 'createRoom'
  | 'credentials'
  | 'decryptEventIfNeeded'
  | 'deleteThreePid'
  | 'fetchRoomEvent'
  | 'forget'
  | 'getJoinedRooms'
  | 'getProfileInfo'
  | 'getRoom'
  | 'getThreePids'
  | 'getUserId'
  | 'invite'
  | 'isLoggedIn'
  | 'isUsernameAvailable'
  | 'joinRoom'
  | 'leave'
  | 'loginWithPassword'
  | 'logout'
  | 'off'
  | 'on'
  | 'registerRequest'
  | 'requestPasswordEmailToken'
  | 'roomState'
  | 'scrollback'
  | 'sendEvent'
  | 'sendReadReceipt'
  | 'setDisplayName'
  | 'setPassword'
  | 'setPowerLevel'
  | 'setRoomName'
  | 'startClient'
> & {
  allRoomMessages(
    roomId: string,
    opts?: MessageOptions,
  ): Promise<DiscreteMatrixEvent[]>;
  requestEmailToken(
    type: 'registration' | 'threepid',
    email: string,
    clientSecret: string,
    sendAttempt: number,
  ): Promise<MatrixSDK.IRequestTokenResponse>;
  loginWithEmail(
    email: string,
    password: string,
  ): Promise<MatrixSDK.LoginResponse>;
};

async function allRoomMessages(
  this: MatrixSDK.MatrixClient,
  roomId: string,
  opts?: MessageOptions,
): Promise<DiscreteMatrixEvent[]> {
  let messages: DiscreteMatrixEvent[] = [];
  let from: string | undefined;

  do {
    let response = await fetch(
      `${this.baseUrl}/_matrix/client/v3/rooms/${roomId}/messages?dir=${
        opts?.direction ? opts.direction.slice(0, 1) : 'f'
      }&limit=${opts?.pageSize ?? DEFAULT_PAGE_SIZE}${
        from ? '&from=' + from : ''
      }`,
      {
        headers: {
          Authorization: `Bearer ${this.getAccessToken()}`,
        },
      },
    );
    let { chunk, end } = await response.json();
    from = end;
    let events: DiscreteMatrixEvent[] = chunk;
    if (opts?.onMessages) {
      await opts.onMessages(events);
    }
    messages.push(...events);
  } while (from);
  return messages;
}

async function requestEmailToken(
  this: MatrixSDK.MatrixClient,
  type: 'registration' | 'threepid',
  email: string,
  clientSecret: string,
  sendAttempt: number,
) {
  let url =
    type === 'registration'
      ? `${this.baseUrl}/_matrix/client/v3/register/email/requestToken`
      : `${this.baseUrl}/_matrix/client/v3/account/3pid/email/requestToken`;

  let response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      client_secret: clientSecret,
      send_attempt: sendAttempt,
    }),
  });
  if (response.ok) {
    return (await response.json()) as MatrixSDK.IRequestTokenResponse;
  } else {
    let data = (await response.json()) as { errcode: string; error: string };
    let error = new Error(data.error) as any;
    error.data = data;
    error.status = response.status;
    throw error;
  }
}

// the matrix SDK is using an old version of this API and
// doesn't provide login using email, so we use the API directly
async function loginWithEmail(
  this: MatrixSDK.MatrixClient,
  email: string,
  password: string,
) {
  let response = await fetch(`${this.baseUrl}/_matrix/client/v3/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      identifier: {
        type: 'm.id.thirdparty',
        medium: 'email',
        address: email,
      },
      password,
      type: 'm.login.password',
    }),
  });
  if (response.ok) {
    return (await response.json()) as MatrixSDK.LoginResponse;
  } else {
    let data = (await response.json()) as { errcode: string; error: string };
    let error = new Error(data.error) as any;
    error.data = data;
    error.status = response.status;
    throw error;
  }
}

function extendedClient(client: MatrixSDK.MatrixClient): ExtendedClient {
  return new Proxy(client, {
    get(target, key, receiver) {
      switch (key) {
        case 'allRoomMessages':
          return allRoomMessages;
        case 'requestEmailToken':
          return requestEmailToken;
        case 'loginWithEmail':
          return loginWithEmail;
        default:
          return Reflect.get(target, key, receiver);
      }
    },
  }) as unknown as ExtendedClient;
}

export interface MessageOptions {
  direction?: 'forward' | 'backward';
  onMessages?: (messages: DiscreteMatrixEvent[]) => Promise<void>;
  pageSize: number;
}
