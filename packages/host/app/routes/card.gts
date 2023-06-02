import Route from '@ember/routing/route';
import { service } from '@ember/service';
import ENV from '@cardstack/host/config/environment';
import { parse } from 'qs';
import type CardService from '../services/card-service';
import type RouterService from '@ember/routing/router-service';
import { Card } from 'https://cardstack.com/base/card-api';
import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

const { ownRealmURL } = ENV;
const rootPath = new URL(ownRealmURL).pathname.replace(/^\//, '');

export type Model = Card | null;

export default class RenderCard extends Route<Model | null> {
  queryParams = {
    operatorModeState: {
      refreshModel: true,
    },
    operatorModeEnabled: {
      refreshModel: true,
    },
  };

  @service declare cardService: CardService;
  @service declare router: RouterService;
  @service declare operatorModeStateService: OperatorModeStateService;

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

  async model(params: {
    path: string;
    operatorModeState: string;
    operatorModeEnabled: boolean;
  }): Promise<Model> {
    let { path, operatorModeState, operatorModeEnabled } = params;
    path = path || '';
    let url = path
      ? new URL(`/${path}`, ownRealmURL)
      : new URL('./', ownRealmURL);

    try {
      let model = await this.cardService.loadModel(url);

      if (operatorModeEnabled) {
        let operatorModeStateObject = JSON.parse(operatorModeState);

        await this.operatorModeStateService.restore(operatorModeStateObject);
      }

      return model;
    } catch (e) {
      (e as any).failureLoadingIndexCard = url.href === ownRealmURL;
      throw e;
    }
  }
}
