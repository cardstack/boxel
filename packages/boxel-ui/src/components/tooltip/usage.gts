import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type { MiddlewareState } from '@floating-ui/dom';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';

import { cssVar } from '../../helpers.ts';
import BoxelButton from '../button/index.gts';
import BoxelTooltip from './index.gts';

export default class TooltipUsage extends Component {
  tooltipVariants = ['default', 'primary', 'secondary', 'muted', 'destructive'];
  tooltipVariantDefault:
    | undefined
    | 'primary'
    | 'secondary'
    | 'muted'
    | 'destructive'
    | 'default' = undefined;

  @tracked placement: MiddlewareState['placement'] = 'bottom';
  @tracked offset = 6;
  @tracked variant:
    | undefined
    | 'primary'
    | 'secondary'
    | 'muted'
    | 'destructive'
    | 'default' = undefined;

  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare tooltipBackgroundColor: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare tooltipTextColor: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare tooltipBorderColor: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare tooltipBorderRadius: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare tooltipPadding: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare tooltipFont: CSSVariableInfo;

  @action log(message: string): void {
    console.log(message);
  }

  <template>
    <div
      class='header-freestyle-container'
      style={{cssVar
        boxel-tooltip-background-color=this.tooltipBackgroundColor.value
        boxel-tooltip-text-color=this.tooltipTextColor.value
        boxel-tooltip-border-color=this.tooltipBorderColor.value
        boxel-tooltip-border-radius=this.tooltipBorderRadius.value
        boxel-tooltip-padding=this.tooltipPadding.value
        boxel-tooltip-font=this.tooltipFont.value
      }}
    >
      <FreestyleUsage @name='Tooltip'>
        <:description>
          Tooltips provide additional information when hovering over an element.
          They support theme variants and customizable styling.
        </:description>
        <:example>
          <BoxelTooltip
            @placement={{this.placement}}
            @offset={{this.offset}}
            @variant={{this.variant}}
            data-test-tooltip-freestyle-usage
          >
            <:trigger>
              <BoxelButton
                {{on 'click' (fn this.log 'button clicked')}}
                id='button'
              >
                Button With Tooltip
              </BoxelButton>
            </:trigger>
            <:content>
              Tooltip Content
            </:content>
          </BoxelTooltip>
        </:example>

        <:api as |Args|>
          <Args.String
            @name='placement'
            @optional={{true}}
            @description='The positioning of the tooltip relative to the reference element.'
            @value={{this.placement}}
            @options={{array 'top' 'bottom' 'left' 'right'}}
            @onInput={{fn (mut this.placement)}}
            @defaultValue='top'
          />
          <Args.Number
            @name='offset'
            @description="A modifier that adjusts the tooltip's position along specific axes."
            @value={{this.offset}}
            @onInput={{fn (mut this.offset)}}
            @defaultValue='6'
          />
          <Args.String
            @name='variant'
            @optional={{true}}
            @description='Theme-based variant for consistent styling'
            @defaultValue={{this.tooltipVariantDefault}}
            @options={{this.tooltipVariants}}
            @onInput={{fn (mut this.variant)}}
            @value={{this.variant}}
          />
        </:api>

        <:cssVars as |Css|>
          <Css.Basic
            @name='boxel-tooltip-background-color'
            @type='color'
            @description='Global override for tooltip background color (highest priority)'
            @value={{this.tooltipBackgroundColor.value}}
            @onInput={{this.tooltipBackgroundColor.update}}
          />
          <Css.Basic
            @name='boxel-tooltip-text-color'
            @type='color'
            @description='Global override for tooltip text color (highest priority)'
            @value={{this.tooltipTextColor.value}}
            @onInput={{this.tooltipTextColor.update}}
          />
          <Css.Basic
            @name='boxel-tooltip-border-color'
            @type='color'
            @description='Global override for tooltip border color (highest priority)'
            @value={{this.tooltipBorderColor.value}}
            @onInput={{this.tooltipBorderColor.update}}
          />
          <Css.Basic
            @name='boxel-tooltip-font'
            @type='font'
            @description='Global override for tooltip font (highest priority)'
            @value={{this.tooltipFont.value}}
            @onInput={{this.tooltipFont.update}}
          />
          <Css.Basic
            @name='boxel-tooltip-border-radius'
            @type='dimension'
            @description='Border radius of the tooltip'
            @value={{this.tooltipBorderRadius.value}}
            @onInput={{this.tooltipBorderRadius.update}}
          />
          <Css.Basic
            @name='boxel-tooltip-padding'
            @type='dimension'
            @description='Padding of the tooltip'
            @value={{this.tooltipPadding.value}}
            @onInput={{this.tooltipPadding.update}}
          />

        </:cssVars>
      </FreestyleUsage>
    </div>
  </template>
}
