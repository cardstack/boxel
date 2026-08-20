import Moon from '@cardstack/boxel-icons/moon';
import Sun from '@cardstack/boxel-icons/sun';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';

import cssVar from '../../helpers/css-var.ts';
import Switch, { type SwitchSize, switchSizeOptions } from './index.gts';

export default class SwitchUsage extends Component {
  @tracked isEnabled = false;
  @tracked isDisabled = false;
  @tracked label = 'Switch';
  @tracked size: SwitchSize = 'base';

  /* Switch asserts without a label, so wait for the knob to name it */
  get hasLabel() {
    return Boolean(this.label && this.label.trim());
  }

  @tracked isLabeledEnabled = false;
  @tracked isDarkModeEnabled = false;

  @action
  handleChange(isEnabled: boolean) {
    this.isEnabled = isEnabled;
  }

  @action
  handleLabeledChange(isEnabled: boolean) {
    this.isLabeledEnabled = isEnabled;
  }

  @action
  handleDarkModeChange(isEnabled: boolean) {
    this.isDarkModeEnabled = isEnabled;
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
  @cssVariable({ cssClassName: 'switch-freestyle-container' })
  declare boxelSwitchThumbIcon: CSSVariableInfo;
  @cssVariable({ cssClassName: 'switch-freestyle-container' })
  declare boxelSwitchActiveThumbIcon: CSSVariableInfo;

  constructor(owner: Owner, args: Record<string, never>) {
    super(owner, args);
    /* ember-freestyle seeds each value from a temp element at
       document.body, outside the themed docs container, pinning the
       chrome's :root values on the preview via inline style. Clear the
       seeds so it follows theme cycling until a control is touched. */
    for (let info of [
      this.boxelSwitchWidth,
      this.boxelSwitchHeight,
      this.boxelSwitchBackground,
      this.boxelSwitchActiveBackground,
      this.boxelSwitchThumb,
      this.boxelSwitchActiveThumb,
      this.boxelSwitchThumbEdge,
      this.boxelSwitchThumbIcon,
      this.boxelSwitchActiveThumbIcon,
      this.boxelSwitchMinTarget,
    ]) {
      info.value = undefined;
    }
  }
  @cssVariable({ cssClassName: 'switch-freestyle-container' })
  declare boxelSwitchMinTarget: CSSVariableInfo;

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
        boxel-switch-thumb-icon=this.boxelSwitchThumbIcon.value
        boxel-switch-active-thumb-icon=this.boxelSwitchActiveThumbIcon.value
        boxel-switch-min-target=this.boxelSwitchMinTarget.value
      }}
    >
      <FreestyleUsage @name='Switch'>
        <:description>
          A switch is a component that allows the user to switch a setting on or
          off. It responds to click, Space, and Enter, and announces itself to
          assistive technology as a switch. It is fully controlled: the switch
          never changes state on its own — it calls onChange with the new value,
          and only moves when isEnabled is updated to match. label is always
          required — it is the accessible name. Yield a block to also render a
          visible label beside the track, in which case label should repeat that
          text.
        </:description>
        <:example>
          {{#if this.hasLabel}}
            <Switch
              @label={{this.label}}
              @isEnabled={{this.isEnabled}}
              @onChange={{this.handleChange}}
              @disabled={{this.isDisabled}}
              @size={{this.size}}
            />
          {{else}}
            <p>Set the label arg to render this example — without it (or a
              visible label block) the switch would have no accessible name,
              which Switch rejects in development.</p>
          {{/if}}
        </:example>
        <:api as |Args|>
          <Args.String
            @name='label'
            @description='Accessible label for the switch (visually hidden, read by screen readers). Required unless a block provides a visible label'
            @value={{this.label}}
            @onInput={{fn (mut this.label)}}
            @optional={{true}}
          />
          <Args.Yield
            @description='Visible label rendered beside the track, programmatically associated with the switch'
            @optional={{true}}
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
          <Args.String
            @name='size'
            @description='Size preset for the track; thumb, travel, and hit area follow. Custom sizes remain available via the width/height CSS variables'
            @defaultValue='base'
            @options={{switchSizeOptions}}
            @value={{this.size}}
            @onInput={{fn (mut this.size)}}
            @optional={{true}}
          />
          <Args.Component
            @name='checkedIcon'
            @description='Decorative icon rendered inside the thumb while the switch is on (e.g. a boxel-icons component). Skipped at size small'
            @optional={{true}}
          />
          <Args.Component
            @name='uncheckedIcon'
            @description='Decorative icon rendered inside the thumb while the switch is off. Skipped at size small'
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
            @description='Color of the thumb when the switch is on (defaults to boxel-switch-thumb)'
            @defaultValue={{this.boxelSwitchActiveThumb.defaults}}
            @value={{this.boxelSwitchActiveThumb.value}}
            @onInput={{this.boxelSwitchActiveThumb.update}}
          />
          <Css.Basic
            @name='boxel-switch-thumb-edge'
            @type='color'
            @description='Color of the 1px ring around the thumb (defaults to a translucent primary-foreground mix so the thumb stays visible when track and thumb colors coincide)'
            @defaultValue={{this.boxelSwitchThumbEdge.defaults}}
            @value={{this.boxelSwitchThumbEdge.value}}
            @onInput={{this.boxelSwitchThumbEdge.update}}
          />
          <Css.Basic
            @name='boxel-switch-thumb-icon'
            @type='color'
            @description='Color of the thumb icon (defaults to the foreground color)'
            @defaultValue={{this.boxelSwitchThumbIcon.defaults}}
            @value={{this.boxelSwitchThumbIcon.value}}
            @onInput={{this.boxelSwitchThumbIcon.update}}
          />
          <Css.Basic
            @name='boxel-switch-active-thumb-icon'
            @type='color'
            @description='Color of the thumb icon when the switch is on (defaults to boxel-switch-thumb-icon)'
            @defaultValue={{this.boxelSwitchActiveThumbIcon.defaults}}
            @value={{this.boxelSwitchActiveThumbIcon.value}}
            @onInput={{this.boxelSwitchActiveThumbIcon.update}}
          />
          <Css.Basic
            @name='boxel-switch-min-target'
            @type='dimension'
            @description='Minimum clickable size of the control (default 1.5rem, the 24px minimum target size). The label pads itself out to this size when the drawn track is smaller; the padding stays inside the element, so it never overlaps neighbouring controls'
            @defaultValue={{this.boxelSwitchMinTarget.defaults}}
            @value={{this.boxelSwitchMinTarget.value}}
            @onInput={{this.boxelSwitchMinTarget.update}}
          />
        </:cssVars>
      </FreestyleUsage>

      <FreestyleUsage @name='Switch with a visible label'>
        <:description>
          Yielding a block renders it as a visible label beside the track;
          clicking the text toggles the switch, and it names the control for
          assistive technology, so no label arg is passed.
        </:description>
        <:example>
          <Switch
            @isEnabled={{this.isLabeledEnabled}}
            @onChange={{this.handleLabeledChange}}
          >
            Email notifications
          </Switch>
        </:example>
      </FreestyleUsage>

      <FreestyleUsage @name='Switch with thumb icons'>
        <:description>
          checkedIcon and uncheckedIcon render inside the thumb for the matching
          state. The icons are decorative — the label still names the control —
          and they are skipped at size small, where the thumb is too small for a
          legible glyph.
        </:description>
        <:example>
          <Switch
            @isEnabled={{this.isDarkModeEnabled}}
            @onChange={{this.handleDarkModeChange}}
            @checkedIcon={{Moon}}
            @uncheckedIcon={{Sun}}
            @size='touch'
          >
            Dark mode
          </Switch>
        </:example>
      </FreestyleUsage>
    </div>
  </template>
}
