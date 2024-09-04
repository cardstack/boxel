import { cssVar } from '@cardstack/boxel-ui/helpers';
import { array, fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';

import BoxelProgressBar, { type BoxelProgressBarPosition } from './index.gts';

export default class ProgressBarUsage extends Component {
  @tracked max = 100;
  @tracked value = 20;
  @tracked label = '';
  @tracked position: BoxelProgressBarPosition = 'end';

  @cssVariable({ cssClassName: 'progress-bar-freestyle-container' })
  declare boxelProgressBarBackgroundColor: CSSVariableInfo;
  @cssVariable({ cssClassName: 'progress-bar-freestyle-container' })
  declare boxelProgressBarFillColor: CSSVariableInfo;
  @cssVariable({ cssClassName: 'progress-bar-freestyle-container' })
  declare boxelProgressBarBorderRadius: CSSVariableInfo;
  @cssVariable({ cssClassName: 'progress-bar-freestyle-container' })
  declare boxelProgressBarFontColor: CSSVariableInfo;

  get progressValue() {
    return `${this.value} / ${this.max}`;
  }

  <template>
    <div
      class='progress-bar-freestyle-container'
      style={{cssVar
        boxel-progress-bar-background-color=this.boxelProgressBarBackgroundColor.value
        boxel-progress-bar-fill-color=this.boxelProgressBarFillColor.value
        boxel-progress-bar-border-radius=this.boxelProgressBarBorderRadius.value
        boxel-progress-bar-font-color=this.boxelProgressBarFontColor.value
      }}
    >
      <FreestyleUsage @name='Progress'>
        <:description>
          A progress bar component to show completion of a task
        </:description>
        <:example>
          <BoxelProgressBar
            @value={{this.value}}
            @max={{this.max}}
            @position={{this.position}}
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
            @description='Custom label for the progress bar'
            @value={{this.label}}
            @onInput={{fn (mut this.label)}}
          />
          <Args.String
            @name='position'
            @value={{this.position}}
            @options={{array 'start' 'center' 'end'}}
            @description='Position of the progress bar info'
            @onInput={{fn (mut this.position)}}
          />
        </:api>
        <:cssVars as |Css|>
          <Css.Basic
            @name='boxel-progress-bar-background-color'
            @type='color'
            @description='Background color of the progress bar'
            @defaultValue={{this.boxelProgressBarBackgroundColor.defaults}}
            @value={{this.boxelProgressBarBackgroundColor.value}}
            @onInput={{this.boxelProgressBarBackgroundColor.update}}
          />
          <Css.Basic
            @name='boxel-progress-bar-fill-color'
            @type='color'
            @description='Color of the progress value'
            @defaultValue={{this.boxelProgressBarFillColor.defaults}}
            @value={{this.boxelProgressBarFillColor.value}}
            @onInput={{this.boxelProgressBarFillColor.update}}
          />
          <Css.Basic
            @name='boxel-progress-bar-border-radius'
            @type='size'
            @description='Border radius of the progress bar'
            @defaultValue={{this.boxelProgressBarBorderRadius.defaults}}
            @value={{this.boxelProgressBarBorderRadius.value}}
            @onInput={{this.boxelProgressBarBorderRadius.update}}
          />
          <Css.Basic
            @name='boxel-progress-bar-font-color'
            @type='color'
            @description='Font color of the progress bar label'
            @defaultValue={{this.boxelProgressBarFontColor.defaults}}
            @value={{this.boxelProgressBarFontColor.value}}
            @onInput={{this.boxelProgressBarFontColor.update}}
          />
        </:cssVars>
      </FreestyleUsage>

      <FreestyleUsage @name='Progress with value'>
        <:example>
          <BoxelProgressBar
            @value={{this.value}}
            @max={{this.max}}
            @position={{this.position}}
            @label={{this.progressValue}}
          />
        </:example>
      </FreestyleUsage>
    </div>
  </template>
}
