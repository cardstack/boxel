import Service, { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { baseRealm } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import config from '@cardstack/host/config/environment';
import { shimExternals } from '@cardstack/host/lib/externals';
import RealmInfoService from '@cardstack/host/services/realm-info-service';
import SessionsService from '@cardstack/host/services/sessions-service';

export default class LoaderService extends Service {
  @service declare fastboot: { isFastBoot: boolean };
  @service declare realmInfoService: RealmInfoService;
  @service declare sessionsService: SessionsService;

  @tracked loader = this.makeInstance();

  reset() {
    if (this.loader) {
      this.loader = Loader.cloneLoader(this.loader);
      shimExternals(this.loader);
    } else {
      this.loader = this.makeInstance();
    }
  }

  private makeInstance() {
    if (this.fastboot.isFastBoot) {
      let loader = new Loader();
      shimExternals(loader);
      return loader;
    }

    let loader = new Loader();
    loader.addURLMapping(
      new URL(baseRealm.url),
      new URL(config.resolvedBaseRealmURL),
    );
    shimExternals(loader);

    return loader;
  }

  async fetchWithAuth(
    urlOrRequest: string | URL | Request,
    init?: RequestInit,
  ) {
    try {
      let request = this.loader.asResolvedRequest(urlOrRequest, init);
      await this.includeAuthHeader(request);
      let response = await this.loader.fetch(request);
      await this.handleUnAuthorizedError(request, response);
      return response;
    } catch (err: any) {
      let url =
        urlOrRequest instanceof Request
          ? urlOrRequest.url
          : String(urlOrRequest);
      return new Response(`fetch failed for ${url}`, {
        status: 500,
        statusText: err.message,
      });
    }
  }

  async includeAuthHeader(request: Request) {
    let realmURL = await this.realmInfoService.fetchRealmURL(request.url);
    let isPublicReadable = await this.realmInfoService.isPublicReadable(
      realmURL,
    );
    let token = await this.sessionsService.getRealmToken(realmURL);

    if ((request.method !== 'GET' || !isPublicReadable) && token) {
      request.headers.append('Authorization', token);
    }
  }

  async handleUnAuthorizedError(request: Request, response: Response) {
    if (response.ok || response.status !== 401) {
      return;
    }

    let realmURL = await this.realmInfoService.fetchRealmURL(request.url);
    let isPublicReadable = await this.realmInfoService.isPublicReadable(
      realmURL,
    );
    if (request.method === 'GET' && isPublicReadable) {
      isPublicReadable = await this.realmInfoService.isPublicReadable(
        realmURL,
        true,
      );
    }

    // Try to refresh token
    if (!isPublicReadable || request.method !== 'GET') {
      let token = await this.sessionsService.getRealmToken(realmURL, true);
      if (token) {
        request.headers.append('Authorization', token);
        response = await this.loader.fetch(request);
      }
    }
  }
}
