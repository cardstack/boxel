import Component from '@glimmer/component';

import { task } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';

import type { Actions } from '@cardstack/runtime-common';

import type { StackItem } from '@cardstack/host/lib/stack-item';

import OperatorModeStackItem, { CardDefOrId } from './stack-item';
import { type CardDef } from 'https://cardstack.com/base/card-api';

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
      stackItem: StackItem,
      clearSelections: () => void,
      doWithStableScroll: (changeSizeCallback: () => Promise<void>) => void,
      doScrollIntoView: (selector: string) => void,
    ) => void;
    saveCard: (card: CardDef) => Promise<CardDef | undefined>;
  };
  Blocks: {};
}

export default class OperatorModeStack extends Component<Signature> {
  private closeAnimation = new WeakMap<StackItem, () => void>();

  dismissStackedCardsAbove = task(async (itemIndex: number) => {
    let itemsToDismiss: StackItem[] = [];
    for (let i = this.args.stackItems.length - 1; i > itemIndex; i--) {
      itemsToDismiss.push(this.args.stackItems[i]);
    }

    // do closing animation on last item
    const lastItem = this.args.stackItems[this.args.stackItems.length - 1];
    const closeAnimation = this.closeAnimation.get(lastItem);
    if (closeAnimation) {
      await closeAnimation();
    }

    await Promise.all(itemsToDismiss.map((i) => this.args.close(i)));
  });

  private setupStackItem = (
    item: StackItem,
    doClearSelections: () => void,
    doWithStableScroll: (changeSizeCallback: () => Promise<void>) => void,
    doScrollIntoView: (selector: string) => void,
    doCloseAnimation: () => void,
  ) => {
    this.args.setupStackItem(
      item,
      doClearSelections,
      doWithStableScroll,
      doScrollIntoView,
    );
    this.closeAnimation.set(item, doCloseAnimation);
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
            @saveCard={{@saveCard}}
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
