import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';

import cssVars from '../../helpers/css-var.ts';
import BoxelLoadingIndicator from './index.gts';

export default class LoadingIndicatorUsage extends Component {
  @tracked color = '';
  @tracked variant:
    | undefined
    | 'primary'
    | 'secondary'
    | 'muted'
    | 'destructive'
    | 'default' = undefined;

  variants = ['default', 'primary', 'secondary', 'muted', 'destructive'];

  @cssVariable({ cssClassName: 'boxel-loading-indicator-size' })
  declare boxelLoadingIndicatorSize: CSSVariableInfo;

  <template>
    <FreestyleUsage
      @name='Loading Indicator'
      @description='Default loading indicator for Boxel components.'
    >
      <:example>
        <BoxelLoadingIndicator
          class='loading-indicator-usage__example'
          style={{cssVars
            boxel-loading-indicator-size=this.boxelLoadingIndicatorSize.value
          }}
          @color={{this.color}}
          @variant={{this.variant}}
        />
      </:example>
      <:api as |Args|>
        <Args.String
          @name='color'
          @description='Custom color override (CSS color value)'
          @value={{this.color}}
          @onInput={{fn (mut this.color)}}
          @default='undefined'
        />
        <Args.String
          @name='variant'
          @description='Theme-based color variant'
          @value={{this.variant}}
          @onInput={{fn (mut this.variant)}}
          @options={{this.variants}}
          @default='undefined'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='loading-indicator-size'
          @type='length'
          @description='Sets height and width for loading indicator icon.'
          @defaultValue={{this.boxelLoadingIndicatorSize.defaults}}
          @value={{this.boxelLoadingIndicatorSize.value}}
          @onInput={{this.boxelLoadingIndicatorSize.update}}
        />
      </:cssVars>
    </FreestyleUsage>
  </template>
}
