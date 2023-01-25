import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { action } from '@ember/object';
import { file, FileResource } from '../resources/file';
import LoaderService from '../services/loader-service';
import type RouterService from '@ember/routing/router-service';
import type LocalRealm from '../services/local-realm';
import type CardService from '../services/card-service';
import { RealmPaths } from '@cardstack/runtime-common';
import type { Format } from 'https://cardstack.com/base/card-api';

interface Model {
  path: string | undefined;
  openFile: FileResource | undefined;
  polling: 'off' | undefined;
  openDirs: string | undefined;
  isFastBoot: boolean;
}

export default class Index extends Route<Model> {
  queryParams = {
    path: {
      refreshModel: true,
    },
    polling: {
      refreshModel: true,
    },
    openDirs: {
      refreshModel: true,
    },
  };

  @service declare router: RouterService;
  @service declare loaderService: LoaderService;
  @service declare cardService: CardService;
  @service declare localRealm: LocalRealm;
  @service declare fastboot: { isFastBoot: boolean };

  async model(args: {
    path?: string;
    polling?: 'off';
    openDirs: string;
    url?: string;
    format?: Format;
  }): Promise<Model> {
    let { path, polling, openDirs } = args;
    let { isFastBoot } = this.fastboot;

    let openFile: FileResource | undefined;
    if (!path) {
      return { path, openFile, polling, openDirs, isFastBoot };
    }

    await this.localRealm.startedUp;
    if (!this.localRealm.isAvailable && !this.cardService.defaultURL) {
      return { path, openFile, polling, openDirs, isFastBoot };
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
      console.error(
        `Could not load ${url}: ${response.status}, ${response.statusText}`
      );
      return { path, openFile, polling, openDirs, isFastBoot };
    }
    // The server may have responded with a redirect which we need to pay
    // attention to. As part of responding to us, the server will hand us a
    // resolved URL in response.url. We need to reverse that resolution in order
    // to see if we have been given a redirect.
    let responseURL = this.loaderService.loader.reverseResolution(response.url);
    if (responseURL.href !== url) {
      this.router.transitionTo('application', {
        queryParams: {
          path: realmPath.local(responseURL),
          polling,
          openDirs,
        },
      });
    } else {
      let content = await response.text();
      openFile = file(this, () => ({
        url,
        content,
        lastModified: response.headers.get('last-modified') || undefined,
        onStateChange: (state) => {
          if (state === 'not-found') {
            this.router.transitionTo('application', {
              queryParams: {
                path: undefined,
                polling: undefined,
                openDirs: undefined,
              },
            });
          }
        },
        polling,
      }));
      await openFile.loading;
    }

    return { path, openFile, polling, openDirs, isFastBoot };
  }

  @action
  willTransition(transition: any) {
    if (transition.from?.attributes.openFile) {
      transition.from.attributes.openFile.close();
    }
  }
}
