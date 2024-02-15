import Service, { service } from '@ember/service';

import { buildWaiter } from '@ember/test-waiters';

import { restartableTask } from 'ember-concurrency';
import { TrackedMap } from 'tracked-built-ins';

import {
  RealmInfo,
  SupportedMimeType,
  RealmPaths,
} from '@cardstack/runtime-common';

import type CardService from '@cardstack/host/services/card-service';
import type LoaderService from '@cardstack/host/services/loader-service';

const waiter = buildWaiter('realm-info-service:waiter');
type ExtendedRealmInfo = {
  info?: RealmInfo;
  isPublicReadable?: boolean;
};

export default class RealmInfoService extends Service {
  @service declare loaderService: LoaderService;
  @service declare cardService: CardService;
  cachedRealmURLsForURL: Map<string, string> = new Map(); // Has the file url already been resolved to a realm url?
  cachedRealms: TrackedMap<string, ExtendedRealmInfo> = new TrackedMap();

  async fetchRealmURL(url: string): Promise<URL | undefined> {
    let realmURLString = this.getRealmURLFromCache(url);
    if (!realmURLString) {
      let response = await this.loaderService.loader.fetch(url, {
        method: 'HEAD',
      });
      realmURLString = response.headers.get('x-boxel-realm-url') ?? undefined;
    }
    let realmURL;
    if (realmURLString) {
      this.cachedRealmURLsForURL.set(url, realmURLString);
      realmURL = new URL(realmURLString);
    }

    return realmURL;
  }

  private getRealmURLFromCache(url: string) {
    let realmURLString = this.cachedRealmURLsForURL.get(url);
    if (!realmURLString) {
      realmURLString = Array.from(this.cachedRealmURLsForURL.values()).find(
        (realmURL) => url.includes(realmURL),
      );
    }
    return realmURLString;
  }

  async isPublicReadable(realmURL: URL): Promise<boolean> {
    const realmURLString = realmURL.href;
    const realm = this.getRealmInfoFromCache(realmURLString);
    if (realm.isPublicReadable != undefined) {
      return realm.isPublicReadable;
    }

    const response = await this.loaderService.loader.fetch(realmURL, {
      method: 'HEAD',
    });
    const isPublicReadable = Boolean(
      response.headers.get('x-boxel-realm-public-readable'),
    );
    this.cachedRealms.set(realmURLString, {
      ...realm,
      isPublicReadable,
    });

    return isPublicReadable;
  }

  // When realmUrl is provided, it will fetch realm info from that url, otherwise it will first
  // try to fetch the realm url from the file url
  async fetchRealmInfo(params: {
    realmURL?: URL;
    fileURL?: string;
  }): Promise<RealmInfo> {
    let { realmURL, fileURL } = params;
    if (!realmURL && !fileURL) {
      throw new Error("Must provide either 'realmUrl' or 'fileUrl'");
    }

    let token = waiter.beginAsync();
    try {
      const realmURLString = realmURL
        ? realmURL.href
        : (await this.fetchRealmURL(fileURL!))?.href;
      if (!realmURLString) {
        throw new Error(
          'Could not find realm URL in response headers (x-boxel-realm-url)',
        );
      }

      const realm = this.getRealmInfoFromCache(realmURLString);
      if (realm.info) {
        return realm.info;
      } else {
        const realmInfoResponse = await this.loaderService.loader.fetch(
          `${realmURLString}_info`,
          { headers: { Accept: SupportedMimeType.RealmInfo } },
        );

        const info = (await realmInfoResponse.json())?.data?.attributes;
        this.cachedRealms.set(realmURLString, {
          ...realm,
          info,
        });
        return info;
      }
    } finally {
      waiter.endAsync(token);
    }
  }

  fetchAllKnownRealmInfos = restartableTask(async () => {
    let paths = this.cardService.realmURLs.map(
      (path) => new RealmPaths(path).url,
    );
    let token = waiter.beginAsync();
    try {
      await Promise.all(
        paths.map(
          async (path) =>
            await this.fetchRealmInfo({ realmURL: new URL(path) }),
        ),
      );
    } finally {
      waiter.endAsync(token);
    }
  });

  private getRealmInfoFromCache(realmURLString: string): ExtendedRealmInfo {
    let realm = this.cachedRealms.get(realmURLString);
    if (!realm) {
      realm = {};
      this.cachedRealms.set(realmURLString, realm);
    }
    return realm;
  }
}
