import { concat, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { cn, eq } from '../../helpers.ts';
import GridContainer from '../grid-container/index.gts';

interface Signature {
  Args: {
    color: string | null;
    colors?: string[];
    onChange: (color: string | null) => void;
  };
  Element: HTMLElement;
}

export const DEFAULT_PALETTE_COLORS = [
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
  @tracked colors = this.args.colors ?? DEFAULT_PALETTE_COLORS;

  <template>
    <GridContainer
      @columns='8'
      @gap='xs'
      @columnMaxWidth='var(--swatch-size)'
      class='color-palette'
      ...attributes
    >
      {{#each this.colors as |color|}}
        <button
          class={{cn 'swatch-button' selected=(eq color @color)}}
          style={{htmlSafe (concat '--swatch-color: ' color)}}
          {{on 'click' (fn @onChange color)}}
          title={{color}}
        />
      {{/each}}
    </GridContainer>

    <style scoped>
      .color-palette {
        --swatch-size: 1.8rem;
      }
      .swatch-button {
        width: var(--swatch-size);
        height: var(--swatch-size);
        border: 2px solid transparent;
        border-radius: 50%;
        padding: 2px;
        transition: transform 0.1s ease;
        background-color: transparent;
      }
      .swatch-button::before {
        content: '';
        display: block;
        width: 100%;
        height: 100%;
        border-radius: 50%;
        background-color: var(--swatch-color);
      }
      .swatch-button:hover:not(:disabled) {
        cursor: pointer;
        transform: scale(1.1);
      }
      .swatch-button.selected {
        background-color: var(--boxel-light);
        border-color: var(--border, var(--boxel-800));
      }
    </style>
  </template>
}
