import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { concat, fn } from '@ember/helper';
import { action } from '@ember/object';
import { service } from '@ember/service';
import { htmlSafe } from '@ember/template';
import { buildWaiter } from '@ember/test-waiters';
import { isTesting } from '@embroider/macros';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { dropTask, restartableTask, timeout } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import onKeyMod from 'ember-keyboard/modifiers/on-key';
import { consume } from 'ember-provide-consume-context';

import { get } from 'lodash-es';
import { TrackedWeakMap, TrackedSet } from 'tracked-built-ins';

import { cn, gt, MenuItem, MenuDivider } from '@cardstack/boxel-ui/helpers';
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
  codeRefWithAbsoluteIdentifier,
  identifyCard,
  isCardInstance,
  isResolvedCodeRef,
  CardError,
  loadCardDef,
  localId as localIdSymbol,
  rri,
  specRef,
  type getCard,
  type getCards,
  type getCardCollection,
  type CodeRef,
  type LooseSingleCardDocument,
  type LocalPath,
  type RealmResourceIdentifier,
  type ResolvedCodeRef,
  type Filter,
} from '@cardstack/runtime-common';

import {
  detectStackItemTypeForTarget,
  StackItem,
  type StackItemType,
} from '@cardstack/host/lib/stack-item';

import { stackBackgroundsResource } from '@cardstack/host/resources/stack-backgrounds';
import CopyCardToStackCommand from '@cardstack/host/tools/copy-card-to-stack';

import { idFromCardOrURL } from '@cardstack/host/utils/id-from-card-or-url';

import type {
  CardContext,
  CardDef,
  Format,
} from 'https://cardstack.com/base/card-api';
import type { Spec } from 'https://cardstack.com/base/spec';

import consumeContext from '../../helpers/consume-context';

import { removeFileExtension } from '../../utils/card-search/types';

import CopyButton from './copy-button';
import DeleteModal from './delete-modal';
import NeighborStackTriggerButton, {
  SearchSheetTriggers,
  type SearchSheetTrigger,
} from './interact-submode/neighbor-stack-trigger';
import OperatorModeStack from './stack';

import SubmodeLayout from './submode-layout';

import type { NewFileOptions } from './new-file-button';
import type { CardDefOrId } from './stack-item';

import type { StackItemComponentAPI } from './stack-item';

import type CardService from '../../services/card-service';
import type LoaderService from '../../services/loader-service';
import type NetworkService from '../../services/network';
import type OperatorModeStateService from '../../services/operator-mode-state-service';
import type Realm from '../../services/realm';
import type RealmServer from '../../services/realm-server';
import type RecentCardsService from '../../services/recent-cards-service';
import type StoreService from '../../services/store';
import type ToolService from '../../services/tool-service';

const waiter = buildWaiter('operator-mode:interact-submode-waiter');

export type Stack = StackItem[];

// Selections are tracked by card id rather than by loaded instance. Materializing
// a CardDef for every selected card is expensive (a fetch + deserialize per card
// that isn't already resident), which made "Select All" over a large grid freeze
// the UI for seconds. Instances are now loaded lazily, only when a copy is invoked.
const cardSelections = new TrackedWeakMap<StackItem, TrackedSet<string>>();
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

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  let tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

export default class InteractSubmode extends Component {
  @consume(GetCardContextName) declare private getCard: getCard;
  @consume(GetCardsContextName) declare private getCards: getCards;
  @consume(GetCardCollectionContextName)
  declare private getCardCollection: getCardCollection;
  @consume(CardContextName) declare private cardContext: CardContext;

  @service declare private cardService: CardService;
  @service declare private toolService: ToolService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private store: StoreService;
  @service declare private realm: Realm;
  @service declare private realmServer: RealmServer;
  @service declare private recentCardsService: RecentCardsService;
  @service declare private loaderService: LoaderService;
  @service declare private network: NetworkService;

  @tracked private searchSheetTrigger: SearchSheetTrigger | null = null;
  @tracked private cardToDelete: CardToDelete | undefined = undefined;
  @tracked private recentCardCollection:
    | ReturnType<getCardCollection>
    | undefined;

  @action private handleEscape(event: KeyboardEvent) {
    // A modal owns Escape regardless of where focus is.
    if (document.body.classList.contains('has-modal')) return;

    if (isInteractiveTarget(event.target)) {
      let el = event.target as HTMLElement;
      // Field inside a stack card: peel the focus off first so a
      // second Escape can fall through to exit edit / close.
      if (el.closest('[data-stack-card]')) {
        event.preventDefault();
        el.blur();
        return;
      }
      // Field outside any stack card (search sheet, AI assistant, etc.):
      // defer to that field's own Escape handler.
      return;
    }

    let item = this.mostRecentlyInteractedStackItem;
    if (!item) return;

    // In edit mode, Escape exits to view mode (one level of "undo open").
    // In view mode, Escape closes the item.
    if (item.format === 'edit' && item.type !== 'file') {
      event.preventDefault();
      this.operatorModeStateService.setItemFormat(item, 'isolated', {
        request: new Deferred(),
      });
      return;
    }
    event.preventDefault();
    this.close(item);
  }

  @action private handleToggleEdit(event: KeyboardEvent) {
    // Ctrl+E works even when focus is in an input — that's the whole
    // point of the shortcut: flip in/out of edit without first having
    // to click somewhere else. Modals still own the keyboard, though.
    if (document.body.classList.contains('has-modal')) return;
    let item = this.mostRecentlyInteractedStackItem;
    // Files have no edit format; nothing to toggle.
    if (!item || item.type === 'file') return;
    event.preventDefault();
    let nextFormat: Format = item.format === 'edit' ? 'isolated' : 'edit';
    this.operatorModeStateService.setItemFormat(item, nextFormat, {
      request: new Deferred(),
    });
  }

  // The card the user is currently working with — i.e. the one a
  // keyboard shortcut should act on. "Last opened" alone is too coarse:
  // open A, open B, then click edit on A → A is the active card even
  // though B was opened more recently. Format changes count as
  // interactions (see StackItem.markInteracted), so this picks A.
  private get mostRecentlyInteractedStackItem(): StackItem | undefined {
    let topItems = this.operatorModeStateService.topMostStackItems();
    if (topItems.length === 0) return undefined;
    return topItems.reduce((a, b) =>
      b.lastInteractedAt > a.lastInteractedAt ? b : a,
    );
  }

  get stacks() {
    return this.operatorModeStateService.state?.stacks ?? [];
  }

  private get allStackItems() {
    return this.operatorModeStateService.state?.stacks.flat() ?? [];
  }

  private createCard = async (
    stackIndex: number,
    ref: CodeRef,
    relativeTo: RealmResourceIdentifier | URL | undefined,
    opts?: {
      realmURL?: URL;
      localDir?: LocalPath;
      doc?: LooseSingleCardDocument; // fill in card data with values
      cardModeAfterCreation?: Format;
    },
  ): Promise<string | undefined> => {
    let instance: CardDef;
    if (opts?.doc) {
      instance = await this.store.add(opts.doc, {
        doNotWaitForPersist: true,
        realm: opts?.realmURL?.href,
      });
    } else {
      let CardKlass = await loadCardDef(
        codeRefWithAbsoluteIdentifier(
          ref,
          relativeTo,
          undefined,
          this.network.virtualNetwork,
        ),
        {
          loader: this.loaderService.loader,
        },
      );
      instance = new CardKlass() as CardDef;
      await this.store.add(instance, {
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
      stackIndex,
      type: 'card',
    });
    this.addToStack(newItem);
    return localId;
  };

  private viewCard = (
    stackIndex: number,
    cardOrURL: CardDef | URL | string,
    format: Format | Event = 'isolated',
    opts?: {
      type?: StackItemType;
      openCardInRightMostStack?: boolean;
      stackIndex?: number;
      fieldType?: 'linksTo' | 'linksToMany' | 'contains' | 'containsMany';
      fieldName?: string;
      useBaseTemplate?: boolean;
    },
  ): void => {
    if (format instanceof Event) {
      // common when invoked from template {{on}} modifier
      format = 'isolated';
    }
    // When toggling the isolated template for a card already on the stack,
    // replace the existing item in-place rather than pushing a new one.
    // Two separate checks are needed:
    //   1. CardDef instances (including local-id-only cards with no .id yet) —
    //      findCardInStackSafe matches by instance identity or local id.
    //   2. String/URL inputs — matched below by resolved cardId after the
    //      CardDef branch is skipped.
    if (
      format === 'isolated' &&
      !(typeof cardOrURL === 'string' || cardOrURL instanceof URL) &&
      this.stacks[stackIndex]
    ) {
      let item = this.operatorModeStateService.findCardInStackSafe(
        cardOrURL,
        stackIndex,
      );
      if (item) {
        this.operatorModeStateService.viewCardOnStack(
          stackIndex,
          cardOrURL,
          opts,
        );
        return;
      }
    }
    let cardId = idFromCardOrURL(cardOrURL);
    if (!cardId) {
      return;
    }
    if (format === 'isolated') {
      let stack = this.stacks[stackIndex];
      let isOnStack = stack?.some((item) => item.id === cardId);
      if (isOnStack) {
        this.operatorModeStateService.viewCardOnStack(
          stackIndex,
          cardOrURL as CardDef,
          opts,
        );
        return;
      }
    }
    if (opts?.openCardInRightMostStack) {
      stackIndex = this.stacks.length;
    } else if (typeof opts?.stackIndex === 'number') {
      let allowedIndex = this.stacks.length;
      if (opts.stackIndex !== allowedIndex) {
        throw new Error(
          `stackIndex must target index ${allowedIndex}, received ${opts.stackIndex}`,
        );
      }
      let targetedStack = this.stacks[opts.stackIndex];
      let targetStackItem = targetedStack?.[targetedStack.length - 1];
      if (targetStackItem?.id === cardId) {
        this.operatorModeStateService.closeWorkspaceChooser();
        return;
      }
      stackIndex = opts.stackIndex;
    }
    let stackItemType = opts?.type ?? this.getStackItemType(cardOrURL, cardId);
    let newItem = new StackItem({
      id: cardId,
      format,
      stackIndex,
      type: stackItemType,
      useBaseTemplate: opts?.useBaseTemplate,
      relationshipContext: opts?.fieldName
        ? {
            fieldName: opts.fieldName,
            fieldType:
              opts.fieldType === 'linksTo' || opts.fieldType === 'linksToMany'
                ? opts.fieldType
                : undefined,
          }
        : undefined,
    });
    this.addToStack(newItem);
    this.operatorModeStateService.closeWorkspaceChooser();
  };

  private editCard = (
    stackIndex: number,
    card: CardDef,
    opts?: { useBaseTemplate?: boolean },
  ): void => {
    let item =
      this.stacks[stackIndex] &&
      this.operatorModeStateService.findCardInStackSafe(card, stackIndex);
    if (item) {
      this.operatorModeStateService.editCardOnStack(stackIndex, card, opts);
    } else {
      this.viewCard(stackIndex, card, 'edit', opts);
    }
  };

  private getStackItemType(
    cardOrURL: CardDef | URL | string,
    cardId: string,
  ): StackItemType {
    return detectStackItemTypeForTarget(cardOrURL, cardId, this.store);
  }

  private saveCard = (id: string): void => {
    this.store.save(id);
  };

  stackBackgroundsState = stackBackgroundsResource(this);

  private get backgroundImageStyle() {
    // only return a background image when both stacks originate from the same realm
    // otherwise we delegate to each stack to handle this
    let { hasDifferingBackgroundURLs } = this.stackBackgroundsState;
    if (this.stackBackgroundsState.backgroundImageURLs.length === 0) {
      return htmlSafe('');
    }
    if (!hasDifferingBackgroundURLs) {
      return htmlSafe(
        `background-image: url(${this.stackBackgroundsState.backgroundImageURLs[0]});`,
      );
    }
    return htmlSafe('');
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
        selections.delete(cardId);
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
      sourceIds: string[],
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
        // Materialize the selected cards now (lazily, only for a copy) rather
        // than when they were selected.
        let sources = (
          await Promise.all(sourceIds.map((id) => this.store.get(id)))
        ).filter(isCardInstance) as CardDef[];
        sources.sort((a, b) => a.cardTitle.localeCompare(b.cardTitle));
        let scrollToCardId: string | undefined;
        let newCardId: string | undefined;
        let targetStackIndex = destinationItem.stackIndex;
        for (let [index, card] of sources.entries()) {
          ({ newCardId } = await new CopyCardToStackCommand(
            this.toolService.commandContext,
          ).execute({
            sourceCard: card,
            targetStackIndex,
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

  @action
  private async requestDeleteCard(card: CardDef | URL | string): Promise<void> {
    let cardToDelete: CardToDelete | undefined;
    if (typeof card === 'object' && 'id' in card) {
      let loadedCard = card as CardDef;
      cardToDelete = {
        id: loadedCard.id,
        title: loadedCard.cardTitle,
      };
    } else {
      let cardUrl = card instanceof URL ? card : new URL(card as string);
      let loadedCard = await this.store.get(cardUrl.href);
      if (isCardInstance(loadedCard)) {
        cardToDelete = {
          id: loadedCard.id,
          title: loadedCard.cardTitle,
        };
      } else {
        let error = loadedCard;
        if (error.meta != null) {
          let cardTitle = error.meta.cardTitle || 'Unknown';
          cardToDelete = {
            id: cardUrl.href,
            title: cardTitle,
          };
        } else {
          throw new CardError(error.message, error);
        }
      }
    }
    this.cardToDelete = cardToDelete;
  }

  private selectCards = restartableTask(
    async (selectedCards: CardDefOrId[], stackItem: StackItem) => {
      let waiterToken = waiter.beginAsync();
      try {
        // Prerendered-card IDs arrive with the `.json` file extension on
        // them, but the canonical card id (and `cardToDelete.id` in the
        // delete handler) is the extensionless URL. Strip the extension
        // here so prune-on-delete and copy lookups match.
        let ids = selectedCards
          .map((cardDefOrId) => {
            let raw =
              typeof cardDefOrId === 'string' ? cardDefOrId : cardDefOrId.id;
            return raw ? removeFileExtension(raw) : undefined;
          })
          .filter(Boolean) as string[];

        let selected = cardSelections.get(stackItem);
        if (!selected) {
          selected = new TrackedSet([]);
          cardSelections.set(stackItem, selected);
        }
        selected.clear();
        for (let id of ids) {
          selected.add(id);
        }
      } finally {
        waiter.endAsync(waiterToken);
      }
    },
  );

  private get selectedCardIds() {
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
      !this.operatorModeStateService.hasAnyStackItemExpanded &&
      this.allStackItems.length > 0 &&
      this.stacks.length === 1 &&
      !this.operatorModeStateService.workspaceChooserOpened
    );
  }

  private openSelectedSearchResultInStack = restartableTask(
    async (cardId: string) => {
      let waiterToken = waiter.beginAsync();
      try {
        let searchSheetTrigger = this.searchSheetTrigger; // Will be set by showSearchWithTrigger

        // In case the left button was clicked, whatever is currently in stack with index 0 will be moved to stack with index 1,
        // and the card will be added to stack with index 0. shiftStack executes this logic.
        if (
          searchSheetTrigger ===
          SearchSheetTriggers.DropCardToLeftNeighborStackButton
        ) {
          let newItem = new StackItem({
            id: cardId,
            format: 'isolated',
            stackIndex: 0,
            type: this.getStackItemType(cardId, cardId),
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
          await this.viewCard(this.stacks.length, cardId, 'isolated');
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
            await this.viewCard(0, cardId, 'isolated');
          } else {
            stack = this.operatorModeStateService.rightMostStack();
            if (stack) {
              let bottomMostItem = stack[0];
              if (bottomMostItem) {
                let stackItem = new StackItem({
                  id: cardId,
                  format: 'isolated',
                  stackIndex,
                  type: this.getStackItemType(cardId, cardId),
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
    // A realm index card id and a recent card's id can be in different forms
    // (e.g. the base realm's alias `https://cardstack.com/base/index` vs an
    // instance's registered-prefix form `@cardstack/base/index`). Unresolve
    // both sides to the same form so index cards are excluded regardless.
    let { virtualNetwork } = this.network;
    const excludedCardIds = new Set(
      this.realmServer.availableRealmIndexCardIds.map((id) =>
        virtualNetwork.unresolveURL(id),
      ),
    );

    recentCards
      .filter(
        (card) => !excludedCardIds.has(virtualNetwork.unresolveURL(card.id)),
      ) // filter out realm index cards
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
          new MenuItem({
            label: name,
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
      new MenuItem({
        label: 'Choose a card type...',
        action: () => this.createCardInstance.perform(),
        icon: IconSearch,
      }),
      new MenuDivider(),
      new MenuItem({
        label: 'Open Code Mode',
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

    // assumption: take actions in the right-most stack
    await this.createCard(this.rightMostStackIndex, spec.ref, rri(specId), {
      realmURL: this.operatorModeStateService.getWritableRealmURL(),
    });
  });

  private createNewFromRecentType = restartableTask(
    async (codeRef: ResolvedCodeRef) => {
      // assumption: take actions in the right-most stack
      this.createCard(this.rightMostStackIndex, codeRef, undefined, {
        realmURL: this.operatorModeStateService.getWritableRealmURL(),
      });
    },
  );
  get rightMostStackIndex() {
    // assumption: take actions in the right-most stack
    let stackCount = this.operatorModeStateService.numberOfStacks();
    return stackCount > 0 ? stackCount - 1 : 0;
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
      <div
        class={{cn
          'interact-submode'
          has-expanded-card=this.operatorModeStateService.hasAnyStackItemExpanded
        }}
        style={{this.backgroundImageStyle}}
        {{onKeyMod 'Escape' this.handleEscape}}
        {{! Ctrl+E (not Cmd+E — taken by browsers' "Use Selection for Find").
           Lowercase 'e' matches event.key, so Dvorak/AZERTY users get the
           shortcut on whatever key produces 'e' on their layout. }}
        {{onKeyMod 'ctrl+e' this.handleToggleEdit}}
      >
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
        <div class={{cn 'stacks' is-multi-stack=(gt this.stacks.length 1)}}>
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
                  'stack'
                  stack-with-bg-image=backgroundImageURLSpecificToThisStack
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
                {{! @glint-expect-error: fn partial application loses async return type }}
                @createCard={{fn this.createCard stackIndex}}
                @viewCard={{fn this.viewCard stackIndex}}
                @saveCard={{this.saveCard}}
                @editCard={{fn this.editCard stackIndex}}
                @deleteCard={{this.requestDeleteCard}}
                @commandContext={{this.toolService.commandContext}}
                @close={{this.close}}
                @onSelectedCards={{this.onSelectedCards}}
                @setupStackItem={{this.setupStackItem}}
              />
            {{/let}}
          {{/each}}

          <CopyButton
            @selectedCardIds={{this.selectedCardIds}}
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

      .interact-submode-layout :deep(.submode-layout-top-bar) {
        position: absolute;
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
      .neighbor-stack-trigger {
        flex: 0;
        flex-basis: var(--container-button-size);
        position: absolute;
        z-index: var(--boxel-layer-floating-button);
      }
      /* Glass-morphism effect on the background */
      .interact-submode.has-expanded-card {
        background-color: var(--boxel-light-hover-35);
        backdrop-filter: blur(10px) saturate(160%);
        -webkit-backdrop-filter: blur(10px) saturate(160%);
      }
      .interact-submode:not(.has-expanded-card)
        .stacks.is-multi-stack
        .stack:first-of-type {
        padding-right: var(--operator-mode-spacing);
      }
      .interact-submode:not(.has-expanded-card)
        .stacks.is-multi-stack
        .stack:last-of-type {
        padding-left: var(--operator-mode-spacing);
      }
      /* In a multi-stack layout, collapse the stack that doesn't hold
         the expanded card so the expanded card fills the full width. */
      .interact-submode.has-expanded-card
        .stacks
        > :deep(.operator-mode-stack:not(:has(.item.expanded))) {
        display: none;
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
