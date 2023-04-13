import Route from '@ember/routing/route';
import type { ComponentLike } from '@glint/template';
import { service } from '@ember/service';
import ENV from '@cardstack/host/config/environment';
import { parse } from 'qs';
import type CardService from '../services/card-service';
import type RouterService from '@ember/routing/router-service';

const { ownRealmURL } = ENV;
const rootPath = new URL(ownRealmURL).pathname.replace(/^\//, '');

export default class RenderCard extends Route<
  ComponentLike<{ Args: {}; Blocks: {} }>
> {
  @service declare cardService: CardService;
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
    let url = new URL(`/${path || ''}`, ownRealmURL);
    try {
      let instance = await this.cardService.loadModel(url);
      return instance.constructor.getComponent(instance, 'isolated');
    } catch (e) {
      (e as any).failureLoadingIndexCard = url.href === ownRealmURL;
      throw e;
    }
  }
}
