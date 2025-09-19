import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import { type BoxelSpacing, BOXEL_SPACING_VARS } from '../../helpers.ts';
import BoxelContainer from '../container/index.gts';
import BoxelFlexContainer from './index.gts';

export default class FlexContainerUsage extends Component {
  private boxelSpacingVars = BOXEL_SPACING_VARS;
  @tracked private flexDirection?: string;
  @tracked private flexWrap?: string;
  @tracked private gap?: string | BoxelSpacing;
  @tracked private columnGap?: string | BoxelSpacing;
  @tracked private rowGap?: string | BoxelSpacing;
  @tracked private padding?: string | BoxelSpacing;
  @tracked private paddingInline?: string | BoxelSpacing;
  @tracked private paddingBlock?: string | BoxelSpacing;
  @tracked private maxWidth?: string;

  <template>
    <FreestyleUsage @name='BoxelFlexContainer'>
      <:description>
        A container that provides a flexbox layout.
      </:description>
      <:example>
        <BoxelFlexContainer
          @flexDirection={{this.flexDirection}}
          @flexWrap={{this.flexWrap}}
          @maxWidth={{this.maxWidth}}
          @padding={{this.padding}}
          @paddingInline={{this.paddingInline}}
          @paddingBlock={{this.paddingBlock}}
          @gap={{this.gap}}
          @columnGap={{this.columnGap}}
          @rowGap={{this.rowGap}}
        >
          <BoxelContainer class='box' />
          <BoxelContainer class='box' />
          <BoxelContainer class='box' />
          <BoxelContainer class='box' />
        </BoxelFlexContainer>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='flexWrap'
          @value={{this.flexWrap}}
          @onInput={{fn (mut this.flexWrap)}}
        />
        <Args.String
          @name='flexDirection'
          @value={{this.flexDirection}}
          @onInput={{fn (mut this.flexDirection)}}
        />
        <Args.String
          @name='columnGap'
          @description='Column gap. Accepts string or BoxelSpacing values.'
          @value={{this.columnGap}}
          @optional={{true}}
          @onInput={{fn (mut this.columnGap)}}
        />
        <Args.String
          @name='rowGap'
          @description='Row gap. Accepts string or BoxelSpacing values.'
          @value={{this.rowGap}}
          @optional={{true}}
          @onInput={{fn (mut this.rowGap)}}
        />
        <Args.String
          @name='gap'
          @description='Grid gap. Accepts string or BoxelSpacing values.'
          @defaultValue='var(--boxel-sp)'
          @value={{this.gap}}
          @optional={{true}}
          @options={{this.boxelSpacingVars}}
          @onInput={{fn (mut this.gap)}}
        />
        <Args.String
          @name='paddingInline'
          @description='Container inline padding (right and left). Accepts string or BoxelSpacing values.'
          @value={{this.paddingInline}}
          @optional={{true}}
          @onInput={{fn (mut this.paddingInline)}}
        />
        <Args.String
          @name='paddingBlock'
          @description='Container block padding (top and bottom). Accepts string or BoxelSpacing values.'
          @value={{this.paddingBlock}}
          @optional={{true}}
          @onInput={{fn (mut this.paddingBlock)}}
        />
        <Args.String
          @name='padding'
          @description='Container padding. Accepts string or BoxelSpacing values.'
          @value={{this.padding}}
          @optional={{true}}
          @onInput={{fn (mut this.padding)}}
        />
        <Args.String
          @name='maxWidth'
          @description='Container max-width'
          @value={{this.maxWidth}}
          @optional={{true}}
          @onInput={{fn (mut this.maxWidth)}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .box {
        background-color: var(--boxel-200);
        border-radius: var(--boxel-border-radius);
      }
    </style>
  </template>
}
