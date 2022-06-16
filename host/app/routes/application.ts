import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { action } from '@ember/object';
import { file, FileResource } from '../resources/file';
import type RouterService from '@ember/routing/router-service';

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

  async model(args: { path: string | undefined }): Promise<Model> {
    let { path } = args;

    let openFile: FileResource | undefined;
    if (path) {
      if (!path) {
        return { path, openFile };
      }

      let url = `http://local-realm${path}`;
      let response = await fetch(url, {
        headers: {
          Accept: path.endsWith('.json')
            ? // assume we want JSON-API for .json files, if the server determines
              // that it is not actually card data, then it will just return in the
              // native format
              'application/vnd.api+json'
            : 'application/vnd.card+source',
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
        openFile = file(
          this,
          () => url,
          () => contents,
          () => response.headers.get('Last-Modified') || undefined
        );
        await openFile.loading;
      }
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
