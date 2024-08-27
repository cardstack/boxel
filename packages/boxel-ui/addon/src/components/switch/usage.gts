import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import Switch from './index.gts';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import { fn } from '@ember/helper';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';
import { cssVar } from '@cardstack/boxel-ui/helpers';

export default class SwitchUsage extends Component {
  @tracked isEnabled = false;
  @tracked isNotifications = true;

  @action
  toggleEnabled() {
    this.isEnabled = !this.isEnabled;
  }

  @cssVariable({ cssClassName: 'toggle-freestyle-container' })
  declare boxelToggleColor: CSSVariableInfo;

  <template>
    <div
      class='header-freestyle-container'
      style={{cssVar boxel-toggle-color=this.boxelToggleColor.value}}
    >
      <FreestyleUsage @name='Switch'>
        <:description>
          A switch is a component that allows the user to toggle a setting on or
          off.
        </:description>
        <:example>
          <Switch
            @isEnabled={{this.isEnabled}}
            @onToggle={{this.toggleEnabled}}
          />
        </:example>
        <:api as |Args|>
          <Args.Bool
            @name='isEnabled'
            @defaultValue={{false}}
            @value={{this.isEnabled}}
            @onInput={{fn (mut this.isEnabled)}}
          />
        </:api>
        <:cssVars as |Css|>
          <Css.Basic
            @name='boxel-toggle-color'
            @type='color'
            @description='Color of the toggle background'
            @value={{this.boxelToggleColor.value}}
            @onInput={{this.boxelToggleColor.update}}
          />
        </:cssVars>
      </FreestyleUsage>
    </div>
  </template>
}
