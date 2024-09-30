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

import { getCard } from '../resources/card-resource';

import type CardService from '../services/card-service';

export type Model = CardDef | null;

export type ErrorModel = {
  message: string;
  loadType: 'index' | 'card' | 'stack';
  operatorModeState: string;
};

const { hostsOwnAssets } = ENV;

export default class Card extends Route<Model | null> {
  @service declare cardService: CardService;
  @service declare router: RouterService;
  @service declare operatorModeStateService: OperatorModeStateService;
  @service declare matrixService: MatrixService;
  @service declare realm: Realm;
  @service declare realmInfoService: RealmInfoService;

  async beforeModel(transition: Transition) {
    let path = transition.to?.params?.path;
    let cardUrl;

    if (!hostsOwnAssets) {
      let resource = getCard(this, () => `${window.origin}/${path}`);
      await resource.loaded;
      cardUrl = resource?.card?.id; // This is to make sure we put the canonical URL on the stack
    }

    const queryParams = cardUrl
      ? {
          operatorModeState: stringify({
            stacks: [[{ id: cardUrl, format: 'isolated' }]],
            submode: Submodes.Interact,
          } as OperatorModeSerializedState),
        }
      : { workspaceChooserOpened: true };

    await this.router.replaceWith('index', { queryParams });
  }
}
