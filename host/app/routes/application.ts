import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { action } from '@ember/object';
import { file, FileResource } from '../resources/file';
import type RouterService from '@ember/routing/router-service';
import LocalRealm from '../services/local-realm';

interface Model {
  path: string | undefined;
  openFile: FileResource | undefined;
}
export default class Application extends Route<Model> {
  queryParams = {
    path: {
      refreshModel: true,
    },
  };

  @service declare router: RouterService;
  @service declare localRealm: LocalRealm;

  async model(args: { path: string | undefined }): Promise<Model> {
    let { path } = args;

    let openFile: FileResource | undefined;
    if (!path) {
      return { path, openFile };
    }

    await this.localRealm.startedUp;
    if (!this.localRealm.isAvailable) {
      return { path, openFile };
    }

    let url = `http://local-realm${path}`;
    let response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.card+source',
      },
    });
    if (!response.ok) {
      // TODO should we have an error route?
      console.error(
        `Could not load ${url}: ${response.status}, ${response.statusText}`
      );
      return { path, openFile };
    }
    if (response.url !== url) {
      this.router.transitionTo('application', {
        queryParams: { path: new URL(response.url).pathname },
      });
    } else {
      let contents = await response.text();
      openFile = file(this, {
        url: () => url,
        content: () => contents,
        lastModified: () => response.headers.get('Last-Modified') || undefined,
        onStateChange: (state) => {
          if (state === 'not-found') {
            this.router.transitionTo('application', {
              queryParams: { path: undefined },
            });
          }
        },
      });
      await openFile.loading;
    }

    return { path, openFile };
  }

  @action
  willTransition(transition: any) {
    if (transition.from?.attributes.openFile) {
      transition.from.attributes.openFile.close();
    }
  }
}
