import { registerDestructor } from '@ember/destroyable';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import { buildWaiter } from '@ember/test-waiters';
import { isTesting } from '@embroider/macros';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import { restartableTask, task } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';

import { Modal } from '@cardstack/boxel-ui/components';

import type { Query } from '@cardstack/runtime-common/query';

import CodeSubmode from '@cardstack/host/components/operator-mode/code-submode';
import InteractSubmode, {
  type Stack,
  type StackItem,
} from '@cardstack/host/components/operator-mode/interact-submode';

import {
  getLiveSearchResults,
  getSearchResults,
  type Search,
} from '@cardstack/host/resources/search';
import type RecentFilesService from '@cardstack/host/services/recent-files-service';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import { SearchSheetMode } from '../search-sheet';

import { Submode } from '../submode-switcher';

import type CardService from '../../services/card-service';

import type LoaderService from '../../services/loader-service';

import type MatrixService from '../../services/matrix-service';
import type OperatorModeStateService from '../../services/operator-mode-state-service';

const waiter = buildWaiter('operator-mode-container:write-waiter');

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

  private get stacks() {
    return this.operatorModeStateService.state?.stacks ?? [];
  }

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

  <template>
    <Modal
      class='operator-mode'
      @size='full-screen'
      @isOpen={{true}}
      @onClose={{@onClose}}
      @isOverlayDismissalDisabled={{true}}
      @boxelModalOverlayColor='var(--operator-mode-bg-color)'
    >
      {{#if this.isCodeMode}}
        <CodeSubmode
          @saveSourceOnClose={{perform this.saveSource}}
          @saveCardOnClose={{perform this.write}}
          @searchSheetTrigger={{this.searchSheetTrigger}}
          @searchSheetMode={{this.searchSheetMode}}
          @onFocusSearchInput={{this.onFocusSearchInput}}
          @onCancelSearchSheet={{this.onCancelSearchSheet}}
          @onBlurSearchInput={{this.onBlurSearchInput}}
          @onSearch={{this.onSearch}}
          @onCardSelectFromSearch={{this.onCardSelectFromSearch}}
        />
      {{else}}
        <InteractSubmode
          @write={{perform this.write}}
          @searchSheetTrigger={{this.searchSheetTrigger}}
          @searchSheetMode={{this.searchSheetMode}}
          @onFocusSearchInput={{this.onFocusSearchInput}}
          @onCancelSearchSheet={{this.onCancelSearchSheet}}
          @onBlurSearchInput={{this.onBlurSearchInput}}
          @onSearch={{this.onSearch}}
          @onCardSelectFromSearch={{this.onCardSelectFromSearch}}
        />
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
      :global(.operator-mode .boxel-modal__inner) {
        display: block;
      }
      .operator-mode {
        min-width: var(--operator-mode-min-width);
      }
      .operator-mode > div {
        align-items: flex-start;
      }
    </style>
  </template>
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    'OperatorMode::Container': typeof OperatorModeContainer;
  }
}
