import Service, { service } from '@ember/service';
import { restartableTask } from 'ember-concurrency';

import {
  RealmInfo,
  SupportedMimeType,
  RealmPaths,
} from '@cardstack/runtime-common';

import LoaderService from '@cardstack/host/services/loader-service';

// This is temporary until we have a better way of discovering the realms that
// are available for a user to search from
import ENV from '@cardstack/host/config/environment';
const { ownRealmURL, otherRealmURLs } = ENV;

export default class RealmInfoService extends Service {
  @service declare loaderService: LoaderService;
  cachedRealmURLsForFileURL: Map<string, string> = new Map(); // Has the file url already been resolved to a realm url?
  cachedRealmInfos: Map<string, RealmInfo> = new Map(); // Has the realm url already been resolved to a realm info?

  async fetchRealmURL(fileURL: string): Promise<string> {
    if (this.cachedRealmURLsForFileURL.has(fileURL)) {
      return this.cachedRealmURLsForFileURL.get(fileURL)!;
    }

    let response = await this.loaderService.loader.fetch(fileURL);
    let realmURL = response.headers.get('x-boxel-realm-url');

    if (!realmURL) {
      throw new Error(
        'Could not find realm URL in response headers (x-boxel-realm-url)',
      );
    }

    this.cachedRealmURLsForFileURL.set(fileURL, realmURL);

    return realmURL;
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

    let realmURLString = realmURL
      ? realmURL.href
      : await this.fetchRealmURL(fileURL!);

    if (this.cachedRealmInfos.has(realmURLString)) {
      return this.cachedRealmInfos.get(realmURLString)!;
    } else {
      let realmInfoResponse = await this.loaderService.loader.fetch(
        `${realmURLString}_info`,
        { headers: { Accept: SupportedMimeType.RealmInfo } },
      );

      let realmInfo = (await realmInfoResponse.json())?.data?.attributes;
      this.cachedRealmInfos.set(realmURLString, realmInfo);
      return realmInfo;
    }
  }

  fetchAllKnownRealmInfos = restartableTask(async () => {
    let paths = [...new Set([ownRealmURL, ...otherRealmURLs])].map(
      (path) => new RealmPaths(path).url,
    );

    await Promise.all(
      paths.map(
        async (path) => await this.fetchRealmInfo({ realmURL: new URL(path) }),
      ),
    );
  });
}
