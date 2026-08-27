import { action } from '@ember/object';
import Route from '@ember/routing/route';
import type RouterService from '@ember/routing/router-service';
import type Transition from '@ember/routing/transition';
import { service } from '@ember/service';
import { isTesting } from '@embroider/macros';

import window from 'ember-window-mock';
import stringify from 'safe-stable-stringify';

import {
  HOST_APP_QUERY_PARAMS,
  isRedirectRoutingRule,
} from '@cardstack/runtime-common';
import { isFileDefInstance } from '@cardstack/runtime-common/code-ref';

import { Submodes } from '@cardstack/host/components/submode-switcher';
import ENV from '@cardstack/host/config/environment';
import { resolvedRealmURLHref } from '@cardstack/host/lib/realm-utils';
import type { StackItemType } from '@cardstack/host/lib/stack-item';

import type BillingService from '@cardstack/host/services/billing-service';
import type CardService from '@cardstack/host/services/card-service';
import type HostModeService from '@cardstack/host/services/host-mode-service';
import type HostModeStateService from '@cardstack/host/services/host-mode-state-service';
import type MatrixService from '@cardstack/host/services/matrix-service';
import type NetworkService from '@cardstack/host/services/network';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type { SerializedState as OperatorModeSerializedState } from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type StoreService from '@cardstack/host/services/store';
import { consumeLoginTokenFromUrl } from '@cardstack/host/utils/login-token';

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
  @service declare private network: NetworkService;
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
  async model(
    params: {
      authRedirect?: string;
      cardPath?: string;
      path: string;
      operatorModeState: string;
    },
    transition: Transition,
  ) {
    if (this.hostModeService.isActive) {
      let normalizedPath = params.path ?? '';
      // CS-10055: a routing rule in the realm config can map a bare path
      // to a target card. When the path matches a serve rule, use the
      // rule's target id directly; otherwise resolve the path as a card
      // URL under the host-mode origin. A redirect rule is never
      // rendered — navigate to its target instead, mirroring the 3xx
      // the server answers for a full-page request to this path, query
      // string included (`params` holds only the pathname).
      let routed = this.hostModeService.resolveRoutedPath(
        normalizedPath || '/',
      );
      if (routed && isRedirectRoutingRule(routed)) {
        this.hostModeService.redirectTo(
          routed.redirectTo,
          this.forwardableQueryParams(transition),
        );
        return;
      }
      let cardUrl =
        routed?.id ??
        `${this.hostModeService.hostModeOrigin}/${normalizedPath}`;

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

    // A loginToken while already logged in means "switch accounts" (`boxel
    // browse --profile B` against a browser signed in as A). When logged out,
    // the <Login> component consumes the token instead, so only consume it here
    // when logged in. Strip the token from the URL first: logout() ends in a
    // router.transitionTo that re-enters this model hook, and the already-clean
    // URL makes that re-entry a no-op. A failure after logout leaves the user
    // logged out on the login form — acceptable, the token is single-use.
    if (this.matrixService.isLoggedIn) {
      let loginToken = consumeLoginTokenFromUrl();
      if (loginToken) {
        await this.matrixService.logout();
        let auth = await this.matrixService.loginWithSsoToken(loginToken);
        await this.matrixService.start({ auth, refreshRoutes: true });
        return;
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

  // Query params to carry onto a redirect rule's target, read from the
  // transition rather than `window.location.search` — with
  // HistoryLocation the location still points at the URL being navigated
  // away from while the transition is in flight.
  //
  // The app's own params are dropped, matching what serve-index forwards
  // on the equivalent HTTP redirect. On this side there is an extra
  // reason to: the router hydrates every declared param onto
  // `transition.to.queryParams` using its controller default whether or
  // not it was in the URL, so forwarding them blind would append values
  // that were never there (`debug=false` on every redirect). Foreign
  // params (`utm_source` and friends) pass through untouched.
  private forwardableQueryParams(
    transition: Transition,
  ): Record<string, unknown> {
    let queryParams = transition.to?.queryParams ?? {};
    return Object.fromEntries(
      Object.entries(queryParams).filter(
        ([key]) => !HOST_APP_QUERY_PARAMS.includes(key),
      ),
    );
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
      // The question here is which realm *serves* this card path, so the
      // comparison is against each realm's mounted URL path. A registered
      // prefix does not carry one: `@cardstack/base/` names two namespace
      // segments while the realm it maps to is mounted at `/base/`, so
      // comparing the prefix directly matches nothing. Resolve first, then
      // match — and the match doubles as the base below, which `new URL`
      // accepts only in URL form.
      let vn = this.network.virtualNetwork;
      let realmUrl = this.realmServer.availableRealmIdentifiers
        .map((identifier) => resolvedRealmURLHref(vn, identifier))
        .find((resolvedRealmUrl) => {
          let realmPathParts = new URL(resolvedRealmUrl).pathname
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
        });
      // The fallback is a realm identifier as well: `defaultReadableRealm.path`
      // is a key of `realm.realms`, which is keyed by whatever spelling created
      // each resource, or else the configured base realm URL. So it gets the
      // same resolution as the entries above rather than being assumed a URL.
      cardUrl = new URL(
        `/${cardPath}`,
        realmUrl ??
          resolvedRealmURLHref(vn, this.realm.defaultReadableRealm.path),
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
