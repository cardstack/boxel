import LoaderService from '@cardstack/host/services/loader-service';
import Service from '@ember/service';
import { RealmInfo, SupportedMimeType } from '@cardstack/runtime-common';
import { service } from '@ember/service';

export default class RecentFilesService extends Service {
  @service declare loaderService: LoaderService;
  cachedRealmInfos: Map<string, RealmInfo> = new Map();

  async fetchRealmUrl(fileUrl: string): Promise<string> {
    let response = await this.loaderService.loader.fetch(fileUrl);
    let realmURL = response.headers.get('x-boxel-realm-url');

    if (!realmURL) {
      throw new Error(
        'Could not find realm URL in response headers (x-boxel-realm-url)',
      );
    }

    return realmURL;
  }

  async fetchRealmInfo(fileUrl: string): Promise<RealmInfo> {
    if (this.cachedRealmInfos.has(fileUrl)) {
      return this.cachedRealmInfos.get(fileUrl)!;
    }

    let realmUrl = await this.fetchRealmUrl(fileUrl);

    let realmInfoResponse = await this.loaderService.loader.fetch(
      `${realmUrl}_info`,
      { headers: { Accept: SupportedMimeType.RealmInfo } },
    );

    let realmInfo = (await realmInfoResponse.json())?.data?.attributes;

    return realmInfo;
  }
}
