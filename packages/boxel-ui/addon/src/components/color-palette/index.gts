import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { cn, cssVar, eq } from '../../helpers.ts';
import ColorPicker from '../color-picker/index.gts';
import IconButton from '../icon-button/index.gts';
import Tooltip from '../tooltip/index.gts';

interface Signature {
  Args: {
    color: string | null;
    disabled?: boolean;
    onChange: (color: string | null) => void;
    paletteColors?: string[];
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
  private get color() {
    return this.args.color?.toUpperCase();
  }
  @tracked private colors = (
    this.args.paletteColors ?? DEFAULT_PALETTE_COLORS
  ).map((c) => c?.toUpperCase());

  <template>
    <div class='color-palette-group' ...attributes>
      <ColorPicker
        @color={{@color}}
        @onChange={{@onChange}}
        @placeholder='Custom hex color (#ff00ff)'
        @disabled={{@disabled}}
      />
      {{#unless @disabled}}
        <div class='color-palette'>
          {{#each this.colors as |color|}}
            <Tooltip @placement='top'>
              <:trigger>
                <IconButton
                  class={{cn 'swatch-button' selected=(eq color this.color)}}
                  style={{cssVar swatch-color=color}}
                  {{on 'click' (fn @onChange color)}}
                  aria-label={{color}}
                />
              </:trigger>
              <:content>
                {{color}}
              </:content>
            </Tooltip>
          {{/each}}
        </div>
      {{/unless}}
    </div>

    <style scoped>
      @layer boxelComponentL3 {
        .color-palette-group {
          max-width: var(--boxel-palette-max-width, 18.75rem);
          display: grid;
          gap: var(--boxel-sp);
        }
        .color-palette {
          --swatch-size: 1.8rem;
          display: grid;
          grid-template-columns: repeat(auto-fill, var(--swatch-size));
          gap: var(--boxel-sp);
        }
        .swatch-button {
          --_swatch-border: color-mix(
            in oklab,
            var(--swatch-color),
            var(--foreground, var(--boxel-dark)) 10%
          );
          --_swatch-border-selected: color-mix(
            in oklab,
            var(--border, var(--boxel-border-color)),
            var(--foreground, var(--boxel-dark)) 80%
          );
          width: var(--swatch-size);
          height: var(--swatch-size);
          aspect-ratio: 1;
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
          box-shadow: inset 0 0 0 1px var(--_swatch-border);
        }
        .swatch-button:hover:not(:disabled) {
          cursor: pointer;
          transform: scale(1.1);
        }
        .swatch-button.selected {
          border-color: var(--_swatch-border-selected);
        }
        .swatch-button.selected::before {
          box-shadow: none;
        }
      }
    </style>
  </template>
}
