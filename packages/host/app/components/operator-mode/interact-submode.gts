import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { concat, fn } from '@ember/helper';
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

import {
  cn,
  eq,
  gte,
  MenuItem,
  MenuDivider,
} from '@cardstack/boxel-ui/helpers';
import { IconCode, IconSearch, type Icon } from '@cardstack/boxel-ui/icons';

import {
  chooseCard,
  CardContextName,
  GetCardContextName,
  GetCardsContextName,
  GetCardCollectionContextName,
  Deferred,
  cardTypeDisplayName,
  cardTypeIcon,
  codeRefWithAbsoluteURL,
  identifyCard,
  isCardInstance,
  isResolvedCodeRef,
  CardError,
  loadCardDef,
  localId as localIdSymbol,
  realmURL as realmURLSymbol,
  specRef,
  type getCard,
  type getCards,
  type getCardCollection,
  type Actions,
  type CatalogActions,
  type CardActions,
  type CodeRef,
  type LooseSingleCardDocument,
  type LocalPath,
  type ResolvedCodeRef,
  type Filter,
} from '@cardstack/runtime-common';

import CopyCardCommand from '@cardstack/host/commands/copy-card';

import config from '@cardstack/host/config/environment';
import { StackItem } from '@cardstack/host/lib/stack-item';

import { stackBackgroundsResource } from '@cardstack/host/resources/stack-backgrounds';

import type MatrixService from '@cardstack/host/services/matrix-service';

import type {
  CardContext,
  CardDef,
  Format,
} from 'https://cardstack.com/base/card-api';
import type { Spec } from 'https://cardstack.com/base/spec';

import consumeContext from '../../helpers/consume-context';

import CopyButton from './copy-button';
import DeleteModal from './delete-modal';
import NeighborStackTriggerButton, {
  SearchSheetTriggers,
  type SearchSheetTrigger,
} from './interact-submode/neighbor-stack-trigger';
import OperatorModeStack from './stack';
import { CardDefOrId } from './stack-item';
import SubmodeLayout from './submode-layout';

import type { NewFileOptions } from './new-file-button';

import type { StackItemComponentAPI } from './stack-item';

import type CardService from '../../services/card-service';
import type CommandService from '../../services/command-service';
import type LoaderService from '../../services/loader-service';
import type OperatorModeStateService from '../../services/operator-mode-state-service';
import type Realm from '../../services/realm';
import type RealmServer from '../../services/realm-server';
import type RecentCardsService from '../../services/recent-cards-service';
import type StoreService from '../../services/store';

import type { Submode } from '../submode-switcher';

const waiter = buildWaiter('operator-mode:interact-submode-waiter');

export type Stack = StackItem[];

const cardSelections = new TrackedWeakMap<StackItem, TrackedSet<CardDef>>();
const stackItemComponentAPI = new WeakMap<StackItem, StackItemComponentAPI>();

const CodeSubmodeNewFileOptions: TemplateOnlyComponent = <template>
  <ul class='code-mode-file-options'>
    <li>Card Definition .GTS</li>
    <li>Field Definition .GTS</li>
    <li>Card Instance .JSON</li>
  </ul>
  <style scoped>
    .code-mode-file-options {
      list-style-type: disc;
      padding-left: var(--boxel-sp);
      line-height: calc(18 / 11);
    }
  </style>
</template>;

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
  @service private declare realmServer: RealmServer;
  @service private declare recentCardsService: RecentCardsService;
  @service private declare loaderService: LoaderService;

  @tracked private searchSheetTrigger: SearchSheetTrigger | null = null;
  @tracked private cardToDelete: CardToDelete | undefined = undefined;
  @tracked private recentCardCollection:
    | ReturnType<getCardCollection>
    | undefined;

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
    let actions: CardActions = {
      createCard: async (
        ref: CodeRef,
        relativeTo: URL | undefined,
        opts?: {
          realmURL?: URL;
          localDir?: LocalPath;
          closeAfterCreating?: boolean;
          doc?: LooseSingleCardDocument; // fill in card data with values
          cardModeAfterCreation?: Format;
        },
      ): Promise<string | undefined> => {
        let instance: CardDef;
        if (opts?.doc) {
          instance = await here.store.add(opts.doc, {
            doNotWaitForPersist: true,
            realm: opts?.realmURL?.href,
          });
        } else {
          let CardKlass = await loadCardDef(
            codeRefWithAbsoluteURL(ref, relativeTo),
            {
              loader: here.loaderService.loader,
            },
          );
          instance = new CardKlass() as CardDef;
          await here.store.add(instance, {
            doNotWaitForPersist: true,
            realm: opts?.realmURL?.href,
            localDir: opts?.localDir,
          });
        }
        let localId = instance[localIdSymbol];
        let newItem = new StackItem({
          id: localId,
          format: opts?.cardModeAfterCreation ?? 'edit',
          request: new Deferred(),
          closeAfterSaving: opts?.closeAfterCreating,
          stackIndex,
        });
        here.addToStack(newItem);
        return localId;
      },
      viewCard: (
        cardOrURL: CardDef | URL,
        format: Format = 'isolated',
        opts?: { openCardInRightMostStack?: boolean },
      ): void => {
        if (opts?.openCardInRightMostStack) {
          stackIndex = here.stacks.length;
        }
        let newItem = new StackItem({
          id: cardOrURL instanceof URL ? cardOrURL.href : cardOrURL.id,
          format,
          stackIndex,
        });
        here.addToStack(newItem);
        here.operatorModeStateService.closeWorkspaceChooser();
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
          stackItem = stack.find((item: StackItem) => item.id === card.id);
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
      changeSubmode: async (
        url: URL,
        submode: Submode = 'code',
      ): Promise<void> => {
        await here.operatorModeStateService.updateCodePath(url);
        here.operatorModeStateService.updateSubmode(submode);
      },
    };
    let catalogActions: CatalogActions = {
      allRealmsInfo: () => {
        return here.realm.allRealmsInfo;
      },
    };
    return { ...actions, ...catalogActions };
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
      (item: StackItem) =>
        item.id === card.id || item.id === card[localIdSymbol],
    );
    if (!item) {
      throw new Error(
        `Could not find card ${card.id} (localId ${card[localIdSymbol]}) in stack ${stackIndex}`,
      );
    }
    return item;
  }

  private close = (item: StackItem) => {
    // close the item first so user doesn't have to wait for the save to complete
    this.operatorModeStateService.trimItemsFromStack(item);
    let { request, id } = item;

    if (id && item.format === 'edit') {
      request?.fulfill(id);
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
        let removedCard = [...selections].find((c: CardDef) => c.id === cardId);
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
        let destinationIndexCardUrl = destinationItem.id;
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
        let newCardId: string | undefined;
        for (let [index, card] of sources.entries()) {
          ({ newCardId } = await new CopyCardCommand(
            this.commandService.commandContext,
          ).execute({
            sourceCard: card,
            realm: realmURL.href,
          }));
          if (index === 0) {
            scrollToCardId = newCardId; // we scroll to the first card lexically by title
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
    return (
      this.allStackItems.length > 0 &&
      this.stacks.length === 1 &&
      !this.operatorModeStateService.workspaceChooserOpened
    );
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
            id: url.href,
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
                  id: url.href,
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

        this.operatorModeStateService.closeWorkspaceChooser();
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

  private getRecentCardCollection = () => {
    this.recentCardCollection = this.cardContext?.getCardCollection(
      this,
      () => this.recentCardsService.recentCardIds,
    );
  };

  private getRecentCardMenuItems = () => {
    let recentCards = this.recentCardCollection?.cards;
    if (!recentCards) {
      return;
    }

    let items: { name: string; icon: Icon; ref: ResolvedCodeRef }[] = [];
    const excludedCardIds = this.realmServer.availableRealmIndexCardIds;

    recentCards
      .filter((card) => !excludedCardIds.includes(card.id)) // filter out realm index cards
      .map((card) => {
        let ref = identifyCard(card.constructor);
        let name = cardTypeDisplayName(card);
        if (isResolvedCodeRef(ref)) {
          if (items.find((item) => item.ref === ref && item.name === name)) {
            // do not add duplicate of the same card type
            return;
          }
          items.push({
            name,
            icon: cardTypeIcon(card) as Icon,
            ref,
          });
        }
      });

    let cardTypes = [...new Set(items)].slice(0, 2); // need only the 2 most-recent

    let menuItems: (MenuItem | MenuDivider)[] = [];
    if (cardTypes.length) {
      cardTypes.map(({ name, icon, ref }) => {
        menuItems.push(
          new MenuItem(name, 'action', {
            action: () => this.createNewFromRecentType.perform(ref),
            icon,
          }),
        );
      });
    }
    return menuItems;
  };

  private get createNewMenuItems(): (MenuItem | MenuDivider)[] {
    let recentCardMenuItems = this.getRecentCardMenuItems();
    let menuItems = [
      new MenuItem('Choose a card type...', 'action', {
        action: () => this.createCardInstance.perform(),
        icon: IconSearch,
      }),
      new MenuDivider(),
      new MenuItem('Open Code Mode', 'action', {
        action: this.createFileInCodeSubmode,
        subtextComponent: CodeSubmodeNewFileOptions,
        icon: IconCode,
      }),
    ];
    if (recentCardMenuItems) {
      return [...recentCardMenuItems, ...menuItems];
    }
    return menuItems;
  }

  private get newFileOptions(): NewFileOptions {
    return {
      menuItems: this.createNewMenuItems,
    };
  }

  private createFileInCodeSubmode = () => {
    this.operatorModeStateService.setNewFileDropdownOpen();
    this.operatorModeStateService.updateSubmode('code');
  };

  private createCardInstance = restartableTask(async () => {
    let specFilter: Filter = {
      on: specRef,
      every: [{ eq: { isCard: true } }],
    };
    let specId = await chooseCard({ filter: specFilter });
    if (!specId) {
      return;
    }

    let spec = await this.store.get<Spec>(specId);

    if (!spec) {
      throw new Error(`Could not find spec "${specId}" in the store`);
    }
    if (!isCardInstance<Spec>(spec)) {
      console.error(spec);
      throw new Error(`"${specId}" is not a card instance.`);
    }

    await this.cardContext.actions?.createCard?.(spec.ref, new URL(specId), {
      realmURL: this.operatorModeStateService.getWritableRealmURL(),
    });
  });

  private createNewFromRecentType = restartableTask(
    async (codeRef: ResolvedCodeRef) => {
      this.cardContext.actions?.createCard(codeRef, undefined, {
        realmURL: this.operatorModeStateService.getWritableRealmURL(),
      });
    },
  );

  @provide(CardContextName)
  private get cardContext(): Omit<
    CardContext,
    'prerenderedCardSearchComponent'
  > {
    // assumption: take actions in the right-most stack
    let stackCount = this.operatorModeStateService.numberOfStacks();
    let rightMostStackIndex = stackCount > 0 ? stackCount - 1 : 0;
    return {
      actions: this.publicAPI(this, rightMostStackIndex),
      getCard: this.getCard,
      getCards: this.getCards,
      getCardCollection: this.getCardCollection,
      store: this.store,
      // TODO: should we include this here??
      commandContext: this.commandService.commandContext,
    };
  }

  <template>
    {{consumeContext this.getRecentCardCollection}}
    <SubmodeLayout
      class='interact-submode-layout'
      @onSearchSheetClosed={{this.clearSearchSheetTrigger}}
      @onCardSelectFromSearch={{perform this.openSelectedSearchResultInStack}}
      @newFileOptions={{this.newFileOptions}}
      data-test-interact-submode
      as |search|
    >
      <div class='interact-submode' style={{this.backgroundImageStyle}}>
        {{#if this.canCreateNeighborStack}}
          <NeighborStackTriggerButton
            class='neighbor-stack-trigger stack-trigger-left'
            @triggerSide={{SearchSheetTriggers.DropCardToLeftNeighborStackButton}}
            @activeTrigger={{this.searchSheetTrigger}}
            @onTrigger={{fn
              this.showSearchWithTrigger
              search.openSearchToPrompt
            }}
          />
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
                  stack-medium-padding-top=(eq stack.length 2)
                  stack-small-padding-top=(gte stack.length 3)
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
          <NeighborStackTriggerButton
            class='neighbor-stack-trigger stack-trigger-right'
            @triggerSide={{SearchSheetTriggers.DropCardToRightNeighborStackButton}}
            @activeTrigger={{this.searchSheetTrigger}}
            @onTrigger={{fn
              this.showSearchWithTrigger
              search.openSearchToPrompt
            }}
          />
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
      .interact-submode-layout {
        --submode-bar-item-outline: var(--boxel-border-flexible);
        --submode-bar-item-box-shadow: var(--boxel-deep-box-shadow);
      }
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
      .stacks > :deep(.operator-mode-stack:first-child) {
        padding-left: var(--boxel-sp-lg);
      }
      .stacks > :deep(.operator-mode-stack:last-child) {
        padding-right: var(--boxel-sp-lg);
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
        padding-top: calc(var(--stack-padding-top) / 2);
      }
      .stack-small-padding-top {
        padding-top: var(--operator-mode-spacing);
      }
      .neighbor-stack-trigger {
        flex: 0;
        flex-basis: var(--container-button-size);
        position: absolute;
        z-index: var(--boxel-layer-floating-button);
      }
      .stack-trigger-right {
        right: 2px;
      }
      .stack-trigger-left {
        left: 2px;
      }
    </style>
  </template>
}
