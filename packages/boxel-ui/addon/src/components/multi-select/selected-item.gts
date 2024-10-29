import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import type { Select } from 'ember-power-select/components/power-select';

import IconX from '../../icons/icon-x.gts';

// Inside the trigger component, the selected item component is called within in ember-power-select
// It only passes option, select
// We follow the same convention when defining our own selected item component
export interface SelectedItemSignature<ItemT> {
  Args: {
    option: any;
    select: Select & {
      actions: {
        remove: (item: ItemT) => void;
      };
    };
  };
  Blocks: {
    default: [any];
  };
  Element: HTMLDivElement;
}

export default class BoxelSelectedItem<ItemT> extends Component<
  SelectedItemSignature<ItemT>
> {
  @action
  remove(item: ItemT, event: MouseEvent) {
    // Do not remove these event methods
    // This is to ensure that the close/click event from selected item does not bubble up to the trigger
    // and cause the dropdown to close
    event.preventDefault();
    event.stopPropagation();
    if (typeof this.args.select.actions.remove === 'function') {
      this.args.select.actions.remove(item);
    } else {
      console.warn('Remove action is not available');
    }
  }

  <template>
    <div class='ember-power-select-multiple-option'>
      {{@option.name}}
      <button
        type='button'
        class='boxel-multi-select__remove-button'
        {{on 'click' (fn this.remove @option)}}
        aria-label='Remove {{@option.name}}'
      >
        <IconX class='boxel-multi-select__icon--remove' />
      </button>
    </div>

    <style scoped>
      .ember-power-select-multiple-option {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxxs);
      }
      .boxel-multi-select__remove-button {
        all: unset;
        display: flex;
        justify-content: center;
        align-items: center;
        width: 20px;
        height: 20px;
        cursor: pointer;
        border-radius: 50%;
        transition: background-color 0.2s ease;
      }
      .boxel-multi-select__icon--remove {
        width: 10px;
        height: 10px;
        --icon-color: var(--boxel-multi-select-pill-color);
      }
    </style>
  </template>
}
