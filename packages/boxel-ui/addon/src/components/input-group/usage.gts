import { A } from '@ember/array';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { later } from '@ember/runloop';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';

import cssVar from '../../helpers/css-var.ts';
import BoxelField from '../field-container/index.gts';
import { type InputValidationState } from '../input/index.gts';
import BoxelInputGroup from './index.gts';

interface Token {
  icon: string;
  name: string;
}

export default class BoxelInputGroupUsage extends Component {
  @tracked id = 'boxel-input-group-usage';
  @tracked value = '';
  @tracked placeholder: string | undefined;
  @tracked autocomplete: string | undefined;
  @tracked inputmode: string | undefined;
  @tracked helperText = 'Please enter an amount';
  @tracked errorMessage = '';
  @tracked disabled = false;
  @tracked state: InputValidationState = 'initial';
  @tracked isShowingCopiedConfirmation = false;

  cssClassName = 'boxel-input-group';
  @cssVariable declare boxelInputGroupPaddingX: CSSVariableInfo;
  @cssVariable declare boxelInputGroupPaddingY: CSSVariableInfo;
  @cssVariable declare boxelInputGroupBorderColor: CSSVariableInfo;
  @cssVariable declare boxelInputGroupBorderRadius: CSSVariableInfo;
  @cssVariable declare boxelInputGroupInteriorBorderWidth: CSSVariableInfo;

  tokens = [
    { name: 'CARD', icon: 'card' },
    { name: 'HI', icon: 'emoji' },
    { name: 'WORLD', icon: 'world' },
  ];
  @tracked token = this.tokens[0];

  @action set(val: string): void {
    this.value = val;
  }

  @action log(s: string, _ev: Event): void {
    console.log(s);
  }

  @action onChooseToken(token: Token) {
    this.token = token;
    console.log(token);
  }

  @action flashCopiedConfirmation() {
    this.isShowingCopiedConfirmation = true;
    later(() => {
      this.isShowingCopiedConfirmation = false;
    }, 1000);
  }

  @tracked selectExampleItems = A(
    [...new Array(10)].map((_, idx) => `Item - ${idx}`),
  ) as Array<string>;

  @tracked selectExampleSelectedItem: string | null = null;
  @tracked selectExamplePlaceholder = 'Select Item';

  @action selectExampleOnSelectItem(item: string | null): void {
    this.selectExampleSelectedItem = item;
  }

  <template>
    <FreestyleUsage @name='InputGroup'>
      <:description>
        Extend inputs by adding text, buttons, etc on either side of textual
        inputs.
      </:description>
      <:example>
        <label for={{this.id}} class='boxel-sr-only'>Label</label>
        <BoxelInputGroup
          @id={{this.id}}
          @disabled={{this.disabled}}
          @value={{this.value}}
          @placeholder={{this.placeholder}}
          @autocomplete={{this.autocomplete}}
          @inputmode={{this.inputmode}}
          @onInput={{this.set}}
          @state={{this.state}}
          @errorMessage={{this.errorMessage}}
          @helperText={{this.helperText}}
          style={{cssVar
            boxel-input-group-padding-x=this.boxelInputGroupPaddingX.value
            boxel-input-group-padding-y=this.boxelInputGroupPaddingY.value
            boxel-input-group-border-color=this.boxelInputGroupBorderColor.value
            boxel-input-group-border-radius=this.boxelInputGroupBorderRadius.value
            boxel-input-group-interior-border-width=this.boxelInputGroupInteriorBorderWidth.value
          }}
        >
          <:before as |Accessories|>
            <Accessories.Text>Something before</Accessories.Text>
          </:before>
        </BoxelInputGroup>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='id'
          @description='The id of the input'
          @onInput={{fn (mut this.id)}}
          @value={{this.id}}
        />
        <Args.Bool
          @name='disabled'
          @description='Whether the input is disabled'
          @defaultValue={{false}}
          @onInput={{fn (mut this.disabled)}}
          @value={{this.disabled}}
        />
        <Args.Bool
          @name='state'
          @description='The input state'
          @defaultValue={{false}}
          @onInput={{fn (mut this.state)}}
          @value={{this.state}}
        />
        <Args.String
          @name='helperText'
          @description='Helper message to display below the input'
          @value={{this.helperText}}
          @onInput={{fn (mut this.helperText)}}
        />
        <Args.String
          @name='errorMessage'
          @description='Error message to display when the input is invalid'
          @value={{this.errorMessage}}
          @onInput={{fn (mut this.errorMessage)}}
        />
        <Args.String
          @name='placeholder'
          @description='The placeholder text for the input (ignored when a default block is supplied)'
          @value={{this.placeholder}}
          @onInput={{fn (mut this.placeholder)}}
        />
        <Args.String
          @name='autocomplete'
          @description='The autocomplete attribute value for the input (ignored when a default block is supplied)'
          @value={{this.autocomplete}}
          @onInput={{fn (mut this.autocomplete)}}
        />
        <Args.String
          @name='inputmode'
          @description='The inputmode attribute value for the input (ignored when a default block is supplied)'
          @value={{this.inputmode}}
          @onInput={{fn (mut this.inputmode)}}
        />
        <Args.String
          @name='value'
          @description='The value of the input'
          @value={{this.value}}
          @onInput={{fn (mut this.value)}}
        />
        <Args.Action
          @name='onInput'
          @description='Action to call when the input value changes'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='boxel-input-group-padding-x'
          @type='dimension'
          @description='Horizontal padding'
          @defaultValue={{this.boxelInputGroupPaddingX.defaults}}
          @value={{this.boxelInputGroupPaddingX.value}}
          @onInput={{this.boxelInputGroupPaddingX.update}}
        />
        <Css.Basic
          @name='boxel-input-group-padding-y'
          @type='dimension'
          @description='Vertical padding'
          @defaultValue={{this.boxelInputGroupPaddingY.defaults}}
          @value={{this.boxelInputGroupPaddingY.value}}
          @onInput={{this.boxelInputGroupPaddingY.update}}
        />
        <Css.Basic
          @name='boxel-input-group-border-color'
          @type='color'
          @description='Border color'
          @defaultValue={{this.boxelInputGroupBorderColor.defaults}}
          @value={{this.boxelInputGroupBorderColor.value}}
          @onInput={{this.boxelInputGroupBorderColor.update}}
        />
        <Css.Basic
          @name='boxel-input-group-border-radius'
          @type='dimension'
          @description='Border radius'
          @defaultValue={{this.boxelInputGroupBorderRadius.defaults}}
          @value={{this.boxelInputGroupBorderRadius.value}}
          @onInput={{this.boxelInputGroupBorderRadius.update}}
        />
        <Css.Basic
          @name='boxel-input-group-interior-border-width'
          @type='dimension'
          @description='Interior border width (CSS Variable). Set to zero for no interior borders'
          @defaultValue={{this.boxelInputGroupInteriorBorderWidth.defaults}}
          @value={{this.boxelInputGroupInteriorBorderWidth.value}}
          @onInput={{this.boxelInputGroupInteriorBorderWidth.update}}
        />
      </:cssVars>
    </FreestyleUsage>
    <style>
      .boxel-input-usage-examples .boxel-input-group {
        margin-bottom: var(--boxel-sp-xl);
      }
    </style>
    <FreestyleUsage
      @name='InputGroupExamples'
      class='boxel-input-usage-examples'
    >
      <:example>
        <BoxelInputGroup @placeholder='Username'>
          <:before as |Accessories|>
            <Accessories.Text>@</Accessories.Text>
          </:before>
        </BoxelInputGroup>

        <BoxelInputGroup @placeholder="Recipient's username">
          <:after as |Accessories|>
            <Accessories.Text>@example.com</Accessories.Text>
          </:after>
        </BoxelInputGroup>

        <BoxelField @tag='label' @label='Your vanity URL' @vertical={{true}}>
          <BoxelInputGroup>
            <:before as |Accessories|>
              <Accessories.Text>https://example.com/users/</Accessories.Text>
            </:before>
          </BoxelInputGroup>
        </BoxelField>

        <BoxelInputGroup @placeholder='Amount'>
          <:before as |Accessories|>
            <Accessories.Text>$</Accessories.Text>
          </:before>
          <:after as |Accessories|>
            <Accessories.Text>.00</Accessories.Text>
          </:after>
        </BoxelInputGroup>

        <BoxelInputGroup>
          <:default as |Controls Accessories|>
            <Controls.Input @placeholder='Username' />
            <Accessories.Text>@</Accessories.Text>
            <Controls.Input @placeholder='Server' />
          </:default>
        </BoxelInputGroup>

        <label>Example overriding default block to use a textarea instead of a
          text input<br />
          <BoxelInputGroup>
            <:default as |Controls Accessories inputGroup|>
              <Accessories.Text>With textarea</Accessories.Text>
              <Controls.Textarea id={{inputGroup.elementId}} />
            </:default>
          </BoxelInputGroup>
        </label>

        <label>Example showing multiple accessories before the input<br />
          <BoxelInputGroup>
            <:before as |Accessories|>
              <Accessories.Text>$</Accessories.Text>
              <Accessories.Text>0.00</Accessories.Text>
            </:before>
          </BoxelInputGroup>
        </label>

        <label>Example showing multiple accessories after the input<br />
          <BoxelInputGroup>
            <:after as |Accessories|>
              <Accessories.Text>$</Accessories.Text>
              <Accessories.Text>0.00</Accessories.Text>
            </:after>
          </BoxelInputGroup>
        </label>

        <label>Example showing a button accessories after the input<br />
          <BoxelInputGroup>
            <:before as |Accessories|>
              <Accessories.Button>Button</Accessories.Button>
            </:before>
          </BoxelInputGroup>
        </label>

        <BoxelInputGroup @placeholder="Recipient's username">
          <:after as |Accessories|>
            <Accessories.Button>Button</Accessories.Button>
          </:after>
        </BoxelInputGroup>

        <BoxelInputGroup @placeholder="The button has a 'kind' of 'primary'">
          <:after as |Accessories|>
            <Accessories.Button @kind='primary'>Button</Accessories.Button>
          </:after>
        </BoxelInputGroup>

        <BoxelInputGroup @placeholder='Example with two buttons before'>
          <:before as |Accessories|>
            <Accessories.Button>Button</Accessories.Button>
            <Accessories.Button>Button</Accessories.Button>
          </:before>
        </BoxelInputGroup>

        <BoxelInputGroup @placeholder='Example with two buttons after'>
          <:after as |Accessories|>
            <Accessories.Button>Button</Accessories.Button>
            <Accessories.Button>Button</Accessories.Button>
          </:after>
        </BoxelInputGroup>
        <BoxelInputGroup @placeholder='Input with a select menu'>
          <:after as |Accessories|>
            <Accessories.Select
              @placeholder={{this.selectExamplePlaceholder}}
              @selected={{this.selectExampleSelectedItem}}
              @onChange={{this.selectExampleOnSelectItem}}
              @options={{this.selectExampleItems}}
              @dropdownClass='boxel-select-usage-dropdown'
              aria-label='Select an item'
              as |item itemCssClass|
            >
              <div class={{itemCssClass}}>{{item}}</div>
            </Accessories.Select>
          </:after>
        </BoxelInputGroup>
      </:example>
    </FreestyleUsage>
  </template>
}
