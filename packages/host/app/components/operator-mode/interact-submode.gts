import Component from '@glimmer/component';

import { trackedFunction } from 'ember-resources/util/function';
import { inject as service } from '@ember/service';
import { htmlSafe } from '@ember/template';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { buildWaiter } from '@ember/test-waiters';
import { isTesting } from '@embroider/macros';
import { tracked } from '@glimmer/tracking';

import get from 'lodash/get';

import { dropTask, restartableTask, task } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';

import { cn, eq } from '@cardstack/boxel-ui/helpers';
import { IconPlus, Download } from '@cardstack/boxel-ui/icons';
import { TrackedWeakMap, TrackedSet } from 'tracked-built-ins';

import {
  Deferred,
  baseCardRef,
  chooseCard,
  type Actions,
  type CodeRef,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import {
  moduleFrom,
  codeRefWithAbsoluteURL,
} from '@cardstack/runtime-common/code-ref';
import { RealmPaths } from '@cardstack/runtime-common/paths';

import type { CardDef, Format } from 'https://cardstack.com/base/card-api';

import type CardService from '../../services/card-service';
import type OperatorModeStateService from '../../services/operator-mode-state-service';
import type RecentFilesService from '../../services/recent-files-service';

import CopyButton from './copy-button';
import DeleteModal from './delete-modal';
import OperatorModeStack from './stack';
import SubmodeLayout from './submode-layout';

const waiter = buildWaiter('operator-mode:interact-submode-waiter');

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
const stackItemScrollers = new WeakMap<
  StackItem,
  {
    stableScroll: (changeSizeCallback: () => Promise<void>) => void;
    scrollIntoView: (selector: string) => void;
  }
>();

interface Signature {
  Element: HTMLDivElement;
  Args: {
    write: (card: CardDef) => Promise<CardDef | undefined>;
  };
}

export default class InteractSubmode extends Component<Signature> {
  @service private declare cardService: CardService;
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare recentFilesService: RecentFilesService;

  @tracked private searchSheetTrigger: SearchSheetTrigger | null = null;

  private deleteModal: DeleteModal | undefined;

  private get stacks() {
    return this.operatorModeStateService.state?.stacks ?? [];
  }

  private get allStackItems() {
    return this.operatorModeStateService.state?.stacks.flat() ?? [];
  }

  // The public API is wrapped in a closure so that whatever calls its methods
  // in the context of operator-mode, the methods can be aware of which stack to deal with (via stackIndex), i.e.
  // to which stack the cards will be added to, or from which stack the cards will be removed from.
  private publicAPI(here: InteractSubmode, stackIndex: number): Actions {
    return {
      createCard: async (
        ref: CodeRef,
        relativeTo: URL | undefined,
        opts?: {
          realmURL?: URL;
          isLinkedCard?: boolean;
          doc?: LooseSingleCardDocument; // fill in card data with values
        },
      ): Promise<CardDef | undefined> => {
        let cardModule = new URL(moduleFrom(ref), relativeTo);
        // we make the code ref use an absolute URL for safety in
        // the case it's being created in a different realm than where the card
        // definition comes from
        if (
          opts?.realmURL &&
          !new RealmPaths(opts.realmURL).inRealm(cardModule)
        ) {
          ref = codeRefWithAbsoluteURL(ref, relativeTo);
        }
        let doc: LooseSingleCardDocument = opts?.doc ?? {
          data: {
            meta: {
              adoptsFrom: ref,
              ...(opts?.realmURL ? { realmURL: opts.realmURL.href } : {}),
            },
          },
        };
        let newCard = await here.cardService.createFromSerialized(
          doc.data,
          doc,
          relativeTo,
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
        await here.cardService.saveModel(here, newCard);
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
            let doWithStableScroll =
              stackItemScrollers.get(stackItem)?.stableScroll;
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
  private fetchBackgroundImageURLs = trackedFunction(this, async () => {
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

  private get backgroundImageURLs() {
    return (
      this.fetchBackgroundImageURLs.value?.map((u) => (u ? u : undefined)) ?? []
    );
  }

  private get backgroundImageStyle() {
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

  private get differingBackgroundImageURLs() {
    // if the this.backgroundImageStyle is undefined when there are images its because
    // they are different images--in that case we want to return these.
    if (this.backgroundImageURLs.length > 0 && !this.backgroundImageStyle) {
      return this.backgroundImageURLs;
    }
    return [];
  }

  private addCard = restartableTask(async () => {
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

  private close = task(async (item: StackItem) => {
    let { card, request } = item;
    // close the item first so user doesn't have to wait for the save to complete
    this.operatorModeStateService.trimItemsFromStack(item);

    // only save when closing a stack item in edit mode. there should be no unsaved
    // changes in isolated mode because they were saved when user toggled between
    // edit and isolated formats
    if (item.format === 'edit') {
      let updatedCard = await this.args.write(card);
      request?.fulfill(updatedCard);
    }
  });

  private save = task(async (item: StackItem, dismissStackItem: boolean) => {
    let { request } = item;
    let updatedCard = await this.args.write(item.card);

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

  @action private edit(item: StackItem) {
    this.operatorModeStateService.replaceItemInStack(item, {
      ...item,
      request: new Deferred(),
      format: 'edit',
    });
  }

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

    for (let stack of this.stacks) {
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
    await this.withTestWaiters(async () => {
      await this.operatorModeStateService.deleteCard(card);
      deferred!.fulfill();
    });

    if (afterDelete) {
      afterDelete();
    }
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

  private setupDeleteModal = (deleteModal: DeleteModal) => {
    this.deleteModal = deleteModal;
  };

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
        sources.sort((a, b) => a.title.localeCompare(b.title));
        let scrollToCard: CardDef | undefined;
        for (let [index, card] of sources.entries()) {
          let newCard = await this.cardService.copyCard(card, realmURL);
          if (index === 0) {
            scrollToCard = newCard; // we scroll to the first card lexically by title
          }
        }
        let clearSelection = clearSelections.get(sourceItem);
        if (typeof clearSelection === 'function') {
          clearSelection();
        }
        cardSelections.delete(sourceItem);
        let scroller = stackItemScrollers.get(destinationItem);
        if (scrollToCard) {
          // Currently the destination item is always a cards-grid, so we use that
          // fact to be able to scroll to the newly copied item
          scroller?.scrollIntoView(
            `[data-stack-card="${destinationItem.card.id}"] [data-cards-grid-item="${scrollToCard.id}"]`,
          );
        }
      });
    },
  );
  @action private addToStack(item: StackItem) {
    this.operatorModeStateService.addItemToStack(item);
  }

  @action
  private onSelectedCards(selectedCards: CardDef[], stackItem: StackItem) {
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

  private get selectedCards() {
    return this.operatorModeStateService
      .topMostStackItems()
      .map((i) => [...(cardSelections.get(i) ?? [])]);
  }

  private setupStackItem = (
    item: StackItem,
    doClearSelections: () => void,
    doWithStableScroll: (changeSizeCallback: () => Promise<void>) => void,
    doScrollIntoView: (selector: string) => void,
  ) => {
    clearSelections.set(item, doClearSelections);
    stackItemScrollers.set(item, {
      stableScroll: doWithStableScroll,
      scrollIntoView: doScrollIntoView,
    });
  };

  // This determines whether we show the left and right button that trigger the search sheet whose card selection will go to the left or right stack
  // (there is a single stack with at least one card in it)
  private get canCreateNeighborStack() {
    return this.allStackItems.length > 0 && this.stacks.length === 1;
  }

  @action private openSelectedSearchResultInStack(card: CardDef) {
    let searchSheetTrigger = this.searchSheetTrigger; // Will be set by showSearchWithTrigger

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
  }

  @action private clearSearchSheetTrigger() {
    this.searchSheetTrigger = null;
  }

  @action private showSearchWithTrigger(
    searchSheetTrigger: SearchSheetTrigger,
    openSearchCallback: () => void,
  ) {
    if (
      searchSheetTrigger ==
        SearchSheetTrigger.DropCardToLeftNeighborStackButton ||
      searchSheetTrigger ==
        SearchSheetTrigger.DropCardToRightNeighborStackButton
    ) {
      this.searchSheetTrigger = searchSheetTrigger;
    }
    openSearchCallback();
  }

  <template>
    <SubmodeLayout
      @onSearchSheetClosed={{this.clearSearchSheetTrigger}}
      @onCardSelectFromSearch={{this.openSelectedSearchResultInStack}}
      as |openSearch|
    >
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
              <IconPlus width='50px' height='50px' />
            </button>
          </div>
        {{else}}
          {{#each this.stacks as |stack stackIndex|}}
            {{#let
              (get this.differingBackgroundImageURLs stackIndex)
              as |backgroundImageURL|
            }}
              <OperatorModeStack
                data-test-operator-mode-stack={{stackIndex}}
                class={{cn
                  'operator-mode-stack'
                  (if backgroundImageURL 'with-bg-image')
                }}
                style={{if
                  backgroundImageURL
                  (htmlSafe
                    (concat 'background-image: url(' backgroundImageURL ')')
                  )
                }}
                @stackItems={{stack}}
                @stackIndex={{stackIndex}}
                @publicAPI={{this.publicAPI this stackIndex}}
                @close={{perform this.close}}
                @edit={{this.edit}}
                @onSelectedCards={{this.onSelectedCards}}
                @save={{perform this.save}}
                @delete={{perform this.delete}}
                @setupStackItem={{this.setupStackItem}}
              />
            {{/let}}
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
                  "drop-card-to-left-neighbor-stack-button"
                )
                "add-card-to-neighbor-stack--active"
              }}'
            {{on
              'click'
              (fn
                this.showSearchWithTrigger
                SearchSheetTrigger.DropCardToLeftNeighborStackButton
                openSearch
              )
            }}
          >
            <Download width='25' height='25' />
          </button>
          <button
            data-test-add-card-right-stack
            class='add-card-to-neighbor-stack add-card-to-neighbor-stack--right
              {{if
                (eq
                  this.searchSheetTrigger
                  "drop-card-to-right-neighbor-stack-button"
                )
                "add-card-to-neighbor-stack--active"
              }}'
            {{on
              'click'
              (fn
                this.showSearchWithTrigger
                SearchSheetTrigger.DropCardToRightNeighborStackButton
                openSearch
              )
            }}
          >
            <Download width='25' height='25' />
          </button>
        {{/if}}
        <DeleteModal @onCreate={{this.setupDeleteModal}} />
      </div>
    </SubmodeLayout>

    <style>
      .operator-mode__main {
        display: flex;
        justify-content: center;
        align-items: center;
        position: relative;
        background-position: center;
        background-size: cover;
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
    </style>
  </template>
}
