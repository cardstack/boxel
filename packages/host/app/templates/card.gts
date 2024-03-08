import { registerDestructor } from '@ember/destroyable';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import type RouterService from '@ember/routing/router-service';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { ComponentLike } from '@glint/template';

import { restartableTask } from 'ember-concurrency';
// @ts-expect-error no types
import { keyResponder, onKey } from 'ember-keyboard';

import { trackedFunction } from 'ember-resources/util/function';
import RouteTemplate from 'ember-route-template';
import stringify from 'safe-stable-stringify';

import { and, bool } from '@cardstack/boxel-ui/helpers';

import type { Loader } from '@cardstack/runtime-common';
import type { Query } from '@cardstack/runtime-common/query';

import OperatorModeContainer from '@cardstack/host/components/operator-mode/container';

import Preview from '@cardstack/host/components/preview';
import { Submodes } from '@cardstack/host/components/submode-switcher';
import ENV from '@cardstack/host/config/environment';

import CardController from '@cardstack/host/controllers/card';

import { getCard, trackCard } from '@cardstack/host/resources/card-resource';

import type { Model as CardModel } from '@cardstack/host/routes/card';
import type CardService from '@cardstack/host/services/card-service';

import MessageService from '@cardstack/host/services/message-service';

import OperatorModeStateService, {
  SerializedState as OperatorModeSerializedState,
} from '@cardstack/host/services/operator-mode-state-service';
import RealmInfoService from '@cardstack/host/services/realm-info-service';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import { withPreventDefault } from '../helpers/with-prevent-default';
import {
  getLiveSearchResults,
  getSearchResults,
  type Search,
} from '../resources/search';

interface CardRouteSignature {
  Args: {
    controller: CardController;
    model: CardModel;
  };
}
const { ownRealmURL } = ENV;
@keyResponder
class CardRouteComponent extends Component<CardRouteSignature> {
  isolatedCardComponent: ComponentLike | undefined;
  withPreventDefault = withPreventDefault;

  @service declare cardService: CardService;
  @service declare router: RouterService;
  @service declare operatorModeStateService: OperatorModeStateService;
  @service declare messageService: MessageService;
  @service declare realmInfoService: RealmInfoService;

  constructor(owner: Owner, args: CardRouteSignature['Args']) {
    super(owner, args);
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

  @onKey('Ctrl+.')
  // Ctrl+. doesn't work in ubuntu
  @onKey('Ctrl+,')
  @action
  toggleOperatorMode() {
    this.toggleOperatorModeTask.perform();
  }

  toggleOperatorModeTask = restartableTask(async () => {
    // Users are not allowed to open guest mode
    // if realm is not publicly readable
    let isPublicReadableRealm = await this.realmInfoService.isPublicReadable(
      new URL(ownRealmURL),
    );
    if (!isPublicReadableRealm && this.args.controller.operatorModeEnabled) {
      return;
    }

    this.args.controller.operatorModeEnabled =
      !this.args.controller.operatorModeEnabled;

    if (this.args.controller.operatorModeEnabled) {
      // When entering operator mode, put the current card on the stack
      this.args.controller.operatorModeState = stringify({
        stacks: [
          this.args.model
            ? [
                {
                  id: this.args.model.id,
                  format: 'isolated',
                },
              ]
            : [],
        ],
        submode: Submodes.Interact,
      } as OperatorModeSerializedState)!;
    } else {
      this.args.controller.operatorModeState = null;
    }
  });

  @action
  closeOperatorMode() {
    this.args.controller.operatorModeEnabled = false;
  }

  get isPublicReadableRealm() {
    return this.fetchIsPublicReadableStatus.value ?? false;
  }

  private fetchIsPublicReadableStatus = trackedFunction(
    this,
    async () =>
      await this.realmInfoService.isPublicReadable(new URL(ownRealmURL)),
  );

  <template>
    <div class='card-isolated-component'>
      {{#if (and (bool @model) this.isPublicReadableRealm)}}
        {{! @glint-ignore model should not be null}}
        <Preview @card={{@model}} @format='isolated' />
      {{else}}
        <div>ERROR: cannot load card</div>
      {{/if}}
    </div>

    {{#if @controller.operatorModeEnabled}}
      <OperatorModeContainer @onClose={{this.closeOperatorMode}} />
    {{/if}}

    {{outlet}}

    {{! template-lint-disable no-inline-styles }}
    {{! hidden button to toggle operator mode for tests }}
    <button
      data-test-operator-mode-btn
      style='position: fixed; left: -100px; opacity: 0;'
      {{on 'click' this.toggleOperatorMode}}
    >Operator mode</button>
    <style>
      .card-isolated-component {
        padding: var(--boxel-sp-lg);
      }
    </style>
  </template>
}

export default RouteTemplate(CardRouteComponent);
