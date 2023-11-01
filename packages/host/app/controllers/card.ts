import Controller from '@ember/controller';

import { registerDestructor } from '@ember/destroyable';
import { action } from '@ember/object';
import type RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { ComponentLike } from '@glint/template';
import stringify from 'safe-stable-stringify';

import type { Loader } from '@cardstack/runtime-common';
import type { Query } from '@cardstack/runtime-common/query';

import { Submode } from '@cardstack/host/components/submode-switcher';
import { getCard, trackCard } from '@cardstack/host/resources/card-resource';
import { Model } from '@cardstack/host/routes/card';

import type CardService from '@cardstack/host/services/card-service';

import MessageService from '@cardstack/host/services/message-service';

import OperatorModeStateService, {
  SerializedState as OperatorModeSerializedState,
} from '@cardstack/host/services/operator-mode-state-service';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import { withPreventDefault } from '../helpers/with-prevent-default';
import {
  getLiveSearchResults,
  getSearchResults,
  type Search,
} from '../resources/search';

export default class CardController extends Controller {
  queryParams = ['operatorModeState', 'operatorModeEnabled'];

  isolatedCardComponent: ComponentLike | undefined;
  withPreventDefault = withPreventDefault;

  @service declare cardService: CardService;
  @service declare router: RouterService;
  @service declare operatorModeStateService: OperatorModeStateService;
  @service declare messageService: MessageService;

  @tracked operatorModeEnabled = false;
  @tracked model: Model | undefined;
  @tracked operatorModeState: string | null = null;

  constructor(args: any) {
    super(args);
    (globalThis as any)._CARDSTACK_CARD_SEARCH = this;

    // this allows the guest mode cards-grid to use a live query. I'm not sure
    // if that is a requirement or not. we can remove this if it is not.
    this.messageService.register();

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

  getCard(
    url: URL,
    opts?: { cachedOnly?: true; loader?: Loader; isLive?: boolean },
  ) {
    return getCard(this, () => url.href, {
      ...(opts?.isLive ? { isLive: () => opts.isLive! } : {}),
      ...(opts?.cachedOnly ? { cachedOnly: () => opts.cachedOnly! } : {}),
      ...(opts?.loader ? { loader: () => opts.loader! } : {}),
    });
  }

  trackCard<T extends object>(owner: T, card: CardDef, realmURL: URL) {
    return trackCard(owner, card, realmURL);
  }

  getLiveCards(
    query: Query,
    realms?: string[],
    doWhileRefreshing?: (ready: Promise<void> | undefined) => Promise<void>,
  ): Search {
    return getLiveSearchResults(
      this,
      () => query,
      realms ? () => realms : undefined,
      doWhileRefreshing ? () => doWhileRefreshing : undefined,
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
