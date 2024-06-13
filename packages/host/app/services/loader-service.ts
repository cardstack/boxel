import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import {
  VirtualNetwork,
  baseRealm,
  addAuthorizationHeader,
} from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import config from '@cardstack/host/config/environment';
import RealmInfoService from '@cardstack/host/services/realm-info-service';

import { shimExternals } from '../lib/externals';

import RealmService from './realm';

export default class LoaderService extends Service {
  @service declare fastboot: { isFastBoot: boolean };
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
        getToken: async (url: string, httpMethod: string) => {
          try {
            return this.realm.token(url, httpMethod);
          } catch (e: any) {
            if (e.code === 'RealmNotReady') {
              return undefined;
            }
            throw e;
          }
        },
        resetToken: async (url: string) => {
          return await this.realm.refreshToken(url);
        },
      }),
    ]);
    shimExternals(this.virtualNetwork);

    return loader;
  }
}
