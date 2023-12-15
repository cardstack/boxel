import { registerDestructor } from '@ember/destroyable';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import { buildWaiter } from '@ember/test-waiters';
import Component from '@glimmer/component';

import { all, task, timeout } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';

import { Modal, LoadingIndicator } from '@cardstack/boxel-ui/components';
import { and, not } from '@cardstack/boxel-ui/helpers';

import type { Loader, Query } from '@cardstack/runtime-common';

import Auth from '@cardstack/host/components/matrix/auth';
import CodeSubmode from '@cardstack/host/components/operator-mode/code-submode';
import InteractSubmode from '@cardstack/host/components/operator-mode/interact-submode';
import config from '@cardstack/host/config/environment';
import { getCard, trackCard } from '@cardstack/host/resources/card-resource';
import { isTesting } from '@embroider/macros';

import {
  getLiveSearchResults,
  getSearchResults,
  type Search,
} from '@cardstack/host/resources/search';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import CardCatalogModal from '../card-catalog/modal';
import { Submodes } from '../submode-switcher';

import type CardService from '../../services/card-service';
import type MatrixService from '../../services/matrix-service';
import type OperatorModeStateService from '../../services/operator-mode-state-service';

const waiter = buildWaiter('operator-mode-container:write-waiter');

const { loginMessageTimeoutMs } = config;

interface Signature {
  Args: {
    onClose: () => void;
  };
}

export default class OperatorModeContainer extends Component<Signature> {
  @service private declare cardService: CardService;
  @service declare matrixService: MatrixService;
  @service private declare operatorModeStateService: OperatorModeStateService;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);

    this.loadMatrix.perform();
    if (isTesting()) {
      (globalThis as any)._CARDSTACK_CARD_SEARCH = this;
      registerDestructor(this, () => {
        delete (globalThis as any)._CARDSTACK_CARD_SEARCH;
      });
    }

    registerDestructor(this, () => {
      this.operatorModeStateService.clearStacks();
    });
  }

  // public API
  @action
  getCards(query: Query, realms?: string[]): Search {
    return getSearchResults(
      this,
      () => query,
      realms ? () => realms : undefined,
    );
  }

  // public API
  @action
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

  // public API
  @action
  trackCard<T extends object>(owner: T, card: CardDef, realmURL: URL) {
    return trackCard(owner, card, realmURL);
  }

  // public API
  @action
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

  private saveSource = task(async (url: URL, content: string) => {
    await this.withTestWaiters(async () => {
      await this.cardService.saveSource(url, content);
    });
  });

  // we debounce saves in the stack item--by the time they reach
  // this level we need to handle every request (so not restartable). otherwise
  // we might drop writes from different stack items that want to save
  // at the same time
  private write = task(async (card: CardDef) => {
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

  private loadMatrix = task(async () => {
    await all([
      new Promise<void>(async (resolve) => {
        await this.matrixService.ready;
        await this.matrixService.start();
        resolve();
      }),
      timeout(loginMessageTimeoutMs),
    ]);
  });

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
      {{#if this.loadMatrix.isRunning}}
        <div class='loading'>
          <LoadingIndicator @color='var(--boxel-light)' />
          <span class='loading__message'>Initializing Operator Mode...</span>
        </div>
      {{else}}
        {{#if (and this.matrixService.isLoggedIn this.isCodeMode)}}
          <CodeSubmode
            @saveSourceOnClose={{perform this.saveSource}}
            @saveCardOnClose={{perform this.write}}
          />
        {{else if (and this.matrixService.isLoggedIn (not this.isCodeMode))}}
          <InteractSubmode @write={{perform this.write}} />
        {{else}}
          <Auth />
        {{/if}}
      {{/if}}
    </Modal>

    <style>
      :global(:root) {
        --operator-mode-bg-color: #686283;
        --boxel-modal-max-width: 100%;
        --container-button-size: var(--boxel-icon-lg);
        --operator-mode-min-width: 20.5rem;
        --operator-mode-left-column: 14rem;
      }
      :global(button:focus:not(:hover):not(:disabled)) {
        outline-color: var(--boxel-highlight);
      }
      :global(dialog:focus) {
        outline: none;
      }
      :global(.operator-mode .boxel-modal__inner) {
        display: block;
      }
      .operator-mode {
        min-width: var(--operator-mode-min-width);
      }
      .operator-mode > div {
        align-items: flex-start;
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
