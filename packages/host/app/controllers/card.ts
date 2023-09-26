import Controller from '@ember/controller';

import { registerDestructor } from '@ember/destroyable';
import { action } from '@ember/object';
import type RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { ComponentLike } from '@glint/template';
import stringify from 'safe-stable-stringify';

import type { Query } from '@cardstack/runtime-common/query';

import { Submode } from '@cardstack/host/components/submode-switcher';
import { Model } from '@cardstack/host/routes/card';

import type CardService from '@cardstack/host/services/card-service';

import OperatorModeStateService, {
  SerializedState as OperatorModeSerializedState,
} from '@cardstack/host/services/operator-mode-state-service';

import { withPreventDefault } from '../helpers/with-prevent-default';
import { getSearchResults, type Search } from '../resources/search';

export default class CardController extends Controller {
  queryParams = ['operatorModeState', 'operatorModeEnabled'];

  isolatedCardComponent: ComponentLike | undefined;
  withPreventDefault = withPreventDefault;

  @service declare cardService: CardService;
  @service declare router: RouterService;
  @service declare operatorModeStateService: OperatorModeStateService;

  @tracked operatorModeEnabled = false;
  @tracked model: Model | undefined;
  @tracked operatorModeState: string | null = null;

  constructor(args: any) {
    super(args);
    (globalThis as any)._CARDSTACK_CARD_SEARCH = this;
    registerDestructor(this, () => {
      delete (globalThis as any)._CARDSTACK_CARD_SEARCH;
    });
  }

  openPath(newPath: string | undefined) {
    if (newPath) {
      let fileUrl = new URL(this.cardService.defaultURL + newPath);
      this.operatorModeStateService.updateCodePath(fileUrl);
    }
  }

  getCards(query: Query, realms?: string[]): Search {
    return getSearchResults(
      this,
      () => query,
      realms ? () => realms : undefined,
    );
  }

  @action
  toggleOperatorMode() {
    this.operatorModeEnabled = !this.operatorModeEnabled;

    if (this.operatorModeEnabled) {
      // When entering operator mode, put the current card on the stack
      this.operatorModeState = stringify({
        stacks: [
          [
            {
              id: this.model?.id,
              format: 'isolated',
            },
          ],
        ],
        submode: Submode.Interact,
      } as OperatorModeSerializedState)!;
    } else {
      this.operatorModeState = null;
    }
  }

  @action
  closeOperatorMode() {
    this.operatorModeEnabled = false;
  }
}
