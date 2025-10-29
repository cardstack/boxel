import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';

import { IconX } from '@cardstack/boxel-ui/icons';
import { Pill, BoxelInput } from '@cardstack/boxel-ui/components';

// Chip Component
interface ChipSignature {
  Args: {
    label: string;
    onDelete?: (event: MouseEvent) => void;
  };
  Element: HTMLElement;
}

// Chip Component
class Chip extends GlimmerComponent<ChipSignature> {
  @action
  handleDelete(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();

    if (this.args.onDelete) {
      this.args.onDelete(event);
    }
  }

  <template>
    <Pill class='chips'>
      <:default>
        <span class='chips__label'>{{@label}}</span>
      </:default>

      <:iconRight>
        <button
          type='button'
          class='chips__delete-button'
          {{on 'click' this.handleDelete}}
          aria-label='Remove chip'
        >
          <IconX class='chips__delete-icon' />
        </button>
      </:iconRight>
    </Pill>

    <style scoped>
      .chips {
        --pill-gap: var(--boxel-sp-xxs);
      }

      .chips__label {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .chips__delete-button {
        all: unset;
        display: flex;
        justify-content: center;
        align-items: center;
        cursor: pointer;
        border-radius: 50%;
        transition: background-color 0.2s ease;
        width: 12px;
        height: 12px;
        padding: 2px;
        color: var(--boxel-danger);
      }

      .chips__delete-button:hover {
        color: var(--boxel-danger-hover);
      }

      .chips__delete-icon {
        width: 10px;
        height: 10px;
        --icon-color: currentColor;
        flex-shrink: 0;
      }
    </style>
  </template>
}

// Reusable Chips Editor Component
interface ChipsEditorSignature {
  Args: {
    name?: string;
    items: string[] | undefined;
    onItemsUpdate: (items: string[]) => void;
    placeholder?: string;
  };
  Element: HTMLElement;
}

export class ChipsEditor extends GlimmerComponent<ChipsEditorSignature> {
  @tracked newItemValue = '';

  updateNewItemValue = (value: string) => {
    this.newItemValue = value;
  };

  handleKeyPress = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && this.newItemValue.trim()) {
      event.preventDefault();

      // Add new item to the array
      const newItem = this.newItemValue.trim();
      const updatedItems = [...(this.args.items || []), newItem];
      this.args.onItemsUpdate(updatedItems);

      // Clear the input
      this.newItemValue = '';
    }
  };

  deleteItem = (index: number) => {
    if (this.args.items) {
      let updatedItems = [...this.args.items];
      updatedItems.splice(index, 1);
      this.args.onItemsUpdate(updatedItems);
    }
  };

  <template>
    <div class='chips-component'>
      <div class='items-list'>
        {{#each @items as |item index|}}
          <Chip @label={{item}} @onDelete={{fn this.deleteItem index}} />
        {{/each}}
      </div>
      <BoxelInput
        @placeholder={{if @placeholder @placeholder 'Add new item...'}}
        @value={{this.newItemValue}}
        @onInput={{this.updateNewItemValue}}
        @onKeyPress={{this.handleKeyPress}}
      />
    </div>

    <style scoped>
      .chips-component {
        padding: var(--boxel-sp-sm);
      }

      .items-list {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xs);
        margin-bottom: var(--boxel-sp-sm);
      }
    </style>
  </template>
}
