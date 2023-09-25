import { registerDestructor } from '@ember/destroyable';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import { htmlSafe } from '@ember/template';
import { buildWaiter } from '@ember/test-waiters';
import { isTesting } from '@embroider/macros';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import { restartableTask, task, dropTask } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import { trackedFunction } from 'ember-resources/util/function';

import get from 'lodash/get';

import { TrackedWeakMap, TrackedSet } from 'tracked-built-ins';

import { Modal, IconButton } from '@cardstack/boxel-ui';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';

import {
  Deferred,
  baseCardRef,
  chooseCard,
  type Actions,
  type CodeRef,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';

import { RealmPaths } from '@cardstack/runtime-common/paths';

import type { Query } from '@cardstack/runtime-common/query';

import CodeMode from '@cardstack/host/components/operator-mode/code-mode';
import ENV from '@cardstack/host/config/environment';

import {
  getSearchResults,
  type Search,
} from '@cardstack/host/resources/search';

import type RecentFilesService from '@cardstack/host/services/recent-files-service';

import { assertNever } from '@cardstack/host/utils/assert-never';

import { CardDef, Format } from 'https://cardstack.com/base/card-api';

import CardCatalogModal from '../card-catalog/modal';

import ChatSidebar from '../matrix/chat-sidebar';
import SearchSheet, { SearchSheetMode } from '../search-sheet';

import SubmodeSwitcher, { Submode } from '../submode-switcher';

import CopyButton from './copy-button';
import DeleteModal from './delete-modal';
import OperatorModeStack from './stack';

import type CardService from '../../services/card-service';

import type LoaderService from '../../services/loader-service';

import type MatrixService from '../../services/matrix-service';
import type MessageService from '../../services/message-service';
import type OperatorModeStateService from '../../services/operator-mode-state-service';

const waiter = buildWaiter('operator-mode-container:write-waiter');

const { APP } = ENV;

interface Signature {
  Args: {
    onClose: () => void;
  };
}

export type Stack = StackItem[];

export interface StackItem {
  format: Format;
  request?: Deferred<CardDef | undefined>;
  stackIndex: number;
  card: CardDef;
  isLinkedCard?: boolean; // TODO: consider renaming this so its clearer that we use this for being able to tell whether the card needs to be closed after saving
}

enum SearchSheetTrigger {
  DropCardToLeftNeighborStackButton = 'drop-card-to-left-neighbor-stack-button',
  DropCardToRightNeighborStackButton = 'drop-card-to-right-neighbor-stack-button',
}

const cardSelections = new TrackedWeakMap<StackItem, TrackedSet<CardDef>>();
const clearSelections = new WeakMap<StackItem, () => void>();
const stackItemStableScrolls = new WeakMap<
  StackItem,
  (changeSizeCallback: () => Promise<void>) => void
>();

export default class OperatorModeContainer extends Component<Signature> {
  @service declare loaderService: LoaderService;
  @service declare cardService: CardService;
  @service declare messageService: MessageService;
  @service declare operatorModeStateService: OperatorModeStateService;
  @service declare matrixService: MatrixService;
  @service declare recentFilesService: RecentFilesService;

  @tracked searchSheetMode: SearchSheetMode = SearchSheetMode.Closed;
  @tracked searchSheetTrigger: SearchSheetTrigger | null = null;
  @tracked isChatVisible = false;

  private deleteModal: DeleteModal | undefined;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);

    this.messageService.register();
    (globalThis as any)._CARDSTACK_CARD_SEARCH = this;
    this.constructRecentCards.perform();
    registerDestructor(this, () => {
      delete (globalThis as any)._CARDSTACK_CARD_SEARCH;
      this.operatorModeStateService.clearStacks();
    });
  }

  get stacks() {
    return this.operatorModeStateService.state?.stacks ?? [];
  }

  @action
  getCards(query: Query, realms?: string[]): Search {
    return getSearchResults(
      this,
      () => query,
      realms ? () => realms : undefined,
    );
  }

  @action
  toggleChat() {
    this.isChatVisible = !this.isChatVisible;
  }

  @action onFocusSearchInput(searchSheetTrigger?: SearchSheetTrigger) {
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

  @action onBlurSearchInput() {
    this.searchSheetTrigger = null;
    this.searchSheetMode = SearchSheetMode.Closed;
  }

  @action onSearch(_term: string) {
    this.searchSheetMode = SearchSheetMode.SearchResults;
  }

  constructRecentCards = restartableTask(async () => {
    return await this.operatorModeStateService.constructRecentCards();
  });

  @action
  onSelectedCards(selectedCards: CardDef[], stackItem: StackItem) {
    let selected = cardSelections.get(stackItem);
    if (!selected) {
      selected = new TrackedSet([]);
      cardSelections.set(stackItem, selected);
    }
    selected.clear();
    for (let card of selectedCards) {
      selected.add(card);
    }
  }

  get selectedCards() {
    return this.operatorModeStateService
      .topMostStackItems()
      .map((i) => [...(cardSelections.get(i) ?? [])]);
  }

  @action onCancelSearchSheet() {
    this.searchSheetMode = SearchSheetMode.Closed;
    this.searchSheetTrigger = null;
  }

  @action addToStack(item: StackItem) {
    this.operatorModeStateService.addItemToStack(item);
  }

  @action edit(item: StackItem) {
    this.updateItem(item, 'edit', new Deferred());
  }

  @action updateItem(
    item: StackItem,
    format: Format,
    request?: Deferred<CardDef | undefined>,
  ) {
    this.operatorModeStateService.replaceItemInStack(item, {
      ...item,
      request,
      format,
    });
  }

  close = task(async (item: StackItem) => {
    let { card, request } = item;
    // close the item first so user doesn't have to wait for the save to complete
    this.operatorModeStateService.trimItemsFromStack(item);

    // only save when closing a stack item in edit mode. there should be no unsaved
    // changes in isolated mode because they were saved when user toggled between
    // edit and isolated formats
    if (item.format === 'edit') {
      let updatedCard = await this.write.perform(card);
      request?.fulfill(updatedCard);
    }
  });

  save = task(async (item: StackItem, dismissStackItem: boolean) => {
    let { request } = item;
    let updatedCard = await this.write.perform(item.card);

    if (updatedCard) {
      request?.fulfill(updatedCard);
      if (!dismissStackItem) {
        // if this is a newly created card from auto-save then we
        // need to replace the stack item to account for the new card's ID
        if (!item.card.id && updatedCard.id) {
          this.operatorModeStateService.replaceItemInStack(item, {
            ...item,
            card: updatedCard,
          });
        }
        return;
      }

      if (item.isLinkedCard) {
        this.operatorModeStateService.trimItemsFromStack(item); // closes the 'create new card' editor for linked card fields
      } else {
        if (!item.card.id && updatedCard.id) {
          this.operatorModeStateService.trimItemsFromStack(item);
        } else {
          this.operatorModeStateService.replaceItemInStack(item, {
            ...item,
            card: updatedCard,
            request,
            format: 'isolated',
          });
        }
      }
    }
  });

  saveCard = task(async (card: CardDef) => {
    await this.withTestWaiters(async () => {
      await this.cardService.saveModel(card);
    });
  });

  saveSource = task(async (url: URL, content: string) => {
    await this.withTestWaiters(async () => {
      await this.cardService.saveSource(url, content);
    });
  });

  // dropTask will ignore any subsequent delete requests until the one in progress is done
  delete = dropTask(async (card: CardDef, afterDelete?: () => void) => {
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

    let items: StackItem[] = [];
    for (let stack of this.stacks) {
      items.push(
        ...(stack.filter((i) => i.card.id === card.id) as StackItem[]),
      );
      // remove all selections for the deleted card
      for (let item of stack) {
        let selections = cardSelections.get(item);
        if (!selections) {
          continue;
        }
        let removedCard = [...selections].find((c) => c.id === card.id);
        if (removedCard) {
          selections.delete(removedCard);
        }
      }
    }
    // remove all stack items for the deleted card
    for (let item of items) {
      this.operatorModeStateService.trimItemsFromStack(item);
    }
    this.operatorModeStateService.removeRecentCard(card.id);

    let cardRealmUrl = await this.cardService.getRealmURL(card);

    if (cardRealmUrl) {
      let realmPaths = new RealmPaths(cardRealmUrl);
      let cardPath = realmPaths.local(`${card.id}.json`);
      this.recentFilesService.removeRecentFile(cardPath);
    }

    await this.withTestWaiters(async () => {
      await this.cardService.deleteCard(card);
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
      return await this.cardService.saveModel(card);
    });
  });

  // dropTask will ignore any subsequent copy requests until the one in progress is done
  private copy = dropTask(
    async (
      sources: CardDef[],
      sourceItem: StackItem,
      destinationItem: StackItem,
    ) => {
      await this.withTestWaiters(async () => {
        let destinationRealmURL = await this.cardService.getRealmURL(
          destinationItem.card,
        );
        if (!destinationRealmURL) {
          throw new Error(
            `bug: could not determine realm URL for index card ${destinationItem.card.id}`,
          );
        }
        let realmURL = destinationRealmURL;
        for (let card of sources) {
          await this.cardService.copyCard(card, realmURL);
        }
        let clearSelection = clearSelections.get(sourceItem);
        if (typeof clearSelection === 'function') {
          clearSelection();
        }
        cardSelections.delete(sourceItem);
      });
    },
  );

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

  // The public API is wrapped in a closure so that whatever calls its methods
  // in the context of operator-mode, the methods can be aware of which stack to deal with (via stackIndex), i.e.
  // to which stack the cards will be added to, or from which stack the cards will be removed from.
  private publicAPI(here: OperatorModeContainer, stackIndex: number): Actions {
    return {
      createCard: async (
        ref: CodeRef,
        relativeTo: URL | undefined,
        opts?: {
          isLinkedCard?: boolean;
          doc?: LooseSingleCardDocument; // fill in card data with values
        },
      ): Promise<CardDef | undefined> => {
        // prefers optional doc to be passed in
        // use case: to populate default values in a create modal
        let doc: LooseSingleCardDocument = opts?.doc ?? {
          data: { meta: { adoptsFrom: ref } },
        };
        // using RealmPaths API to correct for the trailing `/`
        let realmPath = new RealmPaths(
          relativeTo ?? here.cardService.defaultURL,
        );
        let newCard = await here.cardService.createFromSerialized(
          doc.data,
          doc,
          new URL(realmPath.url),
        );
        let newItem: StackItem = {
          card: newCard,
          format: 'edit',
          request: new Deferred(),
          isLinkedCard: opts?.isLinkedCard,
          stackIndex,
        };
        here.addToStack(newItem);
        return await newItem.request?.promise;
      },
      viewCard: async (card: CardDef, format: Format = 'isolated') => {
        here.addToStack({
          card,
          format,
          stackIndex,
        });
      },
      createCardDirectly: async (
        doc: LooseSingleCardDocument,
        relativeTo: URL | undefined,
      ): Promise<void> => {
        let newCard = await here.cardService.createFromSerialized(
          doc.data,
          doc,
          relativeTo ?? here.cardService.defaultURL,
        );
        await here.cardService.saveModel(newCard);
        let newItem: StackItem = {
          card: newCard,
          format: 'isolated',
          stackIndex,
        };
        here.addToStack(newItem);
        return;
      },
      doWithStableScroll: async (
        card: CardDef,
        changeSizeCallback: () => Promise<void>,
      ): Promise<void> => {
        let stackItem: StackItem | undefined;
        for (let stack of here.stacks) {
          stackItem = stack.find((item) => item.card === card);
          if (stackItem) {
            let doWithStableScroll = stackItemStableScrolls.get(stackItem);
            if (doWithStableScroll) {
              doWithStableScroll(changeSizeCallback); // this is perform()ed in the component
              return;
            }
          }
        }
        await changeSizeCallback();
      },
    };
  }

  addCard = restartableTask(async () => {
    let type = baseCardRef;
    let chosenCard: CardDef | undefined = await chooseCard({
      filter: { type },
    });

    if (chosenCard) {
      let newItem: StackItem = {
        card: chosenCard,
        format: 'isolated',
        stackIndex: 0, // This is called when there are no cards in the stack left, so we can assume the stackIndex is 0
      };
      this.addToStack(newItem);
    }
  });

  fetchBackgroundImageURLs = trackedFunction(this, async () => {
    let result = await Promise.all(
      this.stacks.map(async (stack) => {
        if (stack.length === 0) {
          return;
        }
        let bottomMostCard = stack[0];
        return (await this.cardService.getRealmInfo(bottomMostCard.card))
          ?.backgroundURL;
      }),
    );
    return result;
  });

  get backgroundImageURLs() {
    return (
      this.fetchBackgroundImageURLs.value?.map((u) => (u ? u : undefined)) ?? []
    );
  }

  get backgroundImageStyle() {
    // only return a background image when both stacks originate from the same realm
    // otherwise we delegate to each stack to handle this
    if (
      this.backgroundImageURLs.length > 0 &&
      this.backgroundImageURLs.every(
        (u) => u != null && this.backgroundImageURLs[0] === u,
      )
    ) {
      return htmlSafe(`background-image: url(${this.backgroundImageURLs[0]});`);
    }
    return false;
  }

  get differingBackgroundImageURLs() {
    // if the this.backgroundImageStyle is undefined when there are images its because
    // they are different images--in that case we want to return these.
    if (this.backgroundImageURLs.length > 0 && !this.backgroundImageStyle) {
      return this.backgroundImageURLs;
    }
    return [];
  }

  get allStackItems() {
    return this.operatorModeStateService.state?.stacks.flat() ?? [];
  }

  get lastCardInRightMostStack(): CardDef | null {
    if (this.allStackItems.length <= 0) {
      return null;
    }

    return this.allStackItems[this.allStackItems.length - 1].card;
  }

  get isCodeMode() {
    return this.operatorModeStateService.state?.submode === Submode.Code;
  }

  @action onCardSelectFromSearch(card: CardDef) {
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

      if (numberOfStacks === 0) {
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

  // This determines whether we show the left and right button that trigger the search sheet whose card selection will go to the left or right stack
  // (there is a single stack with at least one card in it)
  get canCreateNeighborStack() {
    return this.allStackItems.length > 0 && this.stacks.length === 1;
  }

  get chatVisibilityClass() {
    return this.isChatVisible ? 'chat-open' : 'chat-closed';
  }

  setupStackItem = (
    item: StackItem,
    doClearSelections: () => void,
    doWithStableScroll: (changeSizeCallback: () => Promise<void>) => void,
  ) => {
    clearSelections.set(item, doClearSelections);
    stackItemStableScrolls.set(item, doWithStableScroll);
  };

  setupDeleteModal = (deleteModal: DeleteModal) => {
    this.deleteModal = deleteModal;
  };

  @action updateSubmode(submode: Submode) {
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
          <CodeMode
            @delete={{perform this.delete}}
            @saveSourceOnClose={{perform this.saveSource}}
            @saveCardOnClose={{perform this.saveCard}}
          />
        {{else}}
          <div class='operator-mode__main' style={{this.backgroundImageStyle}}>
            {{#if (eq this.allStackItems.length 0)}}
              <div class='no-cards'>
                <p class='add-card-title'>
                  Add a card to get started
                </p>

                <button
                  class='add-card-button'
                  {{on 'click' (fn (perform this.addCard))}}
                  data-test-add-card-button
                >
                  {{svgJar 'icon-plus' width='50px' height='50px'}}
                </button>
              </div>
            {{else}}
              {{#each this.stacks as |stack stackIndex|}}
                <OperatorModeStack
                  data-test-operator-mode-stack={{stackIndex}}
                  class='operator-mode-stack'
                  @stackItems={{stack}}
                  @backgroundImageURL={{get
                    this.differingBackgroundImageURLs
                    stackIndex
                  }}
                  @stackIndex={{stackIndex}}
                  @publicAPI={{this.publicAPI this stackIndex}}
                  @close={{perform this.close}}
                  @edit={{this.edit}}
                  @onSelectedCards={{this.onSelectedCards}}
                  @save={{perform this.save}}
                  @delete={{perform this.delete}}
                  @setupStackItem={{this.setupStackItem}}
                />
              {{/each}}

              <CopyButton
                @selectedCards={{this.selectedCards}}
                @copy={{fn (perform this.copy)}}
                @isCopying={{this.copy.isRunning}}
              />
            {{/if}}

            {{#if this.canCreateNeighborStack}}
              <button
                data-test-add-card-left-stack
                class='add-card-to-neighbor-stack add-card-to-neighbor-stack--left
                  {{if
                    (eq
                      this.searchSheetTrigger
                      SearchSheetTrigger.DropCardToLeftNeighborStackButton
                    )
                    "add-card-to-neighbor-stack--active"
                  }}'
                {{on
                  'click'
                  (fn
                    this.onFocusSearchInput
                    SearchSheetTrigger.DropCardToLeftNeighborStackButton
                  )
                }}
              >
                {{svgJar 'download' width='25' height='25'}}
              </button>
              <button
                data-test-add-card-right-stack
                class='add-card-to-neighbor-stack add-card-to-neighbor-stack--right
                  {{if
                    (eq
                      this.searchSheetTrigger
                      SearchSheetTrigger.DropCardToRightNeighborStackButton
                    )
                    "add-card-to-neighbor-stack--active"
                  }}'
                {{on
                  'click'
                  (fn
                    this.onFocusSearchInput
                    SearchSheetTrigger.DropCardToRightNeighborStackButton
                  )
                }}
              >
                {{svgJar 'download' width='25' height='25'}}
              </button>
            {{/if}}
          </div>
        {{/if}}

        <DeleteModal @onCreate={{this.setupDeleteModal}} />

        {{#if APP.experimentalAIEnabled}}
          {{#if this.isChatVisible}}
            <div class='container__chat-sidebar'>
              <ChatSidebar @onClose={{this.toggleChat}} />
            </div>
          {{else}}
            <IconButton
              data-test-open-chat
              class='chat-btn'
              @icon='sparkle'
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
      .no-cards {
        height: calc(100% -var(--search-sheet-closed-height));
        width: 100%;
        max-width: 50rem;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
      }
      .add-card-title {
        color: var(--boxel-light);
        font: var(--boxel-font-lg);
      }
      .add-card-button {
        --icon-color: var(--boxel-light);
        height: 350px;
        width: 200px;
        vertical-align: middle;
        background-color: var(--boxel-highlight);
        border: none;
        border-radius: var(--boxel-border-radius);
      }
      .add-card-button:hover {
        background-color: var(--boxel-highlight-hover);
      }
      .add-card-to-neighbor-stack {
        --icon-color: var(--boxel-highlight-hover);
        position: absolute;
        width: var(--container-button-size);
        height: var(--container-button-size);
        padding: 0;
        border-radius: 50%;
        background-color: var(--boxel-light-100);
        border-color: transparent;
        box-shadow: var(--boxel-deep-box-shadow);
      }
      .add-card-to-neighbor-stack:hover,
      .add-card-to-neighbor-stack--active {
        --icon-color: var(--boxel-highlight);
        background-color: var(--boxel-light);
      }
      .add-card-to-neighbor-stack--left {
        left: var(--boxel-sp);
      }
      .add-card-to-neighbor-stack--right {
        right: var(--boxel-sp);
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

      .operator-mode__main {
        display: flex;
        justify-content: center;
        align-items: center;
        position: relative;
        background-position: center;
        background-size: cover;
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
