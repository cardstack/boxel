import Route from '@ember/routing/route';
import { service } from '@ember/service';
import { file, FileResource } from '../resources/file';
import LocalRealm from '../services/local-realm';
import type RouterService from '@ember/routing/router-service';

const executableExtensions = ['.js', '.gjs', '.ts', '.gts'];

export default class Application extends Route<{
  path: string | undefined;
  openFile: FileResource | undefined;
}> {
  queryParams = {
    path: {
      refreshModel: true,
    },
  };

  @service declare localRealm: LocalRealm;
  @service declare router: RouterService;

  async model(args: { path: string | undefined }) {
    let { path } = args;
    await this.localRealm.startedUp;

    if (this.localRealm.isEmpty) {
      return { path: undefined, openFile: undefined };
    }

    if (!this.localRealm.isAvailable) {
      throw new Error(`unable to start local realm`);
    }

    let openFile: FileResource | undefined;
    if (path) {
      let attemptedPaths = path.split('/').pop()?.includes('.')
        ? [path]
        : [path, ...executableExtensions.map((e) => path + e)];
      for (let attemptedPath of attemptedPaths) {
        openFile = file(
          this,
          () => attemptedPath,
          () =>
            this.localRealm.isAvailable ? this.localRealm.fsHandle : undefined
        );
        await openFile.loading;
        if (openFile.state === 'ready') {
          if (path !== attemptedPath) {
            this.router.transitionTo({
              queryParams: { path: attemptedPath },
            });
          }
        }
      }
    }

    return { path, openFile };
  }
}
