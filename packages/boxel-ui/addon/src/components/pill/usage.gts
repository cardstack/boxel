import CardIcon from '@cardstack/boxel-icons/captions';
import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';

import { cssVar } from '../../helpers.ts';
import { IconPlus } from '../../icons.gts';
import Pill, {
  type BoxelPillKind,
  type BoxelPillVariant,
  boxelPillVariants,
} from './index.gts';

export default class PillUsage extends Component {
  pillKinds = ['button', 'default'];
  pillKindDefault: BoxelPillKind = 'default';
  pillVariants = boxelPillVariants;

  @tracked kind: BoxelPillKind = this.pillKindDefault;
  @tracked variant?: BoxelPillVariant;
  @tracked pillBackgroundColor?: string;
  @tracked borderColor?: string;
  @tracked fontColor?: string;

  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare pillPadding: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare pillGap: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare pillIconSize: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare boxelPillBackgroundColor: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare boxelPillFontColor: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare boxelPillBorderColor: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare boxelPillFont: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare boxelPillBorderRadius: CSSVariableInfo;
  @cssVariable({ cssClassName: 'header-freestyle-container' })
  declare boxelPillBorder: CSSVariableInfo;

  <template>
    <div
      class='header-freestyle-container'
      style={{cssVar
        boxel-pill-padding=this.pillPadding.value
        boxel-pill-gap=this.pillGap.value
        boxel-pill-icon-size=this.pillIconSize.value
        boxel-pill-background-color=this.boxelPillBackgroundColor.value
        boxel-pill-font-color=this.boxelPillFontColor.value
        boxel-pill-border=this.boxelPillBorder.value
        boxel-pill-border-color=this.boxelPillBorderColor.value
        boxel-pill-border-radius=this.boxelPillBorderRadius.value
        boxel-pill-font=this.boxelPillFont.value
      }}
    >
      <FreestyleUsage @name='Pill'>
        <:description>
          Pills are used to display information in a compact and visually
          appealing manner. Similar to a tag, badge or label.
        </:description>
        <:example>
          {{! Main interactive example }}
          <Pill
            @kind={{this.kind}}
            @variant={{this.variant}}
            @pillBackgroundColor={{this.pillBackgroundColor}}
            @pillBorderColor={{this.borderColor}}
            @pillFontColor={{this.fontColor}}
            data-test-pill-freestyle-usage
          >
            <:iconLeft>
              <IconPlus />
            </:iconLeft>
            <:default>
              Happy
            </:default>
          </Pill>
        </:example>
        <:api as |Args|>
          <Args.String
            @name='kind'
            @optional={{true}}
            @description='Controls the kind of the pill'
            @defaultValue={{this.pillKindDefault}}
            @options={{this.pillKinds}}
            @onInput={{fn (mut this.kind)}}
            @value={{this.kind}}
          />
          <Args.String
            @name='variant'
            @optional={{true}}
            @description='Theme-based variant for consistent styling'
            @options={{this.pillVariants}}
            @onInput={{fn (mut this.variant)}}
            @value={{this.variant}}
          />
          <Args.String
            @name='pillBackgroundColor'
            @description='3-or-6 digit hex color code for background color (overrides variant)'
            @value={{this.pillBackgroundColor}}
            @onInput={{fn (mut this.pillBackgroundColor)}}
            @defaultValue='variant-default'
          />
          <Args.String
            @name='pillBorderColor'
            @description='Border color for the pill (overrides variant)'
            @value={{this.borderColor}}
            @onInput={{fn (mut this.borderColor)}}
            @defaultValue='variant-default'
          />
          <Args.String
            @name='pillFontColor'
            @description='Font color for the pill (overrides variant)'
            @value={{this.fontColor}}
            @onInput={{fn (mut this.fontColor)}}
            @defaultValue='variant-default'
          />
        </:api>
        <:cssVars as |Css|>
          <Css.Basic
            @name='boxel-pill-padding'
            @type='padding'
            @description='Padding of the pill'
            @value={{this.pillPadding.value}}
            @onInput={{this.pillPadding.update}}
          />
          <Css.Basic
            @name='boxel-pill-gap'
            @type='gap'
            @description='Gap between the pill and the icon'
            @value={{this.pillGap.value}}
            @onInput={{this.pillGap.update}}
          />
          <Css.Basic
            @name='boxel-pill-icon-size'
            @type='min-width'
            @description='Min-width for the icon container'
            @value={{this.pillIconSize.value}}
            @onInput={{this.pillIconSize.update}}
          />
          <Css.Basic
            @name='boxel-pill-background-color'
            @type='color'
            @description='Global override for pill background color (highest priority)'
            @value={{this.boxelPillBackgroundColor.value}}
            @onInput={{this.boxelPillBackgroundColor.update}}
          />
          <Css.Basic
            @name='boxel-pill-font-color'
            @type='color'
            @description='Global override for pill font color (highest priority)'
            @value={{this.boxelPillFontColor.value}}
            @onInput={{this.boxelPillFontColor.update}}
          />
          <Css.Basic
            @name='boxel-pill-border'
            @type='border'
            @description='Global override for pill border (highest priority)'
            @value={{this.boxelPillBorder.value}}
            @onInput={{this.boxelPillBorder.update}}
          />
          <Css.Basic
            @name='boxel-pill-border-color'
            @type='border-color'
            @value={{this.boxelPillBorderColor.value}}
            @onInput={{this.boxelPillBorderColor.update}}
          />
          <Css.Basic
            @name='boxel-pill-border-radius'
            @type='border-radius'
            @description='Global override for pill border-radius (highest priority)'
            @value={{this.boxelPillBorderRadius.value}}
            @onInput={{this.boxelPillBorderRadius.update}}
          />
          <Css.Basic
            @name='boxel-pill-font'
            @type='font'
            @description='Global override for pill font (highest priority)'
            @value={{this.boxelPillFont.value}}
            @onInput={{this.boxelPillFont.update}}
          />
          <Css.Basic
            @name='boxel-pill-transition'
            @type='transition'
            @description='Css "transition" shorthand property'
          />
        </:cssVars>
      </FreestyleUsage>
      <FreestyleUsage @name='SpecTag Usage'>
        <:example>
          <Pill @variant='muted' class='spec-tag-pill'>
            <:iconLeft>
              <CardIcon width='18px' height='18px' />
            </:iconLeft>
            <:default>
              Card
            </:default>
          </Pill>
        </:example>
      </FreestyleUsage>
    </div>
    <style scoped>
      .spec-tag-pill {
        --boxel-pill-font: 500 var(--boxel-font-xs);
        word-break: initial;
        text-transform: uppercase;
      }
    </style>
  </template>
}
