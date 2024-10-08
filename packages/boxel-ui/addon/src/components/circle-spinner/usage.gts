import Component from '@glimmer/component';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';

import cssVar from '../../helpers/css-var.ts';
import CircleSpinner from './index.gts';

export default class CircleSpinnerUsage extends Component {
  cssClassName = 'icon-color';
  @cssVariable declare iconColor: CSSVariableInfo;

  <template>
    <FreestyleUsage @name='CircleSpinner'>
      <:description>
        Spinner by composing IconCircle component and CSS. Takes on the size of
        its container.
      </:description>
      <:example>
        <div class='example-container'>
          <CircleSpinner style={{cssVar icon-color=this.iconColor.value}} />
        </div>
      </:example>

      <:cssVars as |Css|>
        <Css.Basic
          @name='boxel-icon-color'
          @type='color'
          @description='Color of the stroke of the circle'
          @defaultValue='#000'
          @value={{this.iconColor.value}}
          @onInput={{this.iconColor.update}}
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      .example-container {
        display: flex;
        justify-content: center;
        align-items: center;
        height: 30px;
        width: 30px;
      }
    </style>
  </template>
}
