import { concat, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { inject as service } from '@ember/service';
import { htmlSafe } from '@ember/template';
import { buildWaiter } from '@ember/test-waiters';
import { isTesting } from '@embroider/macros';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { dropTask, restartableTask, timeout } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import { provide, consume } from 'ember-provide-consume-context';

import get from 'lodash/get';

import { TrackedWeakMap, TrackedSet } from 'tracked-built-ins';

import { Tooltip } from '@cardstack/boxel-ui/components';
import { cn, eq, lt, gt, and } from '@cardstack/boxel-ui/helpers';
import { Download } from '@cardstack/boxel-ui/icons';

import {
  CardContextName,
  GetCardContextName,
  GetCardsContextName,
  GetCardCollectionContextName,
  Deferred,
  codeRefWithAbsoluteURL,
  moduleFrom,
  RealmPaths,
  isCardInstance,
  CardError,
  realmURL as realmURLSymbol,
  type getCard,
  type getCards,
  type getCardCollection,
  type Actions,
  type CodeRef,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';

import CopyCardCommand from '@cardstack/host/commands/copy-card';
import config from '@cardstack/host/config/environment';
import { StackItem } from '@cardstack/host/lib/stack-item';

import { stackBackgroundsResource } from '@cardstack/host/resources/stack-backgrounds';

import type MatrixService from '@cardstack/host/services/matrix-service';

import {
  type CardContext,
  type CardDef,
  type Format,
} from 'https://cardstack.com/base/card-api';

import CopyButton from './copy-button';
import DeleteModal from './delete-modal';
import OperatorModeStack from './stack';
import { CardDefOrId } from './stack-item';
import SubmodeLayout from './submode-layout';

import type { StackItemComponentAPI } from './stack-item';

import type CardService from '../../services/card-service';
import type CommandService from '../../services/command-service';
import type OperatorModeStateService from '../../services/operator-mode-state-service';
import type Realm from '../../services/realm';
import type StoreService from '../../services/store';

import type { Submode } from '../submode-switcher';

const waiter = buildWaiter('operator-mode:interact-submode-waiter');

export type Stack = StackItem[];

const SearchSheetTriggers = {
  DropCardToLeftNeighborStackButton: 'drop-card-to-left-neighbor-stack-button',
  DropCardToRightNeighborStackButton:
    'drop-card-to-right-neighbor-stack-button',
} as const;
type Values<T> = T[keyof T];
type SearchSheetTrigger = Values<typeof SearchSheetTriggers>;

const cardSelections = new TrackedWeakMap<StackItem, TrackedSet<CardDef>>();
const stackItemComponentAPI = new WeakMap<StackItem, StackItemComponentAPI>();

interface NeighborStackTriggerButtonSignature {
  Element: HTMLButtonElement;
  Args: {
    triggerSide: SearchSheetTrigger;
    activeTrigger: SearchSheetTrigger | null;
    onTrigger: (triggerSide: SearchSheetTrigger) => void;
  };
}

class NeighborStackTriggerButton extends Component<NeighborStackTriggerButtonSignature> {
  get triggerSideClass() {
    switch (this.args.triggerSide) {
      case SearchSheetTriggers.DropCardToLeftNeighborStackButton:
        return 'add-card-to-neighbor-stack--left';
      case SearchSheetTriggers.DropCardToRightNeighborStackButton:
        return 'add-card-to-neighbor-stack--right';
      default:
        return undefined;
    }
  }

  <template>
    <button
      class={{cn
        'add-card-to-neighbor-stack'
        this.triggerSideClass
        add-card-to-neighbor-stack--active=(eq @activeTrigger @triggerSide)
      }}
      {{on 'click' (fn @onTrigger @triggerSide)}}
      ...attributes
    >
      <Download width='19' height='19' />
    </button>
    <style scoped>
      .add-card-to-neighbor-stack {
        --icon-color: var(--boxel-highlight-hover);
        width: var(--container-button-size);
        height: var(--container-button-size);
        padding: 0;
        border-radius: 50%;
        background-color: var(--boxel-light-100);
        border-color: transparent;
        box-shadow: var(--boxel-deep-box-shadow);
        z-index: var(--boxel-layer-floating-button);
      }
      .add-card-to-neighbor-stack:hover,
      .add-card-to-neighbor-stack--active {
        --icon-color: var(--boxel-highlight);
        background-color: var(--boxel-light);
      }
      .add-card-to-neighbor-stack--left {
        margin-left: var(--operator-mode-spacing);
      }
      .add-card-to-neighbor-stack--right {
        margin-right: var(--operator-mode-spacing);
      }
    </style>
  </template>
}

interface CardToDelete {
  id: string;
  title: string;
}

export default class InteractSubmode extends Component {
  @consume(GetCardContextName) private declare getCard: getCard;
  @consume(GetCardsContextName) private declare getCards: getCards;
  @consume(GetCardCollectionContextName)
  private declare getCardCollection: getCardCollection;

  @service private declare cardService: CardService;
  @service private declare commandService: CommandService;
  @service private declare matrixService: MatrixService;
  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare store: StoreService;
  @service private declare realm: Realm;

  @tracked private searchSheetTrigger: SearchSheetTrigger | null = null;
  @tracked private cardToDelete: CardToDelete | undefined = undefined;

  get stacks() {
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
          cardModeAfterCreation?: Format;
        },
      ): Promise<string | undefined> => {
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

        if (opts?.realmURL && !doc.data.meta.realmURL) {
          doc.data.meta.realmURL = opts.realmURL.href;
        }

        let maybeUrl = await here.store.create(
          doc,
          relativeTo,
          opts?.realmURL?.href,
        );
        if (typeof maybeUrl === 'string') {
          let url = maybeUrl;
          let newItem = new StackItem({
            url,
            format: opts?.cardModeAfterCreation ?? 'edit',
            request: new Deferred(),
            isLinkedCard: opts?.isLinkedCard,
            stackIndex,
          });
          here.addToStack(newItem);
          return url;
        } else {
          console.error(
            `Error creating card: ${JSON.stringify(maybeUrl, null, 2)}`,
          );
          return undefined;
        }
      },
      viewCard: (
        cardOrURL: CardDef | URL,
        format: Format = 'isolated',
        opts?: { openCardInRightMostStack?: boolean },
      ): void => {
        if (opts?.openCardInRightMostStack) {
          stackIndex = this.stacks.length;
        }
        let newItem = new StackItem({
          url: cardOrURL instanceof URL ? cardOrURL.href : cardOrURL.id,
          format,
          stackIndex,
        });
        here.addToStack(newItem);
        here.operatorModeStateService.workspaceChooserOpened = false;
      },
      copyURLToClipboard: async (
        card: CardDef | URL | string,
      ): Promise<void> => {
        let copyableUrl;
        if (typeof card === 'string') {
          copyableUrl = card;
        } else if (card instanceof URL) {
          copyableUrl = card.href;
        } else {
          copyableUrl = card.id;
        }
        if (!copyableUrl) {
          return;
        }
        if (config.environment === 'test') {
          return; // navigator.clipboard is not available in test environment
        }
        await navigator.clipboard.writeText(copyableUrl);
      },
      editCard(card: CardDef): void {
        let item = here.findCardInStack(card, stackIndex);
        here.operatorModeStateService.replaceItemInStack(
          item,
          item.clone({
            request: new Deferred(),
            format: 'edit',
          }),
        );
      },
      copyCard: async (card: CardDef): Promise<string> => {
        let deferred = new Deferred<string>();
        here._copyCard.perform(card, stackIndex, deferred);
        return await deferred.promise;
      },
      saveCard: (id: string): void => {
        here.store.save(id);
      },
      delete: async (card: CardDef | URL | string): Promise<void> => {
        let cardToDelete: CardToDelete | undefined;

        if (typeof card === 'object' && 'id' in card) {
          let loadedCard = card as CardDef;
          cardToDelete = {
            id: loadedCard.id,
            title: loadedCard.title,
          };
        } else {
          let cardUrl = card instanceof URL ? card : new URL(card as string);
          let loadedCard = await here.store.get(cardUrl.href);
          if (isCardInstance(loadedCard)) {
            cardToDelete = {
              id: loadedCard.id,
              title: loadedCard.title,
            };
          } else {
            let error = loadedCard;
            if (error.meta != null) {
              let cardTitle = error.meta.cardTitle;
              if (!cardTitle) {
                throw new Error(
                  `Could not get card title for ${card} - the server returned a 500 but perhaps for other reason than the card being in error state`,
                );
              }
              cardToDelete = {
                id: cardUrl.href,
                title: cardTitle,
              };
            } else {
              throw new CardError(error.message, error);
            }
          }
        }
        here.cardToDelete = cardToDelete;
      },
      doWithStableScroll: async (
        card: CardDef,
        changeSizeCallback: () => Promise<void>,
      ): Promise<void> => {
        let stackItem: StackItem | undefined;
        for (let stack of here.stacks) {
          stackItem = stack.find((item: StackItem) => item.url === card.id);
          if (stackItem) {
            let doWithStableScroll =
              stackItemComponentAPI.get(stackItem)?.doWithStableScroll;
            if (doWithStableScroll) {
              doWithStableScroll(changeSizeCallback); // this is perform()ed in the component
              return;
            }
          }
        }
        await changeSizeCallback();
      },
      changeSubmode: (url: URL, submode: Submode = 'code'): void => {
        here.operatorModeStateService.updateCodePath(url);
        here.operatorModeStateService.updateSubmode(submode);
      },
    };
  }
  stackBackgroundsState = stackBackgroundsResource(this);

  private get backgroundImageStyle() {
    // only return a background image when both stacks originate from the same realm
    // otherwise we delegate to each stack to handle this
    let { hasDifferingBackgroundURLs } = this.stackBackgroundsState;
    if (this.stackBackgroundsState.backgroundImageURLs.length === 0) {
      return false;
    }
    if (!hasDifferingBackgroundURLs) {
      return htmlSafe(
        `background-image: url(${this.stackBackgroundsState.backgroundImageURLs[0]});`,
      );
    }
    return false;
  }

  private findCardInStack(card: CardDef, stackIndex: number): StackItem {
    let item = this.stacks[stackIndex].find(
      (item: StackItem) => item.url === card.id,
    );
    if (!item) {
      throw new Error(`Could not find card ${card.id} in stack ${stackIndex}`);
    }
    return item;
  }

  private close = (item: StackItem) => {
    // close the item first so user doesn't have to wait for the save to complete
    this.operatorModeStateService.trimItemsFromStack(item);
    let { request, url } = item;

    // only save when closing a stack item in edit mode. there should be no unsaved
    // changes in isolated mode because they were saved when user toggled between
    // edit and isolated formats
    if (url && item.format === 'edit') {
      this.store.save(url);
      request?.fulfill(url);
    }
  };

  @action private onCancelDelete() {
    this.cardToDelete = undefined;
  }

  // dropTask will ignore any subsequent delete requests until the one in progress is done
  private delete = dropTask(async () => {
    if (!this.cardToDelete) {
      return;
    }
    let cardId = this.cardToDelete.id;

    for (let stack of this.stacks) {
      // remove all selections for the deleted card
      for (let item of stack) {
        let selections = cardSelections.get(item);
        if (!selections) {
          continue;
        }
        let removedCard = [...selections].find((c) => c.id === cardId);
        if (removedCard) {
          selections.delete(removedCard);
        }
      }
    }
    await this.withTestWaiters(async () => {
      await this.operatorModeStateService.deleteCard(cardId);
      await timeout(500); // task running message can be displayed long enough for the user to read it
    });

    this.cardToDelete = undefined;
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

  private _copyCard = dropTask(
    async (sourceCard: CardDef, stackIndex: number, done: Deferred<string>) => {
      let newCardId: string | undefined;
      try {
        let { commandContext } = this.commandService;
        const { newCard } = await new CopyCardCommand(commandContext).execute({
          sourceCard,
          targetStackIndex: stackIndex,
        });
        newCardId = newCard.id;
      } catch (e) {
        done.reject(e);
      } finally {
        if (newCardId) {
          done.fulfill(newCardId);
        }
      }
    },
  );

  // dropTask will ignore any subsequent copy requests until the one in progress is done
  private copy = dropTask(
    async (
      sources: CardDef[],
      sourceItem: StackItem,
      destinationItem: StackItem,
    ) => {
      // if this.selectCards task is still running, wait for it to finish before copying
      if (this.selectCards.isRunning) {
        await this.selectCards.last;
      }

      await this.withTestWaiters(async () => {
        let destinationIndexCardUrl = destinationItem.url;
        if (!destinationIndexCardUrl) {
          throw new Error(`destination index card has no URL`);
        }
        let destinationIndexCard = await this.store.get(
          destinationIndexCardUrl,
        );
        if (!isCardInstance(destinationIndexCard)) {
          throw new Error(
            `destination index card ${destinationIndexCardUrl} is not a card`,
          );
        }
        let destinationRealmURL = destinationIndexCard[realmURLSymbol];
        if (!destinationRealmURL) {
          throw new Error('Could not determine the copy destination realm');
        }
        let realmURL = destinationRealmURL;
        sources.sort((a, b) => a.title.localeCompare(b.title));
        let scrollToCardId: string | undefined;
        for (let [index, card] of sources.entries()) {
          let { newCard } = await new CopyCardCommand(
            this.commandService.commandContext,
          ).execute({
            sourceCard: card,
            targetRealmUrl: realmURL.href,
          });
          if (index === 0) {
            scrollToCardId = newCard.id; // we scroll to the first card lexically by title
          }
        }
        let clearSelection =
          stackItemComponentAPI.get(sourceItem)?.clearSelections;
        if (typeof clearSelection === 'function') {
          clearSelection();
        }
        cardSelections.delete(sourceItem);
        let scrollIntoView =
          stackItemComponentAPI.get(destinationItem)?.scrollIntoView;
        if (scrollToCardId) {
          // Currently the destination item is always a cards-grid, so we use that
          // fact to be able to scroll to the newly copied item
          scrollIntoView?.(
            `[data-stack-card="${destinationIndexCardUrl}"] [data-cards-grid-item="${scrollToCardId}"]`,
          );
        }
      });
    },
  );
  @action private addToStack(item: StackItem) {
    this.operatorModeStateService.addItemToStack(item);
  }

  @action
  private onSelectedCards(selectedCards: CardDefOrId[], stackItem: StackItem) {
    this.selectCards.perform(selectedCards, stackItem);
  }

  private selectCards = restartableTask(
    async (selectedCards: CardDefOrId[], stackItem: StackItem) => {
      let waiterToken = waiter.beginAsync();
      try {
        let loadedCards = await Promise.all(
          selectedCards.map((cardDefOrId: CardDefOrId) => {
            if (typeof cardDefOrId === 'string') {
              // WARNING This card is not part of the identity map!
              return this.store.get(cardDefOrId);
            }
            return cardDefOrId;
          }),
        );

        let selected = cardSelections.get(stackItem);
        if (!selected) {
          selected = new TrackedSet([]);
          cardSelections.set(stackItem, selected);
        }
        selected.clear();
        for (let card of loadedCards) {
          if (isCardInstance(card)) {
            selected.add(card);
          }
        }
      } finally {
        waiter.endAsync(waiterToken);
      }
    },
  );

  private get selectedCards() {
    return this.operatorModeStateService
      .topMostStackItems()
      .map((i) => [...(cardSelections.get(i) ?? [])]);
  }

  private setupStackItem = (
    item: StackItem,
    componentAPI: StackItemComponentAPI,
  ) => {
    stackItemComponentAPI.set(item, componentAPI);
  };

  // This determines whether we show the left and right button that trigger the search sheet whose card selection will go to the left or right stack
  // (there is a single stack with at least one card in it)
  private get canCreateNeighborStack() {
    return this.allStackItems.length > 0 && this.stacks.length === 1;
  }

  private openSelectedSearchResultInStack = restartableTask(
    async (cardId: string) => {
      let waiterToken = waiter.beginAsync();
      let url = new URL(cardId);
      try {
        let searchSheetTrigger = this.searchSheetTrigger; // Will be set by showSearchWithTrigger

        // In case the left button was clicked, whatever is currently in stack with index 0 will be moved to stack with index 1,
        // and the card will be added to stack with index 0. shiftStack executes this logic.
        if (
          searchSheetTrigger ===
          SearchSheetTriggers.DropCardToLeftNeighborStackButton
        ) {
          let newItem = new StackItem({
            url: url.href,
            format: 'isolated',
            stackIndex: 0,
          });
          // it's important that we await the stack item readiness _before_
          // we mutate the stack, otherwise there are very odd visual artifacts
          // await newItem.ready();
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
          this.addToStack(newItem);
          // In case the right button was clicked, the card will be added to stack with index 1.
        } else if (
          searchSheetTrigger ===
          SearchSheetTriggers.DropCardToRightNeighborStackButton
        ) {
          await this.publicAPI(this, this.stacks.length).viewCard(
            url,
            'isolated',
          );
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
            await this.publicAPI(this, 0).viewCard(url, 'isolated');
          } else {
            stack = this.operatorModeStateService.rightMostStack();
            if (stack) {
              let bottomMostItem = stack[0];
              if (bottomMostItem) {
                let stackItem = new StackItem({
                  url: url.href,
                  format: 'isolated',
                  stackIndex,
                });
                // await stackItem.ready();
                this.operatorModeStateService.clearStackAndAdd(
                  stackIndex,
                  stackItem,
                );
              }
            }
          }
        }

        this.operatorModeStateService.workspaceChooserOpened = false;
      } finally {
        waiter.endAsync(waiterToken);
      }
    },
  );

  @action private clearSearchSheetTrigger() {
    this.searchSheetTrigger = null;
  }

  @action private showSearchWithTrigger(
    openSearchCallback: () => void,
    searchSheetTrigger: SearchSheetTrigger,
  ) {
    if (
      searchSheetTrigger ==
        SearchSheetTriggers.DropCardToLeftNeighborStackButton ||
      searchSheetTrigger ==
        SearchSheetTriggers.DropCardToRightNeighborStackButton
    ) {
      this.searchSheetTrigger = searchSheetTrigger;
    }
    openSearchCallback();
  }

  @provide(CardContextName)
  // @ts-ignore "cardContext is declared but not used"
  private get cardContext(): Omit<
    CardContext,
    'prerenderedCardSearchComponent'
  > {
    return {
      actions: this.publicAPI(this, 0),
      getCard: this.getCard,
      getCards: this.getCards,
      getCardCollection: this.getCardCollection,
      store: this.store,
      // TODO: should we include this here??
      commandContext: this.commandService.commandContext,
    };
  }

  <template>
    <SubmodeLayout
      @onSearchSheetClosed={{this.clearSearchSheetTrigger}}
      @onCardSelectFromSearch={{perform this.openSelectedSearchResultInStack}}
      as |search|
    >
      <div class='interact-submode' style={{this.backgroundImageStyle}}>
        {{#if this.canCreateNeighborStack}}
          <Tooltip @placement='right'>
            <:trigger>
              <NeighborStackTriggerButton
                data-test-add-card-left-stack
                @triggerSide={{SearchSheetTriggers.DropCardToLeftNeighborStackButton}}
                @activeTrigger={{this.searchSheetTrigger}}
                @onTrigger={{fn
                  this.showSearchWithTrigger
                  search.openSearchToPrompt
                }}
              />
            </:trigger>
            <:content>
              {{neighborStackTooltipMessage 'left'}}
            </:content>
          </Tooltip>
        {{/if}}
        <div class='stacks'>
          {{#each this.stacks as |stack stackIndex|}}
            {{#let
              (get
                this.stackBackgroundsState.differingBackgroundImageURLs
                stackIndex
              )
              as |backgroundImageURLSpecificToThisStack|
            }}
              <OperatorModeStack
                data-test-operator-mode-stack={{stackIndex}}
                class={{cn
                  stack-with-bg-image=backgroundImageURLSpecificToThisStack
                  stack-medium-padding-top=(and
                    (gt stack.length 1) (lt stack.length 3)
                  )
                  stack-small-padding-top=(gt stack.length 2)
                }}
                style={{if
                  backgroundImageURLSpecificToThisStack
                  (htmlSafe
                    (concat
                      'background-image: url('
                      backgroundImageURLSpecificToThisStack
                      ')'
                    )
                  )
                }}
                @stackItems={{stack}}
                @stackIndex={{stackIndex}}
                @publicAPI={{this.publicAPI this stackIndex}}
                @commandContext={{this.commandService.commandContext}}
                @close={{this.close}}
                @onSelectedCards={{this.onSelectedCards}}
                @setupStackItem={{this.setupStackItem}}
              />
            {{/let}}
          {{/each}}

          <CopyButton
            @selectedCards={{this.selectedCards}}
            @copy={{fn (perform this.copy)}}
            @isCopying={{this.copy.isRunning}}
          />
        </div>
        {{#if this.canCreateNeighborStack}}
          <Tooltip @placement='left'>
            <:trigger>
              <NeighborStackTriggerButton
                class='neighbor-stack-trigger'
                data-test-add-card-right-stack
                @triggerSide={{SearchSheetTriggers.DropCardToRightNeighborStackButton}}
                @activeTrigger={{this.searchSheetTrigger}}
                @onTrigger={{fn
                  this.showSearchWithTrigger
                  search.openSearchToPrompt
                }}
              />
            </:trigger>
            <:content>
              {{neighborStackTooltipMessage 'right'}}
            </:content>
          </Tooltip>
        {{/if}}
        {{#if this.cardToDelete}}
          <DeleteModal
            @itemToDelete={{this.cardToDelete}}
            @onConfirm={{perform this.delete}}
            @onCancel={{this.onCancelDelete}}
            @isDeleteRunning={{this.delete.isRunning}}
          >
            <:content>
              Delete the card
              <strong>{{this.cardToDelete.title}}</strong>?
            </:content>
          </DeleteModal>
        {{/if}}
      </div>
    </SubmodeLayout>

    <style scoped>
      .interact-submode {
        display: flex;
        justify-content: center;
        align-items: center;
        position: relative;
        background-position: center;
        background-size: cover;
        height: 100%;
      }
      .stacks {
        flex: 1;
        height: 100%;
        display: flex;
        justify-content: center;
        align-items: center;
      }
      .stack-with-bg-image:before {
        content: ' ';
        height: 100%;
        width: 2px;
        background-color: var(--boxel-dark);
        display: block;
        position: absolute;
        top: 0;
        left: -1px;
      }
      .stack-with-bg-image:first-child:before {
        display: none;
      }
      .stack-medium-padding-top {
        padding-top: var(--operator-mode-top-bar-item-height);
      }
      .stack-small-padding-top {
        padding-top: var(--operator-mode-spacing);
      }
      .neighbor-stack-trigger {
        flex: 0;
        flex-basis: var(--container-button-size);
      }
    </style>
  </template>
}

const neighborStackTooltipMessage = (side: 'left' | 'right') => {
  return `Open a card to the ${side} of the current card`;
};
