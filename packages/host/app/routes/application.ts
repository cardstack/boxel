import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { action } from '@ember/object';
import { file, FileResource } from '../resources/file';
import LoaderService from '../services/loader-service';
import type RouterService from '@ember/routing/router-service';
import LocalRealm from '../services/local-realm';
import { RealmPaths } from '@cardstack/runtime-common';
import type { Format } from 'https://cardstack.com/base/card-api';

type Model = BrowserRenderCardModel | ServerRenderCardModel;

interface BrowserRenderCardModel {
  isServerRender: false;
  path: string | undefined;
  openFile: FileResource | undefined;
  polling: 'off' | undefined;
}

interface ServerRenderCardModel {
  isServerRender: true;
  url: string;
  format: Format;
}

export default class Application extends Route<Model> {
  queryParams = {
    path: {
      refreshModel: true,
    },
    polling: {
      refreshModel: true,
    },
    url: {
      refreshModel: true,
    },
    format: {
      refreshModel: true,
    },
  };

  @service declare router: RouterService;
  @service declare loaderService: LoaderService;
  @service declare localRealm: LocalRealm;

  async model(args: {
    path?: string;
    polling?: 'off';
    url?: string;
    format?: Format;
  }): Promise<Model> {
    let { path, polling, url: renderURL, format } = args;
    if (renderURL && format) {
      return { isServerRender: true, format, url: renderURL };
    }

    let openFile: FileResource | undefined;
    if (!path) {
      return { isServerRender: false, path, openFile, polling };
    }

    await this.localRealm.startedUp;
    if (!this.localRealm.isAvailable) {
      return { isServerRender: false, path, openFile, polling };
    }

    let realmPath = new RealmPaths(this.localRealm.url);
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
      return { isServerRender: false, path, openFile, polling };
    }
    if (response.url !== url) {
      this.router.transitionTo('application', {
        queryParams: {
          path: realmPath.local(new URL(response.url)),
          polling,
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
              queryParams: { path: undefined, polling: undefined },
            });
          }
        },
        polling,
      }));
      await openFile.loading;
    }

    return { isServerRender: false, path, openFile, polling };
  }

  @action
  willTransition(transition: any) {
    if (transition.from?.attributes.openFile) {
      transition.from.attributes.openFile.close();
    }
  }
}
