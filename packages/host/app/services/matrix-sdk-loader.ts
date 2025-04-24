import Service from '@ember/service';

import { service } from '@ember/service';

import * as MatrixSDK from 'matrix-js-sdk';
import { SlidingSync } from 'matrix-js-sdk/lib/sliding-sync';

import { RealmAuthClient } from '@cardstack/runtime-common/realm-auth-client';

import { SerializedFile } from 'https://cardstack.com/base/file-api';

import NetworkService from './network';

/*
  This abstracts over the matrix SDK, including several extra functions that are
  actually implemented via direct HTTP.
*/
export default class MatrixSDKLoader extends Service {
  @service declare private network: NetworkService;
  #extended: ExtendedMatrixSDK | undefined;

  async load(): Promise<ExtendedMatrixSDK> {
    if (!this.#extended) {
      let sdk = await import('matrix-js-sdk');
      this.#extended = new ExtendedMatrixSDK(sdk, this.network.authedFetch);
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

  constructor(sdk: typeof MatrixSDK, fetch: typeof globalThis.fetch) {
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
    return extendedClient(this.#sdk.createClient(opts), this.#fetch);
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
> & {
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
  uploadContent(
    file: MatrixSDK.FileType,
    opts: MatrixSDK.UploadOpts,
  ): Promise<MatrixSDK.UploadResponse>;
  mxcUrlToHttp(mxcUrl: string): string;
  downloadContent(serializedFile: SerializedFile): Promise<string>;
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

interface CacheEntry {
  content: string;
  timestamp: number;
}

const CACHE_EXPIRATION_MS = 30 * 60 * 1000; // 30 minutes
const downloadCache: Map<string, CacheEntry> = new Map();

async function downloadContent(
  this: ExtendedClient,
  fetch: typeof globalThis.fetch,
  serializedFile: SerializedFile,
): Promise<string> {
  if (!serializedFile?.contentType?.includes('text/')) {
    throw new Error(`Unsupported file type: ${serializedFile.contentType}`);
  }

  // Check cache first
  const cachedEntry = downloadCache.get(serializedFile.url);
  if (cachedEntry && Date.now() - cachedEntry.timestamp < CACHE_EXPIRATION_MS) {
    return cachedEntry.content;
  }

  // Download if not in cache or expired
  const response = await fetch(serializedFile.url, {
    headers: {
      Authorization: `Bearer ${this.getAccessToken()}`,
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP error. Status: ${response.status}`);
  }
  const content = await response.text();

  // Update cache
  downloadCache.set(serializedFile.url, {
    content,
    timestamp: Date.now(),
  });

  // Clean up cache if it gets too large
  if (downloadCache.size > 100) {
    cleanupCache();
  }

  return content;
}

/**
 * Cleans up expired entries from the download cache
 */
function cleanupCache(): void {
  const now = Date.now();
  for (const [url, entry] of downloadCache.entries()) {
    if (now - entry.timestamp > CACHE_EXPIRATION_MS) {
      downloadCache.delete(url);
    }
  }
}

function extendedClient(
  client: MatrixSDK.MatrixClient,
  fetch: typeof globalThis.fetch,
): ExtendedClient {
  return new Proxy(client, {
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
        case 'downloadContent':
          return downloadContent.bind(extendedTarget, fetch);
        default:
          return Reflect.get(target, key, receiver);
      }
    },
  }) as unknown as ExtendedClient;
}

export interface MessageOptions {
  direction?: 'forward' | 'backward';
  pageSize: number;
}
