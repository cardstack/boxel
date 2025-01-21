import { on } from '@ember/modifier';
import Component from '@glimmer/component';

interface Signature {
  Args: {
    color: string | null;
    disabled?: boolean;
    onChange: (color: string | null) => void;
    showHexString?: boolean;
  };
  Element: HTMLDivElement;
}

export default class ColorPicker extends Component<Signature> {
  private handleColorChange = (event: Event) => {
    let input = event.target as HTMLInputElement;
    this.args.onChange(input.value);
  };

  <template>
    <div class='color-picker' ...attributes>
      <input
        type='color'
        value={{if @color @color '#ffffff'}}
        class='input'
        disabled={{@disabled}}
        aria-label='Choose color'
        {{on 'input' this.handleColorChange}}
      />
      {{#if @showHexString}}
        <code class='hex-value'>{{@color}}</code>
      {{/if}}
    </div>

    <style scoped>
      .color-picker {
        --swatch-size: 1.4rem;
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }

      .input {
        width: var(--swatch-size);
        height: var(--swatch-size);
        padding: 0;
        cursor: pointer;
        border: var(--boxel-border);
        border-radius: 50%;
      }

      .input:disabled {
        pointer-events: none;
      }

      .input::-webkit-color-swatch-wrapper {
        padding: 0;
      }

      .input::-webkit-color-swatch {
        border: 1px solid transparent;
        border-radius: 50%;
      }

      .hex-value {
        text-transform: uppercase;
      }
    </style>
  </template>
}
