import Component from '@glimmer/component';
import { Actions } from '@cardstack/runtime-common';
import { StackItem } from '@cardstack/host/components/operator-mode/container';
import OperatorModeStackItem from '@cardstack/host/components/operator-mode/stack-item';
import { action } from '@ember/object';

interface Signature {
  Element: HTMLElement;
  Args: {
    tag?: keyof HTMLElementTagNameMap;
    stackItems: StackItem[];
    stackIndex: number;
    publicAPI: Actions;
    close: (stackItem: StackItem) => void;
    edit: (stackItem: StackItem) => void;
    delete: (stackItem: StackItem) => void;
    save: (stackItem: StackItem) => void;
  };
  Blocks: {};
}

export default class OperatorModeStack extends Component<Signature> {
  @action
  async dismissStackedCardsAbove(itemIndex: number) {
    for (let i = this.args.stackItems.length - 1; i > itemIndex; i--) {
      this.args.close(this.args.stackItems[i]);
    }
  }

  <template>
    <div ...attributes>
      {{#each @stackItems as |item i|}}
        <OperatorModeStackItem
          @item={{item}}
          @index={{i}}
          @stackItems={{@stackItems}}
          @publicAPI={{@publicAPI}}
          @dismissStackedCardsAbove={{this.dismissStackedCardsAbove}}
          @close={{@close}}
          @edit={{@edit}}
          @delete={{@delete}}
          @save={{@save}}
        />
      {{/each}}
    </div>

    <style>
      .operator-mode-stack {
        height: calc(100% - var(--search-sheet-closed-height));
        position: relative;
        width: 100%;
        max-width: 50rem;
        padding-top: var(--boxel-sp-xxl);
        display: flex;
        justify-content: center;
        overflow: hidden;
        z-index: 0;
        margin-left: var(--boxel-sp-xs);
        margin-right: var(--boxel-sp-xs);
      }

      /* Add some padding to accomodate for overlaid header for embedded cards in operator mode */
      :global(.operator-mode-stack .embedded-card) {
        padding-top: calc(
          var(--overlay-embedded-card-header-height) + var(--boxel-sp-lg)
        );
      }
      /* This is repeated for the edit-card because specifying multiple selectors in :global don't work */
      :global(.operator-mode-stack .edit-card) {
        padding-top: calc(
          var(--overlay-embedded-card-header-height) + var(--boxel-sp-lg)
        );
      }

    </style>
  </template>
}
