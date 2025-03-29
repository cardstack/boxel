import Route from '@ember/routing/route';
import RouterService from '@ember/routing/router-service';

import { service } from '@ember/service';
import { isTesting } from '@embroider/macros';

import stringify from 'safe-stable-stringify';

import ENV from '@cardstack/host/config/environment';
import { type SerializedState as OperatorModeSerializedState } from '@cardstack/host/services/operator-mode-state-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import { Submodes } from '../components/submode-switcher';

import type BillingService from '../services/billing-service';
import type CardService from '../services/card-service';
import type MatrixService from '../services/matrix-service';
import type RealmService from '../services/realm';
import type StoreService from '../services/store';

const { hostsOwnAssets } = ENV;

export default class Index extends Route<void> {
  queryParams = {
    operatorModeState: {
      refreshModel: true, // Enabled so that back-forward navigation works in operator mode
    },

    // `sid` and `clientSecret` come from email verification process to reset password
    sid: { refreshModel: true },
    clientSecret: { refreshModel: true },
  };

  @service declare private matrixService: MatrixService;
  @service declare private billingService: BillingService;
  @service declare private cardService: CardService;
  @service declare private router: RouterService;
  @service declare private store: StoreService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare realm: RealmService;

  didMatrixServiceStart = false;

  async model(params: {
    cardPath?: string;
    path: string;
    operatorModeState: string;
    workspaceChooserOpened?: boolean;
  }): Promise<void> {
    let { operatorModeState, cardPath, workspaceChooserOpened } = params;

    if (!this.didMatrixServiceStart) {
      await this.matrixService.ready;
      await this.matrixService.start();
      this.didMatrixServiceStart = true;
    }

    if (!this.matrixService.isLoggedIn) {
      return; // Show login component
    }

    if (!isTesting()) {
      // we don't want to fetch subscription data in integration tests
      // we need to fetch the subscription data right after login
      await this.billingService.fetchSubscriptionData();
    }

    let cardUrl: string | undefined;
    if (cardPath) {
      if (hostsOwnAssets) {
        cardUrl = new URL(`/${cardPath}`, this.realm.defaultReadableRealm.path)
          .href;
      } else {
        cardUrl = new URL(cardPath, window.location.origin).href;
      }

      // we only get a card to understand its canonical URL so it's ok to fetch
      // a card that is detached from the store as we only care about it's ID.
      let canonicalCardUrl: string | undefined;
      canonicalCardUrl = (await this.store.peek(cardUrl))?.id;
      if (!canonicalCardUrl) {
        // TODO: show a 404 page
        // https://linear.app/cardstack/issue/CS-7364/show-user-a-clear-message-when-they-try-to-access-a-realm-they-cannot
        alert(`Card not found: ${cardUrl}`);
      }
      cardUrl = canonicalCardUrl;
    }

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
        workspaceChooserOpened !== true)
    ) {
      this.router.transitionTo('index', {
        queryParams: {
          cardPath: undefined,
          workspaceChooserOpened: stacks.length === 0,
          operatorModeState: stringify({
            stacks,
            submode: Submodes.Interact,
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
  }
}
