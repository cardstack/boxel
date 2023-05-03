import Route from '@ember/routing/route';
import { service } from '@ember/service';
import ENV from '@cardstack/host/config/environment';
import { parse } from 'qs';
import type CardService from '../services/card-service';
import type RouterService from '@ember/routing/router-service';
import type LocalRealmService from '../services/local-realm';
import { Card } from 'https://cardstack.com/base/card-api';

const { ownRealmURL, isLocalRealm } = ENV;
const rootPath = new URL(ownRealmURL).pathname.replace(/^\//, '');

export interface Model {
  card: Card;
}

export default class RenderCard extends Route<Model | null> {
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

  async model(params: { path: string }): Promise<Model | null> {
    let { path } = params;
    path = path || '';
    let url = path
      ? new URL(`/${path}`, ownRealmURL)
      : new URL('./', ownRealmURL);

    if (isLocalRealm) {
      await this.localRealm.startedUp;

      if (this.localRealm.isEmpty) {
        return null;
      }

      if (this.localRealm.isAvailable) {
        // Readiness means indexing in the local realm is complete. We want to wait for that so that we can fetch the card from the index.
        await this.localRealm.waitForReadiness();
      }
    }

    try {
      let card = await this.cardService.loadModel(url);
      return { card };
    } catch (e) {
      (e as any).failureLoadingIndexCard = url.href === ownRealmURL;
      throw e;
    }
  }
}
