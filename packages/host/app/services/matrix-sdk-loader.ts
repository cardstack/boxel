import type Owner from '@ember/owner';
import { getOwner } from '@ember/owner';
import Service from '@ember/service';

import { service } from '@ember/service';

import { SlidingSync } from 'matrix-js-sdk/lib/sliding-sync';

import { RealmAuthClient } from '@cardstack/runtime-common/realm-auth-client';

import type { FileDefManager } from '@cardstack/host/lib/file-def-manager';
import FileDefManagerImpl from '@cardstack/host/lib/file-def-manager';

import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type * as FileAPI from 'https://cardstack.com/base/file-api';

import type MatrixService from './matrix-service';
import type NetworkService from './network';
import type * as MatrixSDK from 'matrix-js-sdk';

/*
  This abstracts over the matrix SDK, including several extra functions that are
  actually implemented via direct HTTP.
*/
export default class MatrixSDKLoader extends Service {
  @service declare private network: NetworkService;
  @service declare private matrixService: MatrixService;
  #extended: ExtendedMatrixSDK | undefined;

  async load(): Promise<ExtendedMatrixSDK> {
    if (!this.#extended) {
      let sdk = await import('matrix-js-sdk');
      this.#extended = new ExtendedMatrixSDK(
        sdk,
        this.network.authedFetch,
        getOwner(this) as Owner,
        () => this.matrixService.cardAPI,
        () => this.matrixService.fileAPI,
      );
    }
    return this.#extended;
  }

  // For testing purposes, we need to mock the SlidingSync class
  get SlidingSync() {
    return SlidingSync;
  }
}

export class ExtendedMatrixSDK {
  #sdk: typeof MatrixSDK;
  #fetch: typeof globalThis.fetch;

  constructor(
    sdk: typeof MatrixSDK,
    fetch: typeof globalThis.fetch,
    private readonly owner: Owner,
    private readonly getCardAPI: () => typeof CardAPI,
    private readonly getFileAPI: () => typeof FileAPI,
  ) {
    this.#sdk = sdk;
    this.#fetch = fetch;
  }

  get RoomMemberEvent() {
    return this.#sdk.RoomMemberEvent;
  }

  get RoomEvent() {
    return this.#sdk.RoomEvent;
  }

  get RoomStateEvent() {
    return this.#sdk.RoomStateEvent;
  }

  get ClientEvent() {
    return this.#sdk.ClientEvent;
  }

  get Preset() {
    return this.#sdk.Preset;
  }

  createClient(opts: MatrixSDK.ICreateClientOpts): ExtendedClient {
    return extendedClient({
      client: this.#sdk.createClient(opts),
      fetch: this.#fetch,
      owner: this.owner,
      getCardAPI: this.getCardAPI,
      getFileAPI: this.getFileAPI,
    });
  }
}

export type ExtendedClient = Pick<
  MatrixSDK.MatrixClient,
  | 'addThreePidOnly'
  | 'baseUrl'
  | 'createRoom'
  | 'credentials'
  | 'decryptEventIfNeeded'
  | 'deleteThreePid'
  | 'fetchRoomEvent'
  | 'forget'
  | 'getAccessToken'
  | 'getJoinedRooms'
  | 'getProfileInfo'
  | 'getRoom'
  | 'getStateEvent'
  | 'getThreePids'
  | 'getUserId'
  | 'invite'
  | 'isLoggedIn'
  | 'isUsernameAvailable'
  | 'joinRoom'
  | 'leave'
  | 'loginWithPassword'
  | 'logout'
  | 'getOpenIdToken'
  | 'off'
  | 'on'
  | 'registerRequest'
  | 'requestPasswordEmailToken'
  | 'roomState'
  | 'scrollback'
  | 'sendEvent'
  | 'sendReadReceipt'
  | 'sendStateEvent'
  | 'setAccountData'
  | 'setDisplayName'
  | 'setPassword'
  | 'setPowerLevel'
  | 'setRoomName'
  | 'startClient'
  | 'getAccountDataFromServer'
  | 'setAccountData'
  | 'getDeviceId'
  | 'getDevice'
  | 'uploadContent'
  | 'mxcUrlToHttp'
  | 'paginateEventTimeline'
> &
  FileDefManager & {
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
    createRealmSession(realmURL: URL): Promise<string>;
    hashMessageWithSecret(message: string): Promise<string>;
  };

async function hashMessageWithSecret(
  this: ExtendedClient,
  _fetch: typeof globalThis.fetch,
) {
  throw new Error(`This should not be called on the browser client`);
}

async function createRealmSession(
  this: ExtendedClient,
  fetch: typeof globalThis.fetch,
  realmURL: URL,
) {
  let realmAuthClient = new RealmAuthClient(realmURL, this, fetch);

  return await realmAuthClient.getJWT();
}

async function requestEmailToken(
  this: ExtendedClient,
  fetch: typeof globalThis.fetch,
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
  this: ExtendedClient,
  fetch: typeof globalThis.fetch,
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

function extendedClient({
  client,
  fetch,
  owner,
  getCardAPI,
  getFileAPI,
}: {
  client: MatrixSDK.MatrixClient;
  fetch: typeof globalThis.fetch;
  owner: Owner;
  getCardAPI: () => typeof CardAPI;
  getFileAPI: () => typeof FileAPI;
}): ExtendedClient {
  let fileDefManager: FileDefManagerImpl;

  let extendedClient = new Proxy(client, {
    get(target, key, receiver) {
      let extendedTarget = target as unknown as ExtendedClient;
      switch (key) {
        case 'hashMessageWithSecret':
          return hashMessageWithSecret.bind(extendedTarget, fetch);
        case 'requestEmailToken':
          return requestEmailToken.bind(extendedTarget, fetch);
        case 'loginWithEmail':
          return loginWithEmail.bind(extendedTarget, fetch);
        case 'createRealmSession':
          return createRealmSession.bind(extendedTarget, fetch);
        case 'uploadCards':
          return fileDefManager.uploadCards.bind(fileDefManager);
        case 'uploadCommandDefinitions':
          return fileDefManager.uploadCommandDefinitions.bind(fileDefManager);
        case 'uploadFiles':
          return fileDefManager.uploadFiles.bind(fileDefManager);
        case 'downloadAsFileInBrowser':
          return fileDefManager.downloadAsFileInBrowser.bind(fileDefManager);
        case 'downloadCardFileDef':
          return fileDefManager.downloadCardFileDef.bind(fileDefManager);
        case 'cacheContentHashIfNeeded':
          return fileDefManager.cacheContentHashIfNeeded.bind(fileDefManager);
        case 'recacheContentHash':
          return fileDefManager.recacheContentHash.bind(fileDefManager);
        default:
          return Reflect.get(target, key, receiver);
      }
    },
  }) as unknown as ExtendedClient;
  fileDefManager = new FileDefManagerImpl({
    owner,
    client: extendedClient,
    getCardAPI,
    getFileAPI,
  });
  return extendedClient;
}

export interface MessageOptions {
  direction?: 'forward' | 'backward';
  pageSize: number;
}
