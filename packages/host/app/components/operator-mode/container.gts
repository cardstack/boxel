import { registerDestructor } from '@ember/destroyable';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import { buildWaiter } from '@ember/test-waiters';
import { isTesting } from '@embroider/macros';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import { restartableTask, task, dropTask } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';

import { IconButton, Modal } from '@cardstack/boxel-ui/components';

import { Deferred } from '@cardstack/runtime-common';

import { RealmPaths } from '@cardstack/runtime-common/paths';

import type { Query } from '@cardstack/runtime-common/query';

import CodeSubmode from '@cardstack/host/components/operator-mode/code-submode';
import InteractSubmode, {
  type Stack,
  type StackItem,
} from '@cardstack/host/components/operator-mode/interact-submode';

import ENV from '@cardstack/host/config/environment';

import {
  getLiveSearchResults,
  getSearchResults,
  type Search,
} from '@cardstack/host/resources/search';
import type RecentFilesService from '@cardstack/host/services/recent-files-service';

import { assertNever } from '@cardstack/host/utils/assert-never';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import CardCatalogModal from '../card-catalog/modal';

import ChatSidebar from '../matrix/chat-sidebar';
import SearchSheet, { SearchSheetMode } from '../search-sheet';

import SubmodeSwitcher, { Submode } from '../submode-switcher';

import DeleteModal from './delete-modal';

import type CardService from '../../services/card-service';

import type LoaderService from '../../services/loader-service';

import type MatrixService from '../../services/matrix-service';
import type OperatorModeStateService from '../../services/operator-mode-state-service';
import { Sparkle as SparkleIcon } from '@cardstack/boxel-ui/icons';

const waiter = buildWaiter('operator-mode-container:write-waiter');

const { APP } = ENV;

enum SearchSheetTrigger {
  DropCardToLeftNeighborStackButton = 'drop-card-to-left-neighbor-stack-button',
  DropCardToRightNeighborStackButton = 'drop-card-to-right-neighbor-stack-button',
}

interface Signature {
  Args: {
    onClose: () => void;
  };
}

export default class OperatorModeContainer extends Component<Signature> {
  @service private declare loaderService: LoaderService;
  @service private declare cardService: CardService;
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare matrixService: MatrixService;
  @service private declare recentFilesService: RecentFilesService;

  @tracked private searchSheetTrigger: SearchSheetTrigger | null = null;
  @tracked private searchSheetMode: SearchSheetMode = SearchSheetMode.Closed;

  @tracked private isChatVisible = false;

  private get stacks() {
    return this.operatorModeStateService.state?.stacks ?? [];
  }

  private deleteModal: DeleteModal | undefined;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    (globalThis as any)._CARDSTACK_CARD_SEARCH = this;
    this.constructRecentCards.perform();
    registerDestructor(this, () => {
      delete (globalThis as any)._CARDSTACK_CARD_SEARCH;
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
  getLiveCard<T extends object>(
    owner: T,
    url: URL,
    opts?: { cachedOnly?: true },
  ): Promise<CardDef | undefined> {
    return this.cardService.loadModel(owner, url, opts);
  }

  // public API
  @action
  trackLiveCard<T extends object>(owner: T, card: CardDef) {
    return this.cardService.trackLiveCard(owner, card);
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

  @action
  private toggleChat() {
    this.isChatVisible = !this.isChatVisible;
  }

  @action private onFocusSearchInput(searchSheetTrigger?: SearchSheetTrigger) {
    if (
      searchSheetTrigger ==
        SearchSheetTrigger.DropCardToLeftNeighborStackButton ||
      searchSheetTrigger ==
        SearchSheetTrigger.DropCardToRightNeighborStackButton
    ) {
      this.searchSheetTrigger = searchSheetTrigger;
    }

    if (this.searchSheetMode == SearchSheetMode.Closed) {
      this.searchSheetMode = SearchSheetMode.SearchPrompt;
    }

    if (this.operatorModeStateService.recentCards.length === 0) {
      this.constructRecentCards.perform();
    }
  }

  @action private onBlurSearchInput() {
    this.searchSheetTrigger = null;
    this.searchSheetMode = SearchSheetMode.Closed;
  }

  @action private onSearch(_term: string) {
    this.searchSheetMode = SearchSheetMode.SearchResults;
  }

  private constructRecentCards = restartableTask(async () => {
    return await this.operatorModeStateService.constructRecentCards();
  });

  @action private onCancelSearchSheet() {
    this.searchSheetMode = SearchSheetMode.Closed;
    this.searchSheetTrigger = null;
  }

  private saveSource = task(async (url: URL, content: string) => {
    await this.withTestWaiters(async () => {
      await this.cardService.saveSource(url, content);
    });
  });

  // TODO: push down into CodeSubmode component
  // dropTask will ignore any subsequent delete requests until the one in progress is done
  private delete = dropTask(async (card: CardDef, afterDelete?: () => void) => {
    if (!card.id) {
      // the card isn't actually saved yet, so do nothing
      return;
    }

    if (!this.deleteModal) {
      throw new Error(`bug: DeleteModal not instantiated`);
    }
    let deferred: Deferred<void>;
    let isDeleteConfirmed = await this.deleteModal.confirmDelete(
      card,
      (d) => (deferred = d),
    );
    if (!isDeleteConfirmed) {
      return;
    }

    await this.withTestWaiters(async () => {
      await this.operatorModeStateService.deleteCard(card);
      deferred!.fulfill();
    });

    if (afterDelete) {
      afterDelete();
    }
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

  private get allStackItems() {
    return this.operatorModeStateService.state?.stacks.flat() ?? [];
  }

  private get lastCardInRightMostStack(): CardDef | null {
    if (this.allStackItems.length <= 0) {
      return null;
    }

    return this.allStackItems[this.allStackItems.length - 1].card;
  }

  private get isCodeMode() {
    return this.operatorModeStateService.state?.submode === Submode.Code;
  }

  @action private onCardSelectFromSearch(card: CardDef) {
    if (this.isCodeMode) {
      let codePath = new URL(card.id + '.json');
      this.operatorModeStateService.updateCodePath(codePath);
      this.onCancelSearchSheet();
      return;
    }
    let searchSheetTrigger = this.searchSheetTrigger; // Will be set by onFocusSearchInput

    // In case the left button was clicked, whatever is currently in stack with index 0 will be moved to stack with index 1,
    // and the card will be added to stack with index 0. shiftStack executes this logic.
    if (
      searchSheetTrigger ===
      SearchSheetTrigger.DropCardToLeftNeighborStackButton
    ) {
      for (
        let stackIndex = this.stacks.length - 1;
        stackIndex >= 0;
        stackIndex--
      ) {
        this.operatorModeStateService.shiftStack(
          this.stacks[stackIndex],
          stackIndex + 1,
        );
      }

      let stackItem: StackItem = {
        card,
        format: 'isolated',
        stackIndex: 0,
      };
      this.operatorModeStateService.addItemToStack(stackItem);

      // In case the right button was clicked, the card will be added to stack with index 1.
    } else if (
      searchSheetTrigger ===
      SearchSheetTrigger.DropCardToRightNeighborStackButton
    ) {
      this.operatorModeStateService.addItemToStack({
        card,
        format: 'isolated',
        stackIndex: this.stacks.length,
      });
    } else {
      // In case, that the search was accessed directly without clicking right and left buttons,
      // the rightmost stack will be REPLACED by the selection
      let numberOfStacks = this.operatorModeStateService.numberOfStacks();
      let stackIndex = numberOfStacks - 1;
      let stack: Stack | undefined;

      if (
        numberOfStacks === 0 ||
        this.operatorModeStateService.stackIsEmpty(stackIndex)
      ) {
        this.operatorModeStateService.addItemToStack({
          format: 'isolated',
          stackIndex: 0,
          card,
        });
      } else {
        stack = this.operatorModeStateService.rightMostStack();
        if (stack) {
          let bottomMostItem = stack[0];
          if (bottomMostItem) {
            this.operatorModeStateService.clearStackAndAdd(stackIndex, {
              card,
              format: 'isolated',
              stackIndex,
            });
          }
        }
      }
    }

    // Close the search sheet
    this.onCancelSearchSheet();
  }

  private get chatVisibilityClass() {
    return this.isChatVisible ? 'chat-open' : 'chat-closed';
  }

  private setupDeleteModal = (deleteModal: DeleteModal) => {
    this.deleteModal = deleteModal;
  };

  @action private updateSubmode(submode: Submode) {
    switch (submode) {
      case Submode.Interact:
        this.operatorModeStateService.updateCodePath(null);
        break;
      case Submode.Code:
        let codePath = this.lastCardInRightMostStack
          ? new URL(this.lastCardInRightMostStack.id + '.json')
          : null;
        this.operatorModeStateService.updateCodePath(codePath);
        break;
      default:
        throw assertNever(submode);
    }

    this.operatorModeStateService.updateSubmode(submode);
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

      <div class='operator-mode__with-chat {{this.chatVisibilityClass}}'>
        <SubmodeSwitcher
          @submode={{this.operatorModeStateService.state.submode}}
          @onSubmodeSelect={{this.updateSubmode}}
          class='submode-switcher'
        />

        {{#if this.isCodeMode}}
          <CodeSubmode
            @delete={{perform this.delete}}
            @saveSourceOnClose={{perform this.saveSource}}
            @saveCardOnClose={{perform this.write}}
          />
        {{else}}
          <InteractSubmode
            @write={{perform this.write}}
            @searchSheetTrigger={{this.searchSheetTrigger}}
            @searchSheetMode={{this.searchSheetMode}}
            @onFocusSearchInput={{this.onFocusSearchInput}}
          />
        {{/if}}

        <DeleteModal @onCreate={{this.setupDeleteModal}} />
        {{! TODO: push down into CodeSubmode }}

        {{#if APP.experimentalAIEnabled}}
          {{#if this.isChatVisible}}
            <div class='container__chat-sidebar'>
              <ChatSidebar @onClose={{this.toggleChat}} />
            </div>
          {{else}}
            <IconButton
              data-test-open-chat
              class='chat-btn'
              @icon={{SparkleIcon}}
              @width='25'
              @height='25'
              {{on 'click' this.toggleChat}}
            />
          {{/if}}
        {{/if}}
      </div>

      <SearchSheet
        @mode={{this.searchSheetMode}}
        @onCancel={{this.onCancelSearchSheet}}
        @onFocus={{this.onFocusSearchInput}}
        @onBlur={{this.onBlurSearchInput}}
        @onSearch={{this.onSearch}}
        @onCardSelect={{this.onCardSelectFromSearch}}
      />
    </Modal>

    <style>
      :global(:root) {
        --operator-mode-bg-color: #686283;
        --boxel-modal-max-width: 100%;
        --container-button-size: var(--boxel-icon-lg);
        --operator-mode-min-width: 20.5rem;
        --operator-mode-left-column: 14rem;
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

      .operator-mode__with-chat {
        display: grid;
        grid-template-rows: 1fr;
        grid-template-columns: 1.5fr 0.5fr;
        gap: 0px;
        height: 100%;
      }

      .chat-open {
        grid-template-columns: 1.5fr 0.5fr;
      }

      .chat-closed {
        grid-template-columns: 1fr;
      }

      .chat-btn {
        --boxel-icon-button-width: var(--container-button-size);
        --boxel-icon-button-height: var(--container-button-size);
        --icon-color: var(--boxel-highlight-hover);

        position: absolute;
        bottom: var(--boxel-sp);
        right: var(--boxel-sp);
        margin-right: 0;
        padding: var(--boxel-sp-xxxs);
        border-radius: var(--boxel-border-radius);
        background-color: var(--boxel-dark);
        border: none;
        box-shadow: var(--boxel-deep-box-shadow);
        transition: background-color var(--boxel-transition);
        z-index: 1;
      }
      .chat-btn:hover {
        --icon-color: var(--boxel-dark);
        background-color: var(--boxel-highlight-hover);
      }

      .submode-switcher {
        position: absolute;
        top: 0;
        left: 0;
        z-index: 2;
        padding: var(--boxel-sp);
      }

      .container__chat-sidebar {
        height: 100vh;
        grid-column: 2;
        z-index: 1;
      }
    </style>
  </template>
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    'OperatorMode::Container': typeof OperatorModeContainer;
  }
}
