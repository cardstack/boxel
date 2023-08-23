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
import { restartableTask, task, dropTask } from 'ember-concurrency';
import { TrackedWeakMap, TrackedSet } from 'tracked-built-ins';
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
import { htmlSafe } from '@ember/template';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';
import perform from 'ember-concurrency/helpers/perform';
import type OperatorModeStateService from '../../services/operator-mode-state-service';
import OperatorModeStack from './stack';
import type MatrixService from '../../services/matrix-service';
import type MessageService from '../../services/message-service';
import ChatSidebar from '../matrix/chat-sidebar';
import CopyButton from './copy-button';
import DeleteModal from './delete-modal';
import { buildWaiter } from '@ember/test-waiters';
import { isTesting } from '@embroider/macros';
import SubmodeSwitcher, { Submode } from '../submode-switcher';
import OperatorModeCodeMode from '@cardstack/host/components/operator-mode/code-mode';

const waiter = buildWaiter('operator-mode-container:write-waiter');

interface Signature {
  Args: {
    onClose: () => void;
  };
}

export interface OperatorModeState {
  stacks: Stack[];
  submode: Submode;
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

const cardSelections = new TrackedWeakMap<StackItem, TrackedSet<Card>>();
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
  @tracked searchSheetMode: SearchSheetMode = SearchSheetMode.Closed;
  @tracked searchSheetTrigger: SearchSheetTrigger | null = null;
  @tracked isChatVisible = false;

  private deleteModal: DeleteModal | undefined;

  constructor(owner: unknown, args: any) {
    super(owner, args);

    this.messageService.register();
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

  @action onSearch(_term: string) {
    this.searchSheetMode = SearchSheetMode.SearchResults;
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

  @action
  onSelectedCards(selectedCards: Card[], stackItem: StackItem) {
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
    request?: Deferred<Card | undefined>,
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
        this.stacks[item.stackIndex],
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

  close = task(async (item: StackItem) => {
    let card = this.getAddressableCard(item);
    let { request } = item;
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
    let stack = this.stacks[item.stackIndex];
    let addressableItem = getCardStackItem(item, stack);
    let updatedCard = await this.write.perform(addressableItem.card);

    if (updatedCard) {
      request?.fulfill(updatedCard);
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
            this.operatorModeStateService.popItemFromStack(item.stackIndex),
          );
        }
      }
    }
  });

  // dropTask will ignore any subsequent delete requests until the one in progress is done
  delete = dropTask(async (card: Card) => {
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

    let items: CardStackItem[] = [];
    for (let stack of this.stacks) {
      items.push(
        ...(stack.filter(
          (i) => i.type === 'card' && i.card.id === card.id,
        ) as CardStackItem[]),
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

    await this.withTestWaiters(async () => {
      await this.cardService.deleteCard(card);
      deferred!.fulfill();
    });
  });

  // we debounce saves in the stack item--by the time they reach
  // this level we need to handle every request (so not restartable). otherwise
  // we might drop writes from different stack items that want to save
  // at the same time
  private write = task(async (card: Card) => {
    return await this.withTestWaiters(async () => {
      return await this.cardService.saveModel(card);
    });
  });

  // dropTask will ignore any subsequent copy requests until the one in progress is done
  private copy = dropTask(
    async (
      sources: Card[],
      sourceItem: CardStackItem,
      destinationItem: CardStackItem,
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
        ref: CardRef,
        relativeTo: URL | undefined,
        opts?: {
          isLinkedCard?: boolean;
          doc?: LooseSingleCardDocument; // fill in card data with values
        },
      ): Promise<Card | undefined> => {
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
        fieldName?: string,
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
              await here.cardService.getFields(currentCardOnStack),
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
          here.cardService,
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
        relativeTo: URL | undefined,
      ): Promise<void> => {
        let newCard = await here.cardService.createFromSerialized(
          doc.data,
          doc,
          relativeTo ?? here.cardService.defaultURL,
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
      doWithStableScroll: async (
        card: Card,
        changeSizeCallback: () => Promise<void>,
      ): Promise<void> => {
        let stackItem: StackItem | undefined;
        for (let stack of here.stacks) {
          stackItem = stack.find(
            (item) => item.type === 'card' && item.card === card,
          );
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

  fetchBackgroundImageURLs = trackedFunction(this, async () => {
    let result = await Promise.all(
      this.stacks.map(async (stack) => {
        if (stack.length === 0) {
          return;
        }
        let bottomMostCard = stack[0];
        if (bottomMostCard.type !== 'card') {
          throw new Error(
            `bug: the bottom most card for a stack cannot be a contained card`,
          );
        }
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

  get cardForCodeMode() {
    // Last card in rightmost stack
    return (
      this.allStackItems
        .filter((item) => item.type === 'card')
        // @ts-ignore Property 'card' does not exist on type 'StackItem'. - it actually does exist because we filtered for it in the line above
        .reverse()[0].card
    );
  }

  get isCodeMode() {
    return this.operatorModeStateService.state?.submode === Submode.Code;
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
        let stackIndex = this.stacks.length - 1;
        stackIndex >= 0;
        stackIndex--
      ) {
        this.operatorModeStateService.shiftStack(
          this.stacks[stackIndex],
          stackIndex + 1,
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
        stackIndex: this.stacks.length,
      });
    } else {
      // In case, that the search was accessed directly without clicking right and left buttons,
      // the rightmost stack will be REPLACED by the selection
      let numberOfStacks = this.operatorModeStateService.numberOfStacks();
      let stackIndex = numberOfStacks - 1;
      if (numberOfStacks > 0) {
        //there will always be 1 stack
        let stack = this.operatorModeStateService.rightMostStack();
        if (stack) {
          let bottomMostItem = stack[0];
          if (bottomMostItem) {
            this.operatorModeStateService.clearStackAndAdd(stackIndex, {
              type: 'card',
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
          <OperatorModeCodeMode @card={{this.cardForCodeMode}} />
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
              <DeleteModal @onCreate={{this.setupDeleteModal}} />
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
                {{svgJar 'download' width='30px' height='30px'}}
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
                {{svgJar 'download' width='30px' height='30px'}}
              </button>
            {{/if}}
          </div>
        {{/if}}

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
        @onSearch={{this.onSearch}}
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
        width: 60px;
        height: 60px;
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
        justify-content: stretch;
        align-items: center;
        position: relative;
        background-position: center;
        background-size: cover;
      }

      .chat-btn {
        --icon-color: var(--boxel-highlight-hover);
        position: absolute;
        bottom: 6px;
        right: 6px;
        margin-right: 0;
        border-radius: var(--boxel-border-radius);
        background-color: var(--boxel-light-100);
        border: solid 1px var(--boxel-border-color);
        box-shadow: var(--boxel-deep-box-shadow);
      }
      .chat-btn:hover {
        --icon-color: var(--boxel-highlight);
        background-color: var(--boxel-light);
      }

      .submode-switcher {
        position: absolute;
        top: 0;
        left: 0;
        z-index: 2;
        padding: var(--boxel-sp);
      }
    </style>
  </template>
}

export function getCardStackItem(
  stackItem: StackItem,
  stack: StackItem[],
): CardStackItem {
  if (stackItem.type === 'card') {
    return stackItem;
  }
  if (stackItem.fieldOfIndex >= stack.length) {
    throw new Error(
      `bug: the stack item (index ${stackItem.fieldOfIndex}) that is the parent of the contained field '${stackItem.fieldName}' no longer exists in the stack`,
    );
  }
  return getCardStackItem(stack[stackItem.fieldOfIndex], stack);
}

export function getPathToStackItem(
  stackItem: StackItem,
  stack: StackItem[],
  segments: string[] = [],
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
  path: string[] = [],
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
