import IconTrash from '@cardstack/boxel-icons/trash-2';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { cn, cssVar, eq } from '../../helpers.ts';
import ColorPicker from '../color-picker/index.gts';
import IconButton from '../icon-button/index.gts';

interface Signature {
  Args: {
    color: string | null;
    colors?: string[];
    disabled?: boolean;
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
  private get color() {
    return this.args.color?.toUpperCase();
  }
  @tracked private colors = (this.args.colors ?? DEFAULT_PALETTE_COLORS).map(
    (c) => c?.toUpperCase(),
  );

  <template>
    <div class='color-palette-group' ...attributes>
      {{#unless @disabled}}
        <div class='color-palette'>
          {{#each this.colors as |color|}}
            <IconButton
              class={{cn 'swatch-button' selected=(eq color this.color)}}
              style={{cssVar swatch-color=color}}
              {{on 'click' (fn @onChange color)}}
              title={{color}}
            />
          {{/each}}
        </div>
        <div class='selected-color'>
          {{#if this.color}}
            <code>{{this.color}}</code>
            <IconButton
              class='remove'
              @icon={{IconTrash}}
              @width='16px'
              @height='16px'
              {{on 'click' (fn @onChange null)}}
              aria-label='Unset color'
            />
          {{/if}}
        </div>
      {{/unless}}
      <ColorPicker
        @color={{@color}}
        @onChange={{@onChange}}
        @placeholder='Custom Color'
        @disabled={{@disabled}}
      />
    </div>

    <style scoped>
      .color-palette-group {
        --boxel-icon-button-width: var(--boxel-icon-sm);
        --boxel-icon-button-height: var(--boxel-icon-sm);
        display: inline-grid;
        grid-template-columns: var(--boxel-palette-max-width, 18.75rem) auto;
        align-items: center;
        gap: var(--boxel-sp);
      }
      .color-palette {
        --swatch-size: 1.8rem;
        display: grid;
        grid-template-columns: repeat(auto-fill, var(--swatch-size));
        gap: var(--boxel-sp-xs);
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
      .remove {
        vertical-align: text-bottom;
        margin-left: var(--boxel-sp-xxxs);
      }
      .remove:focus,
      .remove:hover {
        color: var(--danger, var(--boxel-danger));
        outline: 0;
      }
    </style>
  </template>
}
