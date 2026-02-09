import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import type { ComponentLike } from '@glint/template';
import type { Select } from 'ember-power-select/components/power-select';

import { cn } from '../../helpers.ts';
import { not } from '../../helpers/truth-helpers.ts';
import CaretDown from '../../icons/caret-down.gts';
import type { PickerOption } from './index.gts';
import PickerSelectedItem, {
  type PickerSelectedItemSignature,
} from './selected-item.gts';

export interface TriggerLabeledSignature {
  Args: {
    extra?: {
      label?: string;
      maxSelectedDisplay?: number;
    };
    placeholder?: string;
    select: Select;
    selectedItemComponent?: ComponentLike<PickerSelectedItemSignature>;
  };
  Blocks: {
    default: [PickerOption, Select];
  };
  Element: HTMLElement;
}

type ExtendedSelect = Select & {
  actions: {
    remove: (item: PickerOption) => void;
  } & Select['actions'];
};

export default class PickerLabeledTrigger extends Component<TriggerLabeledSignature> {
  get showPlaceholder() {
    return this.args.placeholder && this.args.select.selected.length === 0;
  }

  get label() {
    return this.args.extra?.label || '';
  }

  get maxSelectedDisplay() {
    return this.args.extra?.maxSelectedDisplay;
  }

  get displayedItems() {
    const selected = this.args.select.selected;
    if (
      !this.maxSelectedDisplay ||
      selected.length <= this.maxSelectedDisplay
    ) {
      return selected;
    }
    return selected.slice(0, this.maxSelectedDisplay);
  }

  get remainingCount() {
    const selected = this.args.select.selected;
    if (
      !this.maxSelectedDisplay ||
      selected.length <= this.maxSelectedDisplay
    ) {
      return 0;
    }
    return selected.length - this.maxSelectedDisplay;
  }

  get hasMoreItems() {
    return this.remainingCount > 0;
  }

  @action
  removeItem(item: any, event?: MouseEvent) {
    event?.stopPropagation();
    const newSelected = this.args.select.selected.filter(
      (i: any) => i !== item,
    );
    this.args.select.selected = [...newSelected];
    this.args.select.actions.select(newSelected);
  }

  @action
  openDropdown(event: MouseEvent) {
    event.stopPropagation();
    if (!this.args.select.isOpen) {
      this.args.select.actions.open(event);
    }
  }

  get select(): ExtendedSelect {
    return {
      ...this.args.select,
      actions: {
        remove: this.removeItem as (item: PickerOption) => void,
        ...this.args.select.actions,
      },
    };
  }

  <template>
    <div class='boxel-trigger' data-test-boxel-picker-trigger>
      <div class='boxel-trigger-content'>
        {{#if this.label}}
          <span
            class='picker-trigger__label'
            data-test-boxel-picker-trigger-label
          >{{this.label}}</span>
        {{/if}}
        {{#if this.showPlaceholder}}
          <div
            class='boxel-trigger-placeholder'
            data-test-boxel-picker-trigger-placeholder
          >
            {{@placeholder}}
          </div>
        {{else}}
          {{#let
            (if
              @selectedItemComponent
              (component @selectedItemComponent)
              (component PickerSelectedItem)
            )
            as |SelectedComponent|
          }}
            {{#each this.displayedItems as |item|}}
              <SelectedComponent
                @option={{item}}
                @select={{this.select}}
                as |option select|
              >
                {{yield option select}}
              </SelectedComponent>
            {{/each}}
            {{#if this.hasMoreItems}}
              <div
                class='picker-more-items'
                role='button'
                tabindex='0'
                data-test-boxel-picker-more-items
                {{on 'click' this.openDropdown}}
              >
                +{{this.remainingCount}}
                more
              </div>
            {{/if}}
          {{/let}}
        {{/if}}
      </div>
      {{#if (not @select.disabled)}}
        <CaretDown
          class={{cn 'picker-trigger__caret' (if @select.isOpen 'is-open')}}
        />
      {{/if}}
    </div>

    <style scoped>
      .boxel-trigger {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        gap: var(--boxel-sp-xxxs);
        padding: var(--boxel-sp-xs);
        font: var(--boxel-font-sm);
        font-family: inherit;
        letter-spacing: var(--boxel-lsp-sm);
        outline: none;
        cursor: pointer;
      }

      .boxel-trigger-content {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xs);
        align-items: center;
      }

      .boxel-trigger-placeholder {
        color: var(--boxel-450);
        font: var(--boxel-font-sm);
        font-family: inherit;
        letter-spacing: var(--boxel-lsp-sm);
      }

      .picker-trigger__label {
        font-weight: 500;
        flex-shrink: 0;
      }

      .picker-trigger__caret {
        width: 10px;
        height: 10px;
        flex-shrink: 0;
      }

      .picker-trigger__caret.is-open {
        transform: rotate(180deg);
      }

      .picker-more-items {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
        padding: var(--boxel-sp-4xs);
        border-radius: var(--boxel-border-radius-xs);
        border: solid 1px var(--boxel-300);
        background-color: var(--boxel-300);
        min-height: 30px;
        font: 500 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-sm);
        cursor: pointer;
        user-select: none;
      }

      .picker-more-items:hover {
        background-color: var(--boxel-400);
        border-color: var(--boxel-400);
      }

      /*Ember power select has a right padding to the trigger element*/
      :global(.ember-power-select-trigger) {
        padding: 0px;
      }
    </style>
  </template>
}
