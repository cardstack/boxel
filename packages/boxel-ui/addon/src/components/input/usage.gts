import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';

import cssVar from '../../helpers/css-var.ts';
import BoxelInput from './index.gts';
import { InputBottomTreatments, InputTypes } from './index.gts';

const validTypes = Object.values(InputTypes);
const validBottomTreatments = Object.values(InputBottomTreatments);

export default class InputUsage extends Component {
  @tracked id = 'sample-input';
  @tracked value = '';
  @tracked disabled = false;
  @tracked required = false;
  @tracked optional = false;
  @tracked invalid = false;
  @tracked placeholder = '';
  @tracked errorMessage = '';
  @tracked helperText = '';
  @tracked variant: 'large' | 'default' = 'default';

  defaultType = InputTypes.Default;
  @tracked type = this.defaultType;

  defaultBottomTreatment = InputBottomTreatments.Rounded;
  @tracked bottomTreatment = this.defaultBottomTreatment;

  @cssVariable({ cssClassName: 'boxel-input' })
  declare boxelInputHeight: CSSVariableInfo;

  @action set(ev: Event): void {
    let target = ev.target as HTMLInputElement;
    this.value = target?.value;
    this.validate(ev);
  }

  @action logValue(value: any): void {
    console.log(value);
  }

  @action validate(ev: Event): void {
    let target = ev.target as HTMLInputElement;
    if (!target.validity?.valid) {
      this.invalid = true;
      if (target.validity?.valueMissing) {
        this.errorMessage = 'This is a required field';
      } else {
        this.errorMessage = target.validationMessage;
      }
      return;
    }
    this.invalid = false;
    this.errorMessage = '';
  }

  <template>
    <FreestyleUsage @name='Input'>
      <:example>
        <label for={{this.id}} class='boxel-sr-only'>Label for example input
          component</label>
        <BoxelInput
          @id={{this.id}}
          @value={{this.value}}
          @onInput={{this.logValue}}
          @disabled={{this.disabled}}
          @required={{this.required}}
          @optional={{this.optional}}
          @invalid={{this.invalid}}
          @type={{this.type}}
          @placeholder={{this.placeholder}}
          @bottomTreatment={{this.bottomTreatment}}
          @variant={{this.variant}}
          @errorMessage={{this.errorMessage}}
          @helperText={{this.helperText}}
          style={{cssVar boxel-input-height=this.boxelInputHeight.value}}
          @onBlur={{this.validate}}
          @onFocus={{this.logValue}}
          {{on 'input' this.set}}
        />
      </:example>
      <:api as |Args|>
        <Args.String
          @name='id'
          @value={{this.id}}
          @onInput={{fn (mut this.id)}}
        />
        <Args.String
          @name='type'
          @options={{validTypes}}
          @defaultValue={{this.defaultType}}
          @onInput={{fn (mut this.type)}}
          @value={{this.type}}
        />
        <Args.String
          @name='value'
          @value={{this.value}}
          @onInput={{fn (mut this.value)}}
        />
        <Args.Bool
          @name='disabled'
          @value={{this.disabled}}
          @onInput={{fn (mut this.disabled)}}
        />
        <Args.Bool
          @name='required'
          @value={{this.required}}
          @onInput={{fn (mut this.required)}}
        />
        <Args.Bool
          @name='optional'
          @value={{this.optional}}
          @onInput={{fn (mut this.optional)}}
          @description="Displays 'optional' label, unless the '@required' arg is also true"
        />
        <Args.Bool
          @name='invalid'
          @value={{this.invalid}}
          @onInput={{fn (mut this.invalid)}}
        />
        <Args.String
          @name='errorMessage'
          @value={{this.errorMessage}}
          @onInput={{fn (mut this.errorMessage)}}
          @description="This will only show up if the '@invalid' arg returns true"
        />
        <Args.String
          @name='helperText'
          @value={{this.helperText}}
          @onInput={{fn (mut this.helperText)}}
        />
        <Args.String
          @name='placeholder'
          @description='Placeholder text'
          @onInput={{fn (mut this.placeholder)}}
          @value={{this.placeholder}}
          @defaultValue='Search'
        />
        <Args.String
          @name='bottomTreatment'
          @description='The visual shape of the bottom of the input'
          @onInput={{fn (mut this.bottomTreatment)}}
          @options={{validBottomTreatments}}
          @value={{this.bottomTreatment}}
          @defaultValue={{this.defaultBottomTreatment}}
        />
        <Args.String
          @name='variant'
          @description='The visual shape of the bottom of the input'
          @onInput={{fn (mut this.variant)}}
          @options={{Array 'default' 'large'}}
          @value={{this.variant}}
          @defaultValue={{this.variant}}
        />
        <Args.Action
          @name='onInput'
          @description='Function to update the passed in value. This receives the changed value as a string.'
        />
        <Args.Action @name='onKeyPress' @description='Action on key press' />
        <Args.Action @name='onFocus' @description='Action on focus' />
        <Args.Action @name='onBlur' @description='Action on blur' />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='boxel-input-height'
          @type='dimension'
          @description='Used to set the height of the field'
          @defaultValue={{this.boxelInputHeight.defaults}}
          @value={{this.boxelInputHeight.value}}
          @onInput={{this.boxelInputHeight.update}}
        />
      </:cssVars>
    </FreestyleUsage>

    <FreestyleUsage
      class='remove-in-percy'
      @name='Configure a multiline input using textarea attributes'
    >
      <:example>
        <label for='multilineExample' class='boxel-sr-only'>event example input</label>
        <BoxelInput
          @id='multilineExample'
          @value=''
          @type='textarea'
          rows='10'
          cols='20'
        />
      </:example>
    </FreestyleUsage>

    <FreestyleUsage
      class='remove-in-percy'
      @name="Use the @onInput argument to access the input's value in the callback directly."
    >
      <:example>
        <label for='onInputExample' class='boxel-sr-only'>onInput example input</label>
        <BoxelInput @id='onInputExample' @value='' @onInput={{this.logValue}} />
      </:example>
    </FreestyleUsage>

    <FreestyleUsage
      class='remove-in-percy'
      @name="Use 'on &ldquo;input&rdquo; your-function-here' as an escape hatch to get the input event"
    >
      <:description>

      </:description>
      <:example>
        <label for='modifierExample' class='boxel-sr-only'>event example input</label>
        <BoxelInput
          @id='modifierExample'
          @value=''
          {{on 'input' this.logValue}}
        />
      </:example>
    </FreestyleUsage>
  </template>
}
