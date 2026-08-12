import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import type { Option, Select } from 'ember-power-select/types';

import IconX from '../../icons/icon-x.gts';
import Pill from '../pill/index.gts';

// Invoked per selected item by the trigger; the arg names follow
// ember-power-select's own selected-item contract (@selected, @select) so
// custom components typed against either signature are interchangeable.
export interface SelectedItemSignature<ItemT> {
  Args: {
    extra?: unknown;
    select: Select<ItemT, true> & {
      actions: {
        remove?: (item: Option<ItemT>) => void;
      };
    };
    selected: Option<ItemT>;
  };
  Blocks: {
    default: [Option<ItemT>, Select<ItemT, true>];
  };
  Element: HTMLElement;
}

export default class BoxelSelectedItem<ItemT> extends Component<
  SelectedItemSignature<ItemT>
> {
  @action
  remove(item: Option<ItemT>, event: MouseEvent) {
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
      <Pill class='boxel-selected-option'>
        <:default>
          {{yield @selected @select}}
        </:default>
        <:iconRight>
          {{! TODO: Replace with icon button }}
          <button
            type='button'
            class='boxel-multi-select__remove-button'
            {{on 'click' (fn this.remove @selected)}}
            aria-label='Remove item'
          >

            <IconX class='boxel-multi-select__icon--remove' />
          </button>
        </:iconRight>
      </Pill>
    </div>

    <style scoped>
      .ember-power-select-multiple-option {
        all: unset;
      }
      .boxel-selected-option {
        --pill-gap: var(--boxel-sp-xxs);
      }
      .boxel-multi-select__remove-button {
        all: unset;
        display: flex;
        justify-content: center;
        align-items: center;
        cursor: pointer;
        border-radius: 50%;
        transition: background-color 0.2s ease;
        width: 10px;
        height: 10px;
      }
      .boxel-multi-select__icon--remove {
        width: 10px;
        height: 10px;
        --icon-color: var(--boxel-multi-select-pill-color);
      }
    </style>
  </template>
}
