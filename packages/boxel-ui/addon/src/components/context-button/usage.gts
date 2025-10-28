import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import { type BoxelButtonSize, buttonSizeOptions } from '../button/index.gts';
import ContextButton, {
  type ContextButtonIcon,
  type ContextButtonVariant,
  contextButtonIconOptions,
  contextButtonVariants,
} from './index.gts';

export default class ContextButtonUsage extends Component {
  private iconOptions = contextButtonIconOptions;
  private variants = contextButtonVariants;
  private sizeVariants = buttonSizeOptions;
  @tracked private icon?: ContextButtonIcon;
  @tracked private variant?: ContextButtonVariant;
  @tracked private size?: BoxelButtonSize;
  @tracked private width?: string;
  @tracked private height?: string;
  @tracked private isLoading = false;
  @tracked private isDisabled = false;
  @tracked private label = 'context-button usage';

  <template>
    <FreestyleUsage @name='ContextButton'>
      <:example>
        <ContextButton
          @label={{this.label}}
          @icon={{this.icon}}
          @variant={{this.variant}}
          @size={{this.size}}
          @loading={{this.isLoading}}
          @disabled={{this.isDisabled}}
          @width={{this.width}}
          @height={{this.height}}
        />
      </:example>

      <:api as |Args|>
        <Args.String
          @name='label'
          @description='aria-label attribute value'
          @required={{true}}
          @value={{this.label}}
          @onInput={{fn (mut this.label)}}
        />
        <Args.String
          @name='icon'
          @description='Options from dropdown, or IconComponent'
          @value={{this.icon}}
          @options={{this.iconOptions}}
          @onInput={{fn (mut this.icon)}}
          @defaultValue='context-menu'
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
          @defaultValue='base (30px)'
        />
        <Args.Bool
          @name='loading'
          @optional={{true}}
          @value={{this.isLoading}}
          @onInput={{fn (mut this.isLoading)}}
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
          @description='icon width'
          @defaultValue='16px or 20px'
          @value={{this.width}}
          @onInput={{fn (mut this.width)}}
        />
        <Args.String
          @name='height'
          @optional={{true}}
          @description='icon height'
          @defaultValue='16px or 20px'
          @value={{this.height}}
          @onInput={{fn (mut this.height)}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}
