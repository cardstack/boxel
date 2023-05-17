import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { file, FileResource } from '../resources/file';
import LoaderService from '../services/loader-service';
import type RouterService from '@ember/routing/router-service';
import type CardService from '../services/card-service';
import { RealmPaths, logger } from '@cardstack/runtime-common';

const log = logger('route:code');

interface Model {
  path: string | undefined;
  openFile: FileResource | undefined;
  openDirs: string[];
  isFastBoot: boolean;
}

export default class Code extends Route<Model> {
  queryParams = {
    path: {
      refreshModel: true,
    },
    openDirs: {
      refreshModel: true,
    },
  };

  @service declare router: RouterService;
  @service declare loaderService: LoaderService;
  @service declare cardService: CardService;
  @service declare fastboot: { isFastBoot: boolean };

  async model(args: {
    path?: string;
    openDirs: string | undefined;
  }): Promise<Model> {
    let { path, openDirs: openDirsString } = args;
    let openDirs = openDirsString ? openDirsString.split(',') : [];
    let { isFastBoot } = this.fastboot;

    let openFile: FileResource | undefined;
    if (!path) {
      return { path, openFile, openDirs, isFastBoot };
    }

    let realmPath = new RealmPaths(this.cardService.defaultURL);
    let url = realmPath.fileURL(path).href;
    let response = await this.loaderService.loader.fetch(url, {
      headers: {
        Accept: 'application/vnd.card+source',
      },
    });
    if (!response.ok) {
      // TODO should we have an error route?
      log.error(
        `Could not load ${url}: ${response.status}, ${response.statusText}`
      );
      return { path, openFile, openDirs, isFastBoot };
    }
    let responseURL: URL | undefined;
    // The server may have responded with a redirect which we need to pay
    // attention to. As part of responding to us, the server will hand us a
    // resolved URL in response.url. We need to reverse that resolution in order
    // to see if we have been given a redirect. (note that when the response is
    // a short-circuited response because our realm lives in the DOM, i.e. tests,
    // then there is no response.url)
    if (response.url) {
      responseURL = this.loaderService.loader.reverseResolution(response.url);
    }
    if (responseURL && responseURL.href !== url) {
      this.router.transitionTo('code', {
        queryParams: { path: realmPath.local(responseURL), openDirs },
      });
    } else {
      let content = await response.text();
      let relativePath = path;
      openFile = file(this, () => ({
        relativePath,
        realmURL: realmPath.url,
        content,
        lastModified: response.headers.get('last-modified') || undefined,
        onStateChange: (state) => {
          if (state === 'not-found') {
            this.router.transitionTo('code', {
              queryParams: { path: undefined, openDirs },
            });
          }
        },
      }));
      await openFile.loading;
    }

    return { path, openFile, openDirs, isFastBoot };
  }
}
