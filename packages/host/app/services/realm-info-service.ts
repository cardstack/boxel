import LoaderService from '@cardstack/host/services/loader-service';
import Service from '@ember/service';
import { RealmInfo, SupportedMimeType } from '@cardstack/runtime-common';
import { service } from '@ember/service';

export default class RecentFilesService extends Service {
  @service declare loaderService: LoaderService;
  cachedRealmUrlsForFileUrl: Map<string, string> = new Map(); // Has the file url already been resolved to a realm url?
  cachedRealmInfos: Map<string, RealmInfo> = new Map(); // Has the realm url already been rosolved to a realm info?

  async fetchRealmUrl(fileUrl: string): Promise<string> {
    if (this.cachedRealmUrlsForFileUrl.has(fileUrl)) {
      return this.cachedRealmUrlsForFileUrl.get(fileUrl)!;
    }

    let response = await this.loaderService.loader.fetch(fileUrl);
    let realmURL = response.headers.get('x-boxel-realm-url');

    if (!realmURL) {
      throw new Error(
        'Could not find realm URL in response headers (x-boxel-realm-url)',
      );
    }

    this.cachedRealmUrlsForFileUrl.set(fileUrl, realmURL);

    return realmURL;
  }

  // When realmUrl is provided, it will fetch realm info from that url, otherwise it will first
  // try to fetch the realm url from the file url
  async fetchRealmInfo(params: {
    realmUrl?: string;
    fileUrl?: string;
  }): Promise<RealmInfo> {
    let { realmUrl, fileUrl } = params;
    if (!realmUrl && !fileUrl) {
      throw new Error("Must provide either 'realmUrl' or 'fileUrl'");
    }

    realmUrl = realmUrl ? realmUrl : await this.fetchRealmUrl(fileUrl!);

    if (this.cachedRealmInfos.has(realmUrl)) {
      return this.cachedRealmInfos.get(realmUrl)!;
    } else {
      let realmInfoResponse = await this.loaderService.loader.fetch(
        `${realmUrl}_info`,
        { headers: { Accept: SupportedMimeType.RealmInfo } },
      );

      let realmInfo = (await realmInfoResponse.json())?.data?.attributes;
      this.cachedRealmInfos.set(realmUrl, realmInfo);
      return realmInfo;
    }
  }
}
