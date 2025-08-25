import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';

import { cn, cssVar, eq } from '../../helpers.ts';
import { ALL_ICON_COMPONENTS } from '../../icons.gts';
import IconPlus from '../../icons/icon-plus.gts';
import type { Icon } from '../../icons/types.ts';
import { type BoxelButtonKind, buttonKindOptions } from '../button/index.gts';
import BoxelIconButton from './index.gts';

export default class IconButtonUsage extends Component {
  variants = buttonKindOptions;
  @tracked private icon: Icon = IconPlus;
  @tracked private variant?: BoxelButtonKind;
  @tracked private width?: string;
  @tracked private height?: string;
  @tracked private isLoading = false;
  @tracked private isRound = false;

  @tracked private showIconBorders = false;
  @tracked private hideIconOverflow = false;

  cssClassName = 'boxel-icon-button';
  @cssVariable declare boxelIconButtonWidth: CSSVariableInfo;
  @cssVariable declare boxelIconButtonHeight: CSSVariableInfo;
  @cssVariable declare boxelIconButtonBackground: CSSVariableInfo;

  @action log(message: string): void {
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
        <div
          class={{cn
            'usage-icon-button-background'
            usage-button-dark-mode-background=(eq this.variant 'secondary-dark')
          }}
        >
          <BoxelIconButton
            @icon={{this.icon}}
            @loading={{this.isLoading}}
            @variant={{this.variant}}
            @width={{this.width}}
            @height={{this.height}}
            @round={{this.isRound}}
            aria-label='Special Button'
            {{on 'click' (fn this.log 'Button clicked')}}
            style={{cssVar
              boxel-icon-button-width=this.boxelIconButtonWidth.value
              boxel-icon-button-height=this.boxelIconButtonHeight.value
              boxel-icon-button-background=this.boxelIconButtonBackground.value
            }}
          />
        </div>
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
          @value={{this.variant}}
          @options={{this.variants}}
          @onInput={{fn (mut this.variant)}}
          @defaultValue='default'
        />
        <Args.Bool
          @name='loading'
          @optional={{true}}
          @value={{this.isLoading}}
          @onInput={{fn (mut this.isLoading)}}
          @defaultValue='false'
        />
        <Args.Bool
          @name='round'
          @optional={{true}}
          @value={{this.isRound}}
          @onInput={{fn (mut this.isRound)}}
          @defaultValue='false'
        />
        <Args.String
          @name='width'
          @optional={{true}}
          @description='svg icon width'
          @defaultValue='16px'
          @value={{this.width}}
          @onInput={{fn (mut this.width)}}
        />
        <Args.String
          @name='height'
          @description='svg icon height'
          @defaultValue='16px'
          @value={{this.height}}
          @onInput={{fn (mut this.height)}}
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='--boxel-icon-button-width'
          @type='width'
          @description='width of the button'
          @defaultValue='40px'
        />
        <Css.Basic
          @name='--boxel-icon-button-height'
          @type='height'
          @description='height of the button'
          @defaultValue='40px'
        />
        <Css.Basic
          @name='--boxel-icon-button-background'
          @type='background-color'
          @defaultValue='#fff'
        />
        <Css.Basic
          @name='--boxel-icon-button-color'
          @type='color'
          @description='font color'
          @defaultValue='#000'
        />
        <Css.Basic
          @name='--boxel-icon-button-icon-color'
          @type='color'
          @description='icon color'
          @defaultValue='currentColor'
        />
        <Css.Basic
          @name='--boxel-icon-button-transition'
          @type='transition'
          @description='css shorthand "transition" property'
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
                @round={{this.isRound}}
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
    <style scoped>
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
        width: calc(var(--boxel-icon-button-width) + 2px);
        height: calc(var(--boxel-icon-button-height) + 2px);
      }

      .usage-icon-button-background {
        padding: var(--boxel-sp-xs);
      }
      .usage-button-dark-mode-background {
        background-color: var(--foreground, var(--boxel-700));
        color: var(--background, var(--boxel-light));
      }

      :deep(.FreestyleUsageCssVar input) {
        display: none;
      }
    </style>
  </template>
}
