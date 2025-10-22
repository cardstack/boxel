import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import { cn, eq } from '../../helpers.ts';
import { ALL_ICON_COMPONENTS } from '../../icons.gts';
import IconPlus from '../../icons/icon-plus.gts';
import type { Icon } from '../../icons/types.ts';
import {
  type BoxelButtonKind,
  type BoxelButtonSize,
  buttonKindOptions,
  buttonSizeOptions,
} from '../button/index.gts';
import BoxelIconButton, { getIconSize } from './index.gts';

export default class IconButtonUsage extends Component {
  variants = buttonKindOptions;
  private sizeVariants = buttonSizeOptions;
  @tracked private icon: Icon = IconPlus;
  @tracked private variant?: BoxelButtonKind;
  @tracked private size?: BoxelButtonSize = 'auto';
  @tracked private width?: string;
  @tracked private height?: string;
  @tracked private isLoading = false;
  @tracked private isDisabled = false;
  @tracked private isRound = false;

  @tracked private showIconBorders = false;
  @tracked private hideIconOverflow = false;

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
    <div class={{cn dark-background=(eq this.variant 'secondary-dark')}}>
      <FreestyleUsage @name='IconButton'>
        <:example>
          <BoxelIconButton
            @icon={{this.icon}}
            @loading={{this.isLoading}}
            @variant={{this.variant}}
            @size={{this.size}}
            @width={{this.width}}
            @height={{this.height}}
            @round={{this.isRound}}
            @disabled={{this.isDisabled}}
            aria-label='Special Button'
            {{on 'click' (fn this.log 'Button clicked')}}
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
            @value={{this.variant}}
            @options={{this.variants}}
            @onInput={{fn (mut this.variant)}}
            @defaultValue='default'
          />
          <Args.String
            @name='size'
            @optional={{true}}
            @value={{this.size}}
            @options={{this.sizeVariants}}
            @onInput={{fn (mut this.size)}}
            @defaultValue='auto'
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
          <Args.Bool
            @name='disabled'
            @optional={{true}}
            @value={{this.isDisabled}}
            @onInput={{fn (mut this.isDisabled)}}
            @defaultValue='false'
          />
          <Args.String
            @name='width'
            @optional={{true}}
            @description='icon size'
            @defaultValue={{getIconSize this.size}}
            @value={{this.width}}
            @onInput={{fn (mut this.width)}}
          />
          <Args.String
            @name='height'
            @description='icon size'
            @defaultValue={{getIconSize this.size}}
            @value={{this.height}}
            @onInput={{fn (mut this.height)}}
          />
          <Args.Yield @description='Yield for button content' />
        </:api>
        <:cssVars as |Css|>
          <Css.Basic
            @name='--boxel-icon-button-width'
            @type='width'
            @description='width of the button'
            @defaultValue='30px'
          />
          <Css.Basic
            @name='--boxel-icon-button-height'
            @type='height'
            @description='height of the button'
            @defaultValue='30px'
          />
          <Css.Basic
            @name='--boxel-icon-button-padding'
            @type='padding'
            @defaultValue='0'
          />
          <Css.Basic
            @name='--boxel-icon-button-background'
            @type='background-color'
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
                  @size={{this.size}}
                  @width={{this.width}}
                  @height={{this.height}}
                  @round={{this.isRound}}
                  @disabled={{this.isDisabled}}
                  aria-label='Special Button'
                  {{on 'click' (fn this.log 'Button clicked')}}
                  class='icon'
                />
                <span class='label'>{{icon.name}}</span>
              </div>
            {{/each}}
          </section>
        </:example>
      </FreestyleUsage>
    </div>
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

      .dark-background :deep(.FreestyleUsage-preview) {
        background-color: var(--foreground, var(--boxel-700));
        color: var(--background, var(--boxel-light));
      }

      :deep(.FreestyleUsageCssVar input) {
        display: none;
      }
    </style>
  </template>
}
