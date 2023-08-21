import Component from '@glimmer/component';
import { task } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import { htmlSafe } from '@ember/template';
import OperatorModeStackItem from './stack-item';
import type { Actions } from '@cardstack/runtime-common';
import type { StackItem } from './container';
import type { Card } from 'https://cardstack.com/base/card-api';

interface Signature {
  Element: HTMLElement;
  Args: {
    tag?: keyof HTMLElementTagNameMap;
    stackItems: StackItem[];
    stackIndex: number;
    publicAPI: Actions;
    backgroundImageURL: string | undefined;
    close: (stackItem: StackItem) => void;
    edit: (stackItem: StackItem) => void;
    save: (stackItem: StackItem, dismiss: boolean) => void;
    delete: (card: Card) => void;
    onSelectedCards: (selectedCards: Card[], stackItem: StackItem) => void;
    setupStackItem: (
      stackItem: StackItem,
      clearSelections: () => void,
      doWithStableScroll: (changeSizeCallback: () => Promise<void>) => void,
    ) => void;
  };
  Blocks: {};
}

export default class OperatorModeStack extends Component<Signature> {
  dismissStackedCardsAbove = task(async (itemIndex: number) => {
    let itemsToDismiss: StackItem[] = [];
    for (let i = this.args.stackItems.length - 1; i > itemIndex; i--) {
      itemsToDismiss.push(this.args.stackItems[i]);
    }
    await Promise.all(itemsToDismiss.map((i) => this.args.close(i)));
  });

  get backgroundImageStyle() {
    if (!this.args.backgroundImageURL) {
      return '';
    }
    return htmlSafe(`background-image: url(${this.args.backgroundImageURL});`);
  }

  <template>
    <div
      ...attributes
      class={{if @backgroundImageURL 'with-bg-image'}}
      style={{this.backgroundImageStyle}}
    >
      <div class='inner'>
        {{#each @stackItems as |item i|}}
          <OperatorModeStackItem
            @item={{item}}
            @index={{i}}
            @stackItems={{@stackItems}}
            @publicAPI={{@publicAPI}}
            @dismissStackedCardsAbove={{perform this.dismissStackedCardsAbove}}
            @close={{@close}}
            @edit={{@edit}}
            @save={{@save}}
            @delete={{@delete}}
            @onSelectedCards={{@onSelectedCards}}
            @setupStackItem={{@setupStackItem}}
          />
        {{/each}}
      </div>
    </div>

    <style>
      .operator-mode-stack {
        z-index: 0;
        height: 100%;
        width: 100%;
        background-position: center;
        background-size: cover;
        padding: var(--boxel-sp-lg) var(--boxel-sp-sm) 0;
        position: relative;
      }
      .operator-mode-stack.with-bg-image:before {
        content: ' ';
        height: 100%;
        width: 2px;
        background-color: black;
        display: block;
        position: absolute;
        top: 0;
        left: -1px;
      }
      .operator-mode-stack.with-bg-image:first-child:before {
        display: none;
      }

      .inner {
        height: calc(
          100% - var(--search-sheet-closed-height) + var(--boxel-sp)
        );
        position: relative;
        display: flex;
        justify-content: center;
        max-width: 50rem;
        padding-top: var(--boxel-sp-xxl);
        margin: 0 auto;
        border-bottom-left-radius: var(--boxel-border-radius);
        border-bottom-right-radius: var(--boxel-border-radius);
      }
    </style>
  </template>
}
