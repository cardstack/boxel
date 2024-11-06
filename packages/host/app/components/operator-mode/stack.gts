import Component from '@glimmer/component';

import { task } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';

import type { Actions } from '@cardstack/runtime-common';

import type { StackItem } from '@cardstack/host/lib/stack-item';

import OperatorModeStackItem, {
  type StackItemComponentAPI,
  CardDefOrId,
} from './stack-item';

interface Signature {
  Element: HTMLElement;
  Args: {
    tag?: keyof HTMLElementTagNameMap;
    stackItems: StackItem[];
    stackIndex: number;
    publicAPI: Actions;
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
    <div class='operator-mode-stack' ...attributes>
      <div class='inner'>
        {{#each @stackItems as |item i|}}
          <OperatorModeStackItem
            @item={{item}}
            @index={{i}}
            @stackItems={{@stackItems}}
            @publicAPI={{@publicAPI}}
            @dismissStackedCardsAbove={{perform this.dismissStackedCardsAbove}}
            @close={{@close}}
            @onSelectedCards={{@onSelectedCards}}
            @setupStackItem={{this.setupStackItem}}
          />
        {{/each}}
      </div>
    </div>

    <style scoped>
      :global(:root) {
        --stack-padding-top: calc(
          var(--operator-mode-top-bar-item-height) +
            (2 * (var(--operator-mode-spacing)))
        );
        --stack-padding-bottom: calc(
          var(--operator-mode-bottom-bar-item-height) +
            (2 * (var(--operator-mode-spacing)))
        );
      }
      .operator-mode-stack {
        z-index: 0;
        height: 100%;
        width: 100%;
        background-position: center;
        background-size: cover;
        padding: var(--stack-padding-top) var(--operator-mode-spacing)
          var(--stack-padding-bottom);
        position: relative;
        transition: padding-top var(--boxel-transition);
      }
      .operator-mode-stack
        :deep(.field-component-card.fitted-format .missing-embedded-template) {
        margin-top: calc(-1 * var(--boxel-sp-lg));
        border-radius: 0;
        border-bottom-left-radius: var(--boxel-form-control-border-radius);
        border-bottom-right-radius: var(--boxel-form-control-border-radius);
      }
      .inner {
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
