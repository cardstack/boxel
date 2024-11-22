import { registerDestructor } from '@ember/destroyable';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';

import { buildWaiter } from '@ember/test-waiters';
import { isTesting } from '@embroider/macros';
import Component from '@glimmer/component';

import { task } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import { trackedFunction } from 'ember-resources/util/function';

import { Modal, LoadingIndicator } from '@cardstack/boxel-ui/components';

import { or, not } from '@cardstack/boxel-ui/helpers';

import type { Loader, Query } from '@cardstack/runtime-common';

import Auth from '@cardstack/host/components/matrix/auth';
import PaymentSetup from '@cardstack/host/components/matrix/payment-setup';
import CodeSubmode from '@cardstack/host/components/operator-mode/code-submode';
import InteractSubmode from '@cardstack/host/components/operator-mode/interact-submode';
import { getCard, trackCard } from '@cardstack/host/resources/card-resource';

import {
  getSearchResults,
  type Search,
} from '@cardstack/host/resources/search';

import MessageService from '@cardstack/host/services/message-service';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import CardCatalogModal from '../card-catalog/modal';
import { Submodes } from '../submode-switcher';

import type CardService from '../../services/card-service';
import type MatrixService from '../../services/matrix-service';
import type OperatorModeStateService from '../../services/operator-mode-state-service';
import type RealmServerService from '../../services/realm-server';

const waiter = buildWaiter('operator-mode-container:saveCard-waiter');

interface Signature {
  Args: {
    onClose: () => void;
  };
}

export default class OperatorModeContainer extends Component<Signature> {
  @service private declare cardService: CardService;
  @service declare matrixService: MatrixService;
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare messageService: MessageService;
  @service declare realmServer: RealmServerService;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    (globalThis as any)._CARDSTACK_CARD_SEARCH = this;

    this.messageService.register();

    registerDestructor(this, () => {
      delete (globalThis as any)._CARDSTACK_CARD_SEARCH;
      this.operatorModeStateService.clearStacks();
    });
  }

  // public API
  @action
  getCards(query: Query, realms?: string[]): Search {
    return getSearchResults(this, query, realms);
  }

  // public API
  @action
  getCard(url: URL, opts?: { loader?: Loader; isLive?: boolean }) {
    return getCard(this, () => url.href, {
      ...(opts?.isLive ? { isLive: () => opts.isLive! } : {}),
      ...(opts?.loader ? { loader: () => opts.loader! } : {}),
    });
  }

  // public API
  @action
  trackCard<T extends object>(owner: T, card: CardDef, realmURL: URL) {
    return trackCard(owner, card, realmURL);
  }

  private saveSource = task(async (url: URL, content: string) => {
    await this.withTestWaiters(async () => {
      await this.cardService.saveSource(url, content);
    });
  });

  // we debounce saves in the stack item--by the time they reach
  // this level we need to handle every request (so not restartable). otherwise
  // we might drop writes from different stack items that want to save
  // at the same time
  private saveCard = task(async (card: CardDef) => {
    return await this.withTestWaiters(async () => {
      return await this.cardService.saveModel(this, card);
    });
  });

  private async withTestWaiters<T>(cb: () => Promise<T>) {
    let token = waiter.beginAsync();
    try {
      let result = await cb();
      // only do this in test env--this makes sure that we also wait for any
      // interior card instance async as part of our ember-test-waiters
      if (isTesting()) {
        await this.cardService.cardsSettled();
      }
      return result;
    } finally {
      waiter.endAsync(token);
    }
  }

  private get isCodeMode() {
    return this.operatorModeStateService.state?.submode === Submodes.Code;
  }

  private fetchUserInfo = trackedFunction(this, async () => {
    if (isTesting()) {
      return;
    }
    if (!this.matrixService.isLoggedIn) {
      return;
    }
    return await this.realmServer.fetchUser();
  });

  private get isUserInfoLoading() {
    return this.fetchUserInfo.isLoading;
  }

  private get isUserSubscribed() {
    if (isTesting()) {
      return true;
    }
    if (this.isUserInfoLoading) {
      return false;
    }
    return (
      !!this.fetchUserInfo.value?.stripeCustomerId &&
      !!this.fetchUserInfo.value?.plan
    );
  }

  private get matrixUserId() {
    return this.matrixService.userId || '';
  }

  <template>
    <Modal
      class='operator-mode'
      @size='full-screen'
      @isOpen={{true}}
      @onClose={{@onClose}}
      @isOverlayDismissalDisabled={{true}}
      @boxelModalOverlayColor='var(--operator-mode-bg-color)'
    >
      <CardCatalogModal />
      {{#if
        (or
          (not this.matrixService.isLoggedIn)
          this.matrixService.isInitializingNewUser
        )
      }}
        <Auth />
      {{else if this.isUserInfoLoading}}
        <div class='loading-spinner-container'>
          <div class='loading-spinner'>
            <LoadingIndicator @color='var(--boxel-teal)' />
            <div class='loading-spinner-text'>Loading…</div>
          </div>
        </div>
      {{else if (not this.isUserSubscribed)}}
        <PaymentSetup
          @matrixUserId={{this.matrixUserId}}
          @flow={{if this.matrixService.isNewUser 'register' 'logged-in'}}
        />
      {{else if this.isCodeMode}}
        <CodeSubmode
          @saveSourceOnClose={{perform this.saveSource}}
          @saveCardOnClose={{perform this.saveCard}}
        />
      {{else}}
        <InteractSubmode @saveCard={{perform this.saveCard}} />
      {{/if}}
    </Modal>

    <style scoped>
      :global(:root) {
        --operator-mode-bg-color: #686283;
        --boxel-modal-max-width: 100%;
        --container-button-size: 2.5rem;
        --operator-mode-min-width: 20.5rem;
        --operator-mode-left-column: 15rem;
        --operator-mode-spacing: var(--boxel-sp-sm);
        --operator-mode-top-bar-item-height: var(--container-button-size);
        --operator-mode-bottom-bar-item-height: var(--container-button-size);
      }
      :global(button:focus:not(:disabled)) {
        outline-color: var(--boxel-header-text-color, var(--boxel-highlight));
        outline-offset: -2px;
      }
      :global(button:focus:not(:focus-visible)) {
        outline-color: transparent;
      }
      :global(dialog:focus) {
        outline: none;
      }
      :global(.operator-mode .boxel-modal__inner) {
        display: block;
      }
      :global(.input-container .invalid + .validation-icon-container) {
        display: none;
      }
      .operator-mode {
        min-width: var(--operator-mode-min-width);
      }
      .operator-mode > div {
        align-items: flex-start;
      }
      .payment-setup-container {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        min-height: 100%;
        padding: var(--boxel-sp-lg);
      }
      .loading-spinner-container {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100vh;
      }
      .loading-spinner {
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
      }
      .loading-spinner-text {
        color: var(--boxel-light);
        font-size: 12px;
        font-weight: 600;
      }
      .loading {
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        padding: var(--boxel-sp);
        color: var(--boxel-light);
        font: 500 var(--boxel-font);

        --icon-color: var(--boxel-light);
      }
      .loading__message {
        margin-left: var(--boxel-sp-5xs);
      }
      .loading :deep(.boxel-loading-indicator) {
        display: flex;
        justify: center;
        align-items: center;
      }
    </style>
  </template>
}
