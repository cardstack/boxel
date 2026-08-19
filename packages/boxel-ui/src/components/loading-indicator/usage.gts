import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';

import cssVar from '../../helpers/css-var.ts';
import BoxelLoadingIndicator from './index.gts';

export default class LoadingIndicatorUsage extends Component {
  @tracked color?: string;
  @tracked size?: string;

  @cssVariable({ cssClassName: 'loading-indicator-usage-container' })
  declare boxelLoadingIndicatorSize: CSSVariableInfo;
  @cssVariable({ cssClassName: 'loading-indicator-usage-container' })
  declare boxelLoadingIndicatorColor: CSSVariableInfo;

  <template>
    <div
      class='loading-indicator-usage-container'
      style={{cssVar
        boxel-loading-indicator-size=this.boxelLoadingIndicatorSize.value
        boxel-loading-indicator-color=this.boxelLoadingIndicatorColor.value
      }}
    >
      <FreestyleUsage
        @name='Loading Indicator'
        @description='Default loading indicator for Boxel components.'
      >
        <:example>
          <BoxelLoadingIndicator
            class='loading-indicator-usage__example'
            @color={{this.color}}
            @size={{this.size}}
          />
        </:example>
        <:api as |Args|>
          <Args.String
            @name='color'
            @description='Custom color override (CSS color value). Defaults to currentColor.'
            @value={{this.color}}
            @onInput={{fn (mut this.color)}}
            @default='undefined'
          />
          <Args.String
            @name='size'
            @description='One CSS length for both axes, e.g. 20px. Takes precedence over the boxel-loading-indicator-size variable.'
            @value={{this.size}}
            @onInput={{fn (mut this.size)}}
            @default='undefined'
          />
        </:api>
        <:cssVars as |Css|>
          <Css.Basic
            @name='boxel-loading-indicator-size'
            @type='length'
            @description='Sets height and width for loading indicator icon. The @size argument takes precedence.'
            @defaultValue={{this.boxelLoadingIndicatorSize.defaults}}
            @value={{this.boxelLoadingIndicatorSize.value}}
            @onInput={{this.boxelLoadingIndicatorSize.update}}
          />
          <Css.Basic
            @name='boxel-loading-indicator-color'
            @type='color'
            @description='Icon color (defaults to currentColor). The @color argument takes precedence.'
            @defaultValue={{this.boxelLoadingIndicatorColor.defaults}}
            @value={{this.boxelLoadingIndicatorColor.value}}
            @onInput={{this.boxelLoadingIndicatorColor.update}}
          />
        </:cssVars>
      </FreestyleUsage>
    </div>
  </template>
}
