import type Owner from '@ember/owner';

import { settled } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import window from 'ember-window-mock';

import { baseRealm } from '@cardstack/runtime-common';

import type MatrixService from '@cardstack/host/services/matrix-service';

import { MockSDK } from './mock-matrix/_sdk';
import { MockSlidingSync } from './mock-matrix/_sliding-sync';
import { MockUtils, getRoomIdForRealmAndUser } from './mock-matrix/_utils';

import { getTestRealmRegistry } from './test-realm-registry';

import { registerRealmAuthSessionRoomEnsurer } from './index';

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
  uploadContentInterceptor?: () => Promise<void>;
  sendEventInterceptor?: () => Promise<void>;
  workspaceFavorites?: string[];
  loginFlowsResponse?: { flows: import('matrix-js-sdk').LoginFlow[] };
  ssoLoginUrl?: string;
  loginWithTokenInterceptor?: (
    token: string,
  ) => Promise<import('matrix-js-sdk').LoginResponse>;
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

    registerRealmAuthSessionRoomEnsurer(async (realmURL, userId) => {
      let roomId = mockUtils.getRoomIdForRealmAndUser(realmURL, userId);
      if (!mockUtils.getRoomIds().includes(roomId)) {
        mockUtils.createAndJoinRoom({
          sender: userId,
          name: roomId,
          id: roomId,
        });
      }
    });

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

  // Clear per-test references on the module-level `testState` object so the
  // current test's owner/sdk can be GC'd before the next test starts. Without
  // this, every module that calls `setupMockMatrix` retains the *last* owner
  // it ran with — which keeps the entire owner subgraph (services, realms,
  // adapters, registered queue handlers, bound Worker methods, etc.) alive.
  hooks.afterEach(async function () {
    await settled();
    // Drain any pending realm indexing BEFORE we null out testState.sdk —
    // the IIFE inside RealmIndexUpdater.enqueueUpdate fires its broadcast
    // (eventName: 'index') as the last step of the deferred indexing
    // chain, and that broadcast goes through the test adapter's
    // broadcastRealmEvent which reads mockMatrixUtils.serverState. If we
    // tear down matrix first, in-flight broadcasts throw on undefined
    // serverState. QUnit afterEach is LIFO, so setupLocalIndexing's drain
    // (which would normally take care of this) actually runs AFTER this
    // hook in test files where setupMockMatrix is registered after
    // setupLocalIndexing. Doing the drain here, in the same hook, before
    // the teardown step, fixes the order regardless of which sibling
    // hook is registered last.
    for (let entry of getTestRealmRegistry().values()) {
      try {
        await entry.realm.incrementalIndexing();
      } catch {
        // Indexing errors are surfaced via error_doc in the worker; the
        // drain itself swallows them so a single in-flight failure can't
        // break teardown for unrelated tests.
      }
    }
    testState.owner = undefined;
    testState.sdk = undefined;
    testState.opts = undefined;
  });

  return mockUtils;
}
