import Component from '@glimmer/component';
import { Actions } from '@cardstack/runtime-common';
import { StackItem } from '@cardstack/host/components/operator-mode/container';
import OperatorModeStackItem from '@cardstack/host/components/operator-mode/stack-item';
import { action } from '@ember/object';

interface Signature {
  Args: {
    stackItems: StackItem[];
    stackIndex: number;
    publicAPI: Actions;
    close: (stackItem: StackItem) => void;
    cancel: (stackItem: StackItem) => void;
    edit: (stackItem: StackItem) => void;
    delete: (stackItem: StackItem) => void;
    save: (stackItem: StackItem) => void;
  };
}

export default class OperatorModeStack extends Component<Signature> {
  @action
  async dismissStackedCardsAbove(itemIndex: number) {
    for (let i = this.args.stackItems.length - 1; i > itemIndex; i--) {
      this.args.close(this.args.stackItems[i]);
    }
  }

  <template>
    {{! Argument of type 'unknown' is not assignable to parameter of type 'Element'. (this is because of ...attributes) }}
    {{! @glint-ignore}}
    <div ...attributes>
      {{#each @stackItems as |item i|}}
        <OperatorModeStackItem
          @item={{item}}
          @index={{i}}
          @stackItems={{@stackItems}}
          @publicAPI={{@publicAPI}}
          @dismissStackedCardsAbove={{this.dismissStackedCardsAbove}}
          @close={{@close}}
          @cancel={{@cancel}}
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
      }
    </style>
  </template>
}
