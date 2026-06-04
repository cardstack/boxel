import { array, fn } from '@ember/helper';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';

import cssVars from '../../helpers/css-var.ts';
import { ALL_ICON_COMPONENTS } from '../../icons.ts';
import Profile from '../../icons/profile.gts';
import type { Icon } from '../../icons/types.ts';
import BoxelInput from '../input/index.gts';
import type { BoxelLabelFontSize } from '../label/index.gts';
import BoxelFieldContainer from './index.gts';

export default class FieldUsage extends Component {
  @tracked label = 'Full Name of the Issuer';
  @tracked value = 'Gary Walker';
  @tracked id = 'sample-field';
  @tracked vertical = false;
  @tracked centeredDisplay = false;
  @tracked horizontalLabelSize = 'default';
  @tracked labelFontSize?: BoxelLabelFontSize;
  @tracked icon = Profile;
  @tracked tag?: keyof HTMLElementTagNameMap;

  @tracked inline = false;

  @tracked inline2 = false;

  @tracked inline3 = false;
  @tracked vertical3 = false;
  @tracked horizontalLabelSize3 = 'default';
  @tracked icon3: Icon | undefined;
  @cssVariable({ cssClassName: 'boxel-field' })
  declare boxelFieldLabelAlign: CSSVariableInfo;
  @cssVariable({ cssClassName: 'boxel-field' })
  declare boxelFieldLabelJustifyContent: CSSVariableInfo;

  <template>
    <FreestyleUsage
      @name="Field"
      @description="Form-field wrapper that pairs a label with its input control, plus helper text and validation messages — the standard layout primitive for form rows."
    >
      <:example>
        <BoxelFieldContainer
          @tag={{this.tag}}
          @label={{this.label}}
          @fieldId={{this.id}}
          @vertical={{this.vertical}}
          @inline={{this.inline}}
          @horizontalLabelSize={{this.horizontalLabelSize}}
          @labelFontSize={{this.labelFontSize}}
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
          @name="tag"
          @description="html tag to use for the field (ie. use 'label' tag if this is an input/textarea field)"
          @defaultValue="div"
          @value={{this.tag}}
          @onInput={{fn (mut this.tag)}}
        />
        <Args.String
          @name="fieldId"
          @description="field id"
          @value={{this.id}}
          @onInput={{fn (mut this.id)}}
        />
        <Args.String
          @name="label"
          @description="field label"
          @value={{this.label}}
          @onInput={{fn (mut this.label)}}
        />
        <Args.Component
          @name="icon"
          @description="icon component reference"
          @value={{this.icon}}
          @options={{ALL_ICON_COMPONENTS}}
          @onChange={{fn (mut this.icon)}}
        />
        <Args.Bool
          @name="vertical"
          @description="Whether the field should be displayed vertically"
          @defaultValue="false"
          @onInput={{fn (mut this.vertical)}}
          @value={{this.vertical}}
        />
        <Args.Bool
          @name="inline"
          @description="Compact horizontal layout: label column shrinks to content width, min-height removed. Use when embedding the field inside a flex row alongside other controls."
          @defaultValue="false"
          @onInput={{fn (mut this.inline)}}
          @value={{this.inline}}
        />
        <Args.String
          @name="horizontalLabelSize"
          @description="Width of the label column (only applies to horizontal layout)"
          @options={{array "small" "default"}}
          @defaultValue="minmax(4rem, 25%)"
          @onInput={{fn (mut this.horizontalLabelSize)}}
          @value={{this.horizontalLabelSize}}
        />
        <Args.Object
          @name="labelFontSize"
          @description="label font-size"
          @options={{array "small" "default"}}
          @onInput={{fn (mut this.labelFontSize)}}
          @value={{this.labelFontSize}}
        />
        <Args.Bool
          @name="centeredDisplay"
          @description="Whether the field content should have a special centered display"
          @defaultValue="false"
          @onInput={{fn (mut this.centeredDisplay)}}
          @value={{this.centeredDisplay}}
        />
        <Args.Yield @description="Yield value or form field" />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name="boxel-field-label-align"
          @type="align-items"
          @description="position of the label text within the label area"
          @value={{this.boxelFieldLabelAlign.value}}
          @defaultValue={{this.boxelFieldLabelAlign.defaults}}
          @onInput={{this.boxelFieldLabelAlign.update}}
        />
        <Css.Basic
          @name="boxel-field-label-justify-content"
          @type="justify-content"
          @description="alignment of label children along main axis"
          @value={{this.boxelFieldLabelJustifyContent.value}}
          @defaultValue={{this.boxelFieldLabelJustifyContent.defaults}}
          @onInput={{this.boxelFieldLabelJustifyContent.update}}
        />
      </:cssVars>
    </FreestyleUsage>

    <FreestyleUsage @name="Usage with Boxel::Input">
      <:example>
        <BoxelFieldContainer
          @tag="label"
          @label="Name"
          @inline={{this.inline2}}
        >
          <BoxelInput @id="usage-boxel-input" @value="" />
        </BoxelFieldContainer>
      </:example>
      <:api as |Args|>
        <Args.Bool
          @name="inline"
          @description="Compact horizontal layout: label column shrinks to content width, min-height removed."
          @defaultValue="false"
          @onInput={{fn (mut this.inline2)}}
          @value={{this.inline2}}
        />
      </:api>
    </FreestyleUsage>

    <FreestyleUsage @name="Inline (compact horizontal)">
      <:description>
        Use
        <code>@inline</code>
        when placing a labeled control inside a flex row alongside other
        elements. The label column shrinks to fit its text and
        <code>min-height</code>
        is removed so the field doesn't impose extra height on the row.
      </:description>
      <:example>
        <div class="inline-example-row">
          <BoxelFieldContainer @tag="label" @label="Max" @inline={{true}}>
            <BoxelInput @type="number" @value={{0}} @min={{0}} />
          </BoxelFieldContainer>
          <BoxelFieldContainer @tag="label" @label="Min" @inline={{true}}>
            <BoxelInput @type="number" @value={{0}} @min={{0}} />
          </BoxelFieldContainer>
        </div>
      </:example>
    </FreestyleUsage>

    <style scoped>
      .inline-example-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-sm);
      }
    </style>

    <FreestyleUsage @name="Usage with Boxel::Input (invalid state)">
      <:example>
        <BoxelFieldContainer
          @tag="label"
          @label="Name"
          @inline={{this.inline3}}
          @vertical={{this.vertical3}}
          @horizontalLabelSize={{this.horizontalLabelSize3}}
          @icon={{this.icon3}}
        >
          <BoxelInput
            @id=""
            @state="invalid"
            @value=""
            @errorMessage="This is a required field"
            @helperText="Please enter a value"
          />
        </BoxelFieldContainer>
      </:example>
      <:api as |Args|>
        <Args.Component
          @name="icon"
          @description="icon component reference"
          @value={{this.icon3}}
          @options={{ALL_ICON_COMPONENTS}}
          @onChange={{fn (mut this.icon3)}}
        />
        <Args.Bool
          @name="inline"
          @description="Compact horizontal layout: label column shrinks to content width, min-height removed."
          @defaultValue="false"
          @onInput={{fn (mut this.inline3)}}
          @value={{this.inline3}}
        />
        <Args.Bool
          @name="vertical"
          @description="Whether the field should be displayed vertically"
          @defaultValue="false"
          @onInput={{fn (mut this.vertical3)}}
          @value={{this.vertical3}}
        />
        <Args.String
          @name="horizontalLabelSize"
          @description="Width of the label column (only applies to horizontal layout)"
          @options={{array "small" "default"}}
          @defaultValue="minmax(4rem, 25%)"
          @onInput={{fn (mut this.horizontalLabelSize3)}}
          @value={{this.horizontalLabelSize3}}
        />
      </:api>
    </FreestyleUsage>
  </template>
}
