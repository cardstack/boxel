import { service } from '@ember/service';
import Component from '@glimmer/component';

import { provide } from 'ember-provide-consume-context';

import { cn, eq, gte } from '@cardstack/boxel-ui/helpers';

import {
  CardCrudFunctionsContextName,
  type ToolContext,
} from '@cardstack/runtime-common';

import type { StackItem } from '@cardstack/host/lib/stack-item';

import StackMotion from './motion/stack-motion';
import OperatorModeStackItem, {
  type StackItemComponentAPI,
} from './stack-item';

import type OperatorModeStateService from '../../services/operator-mode-state-service';

import type {
  CreateCardFn,
  DeleteCardFn,
  EditCardFn,
  SaveCardFn,
  ViewCardFn,
} from '@cardstack/base/card-api';

interface Signature {
  Element: HTMLElement;
  Args: {
    tag?: keyof HTMLElementTagNameMap;
    stackItems: StackItem[];
    stackIndex: number;
    createCard: CreateCardFn;
    viewCard: ViewCardFn;
    editCard: EditCardFn;
    saveCard: SaveCardFn;
    deleteCard: DeleteCardFn;
    toolContext: ToolContext;
    close: (stackItem: StackItem) => void;
    setupStackItem: (
      model: StackItem,
      componentAPI: StackItemComponentAPI,
    ) => void;
  };
  Blocks: {};
}

export default class OperatorModeStack extends Component<Signature> {
  @service declare private operatorModeStateService: OperatorModeStateService;

  @provide(CardCrudFunctionsContextName)
  // @ts-ignore "cardCrudFunctions" is declared but not used
  private get cardCrudFunctions(): CardCrudFunctions {
    return {
      createCard: this.args.createCard,
      saveCard: this.args.saveCard,
      editCard: this.args.editCard,
      viewCard: this.args.viewCard,
      deleteCard: this.args.deleteCard,
    };
  }

  // Closes every card above the one at `itemIndex`, top card first. The
  // cards leave the stack at once; the stack's motion region shows them
  // leaving (ADR 007 §1.1: state never waits on an animation).
  private dismissStackedCardsAbove = (itemIndex: number) => {
    let itemsToDismiss: StackItem[] = [];
    for (let i = this.args.stackItems.length - 1; i > itemIndex; i--) {
      itemsToDismiss.push(this.args.stackItems[i]);
    }
    for (let item of itemsToDismiss) {
      this.args.close(item);
    }
  };

  <template>
    <div
      class={{cn
        'operator-mode-stack'
        stack-medium-padding-top=(eq @stackItems.length 2)
        stack-small-padding-top=(gte @stackItems.length 3)
      }}
      ...attributes
    >
      {{! the stack's motion region: its cards are the participants (motion/stack-motion.gts) }}
      <StackMotion
        class='inner'
        @phone={{this.operatorModeStateService.isMobileViewport}}
      >
        {{#each @stackItems as |item i|}}
          <OperatorModeStackItem
            @item={{item}}
            @index={{i}}
            @stackItems={{@stackItems}}
            @toolContext={{@toolContext}}
            @dismissStackedCardsAbove={{this.dismissStackedCardsAbove}}
            @requestDeleteCard={{@deleteCard}}
            @close={{@close}}
            @setupStackItem={{@setupStackItem}}
          />
        {{/each}}
      </StackMotion>
    </div>

    <style scoped>
      :global(:root) {
        --stack-lg-padding-top: calc(
          var(--operator-mode-top-bar-item-height) +
            (2 * (var(--operator-mode-spacing)))
        );
        --stack-md-padding-top: calc(var(--stack-lg-padding-top) / 2);
        --stack-sm-padding-top: var(--operator-mode-spacing);

        --stack-padding-top: var(--stack-lg-padding-top);
        --stack-padding-bottom: var(--boxel-sp-lg);
        --stack-padding-inline: var(--boxel-sp-lg);
      }
      .operator-mode-stack {
        position: relative;
        height: 100%;
        width: 100%;
        background-position: center;
        background-size: cover;
        padding-top: var(--stack-padding-top);
        padding-inline: var(--stack-padding-inline);
        padding-bottom: var(--stack-padding-bottom);
        z-index: 0;
      }
      /* The padding follows the cards standing in the stack: a leaving card
         is kept in the region's orphan layer while it fades, and must not
         hold the padding it had */
      .stack-medium-padding-top:not(:has(> .inner > .item.expanded)) {
        --stack-padding-top: var(--stack-md-padding-top);
      }
      .stack-small-padding-top:not(:has(> .inner > .item.expanded)) {
        --stack-padding-top: var(--stack-sm-padding-top);
      }
      .operator-mode-stack:has(> .inner > .item.expanded) {
        --stack-padding-inline: 0;
        --stack-padding-bottom: 0;
      }
      .operator-mode-stack
        :deep(.field-component-card.fitted-format .missing-template) {
        margin-top: calc(-1 * var(--boxel-sp-lg));
        border-radius: 0;
        border-bottom-left-radius: var(--boxel-form-control-border-radius);
        border-bottom-right-radius: var(--boxel-form-control-border-radius);
      }
      .inner {
        width: 100%;
        height: 100%;
        position: relative;
        display: flex;
        justify-content: center;
        margin: 0 auto;
        border-bottom-left-radius: var(--boxel-border-radius);
        border-bottom-right-radius: var(--boxel-border-radius);
      }
      /* A leaving card is a picture of what was: nothing in it takes input */
      .inner :deep([data-choreo-orphans] *) {
        pointer-events: none;
      }
    </style>
  </template>
}
