import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';

import cssVar from '../../helpers/css-var.ts';
import { ALL_ICON_COMPONENTS } from '../../icons.gts';
import IconPlusCircle from '../../icons/icon-plus-circle.gts';
import type { Icon } from '../../icons/types.ts';
import BoxelIconButton from './index.gts';

export default class IconButtonUsage extends Component {
  @tracked icon: Icon = IconPlusCircle;
  @tracked variant?: string;
  @tracked width = '40px';
  @tracked height = '40px';

  @tracked showIconBorders = false;
  @tracked hideIconOverflow = false;

  cssClassName = 'boxel-icon-button';
  @cssVariable declare boxelIconButtonWidth: CSSVariableInfo;
  @cssVariable declare boxelIconButtonHeight: CSSVariableInfo;

  @action log(message: string): void {
    // eslint-disable-next-line no-console
    console.log(message);
  }

  @action toggleShowIconBorders(): void {
    this.showIconBorders = !this.showIconBorders;
  }

  @action toggleHideIconOverflow(): void {
    this.hideIconOverflow = !this.hideIconOverflow;
  }

  <template>
    <FreestyleUsage @name='IconButton'>
      <:example>
        <BoxelIconButton
          @icon={{this.icon}}
          @variant={{this.variant}}
          @width={{this.width}}
          @height={{this.height}}
          aria-label='Special Button'
          {{on 'click' (fn this.log 'Button clicked')}}
          style={{cssVar
            boxel-icon-button-width=this.boxelIconButtonWidth.value
            boxel-icon-button-height=this.boxelIconButtonHeight.value
          }}
        />
      </:example>

      <:api as |Args|>
        <Args.Component
          @name='icon'
          @description='Icon component reference'
          @value={{this.icon}}
          @options={{ALL_ICON_COMPONENTS}}
          @onChange={{fn (mut this.icon)}}
        />
        <Args.String
          @name='variant'
          @optional={{true}}
          @description="the variant to render as (applies CSS class) - 'null' or 'primary' or 'secondary'"
          @value={{this.variant}}
          @options={{array 'primary' 'secondary' '<undefined>'}}
          @onInput={{fn (mut this.variant)}}
          @defaultValue='<undefined>'
        />
        <Args.Number
          @name='width'
          @description='used to size the SVG rendering'
          @defaultValue={{'16px'}}
          @value={{this.width}}
          @onInput={{fn (mut this.width)}}
        />
        <Args.Number
          @name='height'
          @description='used to size the SVG rendering'
          @defaultValue={{'16px'}}
          @value={{this.height}}
          @onInput={{fn (mut this.height)}}
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='boxel-icon-button-width'
          @type='dimension'
          @description='Used to size the boundaries of the button'
          @defaultValue={{this.boxelIconButtonWidth.defaults}}
          @value={{this.boxelIconButtonWidth.value}}
          @onInput={{this.boxelIconButtonWidth.update}}
        />
        <Css.Basic
          @name='boxel-icon-button-height'
          @type='dimension'
          @description='Used to size the boundaries of the button'
          @defaultValue={{this.boxelIconButtonHeight.defaults}}
          @value={{this.boxelIconButtonHeight.value}}
          @onInput={{this.boxelIconButtonHeight.update}}
        />
      </:cssVars>
    </FreestyleUsage>

    <FreestyleUsage @name='All Icons'>
      <:example>
        <label class='checkbox-label'>
          <input
            type='checkbox'
            checked={{this.showIconBorders}}
            {{on 'change' this.toggleShowIconBorders}}
          />
          Show icon bounds
        </label>
        <label class='checkbox-label'>
          <input
            type='checkbox'
            checked={{this.hideIconOverflow}}
            {{on 'change' this.toggleHideIconOverflow}}
          />
          Hide icon overflow
        </label>
        <section class='all-icons'>
          {{#each ALL_ICON_COMPONENTS as |icon|}}
            <div
              class='icon-and-label
                {{if this.showIconBorders "show-borders"}}
                {{if this.hideIconOverflow "hide-icon-overflow"}}'
            >
              <BoxelIconButton
                @icon={{icon}}
                @variant={{this.variant}}
                @width={{this.width}}
                @height={{this.height}}
                aria-label='Special Button'
                {{on 'click' (fn this.log 'Button clicked')}}
                class='icon'
                style={{cssVar
                  boxel-icon-button-width=this.boxelIconButtonWidth.value
                  boxel-icon-button-height=this.boxelIconButtonHeight.value
                }}
              />
              <span class='label'>{{icon.name}}</span>
            </div>
          {{/each}}
        </section>
      </:example>
    </FreestyleUsage>
    <style>
      .checkbox-label {
        display: flex;
        align-items: center;
        margin-bottom: var(--boxel-sp);
        gap: var(--boxel-sp-xxs);
      }

      .all-icons {
        display: flex;
        flex-wrap: wrap;
      }

      .icon-and-label {
        display: flex;
        width: 15rem;
        flex-direction: column;
        align-items: center;
        margin: 0 10px 10px 0;
      }

      .hide-icon-overflow .icon {
        overflow: hidden;
      }

      .show-borders .icon {
        border: 1px solid var(--boxel-500);
      }
    </style>
  </template>
}
