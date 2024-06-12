import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import {
  VirtualNetwork,
  baseRealm,
  addAuthorizationHeader,
  IRealmAuthDataSource,
} from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import config from '@cardstack/host/config/environment';
import MatrixService from '@cardstack/host/services/matrix-service';
import RealmInfoService from '@cardstack/host/services/realm-info-service';

import { shimExternals } from '../lib/externals';

import RealmService from './realm';

export default class LoaderService extends Service {
  @service declare fastboot: { isFastBoot: boolean };
  @service private declare matrixService: MatrixService;
  @service declare realmInfoService: RealmInfoService;
  @service declare realm: RealmService;

  @tracked loader = this.makeInstance();

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
      addAuthorizationHeader(loader, {
        realmURL: undefined,
        getJWT: async (realmURL: string) => {
          return this.realm.token(realmURL);
        },
        getRealmInfo: async (url: string) => {
          let realmURL = await this.realmInfoService.fetchRealmURL(url);
          if (!realmURL) {
            return null;
          }
          let isPublicReadable = await this.realmInfoService.isPublicReadable(
            realmURL,
          );
          return {
            url: realmURL.href,
            isPublicReadable,
          };
        },
        resetAuth: async (realmURL: string) => {
          return await this.realm.refreshToken(realmURL);
        },
      } as IRealmAuthDataSource),
    ]);
    shimExternals(this.virtualNetwork);

    return loader;
  }
}
