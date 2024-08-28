import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import { fn } from '@ember/helper';
import { cssVar } from '@cardstack/boxel-ui/helpers';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';

import BoxelProgress from './index.gts';

export default class ProgressUsage extends Component {
  @tracked value = 70;
  @tracked max = 100;
  @tracked label = '';

  @cssVariable({ cssClassName: 'progress-freestyle-container' })
  declare boxelProgressBackgroundColor: CSSVariableInfo;
  @cssVariable({ cssClassName: 'progress-freestyle-container' })
  declare boxelProgressValueColor: CSSVariableInfo;
  @cssVariable({ cssClassName: 'progress-freestyle-container' })
  declare boxelProgressBorderRadius: CSSVariableInfo;

  get progressValue() {
    return `${this.value} / ${this.max}`;
  }

  <template>
    <div
      class='progress-freestyle-container'
      style={{cssVar
        boxel-progress-background-color=this.boxelProgressBackgroundColor.value
        boxel-progress-value-color=this.boxelProgressValueColor.value
        boxel-progress-border-radius=this.boxelProgressBorderRadius.value
      }}
    >
      <FreestyleUsage @name='Progress'>
        <:description>
          A progress bar component to show completion of a task
        </:description>
        <:example>
          <BoxelProgress
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
            @description='Custom label for the progress bar'
            @value={{this.label}}
            @onInput={{fn (mut this.label)}}
          />
        </:api>
        <:cssVars as |Css|>
          <Css.Basic
            @name='boxel-progress-background-color'
            @type='color'
            @description='Background color of the progress bar'
            @defaultValue={{this.boxelProgressBackgroundColor.defaults}}
            @value={{this.boxelProgressBackgroundColor.value}}
            @onInput={{this.boxelProgressBackgroundColor.update}}
          />
          <Css.Basic
            @name='boxel-progress-value-color'
            @type='color'
            @description='Color of the progress value'
            @defaultValue={{this.boxelProgressValueColor.defaults}}
            @value={{this.boxelProgressValueColor.value}}
            @onInput={{this.boxelProgressValueColor.update}}
          />
          <Css.Basic
            @name='boxel-progress-border-radius'
            @type='size'
            @description='Border radius of the progress bar'
            @defaultValue={{this.boxelProgressBorderRadius.defaults}}
            @value={{this.boxelProgressBorderRadius.value}}
            @onInput={{this.boxelProgressBorderRadius.update}}
          />
        </:cssVars>
      </FreestyleUsage>

      <FreestyleUsage @name='Progress with value'>
        <:example>
          <BoxelProgress
            @value={{this.value}}
            @max={{this.max}}
            @label={{this.progressValue}}
          />
        </:example>
      </FreestyleUsage>
    </div>
  </template>
}
