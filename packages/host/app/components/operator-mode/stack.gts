import Component from '@glimmer/component';

import { task } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';

import { provide } from 'ember-provide-consume-context';

import { cn, eq, gte } from '@cardstack/boxel-ui/helpers';

import {
  CardCrudFunctionsContextName,
  type ToolContext,
} from '@cardstack/runtime-common';

import type { StackItem } from '@cardstack/host/lib/stack-item';

import type {
  CreateCardFn,
  DeleteCardFn,
  EditCardFn,
  SaveCardFn,
  ViewCardFn,
} from 'https://cardstack.com/base/card-api';

import OperatorModeStackItem, {
  type StackItemComponentAPI,
} from './stack-item';

import type { CardDefOrId } from './stack-item';

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
    commandContext: ToolContext;
    close: (stackItem: StackItem) => void;
    onSelectedCards: (
      selectedCards: CardDefOrId[],
      stackItem: StackItem,
    ) => void;
    setupStackItem: (
      model: StackItem,
      componentAPI: StackItemComponentAPI,
    ) => void;
  };
  Blocks: {};
}

export default class OperatorModeStack extends Component<Signature> {
  private stackItemComponentAPI = new WeakMap<
    StackItem,
    StackItemComponentAPI
  >();

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

  dismissStackedCardsAbove = task(async (itemIndex: number) => {
    let itemsToDismiss: StackItem[] = [];
    for (let i = this.args.stackItems.length - 1; i > itemIndex; i--) {
      itemsToDismiss.push(this.args.stackItems[i]);
    }

    // Animate closing items
    const animations = itemsToDismiss
      .map((item) => {
        const componentAPI = this.stackItemComponentAPI.get(item);
        return componentAPI?.startAnimation('closing') ?? undefined;
      })
      .filter(Boolean);

    // Animate next top item moving forward
    const nextTopItem = this.args.stackItems[itemIndex];
    const nextTopItemAPI = this.stackItemComponentAPI.get(nextTopItem);

    if (nextTopItemAPI) {
      animations.push(nextTopItemAPI.startAnimation('movingForward'));
    }

    await Promise.all(animations);

    await Promise.all(itemsToDismiss.map((i) => this.args.close(i)));
  });

  private setupStackItem = (
    item: StackItem,
    componentAPI: StackItemComponentAPI,
  ) => {
    this.args.setupStackItem(item, componentAPI);
    this.stackItemComponentAPI.set(item, componentAPI);
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
      <div class='inner'>
        {{#each @stackItems as |item i|}}
          <OperatorModeStackItem
            @item={{item}}
            @index={{i}}
            @stackItems={{@stackItems}}
            @commandContext={{@commandContext}}
            @dismissStackedCardsAbove={{perform this.dismissStackedCardsAbove}}
            @requestDeleteCard={{@deleteCard}}
            @close={{@close}}
            @onSelectedCards={{@onSelectedCards}}
            @setupStackItem={{this.setupStackItem}}
          />
        {{/each}}
      </div>
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
        transition:
          padding-top var(--boxel-transition),
          padding-inline var(--boxel-transition);
      }
      .stack-medium-padding-top:not(:has(.item.expanded)) {
        --stack-padding-top: var(--stack-md-padding-top);
      }
      .stack-small-padding-top:not(:has(.item.expanded)) {
        --stack-padding-top: var(--stack-sm-padding-top);
      }
      .operator-mode-stack:has(.item.expanded) {
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
    </style>
  </template>
}
