import type { TemplateOnlyComponent } from '@ember/component/template-only';

import cn from '../../helpers/cn.ts';
import BoxelInput from '../input/index.gts';
import Swatch from '../swatch/index.gts';

interface Signature {
  Args: {
    color: string | null;
    disabled?: boolean;
    onChange: (color: string | null) => void;
  };
  Element: HTMLDivElement;
}

const ColorPicker: TemplateOnlyComponent<Signature> = <template>
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
      />
    </label>

    <BoxelInput
      class='color-text-input'
      @value={{@color}}
      @onInput={{@onChange}}
      @disabled={{@disabled}}
    />
  </div>

  <style scoped>
    @layer boxelComponentL2 {
      .color-picker {
        --color-picker-width: 2.5rem;
        --color-picker-height: 2.5rem;
        position: relative;
      }
      .color-text-input {
        padding-left: var(--color-picker-width);
      }
      .color-input-container {
        position: absolute;
        top: 0;
        left: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        width: var(--color-picker-width);
        height: var(--color-picker-height);
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
    }
  </style>
</template>;

export default ColorPicker;
