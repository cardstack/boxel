import Owner from '@ember/owner';

import window from 'ember-window-mock';

import type MatrixService from '@cardstack/host/services/matrix-service';

import { MockSDK } from './mock-matrix/_sdk';
import { MockUtils } from './mock-matrix/_utils';

export interface Config {
  loggedInAs?: string;
  displayName?: string;
  activeRealms?: string[];
  realmPermissions?: Record<string, string[]>;
  expiresInSec?: number;
  autostart?: boolean;
}

export function setupMockMatrix(
  hooks: NestedHooks,
  opts: Config = {},
): MockUtils {
  let testState: { owner?: Owner; sdk?: MockSDK } = {
    owner: undefined,
    sdk: undefined,
  };
  hooks.beforeEach(async function () {
    testState.owner = this.owner;
    let sdk = new MockSDK(opts);
    testState.sdk = sdk;
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
    if (opts.autostart) {
      let matrixService = this.owner.lookup(
        'service:matrix-service',
      ) as MatrixService;
      await matrixService.ready;
      await matrixService.start();
    }
  });
  return new MockUtils(opts, testState);
}
