import Route from '@ember/routing/route';
import type RouterService from '@ember/routing/router-service';
import Transition from '@ember/routing/transition';
import { service } from '@ember/service';

import stringify from 'safe-stable-stringify';

import { Submodes } from '@cardstack/host/components/submode-switcher';

import ENV from '@cardstack/host/config/environment';

import MatrixService from '@cardstack/host/services/matrix-service';
import OperatorModeStateService, {
  SerializedState as OperatorModeSerializedState,
} from '@cardstack/host/services/operator-mode-state-service';
import Realm from '@cardstack/host/services/realm';
import RealmInfoService from '@cardstack/host/services/realm-info-service';

import { CardDef } from 'https://cardstack.com/base/card-api';

import type CardService from '../services/card-service';

export type Model = CardDef | null;

export type ErrorModel = {
  message: string;
  loadType: 'index' | 'card' | 'stack';
  operatorModeState: string;
};

const { hostsOwnAssets } = ENV;

export default class RenderCard extends Route<Model | null> {
  @service declare cardService: CardService;
  @service declare router: RouterService;
  @service declare operatorModeStateService: OperatorModeStateService;
  @service declare matrixService: MatrixService;
  @service declare realm: Realm;
  @service declare realmInfoService: RealmInfoService;

  hasLoadMatrixBeenExecuted = false;

  async beforeModel(transition: Transition) {
    let path = transition.to?.params?.path;

    debugger;

    if (!path) {
      // This is to satisfy the type checker where to and params could be empty - but I don't know how this can happen - if it was routed here, it means it should have a path
      await this.router.replaceWith(`index`);
      return;
    }

    let cardUrl;

    if (transition.to?.queryParams?.card) {
      cardUrl = transition.to?.queryParams?.card;
    } else {
      if (hostsOwnAssets) {
        cardUrl = this.realm.defaultReadableRealm.path;
      } else {
        cardUrl = `${window.origin}/${path}`;
      }
    }

    await this.router.replaceWith(`index`, {
      queryParams: {
        operatorModeEnabled: 'true',
        operatorModeState: stringify({
          stacks: [
            [
              {
                id: cardUrl,
                format: 'isolated',
              },
            ],
          ],
          submode: Submodes.Interact,
        } as OperatorModeSerializedState),
      },
    });
  }
}
