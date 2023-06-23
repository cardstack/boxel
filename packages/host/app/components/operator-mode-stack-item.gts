import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { Card, CardContext, Format } from 'https://cardstack.com/base/card-api';
import Preview from './preview';
import { action } from '@ember/object';
import { fn, array } from '@ember/helper';
import type CardService from '../services/card-service';
// import getValueFromWeakMap from '../helpers/get-value-from-weakmap';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';
import optional from '@cardstack/boxel-ui/helpers/optional';
import cn from '@cardstack/boxel-ui/helpers/cn';
import {
  IconButton,
  Header,
  CardContainer,
  Button,
} from '@cardstack/boxel-ui';
import { restartableTask } from 'ember-concurrency';
import {
  Deferred,
  baseCardRef,
  chooseCard,
  type Actions,
  cardTypeDisplayName,
} from '@cardstack/runtime-common';
import type LoaderService from '../services/loader-service';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { TrackedArray } from 'tracked-built-ins';
import LinksToCardComponentModifier from '@cardstack/host/modifiers/links-to-card-component-modifier';
import { schedule } from '@ember/runloop';
import { SafeString } from '@ember/template';
import BoxelDropdown from '@cardstack/boxel-ui/components/dropdown';
import BoxelMenu from '@cardstack/boxel-ui/components/menu';
import menuItem from '@cardstack/boxel-ui/helpers/menu-item';
import { StackItem } from '@cardstack/host/components/operator-mode';
import OperatorModeOverlays from '@cardstack/host/components/operator-mode-overlays';

interface Signature {
  Args: {
    item: StackItem;
    index: number;
    publicAPI: Actions;
    addToStack: (item: StackItem) => void;
    dismissStackedCardsAbove: (stackIndex: number) => void;
    isBuried: (stackIndex: number) => boolean;
    removeItemFromStack: (item: StackItem) => void;
    replaceItemInStack: (item: StackItem, newStackItem: StackItem) => void;
    styleForStackedCard: (stackIndex: number) => SafeString;
  };
}

export interface RenderedLinksToCard {
  element: HTMLElement;
  card: Card;
  context: CardContext;
  stackedAtIndex: number;
}

export default class OperatorModeStackItem extends Component<Signature> {
  //A variable to store value of card field
  //before in edit mode.
  cardFieldValues: WeakMap<Card, Map<string, any>> = new WeakMap<
    Card,
    Map<string, any>
  >();
  @service declare loaderService: LoaderService;
  @service declare cardService: CardService;

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

    this.args.replaceItemInStack(item, newItem);
    return newItem;
  }

  @action async close(item: StackItem) {
    await this.rollbackCardFieldValues(item.card);
    this.args.removeItemFromStack(item);
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
        this.args.replaceItemInStack(item, {
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

  get context() {
    return {
      renderedIn: this as Component<any>,
      cardComponentModifier: LinksToCardComponentModifier,
      actions: this.args.publicAPI,
    };
  }

  @tracked renderedLinksToCards = new TrackedArray<RenderedLinksToCard>([]);
  registerLinkedCardElement(
    linksToCardElement: HTMLElement,
    linksToCard: Card,
    context: CardContext
  ) {
    // Without scheduling this after render, this produces the "attempted to update value, but it had already been used previously in the same computation" type error
    schedule('afterRender', () => {
      this.renderedLinksToCards.push({
        element: linksToCardElement,
        card: linksToCard,
        stackedAtIndex: this.args.index,
        context,
      });
    });
  }

  unregisterLinkedCardElement(card: Card) {
    let index = this.renderedLinksToCards.findIndex(
      (renderedLinksToCard) => renderedLinksToCard.card === card
    );
    if (index !== -1) {
      this.renderedLinksToCards.splice(index, 1);
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
      };
      this.args.addToStack(newItem);
    }
  });

  <template>
    <div
      class={{cn
      'operator-mode-stack-item'
      operator-mode-stack-item__buried=(@isBuried @index)
      }}
      data-test-stack-card-index={{@index}}
      data-test-stack-card={{@item.card.id}}
      style={{@styleForStackedCard @index}}
    >
      <CardContainer
        class={{cn
          'operator-mode-stack-item__card'
          operator-mode-stack-item__card--edit=(eq @item.format 'edit')
        }}
      >
        {{! z-index and offset calculation in the OperatorModeOverlays operates under assumption that it is nested under element with class operator-mode-stack-item }}
        <OperatorModeOverlays
            @renderedLinksToCards={{this.renderedLinksToCards}}
            @addToStack={{@addToStack}}
          />
        <Header
          @title={{cardTypeDisplayName @item.card}}
          class='operator-mode-stack-item__card__header'
          {{on
          'click'
          (optional
              (if
              (@isBuried @index) (fn @dismissStackedCardsAbove @index)
              )
          )
          }}
          data-test-stack-card-header
        >
          <:actions>
            <BoxelDropdown>
              <:trigger as |bindings|>
                <IconButton
                  @icon='icon-horizontal-three-dots'
                  @width='20px'
                  @height='20px'
                  class='icon-button'
                  aria-label='Options'
                  data-test-edit-button
                  {{bindings}}
                />
              </:trigger>
              <:content as |dd|>
                <BoxelMenu
                  @closeMenu={{dd.close}}
                  @items={{if
                  (eq @item.format 'edit')
                  (array
                    (menuItem
                    'Finish Editing'
                    (fn this.save @item @index)
                    icon='icon-check-mark'
                    )
                    (menuItem
                    'Delete'
                    (fn this.delete @item @index)
                    icon='icon-trash'
                    )
                  )
                  (array
                    (menuItem
                    'Edit' (fn this.edit @item @index) icon='icon-pencil'
                    )
                  )
                  }}
                />
              </:content>
            </BoxelDropdown>
            <IconButton
              @icon='icon-x'
              @width='20px'
              @height='20px'
              class='icon-button'
              aria-label='Close'
              {{on 'click' (fn this.close @item)}}
              data-test-close-button
            />
          </:actions>
        </Header>
        <div class='operator-mode-stack-item__card__content'>
          <Preview
            @card={{@item.card}}
            @format={{@item.format}}
            @context={{this.context}}
          />
        </div>
        {{#if (eq @item.format 'edit')}}
          <footer class='operator-mode-stack-item__card__footer'>
            <Button
              @kind='secondary-light'
              @size='tall'
              class='operator-mode-stack-item__card__footer-button'
              {{on 'click' (fn this.cancel @item)}}
              aria-label='Cancel'
              data-test-cancel-button
            >
              Cancel
            </Button>
            <Button
              @kind='primary'
              @size='tall'
              class='operator-mode-stack-item__card__footer-button'
              {{on 'click' (fn this.save @item)}}
              aria-label='Save'
              data-test-save-button
            >
              Save
            </Button>
          </footer>
        {{/if}}
      </CardContainer>
    </div>
    <style>
      .operator-mode-stack-item__buried .operator-mode-stack-item__card {
      background-color: var(--boxel-200); grid-template-rows:
      var(--buried-operator-mode-header-height) auto; }
      .operator-mode-stack-item__buried .operator-mode-stack-item__card__header
      .icon-button { display: none; } .operator-mode-stack-item__buried
      .operator-mode-stack-item__card__header { cursor: pointer; font: 500
      var(--boxel-font-sm); padding: 0 var(--boxel-sp-xs); }
      .operator-mode-overlayed-button { z-index: 1; }
      .operator-mode-stack-item__card__header { z-index: 2; background: var(--boxel-light); }
      .operator-mode-stack-item__card__footer { z-index: 2; }
    </style>
  </template>
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    OperatorModeStackItem: typeof OperatorModeStackItem;
  }
}
