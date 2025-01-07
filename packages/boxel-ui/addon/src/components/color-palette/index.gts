import { eq } from '@cardstack/boxel-ui/helpers';
import { concat, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';

import ColorPicker from '../color-picker/index.gts';

interface Signature {
  Args: {
    color: string;
    onChange: (color: string) => void;
  };
  Element: HTMLDivElement;
}

const DEFAULT_PALETTE_COLORS = [
  // Row 1
  '#000000',
  '#777777',
  '#FA2200',
  '#FA7F01',
  '#FBEB06',
  '#1EDF67',
  '#39B1FF',
  '#9D00FF',
  // Row 2
  '#A6A6A6',
  '#CFCFCF',
  '#FCA6A7',
  '#FCD2A7',
  '#FCF8A6',
  '#A6F4CA',
  '#A7E4FF',
  '#DEA6FF',
];

export default class ColorPalette extends Component<Signature> {
  colors = DEFAULT_PALETTE_COLORS;

  private openColorPicker = (event: MouseEvent) => {
    let container = event.currentTarget as HTMLElement;
    let input = container.querySelector(
      'input[type="color"]',
    ) as HTMLInputElement;
    input?.click();
  };

  <template>
    <div class='color-palette-container' ...attributes>
      <div class='color-palette'>
        {{#each this.colors as |color|}}
          <button
            type='button'
            class='swatch {{if (eq color @color) "selected"}}'
            style={{htmlSafe (concat '--swatch-color: ' color)}}
            {{on 'click' (fn @onChange color)}}
            title={{color}}
          />
        {{/each}}
      </div>

      <button
        type='button'
        class='color-picker-container'
        {{on 'click' this.openColorPicker}}
      >
        <ColorPicker @color={{@color}} @onChange={{@onChange}} />
        <span class='custom-color-label'>Custom Color</span>
      </button>
    </div>

    <style scoped>
      .color-picker-container {
        border: 1px solid var(--boxel-border-color);
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp-sm);
        background: none;
        margin-top: var(--boxel-sp-sm);
        display: flex;
        align-items: center;
        gap: var(--boxel-sp);
        color: var(--boxel-450);
        width: 18rem;
        cursor: pointer;
      }

      .color-picker-container:hover {
        background-color: var(--boxel-light-100);
        color: var(--boxel-500);
      }

      .color-palette {
        --swatch-size: 1.8rem;
        display: grid;
        grid-template-columns: repeat(8, var(--swatch-size));
        gap: var(--boxel-sp-xs);
      }

      .swatch {
        width: var(--swatch-size);
        height: var(--swatch-size);
        border: 1px solid transparent;
        border-radius: 50%;
        padding: 2px;
        cursor: pointer;
        transition: transform 0.1s ease;
        background-color: transparent;
      }

      .swatch::before {
        content: '';
        display: block;
        width: 100%;
        height: 100%;
        border-radius: 50%;
        background-color: var(--swatch-color);
      }

      .swatch:hover:not(:disabled) {
        transform: scale(1.1);
      }

      .swatch.selected {
        background-color: white;
        border-color: var(--boxel-800);
      }
    </style>
  </template>
}
