import { cssVar } from '@cardstack/boxel-ui/helpers';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';

import Switch from './index.gts';

export default class SwitchUsage extends Component {
  @tracked isEnabled = false;
  @tracked isDisabled = false;

  @action
  handleChange() {
    this.isEnabled = !this.isEnabled;
  }

  @cssVariable({ cssClassName: 'switch-freestyle-container' })
  declare boxelSwitchColor: CSSVariableInfo;

  <template>
    <div
      class='header-freestyle-container'
      style={{cssVar boxel-switch-color=this.boxelSwitchColor.value}}
    >
      <FreestyleUsage @name='Switch'>
        <:description>
          A switch is a component that allows the user to switch a setting on or
          off.
        </:description>
        <:example>
          <Switch
            @label={{'Switch'}}
            @isEnabled={{this.isEnabled}}
            @onChange={{this.handleChange}}
            @disabled={{this.isDisabled}}
          />
        </:example>
        <:api as |Args|>
          <Args.Bool
            @name='isEnabled'
            @defaultValue={{false}}
            @value={{this.isEnabled}}
            @onInput={{fn (mut this.isEnabled)}}
          />
          <Args.Bool
            @name='disabled'
            @defaultValue={{false}}
            @value={{this.isDisabled}}
            @onInput={{fn (mut this.isDisabled)}}
          />
        </:api>
        <:cssVars as |Css|>
          <Css.Basic
            @name='boxel-switch-color'
            @type='color'
            @description='Color of the switch background (Only viewable when isEnabled=true)'
            @value={{this.boxelSwitchColor.value}}
            @onInput={{this.boxelSwitchColor.update}}
          />
        </:cssVars>
      </FreestyleUsage>
    </div>
  </template>
}
