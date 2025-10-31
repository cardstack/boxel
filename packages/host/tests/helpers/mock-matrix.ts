import type Owner from '@ember/owner';

import { getService } from '@universal-ember/test-support';
import window from 'ember-window-mock';

import { baseRealm } from '@cardstack/runtime-common';

import type MatrixService from '@cardstack/host/services/matrix-service';

import { MockSDK } from './mock-matrix/_sdk';
import { MockSlidingSync } from './mock-matrix/_sliding-sync';
import { MockUtils, getRoomIdForRealmAndUser } from './mock-matrix/_utils';

export const testRealmServerMatrixUsername = 'realm_server';
export const testRealmServerMatrixUserId = `@${testRealmServerMatrixUsername}:localhost`;

export interface Config {
  loggedInAs?: string;
  displayName?: string;
  activeRealms?: string[];
  realmPermissions?: Record<string, string[]>;
  expiresInSec?: number;
  autostart?: boolean;
  now?: () => number;
  directRooms?: string[];
  systemCardAccountData?: { id?: string };
}

export function setupMockMatrix(
  hooks: NestedHooks,
  opts: Config = {},
): MockUtils {
  let testState: {
    owner?: Owner;
    sdk?: MockSDK;
    opts?: Config;
  } = {
    owner: undefined,
    sdk: undefined,
    opts: undefined,
  };

  let mockUtils = new MockUtils(testState, async () => {
    if (opts?.autostart) {
      if (!testState?.owner) {
        throw new Error(`Cannot start mock matrix without a test state owner`);
      }
      let matrixService = testState.owner.lookup(
        'service:matrix-service',
      ) as MatrixService;
      await matrixService.ready;
      await matrixService.start();
    } else {
      console.warn(`auto starting of mock matrix is disabled`);
    }
  });

  hooks.beforeEach(async function () {
    if (!opts.directRooms && opts.loggedInAs) {
      opts.directRooms = [
        ...(opts.activeRealms?.map((realmURL) =>
          getRoomIdForRealmAndUser(realmURL, opts.loggedInAs!),
        ) ?? []),
        getRoomIdForRealmAndUser(baseRealm.url, opts.loggedInAs),
      ];
    }

    testState.owner = this.owner;

    // Start with initial directRooms from opts
    const directRooms = [...(opts.directRooms || [])];

    // Always add the auth room to directRooms to ensure it's treated as a DM
    const authRoomId = 'test-auth-realm-server-session-room';
    if (!directRooms.includes(authRoomId)) {
      directRooms.push(authRoomId);
    }

    testState.opts = { ...opts, directRooms };
    let sdk = new MockSDK(testState.opts, this.owner);
    testState.sdk = sdk;

    // Needed for realm event subscriptions to receive events
    getService('message-service').register();
    const { loggedInAs } = opts;
    if (loggedInAs) {
      window.localStorage.setItem(
        'auth',
        JSON.stringify({
          access_token: 'mock-access-token',
          device_id: 'mock-device-id',
          user_id: loggedInAs,
        }),
      );

      let { createAndJoinRoom, getRoomIds } = mockUtils;

      if (opts.activeRealms) {
        for (let realmURL of opts.activeRealms) {
          let realmSessionRoomId = mockUtils.getRoomIdForRealmAndUser(
            realmURL,
            loggedInAs,
          );

          if (!getRoomIds().includes(realmSessionRoomId)) {
            createAndJoinRoom({
              sender: loggedInAs,
              name: realmSessionRoomId,
              id: realmSessionRoomId,
            });
          }
        }
      }

      createAndJoinRoom({
        sender: loggedInAs,
        name: 'test-auth-realm-server-session-room',
        id: 'test-auth-realm-server-session-room',
      });
    }

    this.owner.register(
      'service:matrixSdkLoader',
      {
        async load() {
          return sdk;
        },
        SlidingSync: MockSlidingSync,
      },
      {
        instantiate: false,
      },
    );
    this.owner.register(
      'service:matrix-mock-utils',
      {
        async load() {
          return mockUtils;
        },
      },
      {
        instantiate: false,
      },
    );
  });
  return mockUtils;
}
