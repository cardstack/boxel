import { array, fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';

import cssVars from '../../helpers/css-var.ts';
import { ALL_ICON_COMPONENTS } from '../../icons/index.gts';
import Profile from '../../icons/profile.gts';
import type { Icon } from '../../icons/types.ts';
import BoxelInput from '../input/index.gts';
import BoxelInputValidationState from '../input/validation-state/index.gts';
import BoxelFieldContainer from './index.gts';

export default class FieldUsage extends Component {
  @tracked label = 'Full Name of the Issuer';
  @tracked value = 'Gary Walker';
  @tracked id = 'sample-field';
  @tracked vertical = false;
  @tracked centeredDisplay = false;
  @tracked horizontalLabelSize = 'default';
  @tracked icon = Profile;
  @tracked tag?: keyof HTMLElementTagNameMap;

  @tracked vertical2 = false;
  @tracked horizontalLabelSize2 = 'default';
  @tracked icon2: Icon | undefined;
  @cssVariable({ cssClassName: 'boxel-field' })
  declare boxelFieldLabelAlign: CSSVariableInfo;
  @cssVariable({ cssClassName: 'boxel-field' })
  declare boxelFieldLabelJustifyContent: CSSVariableInfo;

  <template>
    <FreestyleUsage @name='Field'>
      <:example>
        <BoxelFieldContainer
          @tag={{this.tag}}
          @label={{this.label}}
          @fieldId={{this.id}}
          @vertical={{this.vertical}}
          @horizontalLabelSize={{this.horizontalLabelSize}}
          @centeredDisplay={{this.centeredDisplay}}
          @icon={{this.icon}}
          style={{cssVars
            boxel-field-label-align=this.boxelFieldLabelAlign.value
            boxel-field-label-justify-content=this.boxelFieldLabelJustifyContent.value
          }}
        >
          {{this.value}}
        </BoxelFieldContainer>
      </:example>

      <:api as |Args|>
        <Args.String
          @name='tag'
          @description="html tag to use for the field (ie. use 'label' tag if this is an input/textarea field)"
          @defaultValue='div'
          @value={{this.tag}}
          @onInput={{fn (mut this.tag)}}
        />
        <Args.String
          @name='fieldId'
          @description='field id'
          @value={{this.id}}
          @onInput={{fn (mut this.id)}}
        />
        <Args.String
          @name='label'
          @description='field label'
          @value={{this.label}}
          @onInput={{fn (mut this.label)}}
        />
        <Args.Component
          @name='icon'
          @description='icon component reference'
          @value={{this.icon}}
          @options={{ALL_ICON_COMPONENTS}}
          @onChange={{fn (mut this.icon)}}
        />
        <Args.Bool
          @name='vertical'
          @description='Whether the field should be displayed vertically'
          @defaultValue='false'
          @onInput={{fn (mut this.vertical)}}
          @value={{this.vertical}}
        />
        <Args.String
          @name='horizontalLabelSize'
          @description='Width of the label column (only applies to horizontal layout)'
          @options={{array 'small' 'default'}}
          @defaultValue='minmax(4rem, 25%)'
          @onInput={{fn (mut this.horizontalLabelSize)}}
          @value={{this.horizontalLabelSize}}
        />
        <Args.Bool
          @name='centeredDisplay'
          @description='Whether the field content should have a special centered display'
          @defaultValue='false'
          @onInput={{fn (mut this.centeredDisplay)}}
          @value={{this.centeredDisplay}}
        />
        <Args.Yield @description='Yield value or form field' />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='boxel-field-label-align'
          @type='align-items'
          @description='position of the label text within the label area'
          @value={{this.boxelFieldLabelAlign.value}}
          @defaultValue={{this.boxelFieldLabelAlign.defaults}}
          @onInput={{this.boxelFieldLabelAlign.update}}
        />
        <Css.Basic
          @name='boxel-field-label-justify-content'
          @type='justify-content'
          @description='alignment of label children along main axis'
          @value={{this.boxelFieldLabelJustifyContent.value}}
          @defaultValue={{this.boxelFieldLabelJustifyContent.defaults}}
          @onInput={{this.boxelFieldLabelJustifyContent.update}}
        />
      </:cssVars>
    </FreestyleUsage>

    <FreestyleUsage @name='Usage with Boxel::Input'>
      <:example>
        <BoxelFieldContainer @tag='label' @label='Name'>
          <BoxelInput @id='usage-boxel-input' @value='' />
        </BoxelFieldContainer>
      </:example>
    </FreestyleUsage>

    <FreestyleUsage
      @name='Usage with Boxel::Input::ValidationState (invalid state)'
    >
      <:example>
        <BoxelFieldContainer
          @tag='label'
          @label='Name'
          @vertical={{this.vertical2}}
          @horizontalLabelSize={{this.horizontalLabelSize2}}
          @icon={{this.icon2}}
        >
          <BoxelInputValidationState
            @id=''
            @state='invalid'
            @value=''
            @errorMessage='This is a required field'
            @helperText='Please enter a value'
          />
        </BoxelFieldContainer>
      </:example>
      <:api as |Args|>
        <Args.Component
          @name='icon'
          @description='icon component reference'
          @value={{this.icon2}}
          @options={{ALL_ICON_COMPONENTS}}
          @onChange={{fn (mut this.icon2)}}
        />
        <Args.Bool
          @name='vertical'
          @description='Whether the field should be displayed vertically'
          @defaultValue='false'
          @onInput={{fn (mut this.vertical2)}}
          @value={{this.vertical2}}
        />
        <Args.String
          @name='horizontalLabelSize'
          @description='Width of the label column (only applies to horizontal layout)'
          @options={{array 'small' 'default'}}
          @defaultValue='minmax(4rem, 25%)'
          @onInput={{fn (mut this.horizontalLabelSize2)}}
          @value={{this.horizontalLabelSize2}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}
