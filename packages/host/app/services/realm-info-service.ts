import Service, { service } from '@ember/service';

import type LoaderService from '@cardstack/host/services/loader-service';

export default class RealmInfoService extends Service {
  @service declare loaderService: LoaderService;

  cachedPublicReadableRealms: Map<string, boolean> = new Map();

  async isPublicReadable(realmURL: URL): Promise<boolean> {
    let realmURLString = realmURL.href;
    if (this.cachedPublicReadableRealms.has(realmURLString)) {
      return this.cachedPublicReadableRealms.get(realmURLString)!;
    }
    let response = await this.loaderService.loader.fetch(realmURL, {
      method: 'HEAD',
    });
    let isPublicReadable = Boolean(
      response.headers.get('x-boxel-realm-public-readable'),
    );
    this.cachedPublicReadableRealms.set(realmURLString, isPublicReadable);

    return isPublicReadable;
  }
}
