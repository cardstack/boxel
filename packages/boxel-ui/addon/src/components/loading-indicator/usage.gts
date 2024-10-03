/* eslint-disable no-console */
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
  @tracked color = '#000';
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
        />
      </:example>
      <:api as |Args|>
        <Args.String
          @name='color'
          @description='The color of the loading indicator'
          @value={{this.color}}
          @onInput={{fn (mut this.color)}}
          @default='black'
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
