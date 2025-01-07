import { on } from '@ember/modifier';
import Component from '@glimmer/component';

interface Signature {
  Args: {
    color: string;
    disabled?: boolean;
    onChange: (color: string) => void;
    showHexString?: boolean;
  };
  Element: HTMLDivElement;
}

export default class ColorPicker extends Component<Signature> {
  private handleColorChange = (event: Event) => {
    let input = event.target as HTMLInputElement;
    event.stopPropagation();
    this.args.onChange(input.value);
  };

  private handleClick = (event: MouseEvent) => {
    let container = event.currentTarget as HTMLElement;
    let input = container.querySelector(
      'input[type="color"]',
    ) as HTMLInputElement;
    input?.click();
  };

  <template>
    <div class='color-picker' {{on 'click' this.handleClick}} ...attributes>
      <input
        type='color'
        value={{@color}}
        class='input'
        disabled={{@disabled}}
        aria-label='Choose color'
        {{on 'input' this.handleColorChange}}
      />
      {{#if @showHexString}}
        <span class='hex-value'>{{@color}}</span>
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
        border: none;
        cursor: pointer;
        background: transparent;
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
        font: var(--boxel-font);
        color: var(--boxel-dark);
        text-transform: uppercase;
      }
    </style>
  </template>
}
