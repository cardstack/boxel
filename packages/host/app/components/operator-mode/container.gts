import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { Card, Format } from 'https://cardstack.com/base/card-api';
import { action } from '@ember/object';
import { fn } from '@ember/helper';
import { trackedFunction } from 'ember-resources/util/function';
import CardCatalogModal from '../card-catalog-modal';
import type CardService from '../../services/card-service';
import get from 'lodash/get';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';
import { Modal, IconButton } from '@cardstack/boxel-ui';
import cssVar from '@cardstack/boxel-ui/helpers/css-var';
import SearchSheet, { SearchSheetMode } from '../search-sheet';
import { restartableTask, task } from 'ember-concurrency';
import {
  Deferred,
  baseCardRef,
  chooseCard,
  type Actions,
  type CardRef,
  LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import { RealmPaths } from '@cardstack/runtime-common/paths';
import type LoaderService from '../../services/loader-service';
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
import type OperatorModeStateService from '../../services/operator-mode-state-service';
import OperatorModeStack from './stack';
import type MatrixService from '../../services/matrix-service';
import ChatSidebar from '../matrix/chat-sidebar';

interface Signature {
  Args: {
    onClose: () => void;
  };
}

export interface OperatorModeState {
  stacks: Stack[];
}

export type Stack = StackItem[];

interface BaseItem {
  format: Format;
  request?: Deferred<Card | undefined>;
  stackIndex: number;
}

export interface CardStackItem extends BaseItem {
  type: 'card';
  card: Card;
  isLinkedCard?: boolean; // TODO: cnsider renaming this so its clearer that we use this for being able to tell whether the card needs to be closed after saving
}

export interface ContainedCardStackItem extends BaseItem {
  type: 'contained';
  fieldOfIndex: number; // index of the item in the stack that this is a field of
  fieldName: string;
}

export type StackItem = CardStackItem | ContainedCardStackItem;

enum SearchSheetTrigger {
  DropCardToLeftNeighborStackButton = 'drop-card-to-left-neighbor-stack-button',
  DropCardToRightNeighborStackButton = 'drop-card-to-right-neighbor-stack-button',
}

export default class OperatorModeContainer extends Component<Signature> {
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

  private getAddressableCard(item: StackItem): Card {
    return getCardStackItem(item, this.stacks[item.stackIndex]).card;
  }

  private getCard(item: StackItem): Card {
    let card = this.getAddressableCard(item);
    let path = getPathToStackItem(item, this.stacks[item.stackIndex]);
    if (path.length === 0) {
      return card;
    }
    return get(card, path.join('.'));
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
    request?: Deferred<Card | undefined>
  ) {
    if (item.type === 'card') {
      this.operatorModeStateService.replaceItemInStack(item, {
        ...item,
        request,
        format,
      });
    }

    if (item.type === 'contained') {
      let addressableItem = getCardStackItem(
        item,
        this.stacks[item.stackIndex]
      );

      let pathSegments = getPathToStackItem(item, this.stacks[item.stackIndex]);
      this.operatorModeStateService.replaceItemInStack(addressableItem, {
        ...addressableItem,
        request,
        format,
      });
      pathSegments.forEach((_, index) => {
        let stack = this.stacks[item.stackIndex];
        let currentItem = stack[stack.length - index - 1];
        this.operatorModeStateService.replaceItemInStack(currentItem, {
          ...currentItem,
          format,
        });
      });
    }
  }

  @action async close(item: StackItem) {
    let card = this.getAddressableCard(item);
    let { request } = item;
    // close the item first so user doesn't have to wait for the save to complete
    this.operatorModeStateService.trimItemsFromStack(item);
    let updatedCard = await this.write.perform(card);
    await request?.fulfill(updatedCard);
  }

  // TODO I'm a little suspicious of all the async actions in this component.
  // there is the possibility that this component could be destroyed during
  // interior await's within these async actions. perferably we should be
  // using ember concurrency to perform any async which addresses this situation
  // directly.
  @action async save(item: StackItem, dismissStackItem: boolean) {
    let { request } = item;
    let stack = this.stacks[item.stackIndex];
    let addressableItem = getCardStackItem(item, stack);
    // TODO Do not cast the task to a promise by awaiting it
    // https://ember-concurrency.com/docs/task-cancelation-help
    // if this was a EC task instead of an action then we could await here without
    // casting the task to a promise
    let updatedCard = await this.write.perform(addressableItem.card);

    if (updatedCard) {
      await request?.fulfill(updatedCard);
      if (!dismissStackItem) {
        // if this is a newly created card from auto-save then we
        // need to replace the stack item to account for the new card's ID
        if (!addressableItem.card.id && updatedCard.id) {
          this.operatorModeStateService.replaceItemInStack(addressableItem, {
            ...addressableItem,
            card: updatedCard,
          });
        }
        return;
      }

      if (item.type === 'card' && item.isLinkedCard) {
        this.operatorModeStateService.trimItemsFromStack(item); // closes the 'create new card' editor for linked card fields
      } else {
        if (!addressableItem.card.id && updatedCard.id) {
          this.operatorModeStateService.trimItemsFromStack(addressableItem);
        } else {
          this.operatorModeStateService.replaceItemInStack(addressableItem, {
            ...addressableItem,
            card: updatedCard,
            request,
            format: 'isolated',
          });

          getPathToStackItem(item, this.stacks[item.stackIndex]).forEach(() =>
            this.operatorModeStateService.popItemFromStack(item.stackIndex)
          );
        }
      }
    }
  }

  // we debounce saves in the stack item--by the time they reach
  // this level we need to handle every request (so not restartable). otherwise
  // we might drop writes from different stack items that want to save
  // at the same time
  private write = task(async (card: Card) => {
    return await this.cardService.saveModel(card);
  });

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
        // using RealmPaths API to correct for the trailing `/`
        let realmPath = new RealmPaths(
          relativeTo ?? here.cardService.defaultURL
        );
        let newCard = await here.cardService.createFromSerialized(
          doc.data,
          doc,
          new URL(realmPath.url)
        );
        let newItem: StackItem = {
          type: 'card',
          card: newCard,
          format: 'edit',
          request: new Deferred(),
          isLinkedCard: opts?.isLinkedCard,
          stackIndex,
        };
        here.addToStack(newItem);
        return await newItem.request?.promise;
      },
      viewCard: async (
        card: Card,
        format: Format = 'isolated',
        fieldType?: 'linksTo' | 'contains' | 'containsMany' | 'linksToMany',
        fieldName?: string
      ) => {
        let stack = here.stacks[stackIndex];
        let itemsCount = stack.length;

        let currentCardOnStack = here.getCard(stack[itemsCount - 1]!); // Last item on the stack

        // TODO this is a hack until contained cards go away
        // this lets us handle a contained card that is part of a card that has been auto-saved.
        // the deserialization from the auto save actually breaks object equality for contained cards.
        if (
          fieldType === 'contains' &&
          fieldName &&
          [
            ...Object.keys(
              await here.cardService.getFields(currentCardOnStack)
            ),
          ].includes(fieldName)
        ) {
          here.addToStack({
            type: 'contained',
            fieldOfIndex: itemsCount - 1,
            fieldName,
            format,
            stackIndex,
          });
          return;
        }

        let containedPath = await findContainedCardPath(
          currentCardOnStack,
          card,
          here.cardService
        );
        if (containedPath.length > 0) {
          let currentIndex = itemsCount - 1;
          // add the nested contained cards in teh correct order
          for (let fieldName of containedPath) {
            here.addToStack({
              type: 'contained',
              fieldOfIndex: currentIndex++,
              fieldName,
              format,
              stackIndex,
            });
          }
        } else {
          here.addToStack({
            type: 'card',
            card,
            format,
            stackIndex,
          });
        }
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
          type: 'card',
          card: newCard,
          format: 'isolated',
          stackIndex,
        };
        here.addToStack(newItem);
        return;
      },
    };
  }

  addCard = restartableTask(async () => {
    let type = baseCardRef;
    let chosenCard: Card | undefined = await chooseCard({
      filter: { type },
    });

    if (chosenCard) {
      let newItem: StackItem = {
        type: 'card',
        card: chosenCard,
        format: 'isolated',
        stackIndex: 0, // This is called when there are no cards in the stack left, so we can assume the stackIndex is 0
      };
      this.addToStack(newItem);
    }
  });

  // For now use the background from the 1st stack, but eventually, each stack
  // to have its own background URL. Also need to consider how to treat adjoining
  // stacks that have the same background image (consider 4 stacks, where 2
  // adjacent stacks have the same background image)
  fetchBackgroundImageURL = trackedFunction(this, async () => {
    let bottomMostCard = this.stacks[0]?.[0];
    let realmInfo;
    if (bottomMostCard) {
      if (bottomMostCard.type !== 'card') {
        throw new Error(
          `bug: the bottom most card for a stack cannot be a contained card`
        );
      }
      realmInfo = await this.cardService.getRealmInfo(bottomMostCard.card);
    }
    return realmInfo?.backgroundURL;
  });

  get backgroundImageURL() {
    return this.fetchBackgroundImageURL.value ?? '';
  }

  get allStackItems() {
    return this.operatorModeStateService.state?.stacks.flat() ?? [];
  }

  @action onCardSelectFromSearch(card: Card) {
    let searchSheetTrigger = this.searchSheetTrigger; // Will be set by onFocusSearchInput

    // This logic assumes there is currently one stack when this method is called (i.e. the stack with index 0)

    // In case the left button was clicked, whatever is currently in stack with index 0 will be moved to stack with index 1,
    // and the card will be added to stack with index 0. shiftStack executes this logic.
    if (
      searchSheetTrigger ===
      SearchSheetTrigger.DropCardToLeftNeighborStackButton
    ) {
      for (
        let stackIndex = this.operatorModeStateService.state.stacks.length - 1;
        stackIndex >= 0;
        stackIndex--
      ) {
        this.operatorModeStateService.shiftStack(
          this.operatorModeStateService.state.stacks[stackIndex],
          stackIndex + 1
        );
      }

      let stackItem: CardStackItem = {
        type: 'card',
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
        type: 'card',
        card,
        format: 'isolated',
        stackIndex: this.operatorModeStateService.state.stacks.length,
      });
    } else {
      // In case, that the search was accessed directly without clicking right and left buttons,
      // the rightmost stack will be REPLACED by the selection
      let numberOfStacks = this.operatorModeStateService.numberOfStacks();
      if (numberOfStacks > 0) {
        //there will always be 1 stack
        let stack = this.operatorModeStateService.rightMostStack();
        if (stack) {
          let bottomMostItem = stack[0];
          if (bottomMostItem) {
            let stackItem: CardStackItem = {
              type: 'card',
              card,
              format: 'isolated',
              stackIndex: numberOfStacks - 1, //rightMost stack index
            };
            this.operatorModeStateService.trimStackAndAdd(
              bottomMostItem,
              stackItem
            );
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
        <div
          class='operator-mode__main'
          data-test-save-idle={{this.write.isIdle}}
        >
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
                @stackItems={{stack}}
                @stackIndex={{stackIndex}}
                @publicAPI={{this.publicAPI this stackIndex}}
                @close={{this.close}}
                @edit={{this.edit}}
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
      :global(.operator-mode .boxel-modal__inner) {
        display: block;
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
        background-color: var(--boxel-400);
        border: solid 1px var(--boxel-border-color);
        box-shadow: var(--boxel-box-shadow);
      }
      .chat-btn:hover {
        background: var(--boxel-light);
      }

    </style>
  </template>
}

export function getCardStackItem(
  stackItem: StackItem,
  stack: StackItem[]
): CardStackItem {
  if (stackItem.type === 'card') {
    return stackItem;
  }
  if (stackItem.fieldOfIndex >= stack.length) {
    throw new Error(
      `bug: the stack item (index ${stackItem.fieldOfIndex}) that is the parent of the contained field '${stackItem.fieldName}' no longer exists in the stack`
    );
  }
  return getCardStackItem(stack[stackItem.fieldOfIndex], stack);
}

export function getPathToStackItem(
  stackItem: StackItem,
  stack: StackItem[],
  segments: string[] = []
): string[] {
  if (stackItem.type === 'card') {
    return segments;
  }
  return getPathToStackItem(stack[stackItem.fieldOfIndex], stack, [
    stackItem.fieldName,
    ...segments,
  ]);
}

async function findContainedCardPath(
  possibleParent: Card,
  maybeContained: Card,
  cardService: CardService,
  path: string[] = []
): Promise<string[]> {
  let fields = await cardService.getFields(possibleParent);

  for (let [fieldName, field] of Object.entries(fields)) {
    let value = (possibleParent as any)[fieldName];
    if (value === maybeContained && field.fieldType === 'contains') {
      return [...path, fieldName];
    }
    if (
      cardService.isCard(value) &&
      value !== maybeContained &&
      field.fieldType === 'contains'
    ) {
      path = await findContainedCardPath(value, maybeContained, cardService, [
        ...path,
        fieldName,
      ]);
      if (path.length > 0) {
        return path;
      }
    }
  }
  return [];
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    'OperatorMode::Container': typeof OperatorModeContainer;
  }
}
