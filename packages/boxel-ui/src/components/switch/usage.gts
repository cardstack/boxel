import { fn } from '@ember/helper';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';

import cssVar from '../../helpers/css-var.ts';
import Switch from './index.gts';

export default class SwitchUsage extends Component {
  @tracked isEnabled = false;
  @tracked isDisabled = false;
  @tracked label = 'Switch';

  @action
  handleChange(isEnabled: boolean) {
    this.isEnabled = isEnabled;
  }

  @cssVariable({ cssClassName: 'switch-freestyle-container' })
  declare boxelSwitchWidth: CSSVariableInfo;
  @cssVariable({ cssClassName: 'switch-freestyle-container' })
  declare boxelSwitchHeight: CSSVariableInfo;
  @cssVariable({ cssClassName: 'switch-freestyle-container' })
  declare boxelSwitchBackground: CSSVariableInfo;
  @cssVariable({ cssClassName: 'switch-freestyle-container' })
  declare boxelSwitchActiveBackground: CSSVariableInfo;
  @cssVariable({ cssClassName: 'switch-freestyle-container' })
  declare boxelSwitchThumb: CSSVariableInfo;
  @cssVariable({ cssClassName: 'switch-freestyle-container' })
  declare boxelSwitchActiveThumb: CSSVariableInfo;
  @cssVariable({ cssClassName: 'switch-freestyle-container' })
  declare boxelSwitchThumbEdge: CSSVariableInfo;

  <template>
    <div
      class='switch-freestyle-container'
      style={{cssVar
        boxel-switch-width=this.boxelSwitchWidth.value
        boxel-switch-height=this.boxelSwitchHeight.value
        boxel-switch-background=this.boxelSwitchBackground.value
        boxel-switch-active-background=this.boxelSwitchActiveBackground.value
        boxel-switch-thumb=this.boxelSwitchThumb.value
        boxel-switch-active-thumb=this.boxelSwitchActiveThumb.value
        boxel-switch-thumb-edge=this.boxelSwitchThumbEdge.value
      }}
    >
      <FreestyleUsage @name='Switch'>
        <:description>
          A switch is a component that allows the user to switch a setting on or
          off. It responds to click, Space, and Enter, and announces itself to
          assistive technology as a switch. It is fully controlled: the switch
          never changes state on its own — it calls onChange with the new value,
          and only moves when isEnabled is updated to match.
        </:description>
        <:example>
          <Switch
            @label={{this.label}}
            @isEnabled={{this.isEnabled}}
            @onChange={{this.handleChange}}
            @disabled={{this.isDisabled}}
          />
        </:example>
        <:api as |Args|>
          <Args.String
            @name='label'
            @description='Accessible label for the switch (visually hidden, read by screen readers)'
            @value={{this.label}}
            @onInput={{fn (mut this.label)}}
          />
          <Args.Bool
            @name='isEnabled'
            @description='Whether the switch is on. The single source of truth: the switch only moves when this changes'
            @defaultValue={{false}}
            @value={{this.isEnabled}}
            @onInput={{fn (mut this.isEnabled)}}
          />
          <Args.Bool
            @name='disabled'
            @description='Whether the switch can be toggled'
            @defaultValue={{false}}
            @value={{this.isDisabled}}
            @onInput={{fn (mut this.isDisabled)}}
            @optional={{true}}
          />
          <Args.Action
            @name='onChange'
            @description='Called with the requested on/off state when the user toggles the switch. Update isEnabled here to apply the change'
          />
        </:api>
        <:cssVars as |Css|>
          <Css.Basic
            @name='boxel-switch-width'
            @type='dimension'
            @description='Width of the switch track'
            @defaultValue={{this.boxelSwitchWidth.defaults}}
            @value={{this.boxelSwitchWidth.value}}
            @onInput={{this.boxelSwitchWidth.update}}
          />
          <Css.Basic
            @name='boxel-switch-height'
            @type='dimension'
            @description='Height of the switch track (the thumb sizes to match)'
            @defaultValue={{this.boxelSwitchHeight.defaults}}
            @value={{this.boxelSwitchHeight.value}}
            @onInput={{this.boxelSwitchHeight.update}}
          />
          <Css.Basic
            @name='boxel-switch-background'
            @type='color'
            @description='Track color when the switch is off'
            @defaultValue={{this.boxelSwitchBackground.defaults}}
            @value={{this.boxelSwitchBackground.value}}
            @onInput={{this.boxelSwitchBackground.update}}
          />
          <Css.Basic
            @name='boxel-switch-active-background'
            @type='color'
            @description='Track color when the switch is on'
            @defaultValue={{this.boxelSwitchActiveBackground.defaults}}
            @value={{this.boxelSwitchActiveBackground.value}}
            @onInput={{this.boxelSwitchActiveBackground.update}}
          />
          <Css.Basic
            @name='boxel-switch-thumb'
            @type='color'
            @description='Color of the thumb'
            @defaultValue={{this.boxelSwitchThumb.defaults}}
            @value={{this.boxelSwitchThumb.value}}
            @onInput={{this.boxelSwitchThumb.update}}
          />
          <Css.Basic
            @name='boxel-switch-active-thumb'
            @type='color'
            @description='Color of the thumb when the switch is on (defaults to boxel-switch-thumb; themed light in dark mode)'
            @defaultValue={{this.boxelSwitchActiveThumb.defaults}}
            @value={{this.boxelSwitchActiveThumb.value}}
            @onInput={{this.boxelSwitchActiveThumb.update}}
          />
          <Css.Basic
            @name='boxel-switch-thumb-edge'
            @type='color'
            @description='Color of the 1px ring around the thumb (defaults to a translucent foreground mix so the thumb stays visible when track and thumb colors coincide)'
            @defaultValue={{this.boxelSwitchThumbEdge.defaults}}
            @value={{this.boxelSwitchThumbEdge.value}}
            @onInput={{this.boxelSwitchThumbEdge.update}}
          />
        </:cssVars>
      </FreestyleUsage>
    </div>
  </template>
}
