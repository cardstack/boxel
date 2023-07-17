import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { Card, Format } from 'https://cardstack.com/base/card-api';
import { action } from '@ember/object';
import { fn } from '@ember/helper';
import { trackedFunction } from 'ember-resources/util/function';
import CardCatalogModal from '@cardstack/host/components/card-catalog-modal';
import type CardService from '@cardstack/host/services/card-service';

import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';
import { Modal, IconButton } from '@cardstack/boxel-ui';
import cssVar from '@cardstack/boxel-ui/helpers/css-var';
import SearchSheet, {
  SearchSheetMode,
} from '@cardstack/host/components/search-sheet';
import { restartableTask } from 'ember-concurrency';
import {
  Deferred,
  baseCardRef,
  chooseCard,
  type Actions,
  type CardRef,
  LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import type LoaderService from '@cardstack/host/services/loader-service';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { registerDestructor } from '@ember/destroyable';
import type { Query } from '@cardstack/runtime-common/query';
import {
  getSearchResults,
  type Search,
} from '@cardstack/host/resources/search';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';
import perform from 'ember-concurrency/helpers/perform';
import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import OperatorModeStack from '@cardstack/host/components/operator-mode/stack';
import type MatrixService from '../../services/matrix-service';
import ChatSidebar from '../matrix/chat-sidebar';

interface Signature {
  Args: {
    onClose: () => void;
  };
}

export type OperatorModeState = {
  stacks: Stack[];
};

export type Stack = {
  items: StackItem[];
};

export type StackItem = {
  card: Card;
  format: Format;
  request?: Deferred<Card>;
  isLinkedCard?: boolean;
  stackIndex: number;
};

enum SearchSheetTrigger {
  DropCardToLeftNeighborStackButton = 'drop-card-to-left-neighbor-stack-button',
  DropCardToRightNeighborStackButton = 'drop-card-to-right-neighbor-stack-button',
}

export default class OperatorModeContainer extends Component<Signature> {
  // In this map we store the field values of cards that are being edited so that we can restore them if the user cancels the edit
  cardFieldValues: WeakMap<Card, Map<string, any>> = new WeakMap<
    Card,
    Map<string, any>
  >();
  @service declare loaderService: LoaderService;
  @service declare cardService: CardService;
  @service declare operatorModeStateService: OperatorModeStateService;
  @service declare matrixService: MatrixService;
  @tracked searchSheetMode: SearchSheetMode = SearchSheetMode.Closed;
  @tracked searchSheetTrigger: SearchSheetTrigger | null = null;
  @tracked isChatVisible = false;

  constructor(owner: unknown, args: any) {
    super(owner, args);

    (globalThis as any)._CARDSTACK_CARD_SEARCH = this;
    registerDestructor(this, () => {
      delete (globalThis as any)._CARDSTACK_CARD_SEARCH;
      this.operatorModeStateService.clearStacks();
    });
  }

  get stacks() {
    return this.operatorModeStateService.state?.stacks ?? [];
  }

  @action
  getCards(query: Query): Search {
    return getSearchResults(this, () => query);
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

  constructRecentCards = restartableTask(async () => {
    return await this.operatorModeStateService.constructRecentCards();
  });

  @action onCancelSearchSheet() {
    this.searchSheetMode = SearchSheetMode.Closed;
    this.searchSheetTrigger = null;
  }

  @action addToStack(item: StackItem) {
    this.operatorModeStateService.addItemToStack(item);
  }

  @action async edit(item: StackItem) {
    await this.saveCardFieldValues(item.card);
    this.updateItem(item, 'edit', new Deferred());
  }

  @action updateItem(
    item: StackItem,
    format: Format,
    request?: Deferred<Card>
  ) {
    let newItem = {
      card: item.card,
      format,
      request,
      stackIndex: item.stackIndex,
    };

    this.replaceItemInStack(item, newItem);

    return newItem;
  }

  @action async close(item: StackItem) {
    await this.rollbackCardFieldValues(item.card);

    this.operatorModeStateService.removeItemFromStack(item);
  }

  @action async cancel(item: StackItem) {
    await this.rollbackCardFieldValues(item.card);
    this.updateItem(item, 'isolated');
  }

  @action async save(item: StackItem) {
    let { card, request, isLinkedCard } = item;
    await this.saveCardFieldValues(card);
    let updatedCard = await this.write.perform(card);

    if (updatedCard) {
      request?.fulfill(updatedCard);

      if (isLinkedCard) {
        this.close(item); // closes the 'create new card' editor for linked card fields
      } else {
        this.replaceItemInStack(item, {
          card: updatedCard,
          format: 'isolated',
          stackIndex: item.stackIndex,
        });
      }
    }
  }

  // TODO: Implement remove card function
  @action async delete(item: StackItem) {
    await this.close(item);
  }

  replaceItemInStack(item: StackItem, newItem: StackItem) {
    this.operatorModeStateService.replaceItemInStack(item, newItem);
  }

  private write = restartableTask(async (card: Card) => {
    return await this.cardService.saveModel(card);
  });

  private async saveCardFieldValues(card: Card) {
    let fields = await this.cardService.getFields(card);
    for (let fieldName of Object.keys(fields)) {
      if (fieldName === 'id') continue;

      let field = fields[fieldName];
      if (
        (field.fieldType === 'contains' ||
          field.fieldType === 'containsMany') &&
        !(await this.cardService.isPrimitive(field.card))
      ) {
        await this.saveCardFieldValues((card as any)[fieldName]);
      }

      let cardFieldValue = this.cardFieldValues.get(card);
      if (!cardFieldValue) {
        cardFieldValue = new Map<string, any>();
      }
      cardFieldValue.set(fieldName, (card as any)[fieldName]);
      this.cardFieldValues.set(card, cardFieldValue);
    }
  }

  // The public API is wrapped in a closure so that whatever calls its methods
  // in the context of operator-mode, the methods can be aware of which stack to deal with (via stackIndex), i.e.
  // to which stack the cards will be added to, or from which stack the cards will be removed from.
  private publicAPI(here: OperatorModeContainer, stackIndex: number): Actions {
    return {
      createCard: async (
        ref: CardRef,
        relativeTo: URL | undefined,
        opts?: {
          isLinkedCard?: boolean;
          doc?: LooseSingleCardDocument; // fill in card data with values
        }
      ): Promise<Card | undefined> => {
        // prefers optional doc to be passed in
        // use case: to populate default values in a create modal
        let doc: LooseSingleCardDocument = opts?.doc ?? {
          data: { meta: { adoptsFrom: ref } },
        };
        let newCard = await here.cardService.createFromSerialized(
          doc.data,
          doc,
          relativeTo ?? here.cardService.defaultURL
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
      viewCard: (card: Card) => {
        return here.addToStack({ card, format: 'isolated', stackIndex });
      },
      createCardDirectly: async (
        doc: LooseSingleCardDocument,
        relativeTo: URL | undefined
      ): Promise<void> => {
        let newCard = await here.cardService.createFromSerialized(
          doc.data,
          doc,
          relativeTo ?? here.cardService.defaultURL
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
    };
  }

  private async rollbackCardFieldValues(card: Card) {
    let fields = await this.cardService.getFields(card);
    for (let fieldName of Object.keys(fields)) {
      if (fieldName === 'id') continue;

      let field = fields[fieldName];
      if (
        (field.fieldType === 'contains' ||
          field.fieldType === 'containsMany') &&
        !(await this.cardService.isPrimitive(field.card))
      ) {
        await this.rollbackCardFieldValues((card as any)[fieldName]);
      }

      let cardFieldValue = this.cardFieldValues.get(card);
      if (cardFieldValue) {
        (card as any)[fieldName] = cardFieldValue.get(fieldName);
      }
    }
  }

  addCard = restartableTask(async () => {
    let type = baseCardRef;
    let chosenCard: Card | undefined = await chooseCard({
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

  // For now use the background from the 1st stack, but eventually, each stack to have its own background URL
  fetchBackgroundImageURL = trackedFunction(this, async () => {
    let mostBottomCard = this.stacks[0]?.items[0]?.card;
    let realmInfo;
    if (mostBottomCard) {
      realmInfo = await this.cardService.getRealmInfo(mostBottomCard);
    }
    return realmInfo?.backgroundURL;
  });

  get backgroundImageURL() {
    return this.fetchBackgroundImageURL.value ?? '';
  }

  get allStackItems() {
    return (
      this.operatorModeStateService.state?.stacks
        .map((stack) => stack.items)
        .flat() ?? []
    );
  }

  @action onCardSelectFromSearch(card: Card) {
    let searchSheetTrigger = this.searchSheetTrigger; // Will be set by onFocusSearchInput

    if (!searchSheetTrigger) {
      throw new Error('bug: searchSheetTrigger should be set here');
    }

    // This logic assumes there is currently one stack when this method is called (i.e. the stack with index 0)

    // In case the left button was clicked, whatever is currently in stack with index 0 will be moved to stack with index 1,
    // and the card will be added to stack with index 0.
    if (
      searchSheetTrigger ===
      SearchSheetTrigger.DropCardToLeftNeighborStackButton
    ) {
      let stackItem: StackItem = {
        card,
        format: 'isolated',
        stackIndex: 0,
      };

      let currentStackItems =
        this.operatorModeStateService.state.stacks[0].items;

      currentStackItems.forEach((item) => {
        this.operatorModeStateService.replaceItemInStack(item, {
          ...item,
          stackIndex: 1,
        });
      });

      this.operatorModeStateService.addItemToStack(stackItem);

      // In case the right button was clicked, the card will be added to stack with index 1.
    } else if (
      searchSheetTrigger ===
      SearchSheetTrigger.DropCardToRightNeighborStackButton
    ) {
      this.operatorModeStateService.addItemToStack({
        card,
        format: 'isolated',
        stackIndex: 1,
      });
    }

    // Close the search sheet
    this.onCancelSearchSheet();
  }

  // This determines whether we show the left and right button that trigger the search sheet whose card selection will go to the left or right stack
  // (there is a single stack with at least one card in it)
  get canCreateNeighborStack() {
    return (
      this.allStackItems.length > 0 &&
      this.operatorModeStateService.state.stacks.length === 1
    );
  }

  get chatVisibilityClass() {
    return this.isChatVisible ? 'chat-open' : 'chat-closed';
  }

  <template>
    <Modal
      class='operator-mode'
      @isOpen={{true}}
      @onClose={{@onClose}}
      @isOverlayDismissalDisabled={{true}}
      @boxelModalOverlayColor='var(--operator-mode-bg-color)'
      @backgroundImageURL={{this.backgroundImageURL}}
    >

      <CardCatalogModal />

      <div class='operator-mode__with-chat {{this.chatVisibilityClass}}'>
        <div class='operator-mode__main'>
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
              {{svgJar 'download' width='30px' height='30px'}}
            </button>
          {{/if}}

          {{#if (eq this.allStackItems.length 0)}}
            <div class='no-cards'>
              <p class='add-card-title'>
                Add a card to get started
              </p>

              <button
                class='add-card-button icon-button'
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
                @stackItems={{stack.items}}
                @stackIndex={{stackIndex}}
                @publicAPI={{this.publicAPI this stackIndex}}
                @close={{this.close}}
                @cancel={{this.cancel}}
                @edit={{this.edit}}
                @delete={{this.delete}}
                @save={{this.save}}
              />
            {{/each}}
          {{/if}}

          {{#if this.canCreateNeighborStack}}
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
              {{svgJar 'download' width='30px' height='30px'}}
            </button>
          {{/if}}
        </div>

        {{#if this.isChatVisible}}
          <ChatSidebar @onClose={{this.toggleChat}} />
        {{else}}
          <IconButton
            data-test-open-chat
            class='chat-btn'
            @icon='sparkle'
            @width='30px'
            @height='30px'
            {{on 'click' this.toggleChat}}
            style={{cssVar
              boxel-icon-button-width='50px'
              boxel-icon-button-height='50px'
            }}
          />
        {{/if}}
      </div>

      <SearchSheet
        @mode={{this.searchSheetMode}}
        @onCancel={{this.onCancelSearchSheet}}
        @onFocus={{this.onFocusSearchInput}}
        @onCardSelect={{this.onCardSelectFromSearch}}
      />
    </Modal>

    <style>
      :global(:root) {
        --operator-mode-bg-color: #686283;
        --boxel-modal-max-width: 100%;
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
        height: 350px;
        width: 200px;
        vertical-align: middle;
        background: var(--boxel-teal);
        border: none;
        border-radius: var(--boxel-border-radius);
      }
      .add-card-button:hover {
        background: var(--boxel-dark-teal);
      }
      .add-card-to-neighbor-stack {
        position: absolute;
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background: #aeabba;
        fill: #3295a2;
        border-color: transparent;
      }
      .add-card-to-neighbor-stack:hover,
      .add-card-to-neighbor-stack--active {
        background: var(--boxel-light);
        fill: var(--boxel-teal);
      }
      .add-card-to-neighbor-stack--left {
        left: 0;
        margin-left: var(--boxel-sp-lg);
      }
      .add-card-to-neighbor-stack--right {
        right: 0;
        margin-right: var(--boxel-sp-lg);
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
      }

      .chat-btn {
        position: absolute;
        bottom: 6px;
        right: 6px;
        margin-right: 0;
        border-radius: var(--boxel-border-radius);
        background-color: rgba(255, 255, 255, 0.25);
        border: solid 1px rgba(255, 255, 255, 0.5);
        box-shadow: var(--boxel-box-shadow);
      }
      .chat-btn:hover {
        background: var(--boxel-light);
      }

    </style>
  </template>
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    'OperatorMode::Container': typeof OperatorModeContainer;
  }
}
