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

      let url = `http://local-realm/${path}`;
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
          queryParams: { path: new URL(response.url).pathname.slice(1) },
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
      // is there a more concise way to do this? openFile is a Proxy and it
      // seems like this was the only way we could get a handle on the close()
      // method for openFile
      Reflect.get(transition.from.attributes.openFile, 'close')();
    }
  }
}
