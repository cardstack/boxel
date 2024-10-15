import { IconX } from '@cardstack/boxel-ui/icons';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import type { Select } from 'ember-power-select/components/power-select';

// Inside the trigger component, the selected item component is called within in ember-power-select
// It only passes option, select and extra as arguments
// We follow the same convention when defining our own selected item component
export interface SelectedItemSignature<ItemT> {
  Args: {
    extra?: any;
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
    // Do not remove these event
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
      <IconX
        {{on 'click' (fn this.remove @option)}}
        class='boxel-multi-select__icon boxel-multi-select__icon--remove'
      />
    </div>

    <style scoped>
      .ember-power-select-multiple-option {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .boxel-multi-select__icon--remove {
        all: unset;
        display: flex;
        justify-content: center;
        width: 10px;
        height: 10px;
        cursor: pointer;
        --icon-color: var(--boxel-multi-select-pill-color);
      }
    </style>
  </template>
}
