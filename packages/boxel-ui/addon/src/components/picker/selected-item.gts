import { addClassToSVG } from '@cardstack/boxel-ui/helpers';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import type { Select } from 'ember-power-select/components/power-select';

import SelectAll from '../../icons/select-all.gts';
import type { Icon } from '../../icons/types.ts';
import ContextButton from '../context-button/index.gts';
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
    return (
      this.args.option.icon ??
      (this.args.option.type === 'select-all' ? SelectAll : undefined)
    );
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

  get displayRemoveButton() {
    return this.args.option.type !== 'select-all';
  }

  <template>
    <Pill
      class='picker-selected-item'
      @size='small'
      data-test-boxel-picker-selected-item
    >
      <:iconLeft>
        {{#if this.icon}}
          <div class='picker-selected-item__icon'>
            {{#if this.isIconURL}}
              <img
                src={{this.iconString}}
                width='14'
                height='14'
                alt=''
                class='picker-selected-item__icon-image'
              />
            {{else if this.iconString}}
              {{htmlSafe
                (addClassToSVG
                  this.iconString 'picker-selected-item__icon-image'
                )
              }}
            {{else if this.iconComponent}}
              <this.iconComponent
                width='14'
                height='14'
                class='picker-selected-item__icon-component'
                role='presentation'
              />
            {{/if}}
          </div>
        {{/if}}
      </:iconLeft>
      <:default>
        <span class='picker-selected-item__text'>{{this.text}}</span>
      </:default>
      <:iconRight>
        {{#if this.displayRemoveButton}}
          <ContextButton
            @icon='close'
            @size='extra-small'
            @variant='highlight'
            @label='Remove'
            @width='14'
            @height='14'
            class='picker-selected-item__remove'
            {{on 'click' (fn this.remove @option)}}
            data-test-boxel-picker-remove-button
          />
        {{/if}}
      </:iconRight>
    </Pill>

    <style scoped>
      .picker-selected-item {
        --pill-background-color: var(--background, var(--boxel-300));
        --pill-border-color: var(--border, var(--boxel-300));
        --pill-gap: var(--boxel-sp-4xs);
        padding-right: 0;
      }
      .picker-selected-item__icon {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .picker-selected-item__icon-image {
        width: 100%;
        height: 100%;
        object-fit: contain;
        border-radius: var(--boxel-border-radius-xs);
        display: block;
      }
      .picker-selected-item__remove:hover {
        background: none;
        opacity: 0.7;
      }
    </style>
  </template>
}
