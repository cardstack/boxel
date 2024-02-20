import Service, { service } from '@ember/service';

import window from 'ember-window-mock';

import { type JWTPayload } from '@cardstack/runtime-common';

import type { RealmSessionResource } from '@cardstack/host/resources/realm-session';
import type MatrixService from '@cardstack/host/services/matrix-service';
import { LOCAL_STORAGE_KEY } from '@cardstack/host/services/session';
import type SessionService from '@cardstack/host/services/session';

function generateMockSessionService(
  realmPermissions?: () => {
    [realmURL: string]: ('read' | 'write')[];
  },
) {
  class MockSessionService extends Service {
    @service private declare matrixService: MatrixService;

    async loadSession(
      realmSessionResource: RealmSessionResource,
    ): Promise<{ rawToken: string; token: JWTPayload } | undefined> {
      let realmURL = await realmSessionResource.realmURL;
      if (!realmURL) {
        throw new Error(
          `could not determine realm URL from RealmSessionResource`,
        );
      }
      if (!this.matrixService.userId) {
        throw new Error(
          `User not logged into matrix (most likely mock matrix)`,
        );
      }
      let secret = "shhh! it's a secret";
      let nowInSeconds = Math.floor(Date.now() / 1000);
      let expires = nowInSeconds + 60 * 60;
      let header = { alg: 'none', typ: 'JWT' };
      let token = {
        iat: nowInSeconds,
        exp: expires,
        user: this.matrixService.userId,
        realm: realmURL.href,
        permissions: realmPermissions?.()[realmURL.href] ?? ['read', 'write'],
      };
      let stringifiedHeader = JSON.stringify(header);
      let stringifiedPayload = JSON.stringify(token);
      let headerAndPayload = `${btoa(stringifiedHeader)}.${btoa(
        stringifiedPayload,
      )}`;
      // this is our silly JWT--we don't sign with crypto since we are running in the
      // browser so the secret is the signature
      let rawToken = `${headerAndPayload}.${secret}`;
      return Promise.resolve({ rawToken, token });
    }

    logout() {
      window.localStorage.removeItem(LOCAL_STORAGE_KEY);
    }
  }
  return MockSessionService;
}

export function setupSessionServiceMock(
  hooks: NestedHooks,
  realmPermissions?: () => {
    [realmURL: string]: ('read' | 'write')[];
  },
) {
  hooks.beforeEach(function () {
    this.owner.register(
      'service:session',
      generateMockSessionService(realmPermissions),
    );
  });
  hooks.afterEach(function () {
    let sessionService = this.owner.lookup('service:session') as SessionService;
    sessionService.logout();
  });
}
