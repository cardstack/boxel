import IconX from '@cardstack/boxel-icons/x';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import cn from '../../helpers/cn.ts';
import IconButton from '../icon-button/index.gts';
import BoxelInput from '../input/index.gts';
import Swatch from '../swatch/index.gts';

interface Signature {
  Args: {
    color: string | null;
    disabled?: boolean;
    onChange: (color: string | null) => void;
    placeholder?: string;
  };
  Element: HTMLDivElement;
}

export default class ColorPicker extends Component<Signature> {
  <template>
    <div class='color-picker' ...attributes>
      <label class={{cn 'color-input-container' disabled=@disabled}}>
        <span class='boxel-sr-only'>Color Picker</span>
        <Swatch
          class='color-preview'
          @color={{@color}}
          @hideLabel={{true}}
          @style='round'
        />
        <BoxelInput
          type='color'
          @value={{@color}}
          @onInput={{@onChange}}
          @disabled={{@disabled}}
          data-test-color-input
        />
      </label>

      <BoxelInput
        class='color-text-input'
        @value={{@color}}
        @onInput={{@onChange}}
        @disabled={{@disabled}}
        @placeholder={{@placeholder}}
        data-test-color-text-input
      />

      {{#if @color}}
        {{#unless @disabled}}
          <IconButton
            class='remove'
            @icon={{IconX}}
            @width='16px'
            @height='16px'
            {{on 'click' this.remove}}
            aria-label='Unset color'
            data-test-remove-color
          />
        {{/unless}}
      {{/if}}
    </div>

    <style scoped>
      @layer boxelComponentL3 {
        .color-picker {
          --color-picker-width: 2.5rem;
          --color-picker-height: 2.5rem;
          position: relative;
        }
        .color-text-input {
          padding-inline: var(--color-picker-width);
          transition: none;
        }
        .color-input-container {
          position: absolute;
          top: 0;
          left: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          width: var(--color-picker-width);
          height: 100%;
          z-index: 1;
        }
        .color-input-container > :deep(.input-container) {
          visibility: collapse;
          position: absolute;
          top: 0;
          left: 0;
          display: block;
        }
        .color-input-container:not(.disabled):hover {
          cursor: pointer;
        }
        .color-input-container:not(.disabled):hover :deep(.preview) {
          box-shadow: var(--shadow-xs, var(--boxel-box-shadow));
        }
        .remove {
          position: absolute;
          top: 0;
          right: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          width: var(--color-picker-width);
          height: 100%;
          z-index: 1;
          opacity: 0.5;
        }
        .remove:focus,
        .remove:hover {
          opacity: 1;
          outline: 0;
        }
      }
    </style>
  </template>

  private remove = (ev: Event) => {
    ev.preventDefault();
    ev.stopPropagation();
    this.args.onChange?.(null);
  };
}
