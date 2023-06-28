import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { Card, Format } from 'https://cardstack.com/base/card-api';
import { action } from '@ember/object';
import { fn } from '@ember/helper';
import { trackedFunction } from 'ember-resources/util/function';
import CardCatalogModal from '@cardstack/host/components/card-catalog-modal';
import type CardService from '@cardstack/host/services/card-service';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';
import { Modal } from '@cardstack/boxel-ui';
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
import { htmlSafe, SafeString } from '@ember/template';
import { registerDestructor } from '@ember/destroyable';
import type { Query } from '@cardstack/runtime-common/query';
import {
  getSearchResults,
  type Search,
} from '@cardstack/host/resources/search';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';
import perform from 'ember-concurrency/helpers/perform';
import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import OperatorModeStackItem from './stack-item';

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
};

export default class OperatorModeContainer extends Component<Signature> {
  //A variable to store value of card field
  //before in edit mode.
  cardFieldValues: WeakMap<Card, Map<string, any>> = new WeakMap<
    Card,
    Map<string, any>
  >();
  @service declare loaderService: LoaderService;
  @service declare cardService: CardService;
  @service declare operatorModeStateService: OperatorModeStateService;
  @tracked searchSheetMode: SearchSheetMode = SearchSheetMode.Closed;

  constructor(owner: unknown, args: any) {
    super(owner, args);

    (globalThis as any)._CARDSTACK_CARD_SEARCH = this;
    registerDestructor(this, () => {
      delete (globalThis as any)._CARDSTACK_CARD_SEARCH;
      this.operatorModeStateService.clearStack();
    });
  }

  get stack() {
    // We return the first one until we start supporting 2 stacks
    return this.operatorModeStateService.state?.stacks[0]?.items;
  }

  @action
  getCards(query: Query): Search {
    return getSearchResults(this, () => query);
  }

  @action onFocusSearchInput() {
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
        });
      }
    }
  }

  //TODO: Implement remove card function
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

  private publicAPI: Actions = {
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
      let newCard = await this.cardService.createFromSerialized(
        doc.data,
        doc,
        relativeTo ?? this.cardService.defaultURL
      );
      let newItem: StackItem = {
        card: newCard,
        format: 'edit',
        request: new Deferred(),
        isLinkedCard: opts?.isLinkedCard,
      };
      this.addToStack(newItem);
      return await newItem.request?.promise;
    },
    viewCard: (card: Card) => {
      return this.addToStack({ card, format: 'isolated' });
    },
    createCardDirectly: async (
      doc: LooseSingleCardDocument,
      relativeTo: URL | undefined
    ): Promise<void> => {
      let newCard = await this.cardService.createFromSerialized(
        doc.data,
        doc,
        relativeTo ?? this.cardService.defaultURL
      );
      await this.cardService.saveModel(newCard);
      let newItem: StackItem = {
        card: newCard,
        format: 'isolated',
      };
      this.addToStack(newItem);
      return;
    },
  };

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

  @action
  styleForStackedCard(index: number): SafeString {
    let invertedIndex = this.stack.length - index - 1;

    let widthReductionPercent = 5; // Every new card on the stack is 5% wider than the previous one
    let offsetPx = 40; // Every new card on the stack is 40px lower than the previous one

    return htmlSafe(`
      width: ${100 - invertedIndex * widthReductionPercent}%;
      z-index: ${this.stack.length - invertedIndex};
      padding-top: calc(${offsetPx}px * ${index});
    `);
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
      };
      this.addToStack(newItem);
    }
  });

  @action
  isBuried(stackIndex: number) {
    return stackIndex + 1 < this.stack.length;
  }

  @action
  async dismissStackedCardsAbove(stackIndex: number) {
    for (let i = this.stack.length - 1; i > stackIndex; i--) {
      let stackItem = this.stack[i];
      await this.close(stackItem);
    }
  }

  fetchBackgroundImageURL = trackedFunction(this, async () => {
    let mostBottomCard = this.stack?.[0]?.card;
    let realmInfoSymbol = await this.cardService.realmInfoSymbol();
    // @ts-ignore allows using Symbol as an index
    return mostBottomCard?.[realmInfoSymbol]?.backgroundURL;
  });

  get backgroundImageURL() {
    return this.fetchBackgroundImageURL.value ?? '';
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

      {{#if (eq this.stack.length 0)}}
        <div class='no-cards'>
          <p class='add-card-title'>Add a card to get
            started</p>
          {{! Cannot find an svg icon with plus in the box
          that we can fill the color of the plus and the box. }}
          <button
            class='add-card-button icon-button'
            {{on 'click' (fn (perform this.addCard))}}
            data-test-add-card-button
          >
            {{svgJar 'icon-plus' width='50px' height='50px'}}
          </button>
        </div>
      {{else}}
        <div class='card-stack' data-test-card-stack>
          {{#each this.stack as |item i|}}
            <OperatorModeStackItem
              @item={{item}}
              @index={{i}}
              @publicAPI={{this.publicAPI}}
              @addToStack={{this.addToStack}}
              @dismissStackedCardsAbove={{this.dismissStackedCardsAbove}}
              @isBuried={{this.isBuried}}
              @close={{this.close}}
              @cancel={{this.cancel}}
              @edit={{this.edit}}
              @delete={{this.delete}}
              @save={{this.save}}
              @styleForStackedCard={{this.styleForStackedCard}}
            />
          {{/each}}
        </div>
      {{/if}}
      <SearchSheet
        @mode={{this.searchSheetMode}}
        @onCancel={{this.onCancelSearchSheet}}
        @onFocus={{this.onFocusSearchInput}}
        @recentCards={{this.operatorModeStateService.recentCards}}
      />
    </Modal>
    <style>
      :global(:root) {
        --operator-mode-bg-color: #686283;
      }

      .operator-mode > div {
        align-items: flex-start;
      }
  
      .no-cards {
        height: calc(100% - var(--search-sheet-closed-height));
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

      .card-stack {
        position: relative;
        height: calc(100% - var(--search-sheet-closed-height));
        width: 100%;
        max-width: 50rem;
        padding-top: var(--boxel-sp-xxl);
        display: flex;
        justify-content: center;
        overflow: hidden;
        z-index: 0;
      }
    </style>
  </template>
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    'OperatorMode::Container': typeof OperatorModeContainer;
  }
}
