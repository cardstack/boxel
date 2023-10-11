import Route from '@ember/routing/route';
import type RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';

import { parse } from 'qs';

import ENV from '@cardstack/host/config/environment';

import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import { CardDef } from 'https://cardstack.com/base/card-api';

import type CardService from '../services/card-service';

const { ownRealmURL } = ENV;
const rootPath = new URL(ownRealmURL).pathname.replace(/^\//, '');

export type Model = CardDef | null;

export default class RenderCard extends Route<Model | null> {
  queryParams = {
    operatorModeState: {
      refreshModel: true, // Enabled so that back-forward navigation works in operator mode
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
      { ignoreQueryPrefix: true },
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
      let model = await this.cardService.loadStaticModel(url);

      if (operatorModeEnabled) {
        let operatorModeStateObject = JSON.parse(operatorModeState);

        if (this.operatorModeStateService.serialize() === operatorModeState) {
          // If the operator mode state in the query param is the same as the one we have in memory,
          // we don't want to restore it again, because it will lead to rerendering of the stack items, which can
          // bring various annoyances, e.g reloading of the items in the index card.
          // We will reach this point when the user manipulates the stack and the operator state service will set the
          // query param, which will trigger a refresh of the model, which will call the model hook again.
          // The model refresh happens automatically because we have operatorModeState: { refreshModel: true } in the queryParams.
          // We have that because we want to support back-forward navigation in operator mode.
          return model;
        }
        await this.operatorModeStateService.restore(operatorModeStateObject);
      }

      return model;
    } catch (e) {
      (e as any).failureLoadingIndexCard = url.href === ownRealmURL;
      throw e;
    }
  }
}
