import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';

import { cssVar } from '../..//helpers/css-var.ts';
import BoxelProgressRadial from './index.gts';

export default class ProgressRadialUsage extends Component {
  @tracked max = 100;
  @tracked value = 20;
  @tracked label = '';

  @cssVariable({ cssClassName: 'progress-radial-freestyle-container' })
  declare boxelProgressRadialFillColor: CSSVariableInfo;
  @cssVariable({ cssClassName: 'progress-radial-freestyle-container' })
  declare boxelProgressRadialBackgroundColor: CSSVariableInfo;

  get progressValue() {
    const max = Math.round(Math.min(this.max));
    const value = Math.round(Math.min(this.value));
    return `${value} / ${max}`;
  }

  <template>
    <div
      class='progress-radial-freestyle-container'
      style={{cssVar
        boxel-progress-radial-fill-color=this.boxelProgressRadialFillColor.value
        boxel-progress-radial-background-color=this.boxelProgressRadialBackgroundColor.value
      }}
    >
      <FreestyleUsage @name='Progress Radial'>
        <:description>
          A circular progress indicator to show completion of a task
        </:description>
        <:example>
          <BoxelProgressRadial
            @value={{this.value}}
            @max={{this.max}}
            @label={{this.label}}
          />
        </:example>
        <:api as |Args|>
          <Args.Number
            @name='value'
            @description='Current value of the progress'
            @value={{this.value}}
            @onInput={{fn (mut this.value)}}
          />
          <Args.Number
            @name='max'
            @description='Maximum value of the progress'
            @value={{this.max}}
            @onInput={{fn (mut this.max)}}
          />
          <Args.String
            @name='label'
            @description='Custom label for the progress indicator'
            @value={{this.label}}
            @onInput={{fn (mut this.label)}}
          />
        </:api>
        <:cssVars as |Css|>
          <Css.Basic
            @name='boxel-progress-radial-fill-color'
            @type='color'
            @description='Color of the progress value'
            @defaultValue={{this.boxelProgressRadialFillColor.defaults}}
            @value={{this.boxelProgressRadialFillColor.value}}
            @onInput={{this.boxelProgressRadialFillColor.update}}
          />
          <Css.Basic
            @name='boxel-progress-radial-background-color'
            @type='color'
            @description='Background color of the progress indicator'
            @defaultValue={{this.boxelProgressRadialBackgroundColor.defaults}}
            @value={{this.boxelProgressRadialBackgroundColor.value}}
            @onInput={{this.boxelProgressRadialBackgroundColor.update}}
          />
        </:cssVars>
      </FreestyleUsage>
    </div>
  </template>
}
