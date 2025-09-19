import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import { type BoxelSpacing, BOXEL_SPACING_VARS } from '../../helpers.ts';
import BoxelContainer from '../container/index.gts';
import BoxelGridContainer from './index.gts';

export default class GridContainerUsage extends Component {
  private boxelSpacingVars = BOXEL_SPACING_VARS;
  @tracked private columns?: string | number = 3;
  @tracked private rows?: string | number;
  @tracked private columnMinWidth?: string = '100px';
  @tracked private columnMaxWidth?: string;
  @tracked private rowMinHeight?: string = '50px';
  @tracked private rowMaxHeight?: string;
  @tracked private gap?: string | BoxelSpacing;
  @tracked private columnGap?: string | BoxelSpacing;
  @tracked private rowGap?: string | BoxelSpacing;
  @tracked private padding?: string | BoxelSpacing;
  @tracked private paddingInline?: string | BoxelSpacing = 'default';
  @tracked private paddingBlock?: string | BoxelSpacing = 'xl';
  @tracked private maxWidth?: string = '400px';

  <template>
    <FreestyleUsage @name='GridContainer'>
      <:description>
        A container that provides a grid layout.
      </:description>
      <:example>
        <BoxelGridContainer
          @columns={{this.columns}}
          @rows={{this.rows}}
          @maxWidth={{this.maxWidth}}
          @padding={{this.padding}}
          @paddingInline={{this.paddingInline}}
          @paddingBlock={{this.paddingBlock}}
          @gap={{this.gap}}
          @columnGap={{this.columnGap}}
          @rowGap={{this.rowGap}}
          @columnMinWidth={{this.columnMinWidth}}
          @columnMaxWidth={{this.columnMaxWidth}}
          @rowMinHeight={{this.rowMinHeight}}
          @rowMaxHeight={{this.rowMaxHeight}}
        >
          <BoxelContainer class='box' />
          <BoxelContainer class='box' />
          <BoxelContainer class='box' />
          <BoxelContainer class='box' />
          <BoxelContainer class='box' />
          <BoxelContainer class='box' />
          <BoxelContainer class='box' />
          <BoxelContainer class='box' />
          <BoxelContainer class='box' />
        </BoxelGridContainer>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='columns'
          @description='Grid column count. String, number, "auto-fill", "auto-fit".'
          @value={{this.columns}}
          @optional={{true}}
          @onInput={{fn (mut this.columns)}}
        />
        <Args.String
          @name='rows'
          @description='Grid row count'
          @value={{this.rows}}
          @optional={{true}}
          @onInput={{fn (mut this.rows)}}
        />
        <Args.String
          @name='columnGap'
          @description='Column gap. Accepts string or BoxelSpacing values.'
          @defaultValue='var(--boxel-sp)'
          @value={{this.columnGap}}
          @optional={{true}}
          @options={{this.boxelSpacingVars}}
          @onInput={{fn (mut this.columnGap)}}
        />
        <Args.String
          @name='rowGap'
          @description='Row gap. Accepts string or BoxelSpacing values.'
          @defaultValue='var(--boxel-sp)'
          @value={{this.rowGap}}
          @optional={{true}}
          @options={{this.boxelSpacingVars}}
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
          @defaultValue=''
          @value={{this.paddingInline}}
          @optional={{true}}
          @options={{this.boxelSpacingVars}}
          @onInput={{fn (mut this.paddingInline)}}
        />
        <Args.String
          @name='paddingBlock'
          @description='Container block padding (top and bottom). Accepts string or BoxelSpacing values.'
          @defaultValue=''
          @value={{this.paddingBlock}}
          @optional={{true}}
          @options={{this.boxelSpacingVars}}
          @onInput={{fn (mut this.paddingBlock)}}
        />
        <Args.String
          @name='padding'
          @description='Container padding. Accepts string or BoxelSpacing values.'
          @defaultValue=''
          @value={{this.padding}}
          @optional={{true}}
          @options={{this.boxelSpacingVars}}
          @onInput={{fn (mut this.padding)}}
        />
        <Args.String
          @name='maxWidth'
          @description='Container max-width'
          @defaultValue='100%'
          @value={{this.maxWidth}}
          @optional={{true}}
          @onInput={{fn (mut this.maxWidth)}}
        />
        <Args.String
          @name='columnMinWidth'
          @description='Column min width'
          @defaultValue='0'
          @value={{this.columnMinWidth}}
          @optional={{true}}
          @onInput={{fn (mut this.columnMinWidth)}}
        />
        <Args.String
          @name='columnMaxWidth'
          @description='Column max width'
          @defaultValue='1fr'
          @value={{this.columnMaxWidth}}
          @optional={{true}}
          @onInput={{fn (mut this.columnMaxWidth)}}
        />
        <Args.String
          @name='rowMinHeight'
          @description='Row min height'
          @defaultValue='0'
          @value={{this.rowMinHeight}}
          @optional={{true}}
          @onInput={{fn (mut this.rowMinHeight)}}
        />
        <Args.String
          @name='rowMaxHeight'
          @description='Row max height'
          @defaultValue='1fr'
          @value={{this.rowMaxHeight}}
          @optional={{true}}
          @onInput={{fn (mut this.rowMaxHeight)}}
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
