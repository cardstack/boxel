import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import type { Select } from 'ember-power-select/components/power-select';

import { cn } from '../../helpers.ts';
import CheckMark from '../../icons/check-mark.gts';
import SelectAll from '../../icons/select-all.gts';
import type { Icon } from '../../icons/types.ts';
import type { PickerOption } from './index.gts';

export interface OptionRowSignature {
  Args: {
    currentSelected?: PickerOption[];
    isSelected: boolean;
    onHover?: (option: PickerOption | null) => void;
    option: PickerOption;
    select?: Select;
  };
  Element: HTMLElement;
}

export default class PickerOptionRow extends Component<OptionRowSignature> {
  handleMouseEnter = () => {
    this.args.onHover?.(this.args.option);
  };

  handleMouseLeave = () => {
    this.args.onHover?.(null);
  };

  get icon() {
    return (
      this.args.option.icon ??
      (this.args.option.type === 'select-all' ? SelectAll : undefined)
    );
  }

  get label() {
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

  <template>
    <div
      class={{cn 'picker-option-row' picker-option-row--selected=@isSelected}}
      data-test-boxel-picker-option-selected={{if @isSelected 'true' 'false'}}
      data-test-boxel-picker-option-row={{@option.id}}
      {{on 'mouseenter' this.handleMouseEnter}}
      {{on 'mouseleave' this.handleMouseLeave}}
    >
      <div
        class={{cn
          'picker-option-row__checkbox'
          picker-option-row__checkbox--selected=@isSelected
        }}
      >
        <span
          class={{cn
            'picker-option-row__check-icon'
            picker-option-row__check-icon--selected=@isSelected
          }}
        >
          <CheckMark width='16' height='16' />
        </span>
      </div>
      {{#if this.icon}}
        <div class='picker-option-row__icon'>
          {{#if this.isIconURL}}
            {{#let this.iconString as |iconUrl|}}
              <img
                src={{iconUrl}}
                alt=''
                class='picker-option-row__icon-image'
              />
            {{/let}}
          {{else if this.isIconSVG}}
            {{#let this.iconString as |iconSvg|}}
              {{#if iconSvg}}
                {{htmlSafe
                  (addClassToSVG iconSvg 'picker-option-row__icon-image')
                }}
              {{/if}}
            {{/let}}
          {{else if this.iconComponent}}
            {{#let this.iconComponent as |IconComponent|}}
              <IconComponent
                class='picker-option-row__icon-component'
                role='presentation'
              />
            {{/let}}
          {{/if}}
        </div>
      {{/if}}
      <div class='picker-option-row__label'>{{this.label}}</div>
    </div>

    <style scoped>
      .picker-option-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-3xs);
        cursor: pointer;
        padding: var(--boxel-sp-3xs);
        border-radius: var(--boxel-border-radius-xs);
        width: 100%;
      }

      .picker-option-row:hover {
        color: var(--boxel-dark);
        background-color: var(--boxel-100);
        border-radius: 4px;
      }

      .picker-option-row__checkbox {
        width: 16px;
        height: 16px;
        border: 1px solid var(--boxel-500);
        border-radius: 3px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .picker-option-row__checkbox:hover,
      .picker-option-row__checkbox:focus {
        box-shadow: 0 0 0 2px var(--boxel-dark-teal);
      }

      .picker-option-row__checkbox--selected {
        border-color: var(--boxel-dark-teal);
        background-color: var(--boxel-dark-teal);
      }

      .picker-option-row__check-icon {
        --icon-color: var(--boxel-dark-teal);
        visibility: collapse;
        display: contents;
      }

      .picker-option-row__check-icon--selected {
        --icon-color: var(--boxel-dark);
        visibility: visible;
      }

      .picker-option-row__icon {
        width: 18px;
        height: 18px;
        min-width: 18px;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .picker-option-row__icon-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: var(--boxel-border-radius-xs);
        display: block;
      }

      .picker-option-row__icon-component {
        width: 18px;
        height: 18px;
        flex-shrink: 0;
      }

      .picker-option-row__label {
        flex: 1;
        font: var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-sm);
      }
    </style>
  </template>
}

function addClassToSVG(svgString: string, className: string) {
  return svgString
    .replace(/<svg\b([^>]*)\sclass="([^"]*)"/, `<svg$1 class="$2 ${className}"`)
    .replace(
      /<svg\b([^>]*)>/,
      `<svg$1 class="${className}" role="presentation">`,
    );
}
