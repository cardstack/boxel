import Route from '@ember/routing/route';
import RouterService from '@ember/routing/router-service';
import Transition from '@ember/routing/transition';

import { service } from '@ember/service';
import { isTesting } from '@embroider/macros';

import window from 'ember-window-mock';

import stringify from 'safe-stable-stringify';

import ENV from '@cardstack/host/config/environment';

// import {
//   applyHostModeAfterModel,
//   fetchHostModeModel,
// } from '@cardstack/host/routes/utils/host-mode-route';
import type HostModeService from '@cardstack/host/services/host-mode-service';
import type HostModeStateService from '@cardstack/host/services/host-mode-state-service';
import { type SerializedState as OperatorModeSerializedState } from '@cardstack/host/services/operator-mode-state-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import { Submodes } from '../components/submode-switcher';

import RealmServerService from '../services/realm-server';

import type BillingService from '../services/billing-service';
import type CardService from '../services/card-service';
import type MatrixService from '../services/matrix-service';
import type RealmService from '../services/realm';
import type StoreService from '../services/store';

const { hostsOwnAssets } = ENV;

export default class Index extends Route {
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
  @service declare private hostModeService: HostModeService;
  @service declare private hostModeStateService: HostModeStateService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare realm: RealmService;
  @service declare realmServer: RealmServerService;

  didMatrixServiceStart = false;

  // WARNING! Mke sure we are _very_ careful with our async in this model. This
  // model hook is called _every_  time
  // OperatorModeStateService.schedulePersist() is called (due to the fact we
  // care about the back button, see note at bottom). Because of that make sure
  // that there is as little async as possible in this model hook.
  async model(params: {
    authRedirect?: string;
    cardPath?: string;
    path: string;
    operatorModeState: string;
  }) {
    if (this.hostModeService.isActive) {
      // return fetchHostModeModel(this.hostModeService, this.store, params.path);
    }

    let { operatorModeState, cardPath } = params;

    if (!this.didMatrixServiceStart) {
      await this.matrixService.ready;
      await this.matrixService.start();
      this.didMatrixServiceStart = true;
    }

    if (!this.matrixService.isLoggedIn) {
      return; // Show login component
    }

    if (params.authRedirect) {
      window.location.href = params.authRedirect;
      return;
    }

    if (!isTesting()) {
      // we don't want to fetch subscription data in integration tests
      // we need to fetch the subscription data right after login
      await this.billingService.initializeSubscriptionData();
    }
    // Do not need to wait for these to complete,
    // in the workspace chooser we'll retrigger login and wait for them to complete
    // and when fetching cards or files we have reauthentication mechanism.
    this.matrixService.loginToRealms();

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

      return;
    }
  }

  async afterModel(model: unknown, transition: Transition) {
    await super.afterModel(model, transition);

    let resolvedModel = (await Promise.resolve(model)) as
      | Awaited<ReturnType<StoreService['get']>>
      | undefined;

    // applyHostModeAfterModel({
    //   hostModeService: this.hostModeService,
    //   hostModeStateService: this.hostModeStateService,
    //   transition,
    //   model: resolvedModel,
    // });
  }

  private async getCardUrl(cardPath: string): Promise<string | undefined> {
    let cardUrl;
    if (hostsOwnAssets) {
      // availableRealmURLs is set in matrixService.start(), so we can use it here
      let realmUrl = this.realmServer.availableRealmURLs.find((realmUrl) => {
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
