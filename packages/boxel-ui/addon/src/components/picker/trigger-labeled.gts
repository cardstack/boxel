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

  @action
  removeItem(item: any, event?: MouseEvent) {
    event?.stopPropagation();
    const newSelected = this.args.select.selected.filter(
      (i: any) => i !== item,
    );
    this.args.select.selected = [...newSelected];
    this.args.select.actions.select(newSelected);
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
            {{#each @select.selected as |item|}}
              <SelectedComponent
                @option={{item}}
                @select={{this.select}}
                as |option select|
              >
                {{yield option select}}
              </SelectedComponent>
            {{/each}}
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

      /*Ember power select has a right padding to the trigger element*/
      :global(.ember-power-select-trigger) {
        padding: 0px;
      }
    </style>
  </template>
}
