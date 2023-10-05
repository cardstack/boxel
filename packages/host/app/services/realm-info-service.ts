import Service, { service } from '@ember/service';

import { RealmInfo, SupportedMimeType } from '@cardstack/runtime-common';

import LoaderService from '@cardstack/host/services/loader-service';

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
    realmURL?: string;
    fileURL?: string;
  }): Promise<RealmInfo> {
    let { realmURL, fileURL } = params;
    if (!realmURL && !fileURL) {
      throw new Error("Must provide either 'realmUrl' or 'fileUrl'");
    }

    realmURL = realmURL ? realmURL : await this.fetchRealmURL(fileURL!);

    if (this.cachedRealmInfos.has(realmURL)) {
      return this.cachedRealmInfos.get(realmURL)!;
    } else {
      let realmInfoResponse = await this.loaderService.loader.fetch(
        `${realmURL}_info`,
        { headers: { Accept: SupportedMimeType.RealmInfo } },
      );

      let responseJson = await realmInfoResponse.json();
      let realmInfo = {
        id: responseJson?.data?.id,
        ...responseJson?.data?.attributes,
      };

      this.cachedRealmInfos.set(realmURL, realmInfo);
      return realmInfo;
    }
  }
}
