import { addClassToSVG } from '@cardstack/boxel-ui/helpers';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import type { Select } from 'ember-power-select/components/power-select';

import IconX from '../../icons/icon-x.gts';
import type { Icon } from '../../icons/types.ts';
import Pill from '../pill/index.gts';
import type { PickerOption } from './index.gts';

export interface PickerSelectedItemSignature {
  Args: {
    extra?: {
      getItemIcon?: (item: PickerOption) => Icon | string | undefined;
      getItemText?: (item: PickerOption) => string;
    };
    option: PickerOption;
    select: Select & {
      actions: {
        remove: (item: PickerOption) => void;
      };
    };
  };
  Blocks: {
    default: [PickerOption, Select];
  };
  Element: HTMLDivElement;
}

export default class PickerSelectedItem extends Component<PickerSelectedItemSignature> {
  get icon() {
    return this.args.option.icon;
  }

  get text() {
    return this.args.option.name;
  }

  get isIconString() {
    return typeof this.icon === 'string';
  }

  get isIconURL() {
    return this.isIconString && (this.icon as string).startsWith('http');
  }

  get isIconSVG() {
    return this.isIconString && !this.isIconURL;
  }

  get iconString() {
    return this.isIconString ? (this.icon as string) : undefined;
  }

  get iconComponent() {
    return !this.isIconString ? (this.icon as Icon | undefined) : undefined;
  }

  @action
  remove(item: PickerOption, event: MouseEvent) {
    // Do not remove these event methods
    // This is to ensure that the close/click event from selected item does not bubble up to the trigger
    // and cause the dropdown to close
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (typeof this.args.select.actions.remove === 'function') {
      this.args.select.actions.remove(item);
    } else {
      console.warn('Remove action is not available');
    }
  }

  <template>
    <div class='picker-selected-item' data-test-boxel-picker-selected-item>
      <Pill class='picker-selected-item__pill'>
        <:default>
          {{#if this.icon}}
            <div class='picker-selected-item__icon'>
              {{#if this.isIconURL}}
                {{#let this.iconString as |iconUrl|}}
                  <img
                    src={{iconUrl}}
                    alt=''
                    class='picker-selected-item__icon-image'
                  />
                {{/let}}
              {{else if this.isIconSVG}}
                {{#let this.iconString as |iconSvg|}}
                  {{#if iconSvg}}
                    {{htmlSafe
                      (addClassToSVG iconSvg 'picker-selected-item__icon-image')
                    }}
                  {{/if}}
                {{/let}}
              {{else if this.iconComponent}}
                {{#let this.iconComponent as |IconComponent|}}
                  <IconComponent
                    class='picker-selected-item__icon-component'
                    role='presentation'
                  />
                {{/let}}
              {{/if}}
            </div>
          {{/if}}
          <span class='picker-selected-item__text'>{{this.text}}</span>
        </:default>
        <:iconRight>
          <button
            type='button'
            class='picker-selected-item__remove-button'
            {{on 'click' (fn this.remove @option)}}
            aria-label='Remove item'
          >
            <IconX class='picker-selected-item__icon--remove' />
          </button>
        </:iconRight>
      </Pill>
    </div>

    <style scoped>
      .picker-selected-item {
        all: unset;
      }

      .picker-selected-item__pill {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-5xs);
        padding: 1px 8px 3px 4px;
        border-radius: 5px;
        border: solid 1px #d9d9d9;
        background-color: #d9d9d9;
      }

      .picker-selected-item__icon {
        width: 12px;
        height: 12px;
        min-width: 12px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .picker-selected-item__icon-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: var(--boxel-border-radius-xs);
        display: block;
      }

      .picker-selected-item__icon-component {
        width: 12px;
        height: 12px;
        flex-shrink: 0;
      }

      .picker-selected-item__text {
        font: 500 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-sm);
      }

      .picker-selected-item__remove-button {
        all: unset;
        display: flex;
        justify-content: center;
        align-items: center;
        cursor: pointer;
        border-radius: 50%;
        transition: background-color 0.2s ease;
        width: 10px;
        height: 10px;
        margin-left: var(--boxel-sp-2xs);
      }

      .picker-selected-item__icon--remove {
        width: 6px;
        height: 6px;
        --icon-color: var(--boxel-multi-select-pill-color);
      }
    </style>
  </template>
}
