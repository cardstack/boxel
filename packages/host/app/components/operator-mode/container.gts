import { registerDestructor } from '@ember/destroyable';
import type Owner from '@ember/owner';
import { service } from '@ember/service';

import { buildWaiter } from '@ember/test-waiters';
import { isTesting } from '@embroider/macros';
import Component from '@glimmer/component';

import { task } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';

import FromElseWhere from 'ember-elsewhere/components/from-elsewhere';

import { provide } from 'ember-provide-consume-context';

import { or, not } from '@cardstack/boxel-ui/helpers';

import {
  CardContextName,
  GetCardContextName,
  GetCardsContextName,
  GetCardCollectionContextName,
  CommandContextName,
} from '@cardstack/runtime-common';

import Auth from '@cardstack/host/components/matrix/auth';

import CodeSubmode from '@cardstack/host/components/operator-mode/code-submode';
import HostSubmode from '@cardstack/host/components/operator-mode/host-submode';
import InteractSubmode from '@cardstack/host/components/operator-mode/interact-submode';
import { getCardCollection } from '@cardstack/host/resources/card-collection';
import { getCard } from '@cardstack/host/resources/card-resource';

import type MessageService from '@cardstack/host/services/message-service';

import type { CardContext } from 'https://cardstack.com/base/card-api';

import CardCatalogModal from '../card-catalog/modal';
import PrerenderedCardSearch from '../prerendered-card-search';
import { Submodes } from '../submode-switcher';

import ChooseFileModal from './choose-file-modal';

import type CardService from '../../services/card-service';
import type CommandService from '../../services/command-service';
import type MatrixService from '../../services/matrix-service';
import type OperatorModeStateService from '../../services/operator-mode-state-service';
import type RealmServerService from '../../services/realm-server';
import type StoreService from '../../services/store';
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
  @service private declare commandService: CommandService;
  @service private declare store: StoreService;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.messageService.register();

    registerDestructor(this, () => {
      this.operatorModeStateService.clearStacks();
    });
  }
  @provide(GetCardContextName)
  // @ts-ignore "getCard" is declared but not used
  private get getCard() {
    return getCard;
  }

  @provide(GetCardsContextName)
  // @ts-ignore "getCards" is declared but not used
  private get getCards() {
    return this.store.getSearchResource.bind(this.store);
  }

  @provide(GetCardCollectionContextName)
  // @ts-ignore "getCardCollection" is declared but not used
  private get getCardCollection() {
    return getCardCollection;
  }

  @provide(CommandContextName)
  private get commandContext() {
    return this.commandService.commandContext;
  }

  @provide(CardContextName)
  // @ts-ignore "context" is declared but not used
  private get context(): CardContext {
    return {
      getCard: this.getCard,
      getCards: this.getCards,
      getCardCollection: this.getCardCollection,
      store: this.store,
      commandContext: this.commandContext,
      prerenderedCardSearchComponent: PrerenderedCardSearch,
    };
  }

  private saveSource = task(async (url: URL, content: string) => {
    await this.withTestWaiters(async () => {
      await this.cardService.saveSource(url, content, 'editor');
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

  private get isHostMode() {
    return this.operatorModeStateService.state?.submode === Submodes.Host;
  }

  <template>
    <div class='operator-mode'>
      <ChooseFileModal />
      <CardCatalogModal />
      <FromElseWhere @name='modal-elsewhere' />

      {{#if
        (or
          (not this.matrixService.isLoggedIn)
          this.matrixService.isInitializingNewUser
        )
      }}
        <Auth />
      {{else if this.isCodeMode}}
        <CodeSubmode @saveSourceOnClose={{perform this.saveSource}} />
      {{else if this.isHostMode}}
        <HostSubmode />
      {{else}}
        <InteractSubmode />
      {{/if}}
    </div>

    <style scoped>
      :global(:root) {
        --boxel-sp-xxl: calc(var(--boxel-sp) * 2.5); /* 40px */
        --boxel-sp-lg: calc(var(--boxel-sp) * 1.25); /* 20px */
        --boxel-sp-xs: calc(var(--boxel-sp) * 0.625); /* 10px */
        --operator-mode-bg-color: #686283;
        --boxel-modal-max-width: 100%;
        --container-button-size: 2.5rem;
        --operator-mode-min-width: 20.5rem;
        --operator-mode-left-column: 21.5rem; /* 344px */
        --operator-mode-spacing: var(--boxel-sp-xs);
        --operator-mode-top-bar-item-height: var(--container-button-size);
        --operator-mode-bottom-bar-item-height: var(--container-button-size);
        --submode-new-file-button-width: 96px;
      }
      :global(button:focus:not(:disabled)) {
        outline-color: var(
          --boxel-header-text-color,
          var(--ring, var(--boxel-highlight))
        );
        outline-offset: var(--host-outline-offset, -2px);
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
        background: var(--operator-mode-bg-color);
        padding: 0;
        top: 0;
        left: 0;
        right: 0;
        min-width: var(--operator-mode-min-width);
        height: 100%;
        position: fixed;
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
