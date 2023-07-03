import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { Card, CardContext } from 'https://cardstack.com/base/card-api';
import Preview from '@cardstack/host/components/preview';
import { fn, array } from '@ember/helper';
import type CardService from '@cardstack/host/services/card-service';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';
import optional from '@cardstack/boxel-ui/helpers/optional';
import cn from '@cardstack/boxel-ui/helpers/cn';
import { IconButton, Header, CardContainer, Button } from '@cardstack/boxel-ui';
import { type Actions, cardTypeDisplayName } from '@cardstack/runtime-common';
import type LoaderService from '@cardstack/host/services/loader-service';
import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import { TrackedArray } from 'tracked-built-ins';
import LinksToCardComponentModifier from '@cardstack/host/modifiers/links-to-card-component-modifier';
import { schedule } from '@ember/runloop';
import { SafeString } from '@ember/template';
import BoxelDropdown from '@cardstack/boxel-ui/components/dropdown';
import BoxelMenu from '@cardstack/boxel-ui/components/menu';
import menuItem from '@cardstack/boxel-ui/helpers/menu-item';
import { StackItem } from '@cardstack/host/components/operator-mode/container';
import OperatorModeOverlays from '@cardstack/host/components/operator-mode/overlays';

interface Signature {
  Args: {
    item: StackItem;
    index: number;
    publicAPI: Actions;
    addToStack: (item: StackItem) => void;
    cancel: (item: StackItem) => void;
    close: (item: StackItem) => void;
    delete: (item: StackItem) => void;
    dismissStackedCardsAbove: (stackIndex: number) => void;
    edit: (item: StackItem) => void;
    isBuried: (stackIndex: number) => boolean;
    save: (item: StackItem) => void;
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

  <template>
    <div
      class={{cn
      'item'
      buried=(@isBuried @index)
      }}
      data-test-stack-card-index={{@index}}
      data-test-stack-card={{@item.card.id}}
      style={{@styleForStackedCard @index}}
    >
      <CardContainer
        class={{cn
          'card'
          edit=(eq @item.format 'edit')
        }}
      >
        <Header
          @title={{cardTypeDisplayName @item.card}}
          class='header'
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
                    (fn @save @item @index)
                    icon='icon-check-mark'
                    )
                    (menuItem
                    'Delete'
                    (fn @delete @item @index)
                    icon='icon-trash'
                    )
                  )
                  (array
                    (menuItem
                    'Edit' (fn @edit @item @index) icon='icon-pencil'
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
              {{on 'click' (fn @close @item)}}
              data-test-close-button
            />
          </:actions>
        </Header>
        <div class='content'>
          <Preview
            @card={{@item.card}}
            @format={{@item.format}}
            @context={{this.context}}
          />
          <OperatorModeOverlays
            @renderedLinksToCards={{this.renderedLinksToCards}}
            @addToStack={{@addToStack}}
          />
        </div>
        {{#if (eq @item.format 'edit')}}
          <footer class='footer'>
            <Button
              @kind='secondary-light'
              @size='tall'
              class='footer-button'
              {{on 'click' (fn @cancel @item)}}
              aria-label='Cancel'
              data-test-cancel-button
            >
              Cancel
            </Button>
            <Button
              @kind='primary'
              @size='tall'
              class='footer-button'
              {{on 'click' (fn @save @item)}}
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
      :global(:root) {
        --stack-card-footer-height: 5rem;
        --buried-operator-mode-header-height: 2.5rem;
      }

      .item {
        justify-self: center;
        position: absolute;
        width: 89%;
        height: inherit;
        z-index: 0;
        overflow: hidden;
        pointer-events: none;
      }

      .card {
        position: relative;
        height: 100%;
        display: grid;
        grid-template-rows: 7.5rem auto;
        box-shadow: 0 15px 30px 0 rgb(0 0 0 / 35%);
        pointer-events: auto;
      }

      .content {
        overflow: auto;
      }

      .content > .boxel-card-container.boundaries {
        box-shadow: none;
      }

      .content > .boxel-card-container > header {
        display: none;
      }

      .edit .content {
        margin-bottom: var(--stack-card-footer-height);
      }

      .footer {
        position: absolute;
        bottom: 0;
        right: 0;
        display: flex;
        justify-content: flex-end;
        padding: var(--boxel-sp);
        width: 100%;
        background: white;
        height: var(--stack-card-footer-height);
        border-top: 1px solid var(--boxel-300);
        border-bottom-left-radius: var(--boxel-border-radius);
        border-bottom-right-radius: var(--boxel-border-radius);
      }

      .footer-button + .footer-button {
        margin-left: var(--boxel-sp-xs);
      }

      .buried .card {
        background-color: var(--boxel-200);
        grid-template-rows: var(--buried-operator-mode-header-height) auto;
      }

      .buried .header .icon-button {
        display: none;
      }

      .buried .header {
        cursor: pointer;
        font: 500 var(--boxel-font-sm);
        padding: 0 var(--boxel-sp-xs);
      }
    </style>
  </template>
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    OperatorModeStackItem: typeof OperatorModeStackItem;
  }
}
