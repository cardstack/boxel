import { action } from '@ember/object';
import Route from '@ember/routing/route';
import type RouterService from '@ember/routing/router-service';
import type Transition from '@ember/routing/transition';
import { service } from '@ember/service';
import { isTesting } from '@embroider/macros';

import window from 'ember-window-mock';
import stringify from 'safe-stable-stringify';

import { isFileDefInstance } from '@cardstack/runtime-common/code-ref';

import { Submodes } from '@cardstack/host/components/submode-switcher';
import ENV from '@cardstack/host/config/environment';
import type { StackItemType } from '@cardstack/host/lib/stack-item';

import type BillingService from '@cardstack/host/services/billing-service';
import type CardService from '@cardstack/host/services/card-service';
import type HostModeService from '@cardstack/host/services/host-mode-service';
import type HostModeStateService from '@cardstack/host/services/host-mode-state-service';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type { SerializedState as OperatorModeSerializedState } from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type StoreService from '@cardstack/host/services/store';

const { hostsOwnAssets } = ENV;

export type ErrorModel = {
  message: string;
  loadType: 'index' | 'card' | 'stack';
  operatorModeState: string;
};

export default class Card extends Route {
  queryParams = {
    hostModeStack: {
      refreshModel: true,
    },
    operatorModeState: {
      refreshModel: true, // Enabled so that back-forward navigation works in operator mode
    },

    // `sid` and `clientSecret` come from email verification process to reset password
    sid: { refreshModel: true },
    clientSecret: { refreshModel: true },
  } as const;

  @service declare private billingService: BillingService;
  @service declare private cardService: CardService;
  @service declare private hostModeService: HostModeService;
  @service declare private hostModeStateService: HostModeStateService;
  @service declare private matrixService: MatrixService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private router: RouterService;
  @service declare private store: StoreService;
  @service declare realm: RealmService;
  @service declare realmServer: RealmServerService;

  didMatrixServiceStart = false;
  initialLoading = true;

  @action
  loading(transition: Transition) {
    transition.finally(() => {
      // The loading template will be shown only during the initial load of the app
      this.initialLoading = false;
    });

    return this.initialLoading && !this.hostModeService.isActive;
  }

  // WARNING! Make sure we are _very_ careful with our async in this model. This
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
      let normalizedPath = params.path ?? '';
      // CS-10055: a routing rule in the realm config can map a bare path
      // to a target card. When the path matches a rule, use the rule's
      // target id directly; otherwise resolve the path as a card URL
      // under the host-mode origin.
      let routedId = this.hostModeService.resolveRoutedPath(
        normalizedPath || '/',
      );
      let cardUrl =
        routedId ?? `${this.hostModeService.hostModeOrigin}/${normalizedPath}`;

      return this.store.get(cardUrl);
    }

    let { operatorModeState, cardPath } = params;

    if (!this.didMatrixServiceStart) {
      await this.matrixService.ready;
      await this.matrixService.start();
      this.didMatrixServiceStart = true;
    } else if (this.matrixService.needsPostLoginRecovery) {
      // `start()` above is a one-shot (guarded by `didMatrixServiceStart`). If
      // `postLoginCompleted` was cleared after that first start while there's
      // still persisted auth to boot from — a `resetState()` racing a
      // re-navigation — the guard alone would strand the app on the login form.
      // Re-run `start()` to re-establish the post-login session before falling
      // through.
      if (isTesting()) {
        console.warn(
          `[login-diag] index route recovering post-login session: ` +
            JSON.stringify(this.matrixService.loginReadinessDebug),
        );
      }
      await this.matrixService.start();
      if (isTesting() && !this.matrixService.isLoggedIn) {
        console.warn(
          `[login-diag] index route post-login recovery did not restore session: ` +
            JSON.stringify(this.matrixService.loginReadinessDebug),
        );
      }
    }

    if (!this.matrixService.isLoggedIn) {
      if (isTesting()) {
        console.warn(
          `[login-diag] index route rendering login form: didMatrixServiceStart=${this.didMatrixServiceStart} ` +
            JSON.stringify(this.matrixService.loginReadinessDebug),
        );
      }
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

    let pathOrCardPath = cardPath ?? params.path;

    let resolvedItem = pathOrCardPath
      ? await this.resolvePathToStackItem(pathOrCardPath)
      : undefined;
    let stacks: { id: string; format: string; type?: StackItemType }[][] = [];
    if (resolvedItem) {
      // Only carry `type` when the resolved instance is a file. The canonical
      // serializer (OperatorModeStateService.rawStateWithSavedCardsOnly)
      // omits `type` for cards, so emitting `type: 'card'` here would diverge
      // from the canonical string and trip the equality guard on every
      // subsequent model refresh.
      let stackItem: { id: string; format: string; type?: StackItemType } = {
        id: resolvedItem.id,
        format: 'isolated',
      };
      if (resolvedItem.type === 'file') {
        stackItem.type = 'file';
      }
      stacks = [[stackItem]];
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
      let routeName = params.path ? 'index' : 'index-root';
      let routeArgs = params.path ? [params.path] : [];

      this.router.transitionTo(routeName, ...routeArgs, {
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

  async afterModel(
    model: ReturnType<StoreService['get']>,
    transition: Transition,
  ) {
    await super.afterModel(model, transition);

    if (!this.hostModeService.isActive) {
      return;
    }

    let stackParam = transition.to?.queryParams?.hostModeStack as
      | string
      | undefined;
    let primaryCardId = (model && 'id' in model ? model.id : null) as
      | string
      | null;
    let routePath = (transition.to?.params?.path as string) ?? '';

    this.hostModeStateService.restore({
      primaryCardId,
      routePath,
      serializedStack: stackParam,
    });

    let stackItems = this.hostModeStateService.stackItems;
    let headCardId =
      stackItems.length > 0 ? stackItems[stackItems.length - 1] : primaryCardId;

    await this.hostModeService.updateHeadTemplate(headCardId);
  }

  private async resolvePathToStackItem(
    cardPath: string,
  ): Promise<{ id: string; type: StackItemType } | undefined> {
    let cardUrl;
    if (hostsOwnAssets) {
      // availableRealmIdentifiers is set in matrixService.start(), so we can use it here
      let realmUrl = this.realmServer.availableRealmIdentifiers.find(
        (realmUrl) => {
          let realmPathParts = new URL(realmUrl).pathname
            .split('/')
            .filter((part) => part !== '');
          let cardPathParts = cardPath!
            .split('/')
            .filter((part) => part !== '');
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
        },
      );
      cardUrl = new URL(
        `/${cardPath}`,
        realmUrl ?? this.realm.defaultReadableRealm.path,
      ).href;
    } else {
      cardUrl = new URL(cardPath, window.location.origin).href;
    }

    // we only get an instance to understand its canonical URL so it's ok to
    // fetch one that is detached from the store as we only care about its id.
    // For a URL pointing at a binary file (e.g. an image), the store's card
    // path auto-reroutes to a file-meta load and returns a FileDef — so the
    // resulting stack item lands on FileDef isolated rendering instead of
    // failing to hydrate the URL as a CardDef.
    let resolved = await this.store.get(cardUrl);
    let canonicalUrl = resolved?.id;
    if (!canonicalUrl) {
      // TODO: show a 404 page
      // https://linear.app/cardstack/issue/CS-7364/show-user-a-clear-message-when-they-try-to-access-a-realm-they-cannot
      alert(`Card not found: ${cardUrl}`);
      return undefined;
    }
    return {
      id: canonicalUrl,
      type: isFileDefInstance(resolved) ? 'file' : 'card',
    };
  }
}
