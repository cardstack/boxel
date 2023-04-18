import Route from '@ember/routing/route';
import type { ComponentLike } from '@glint/template';
import { service } from '@ember/service';
import ENV from '@cardstack/host/config/environment';
import { parse } from 'qs';
import type CardService from '../services/card-service';
import type RouterService from '@ember/routing/router-service';
import type LocalRealmService from '../services/local-realm';
import Component from '@glimmer/component';

const { ownRealmURL, isLocalRealm } = ENV;
const rootPath = new URL(ownRealmURL).pathname.replace(/^\//, '');

class LocalRealmNotConnectedComponent extends Component {
  <template>
    Local realm not connected.
  </template>
}

export default class RenderCard extends Route<
  ComponentLike<{ Args: {}; Blocks: {} }>
> {
  @service declare cardService: CardService;
  @service declare localRealm: LocalRealmService;
  @service declare router: RouterService;

  beforeModel(transition: any) {
    let queryParams = parse(
      new URL(transition.intent.url, 'http://anywhere').search,
      { ignoreQueryPrefix: true }
    );
    if ('schema' in queryParams) {
      let {
        params: { path },
      } = transition.routeInfos[transition.routeInfos.length - 1];
      path = path || '';
      path = path.slice(rootPath.length);
      let segments = path.split('/');
      segments.pop();
      let dir = segments.join('/');
      let openDirs = segments.length > 0 ? [`${dir}/`] : [];
      this.router.transitionTo('code', { queryParams: { path, openDirs } });
    }
  }

  async model(params: { path: string }) {
    let { path } = params;
    path = path || '';
    let url = path
      ? new URL(`/${path}`, ownRealmURL)
      : new URL('./', ownRealmURL);
    await this.localRealm.startedUp;
    try {
      let instance = await this.cardService.loadModel(url);
      return instance.constructor.getComponent(instance, 'isolated');
    } catch (e) {
      (e as any).failureLoadingIndexCard = url.href === ownRealmURL;
      if (isLocalRealm && !this.localRealm.isAvailable) {
        return LocalRealmNotConnectedComponent;
      }
      throw e;
    }
  }
}
