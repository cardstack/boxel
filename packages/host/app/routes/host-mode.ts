import Route from '@ember/routing/route';
import RouterService from '@ember/routing/router-service';

import { service } from '@ember/service';
import { isTesting } from '@embroider/macros';

import { consume } from 'ember-provide-consume-context';
import stringify from 'safe-stable-stringify';

import {
  GetCardContextName,
  GetCardsContextName,
  GetCardCollectionContextName,
  RealmPaths,
  SupportedMimeType,
  type getCard,
  type getCards,
  type getCardCollection,
} from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';
import { type SerializedState as OperatorModeSerializedState } from '@cardstack/host/services/operator-mode-state-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import { Submodes } from '../components/submode-switcher';

import RealmServerService from '../services/realm-server';

import type BillingService from '../services/billing-service';
import type CardService from '../services/card-service';
import type MatrixService from '../services/matrix-service';
import type NetworkService from '../services/network';
import type RealmService from '../services/realm';
import type StoreService from '../services/store';

const { hostsOwnAssets } = ENV;

export default class HostMode extends Route<void> {
  @consume(GetCardContextName) declare private getCard: getCard;
  @consume(GetCardsContextName) declare private getCards: getCards;
  @consume(GetCardCollectionContextName)
  declare private getCardCollection: getCardCollection;

  @service declare private matrixService: MatrixService;
  @service declare private billingService: BillingService;
  @service declare private cardService: CardService;
  @service declare private network: NetworkService;
  @service declare private router: RouterService;
  @service declare private store: StoreService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare realm: RealmService;
  @service declare realmServer: RealmServerService;

  didMatrixServiceStart = false;

  async beforeModel() {
    return this.realmServer.availableRealmsAreReady;
  }

  async model(params: { realm: string; path: string }): Promise<void> {
    let { realm, path } = params;

    // FIXME this is a hack and won’t work in many circumstances
    let matchingRealm = this.realmServer.availableRealmsFIXME.find(
      (availableRealm) => availableRealm.url.endsWith(`/${realm}/`),
    );

    if (!matchingRealm) {
      throw new Error(`Realm not found: ${realm}`);
    }

    let cardURL = new RealmPaths(new URL(matchingRealm?.url)).fileURL(path);

    let gotten = await this.store.get(cardURL.href);

    return gotten;

    /*
    let cardUrl: string | undefined = cardPath
      ? await this.getCardUrl(cardPath)
      : undefined;
    let stacks: { id: string; format: string }[][] = [];
    if (cardUrl) {
      stacks = [
        [
          {
            id: cardUrl,
            format: 'isolated',
          },
        ],
      ];
    }
    let operatorModeStateObject = operatorModeState
      ? JSON.parse(operatorModeState)
      : undefined;
    if (
      !operatorModeStateObject ||
      (operatorModeStateObject.submode === Submodes.Interact &&
        operatorModeStateObject.stacks.length === 0 &&
        operatorModeStateObject.workspaceChooserOpened !== true)
    ) {
      this.router.transitionTo('index', {
        queryParams: {
          cardPath: undefined,
          operatorModeState: stringify({
            stacks,
            submode: Submodes.Interact,
            aiAssistantOpen: this.operatorModeStateService.aiAssistantOpen,
            workspaceChooserOpened: stacks.length === 0,
          } as OperatorModeSerializedState),
        },
      });
      return;
    } else {
      if (this.operatorModeStateService.serialize() === operatorModeState) {
        // If the operator mode state in the query param is the same as the one we have in memory,
        // we don't want to restore it again, because it will lead to rerendering of the stack items, which can
        // bring various annoyances, e.g reloading of the items in the index card.
        // We will reach this point when the user manipulates the stack and the operator state service will set the
        // query param, which will trigger a refresh of the model, which will call the model hook again.
        // The model refresh happens automatically because we have operatorModeState: { refreshModel: true } in the queryParams.
        // We have that because we want to support back-forward navigation in operator mode.
        return;
      }
      await this.operatorModeStateService.restore(
        operatorModeStateObject || { stacks: [] },
      );
    }
      */
  }

  private async getCardUrl(cardPath: string): Promise<string | undefined> {
    let cardUrl;
    if (hostsOwnAssets) {
      // availableRealmURLs is set in matrixService.start(), so we can use it here
      let realmUrl = this.realmServer.availableRealmURLs.find((realmUrl) => {
        console.log(realmUrl);
        let realmPathParts = new URL(realmUrl).pathname
          .split('/')
          .filter((part) => part !== '');
        let cardPathParts = cardPath!.split('/').filter((part) => part !== '');
        let isMatch = false;
        for (let i = 0; i < realmPathParts.length; i++) {
          if (realmPathParts[i] === cardPathParts[i]) {
            isMatch = true;
          } else {
            isMatch = false;
            break;
          }
        }
        return isMatch;
      });
      cardUrl = new URL(
        `/${cardPath}`,
        realmUrl ?? this.realm.defaultReadableRealm.path,
      ).href;
    } else {
      cardUrl = new URL(cardPath, window.location.origin).href;
    }

    // we only get a card to understand its canonical URL so it's ok to fetch
    // a card that is detached from the store as we only care about it's ID.
    let canonicalCardUrl: string | undefined;
    // the peek takes advantage of the store cache so this should be quick
    canonicalCardUrl = (await this.store.get(cardUrl))?.id;
    if (!canonicalCardUrl) {
      // TODO: show a 404 page
      // https://linear.app/cardstack/issue/CS-7364/show-user-a-clear-message-when-they-try-to-access-a-realm-they-cannot
      alert(`Card not found: ${cardUrl}`);
    }
    cardUrl = canonicalCardUrl;

    return cardUrl;
  }
}
