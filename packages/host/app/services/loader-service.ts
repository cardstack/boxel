import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import {
  IRealmCache,
  RealmAuthHandler,
  VirtualNetwork,
  baseRealm,
} from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import config from '@cardstack/host/config/environment';
import {
  type RealmSessionResource,
  getRealmSession,
} from '@cardstack/host/resources/realm-session';
import MatrixService from '@cardstack/host/services/matrix-service';
import RealmInfoService from '@cardstack/host/services/realm-info-service';

import { shimExternals } from '../lib/externals';

export default class LoaderService extends Service {
  @service declare fastboot: { isFastBoot: boolean };
  @service private declare matrixService: MatrixService;
  @service declare realmInfoService: RealmInfoService;

  @tracked loader = this.makeInstance();
  // This resources all have the same owner, it's safe to reuse cache.
  // The owner is the service, which stays around for the whole lifetime of the host app,
  // which in turn assures the resources will not get torn down.
  private realmSessions: Map<string, RealmSessionResource> = new Map();
  private realmAuthHandler: RealmAuthHandler | undefined;

  virtualNetwork = new VirtualNetwork();

  reset() {
    if (this.loader) {
      this.loader = Loader.cloneLoader(this.loader);
    } else {
      this.loader = this.makeInstance();
    }
  }

  private makeInstance() {
    if (this.fastboot.isFastBoot) {
      let loader = this.virtualNetwork.createLoader();
      shimExternals(this.virtualNetwork);
      return loader;
    }

    let loader = this.virtualNetwork.createLoader();
    this.virtualNetwork.addURLMapping(
      new URL(baseRealm.url),
      new URL(config.resolvedBaseRealmURL),
    );
    loader.prependURLHandlers([
      (req) => {
        if (!this.realmAuthHandler) {
          this.realmAuthHandler = this.makeRealmAuthHandler();
        }
        return this.realmAuthHandler.fetchWithAuth(req);
      },
    ]);
    shimExternals(this.virtualNetwork);

    return loader;
  }

  private makeRealmAuthHandler() {
    let realmCache = {
      getRealmInfoByURL: async (url: string) => {
        let realmURL = await this.realmInfoService.fetchRealmURL(url);
        if (!realmURL) {
          return null;
        }
        // We have to get public readable status
        // before we instantiate realm resource and load realm token.
        // Because we don't want to do authentication
        // for GET request to publicly readable realm.
        let isPublicReadable = await this.realmInfoService.isPublicReadable(
          realmURL,
        );

        return {
          isPublicReadable,
          url: realmURL,
        };
      },
      getJWT: async (realmURL: string) => {
        let realmSession = await this.getRealmSession(new URL(realmURL));
        return realmSession.rawRealmToken ?? null;
      },
      resetAuth: async (realmURL: string) => {
        let realmSession = await this.getRealmSession(new URL(realmURL));
        await realmSession.refreshToken();
      },
    } as IRealmCache;

    return new RealmAuthHandler(this.loader, undefined, undefined, realmCache);
  }

  private async getRealmSession(realmURL: URL) {
    let realmURLString = realmURL.href;
    let realmSession = this.realmSessions.get(realmURLString);

    if (!realmSession) {
      realmSession = getRealmSession(this, {
        realmURL: () => realmURL,
      });
      await realmSession.loaded;
      this.realmSessions.set(realmURLString, realmSession);
    }
    return realmSession;
  }
}
