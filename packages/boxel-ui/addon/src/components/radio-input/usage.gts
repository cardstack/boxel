import { fn } from '@ember/helper';
import { array } from '@ember/helper';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import {
  type CSSVariableInfo,
  cssVariable,
} from 'ember-freestyle/decorators/css-variable';

import cssVar from '../../helpers/css-var.ts';
import RadioInput from './index.gts';

export default class RadioInputUsage extends Component {
  @tracked items = [
    {
      id: 'eggs',
      text: 'Eggs',
    },
    {
      id: 'tofu',
      text: 'Tofu',
    },
    {
      id: 'strawberry',
      text: 'Strawberry',
    },
  ];
  @tracked tshirts = [
    {
      id: 's',
      text: 'S',
    },
    {
      id: 'm',
      text: 'M',
    },
    {
      id: 'l',
      text: 'L',
    },
  ];
  @tracked groupDescription =
    'Select one of these options for breakfast sandwiches';
  @tracked checkedId = this.items[0]?.id;
  @tracked disabled = false;
  @tracked hideRadio = false;
  @tracked hideBorder = false;
  @tracked spacing = '';
  @tracked orientation = 'horizontal';
  @action onChange(id: string): void {
    this.checkedId = id;
  }

  cssClassName = 'boxel-radio-input';
  @cssVariable declare boxelRadioInputOptionPadding: CSSVariableInfo;
  @cssVariable declare boxelRadioInputOptionGap: CSSVariableInfo;

  <template>
    <FreestyleUsage @name='Radio'>
      <:description>
        Radio input
      </:description>
      <:example>
        <RadioInput
          @groupDescription={{this.groupDescription}}
          @items={{this.items}}
          @name='example-radio-usage'
          @checkedId={{this.checkedId}}
          @disabled={{this.disabled}}
          @orientation={{this.orientation}}
          @spacing={{this.spacing}}
          @hideRadio={{this.hideRadio}}
          @hideBorder={{this.hideBorder}}
          style={{cssVar
            boxel-radio-input-option-padding=this.boxelRadioInputOptionPadding.value
            boxel-radio-input-option-gap=this.boxelRadioInputOptionGap.value
          }}
          as |item|
        >
          <item.component @onChange={{fn this.onChange item.data.id}}>
            {{item.data.text}}
          </item.component>
        </RadioInput>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='groupDescription'
          @description='Description for this group of radio buttons'
          @value={{this.groupDescription}}
          @onInput={{fn (mut this.groupDescription)}}
          @optional={{true}}
        />
        <Args.Object
          @name='items'
          @description="Items which will be represented by radio buttons. Each should have a unique 'id' attribute"
          @value={{this.items}}
          @onInput={{fn (mut this.items)}}
        />
        <Args.String
          @name='checkedId'
          @description='The id of the currently checked/selected item'
          @value={{this.checkedId}}
          @onInput={{fn (mut this.checkedId)}}
          @optional={{true}}
        />
        <Args.Bool
          @name='disabled'
          @description='Whether selection is disabled'
          @defaultValue='false'
          @value={{this.disabled}}
          @onInput={{fn (mut this.disabled)}}
          @optional={{true}}
        />
        <Args.Bool
          @name='hideRadio'
          @description='Visually hides the radio input circle'
          @defaultValue='false'
          @value={{this.hideRadio}}
          @onInput={{fn (mut this.hideRadio)}}
        />
        <Args.Bool
          @name='hideBorder'
          @description='Visually hides the item border'
          @defaultValue='false'
          @value={{this.hideBorder}}
          @onInput={{fn (mut this.hideBorder)}}
        />
        <Args.String
          @name='spacing'
          @description='Adjusts spacing level'
          @defaultValue=''
          @options={{array 'default' 'compact'}}
          @onInput={{fn (mut this.spacing)}}
          @value={{this.spacing}}
        />
        <Args.String
          @name='orientation'
          @description='Orientation of the radio buttons'
          @defaultValue='horizontal'
          @options={{array 'horizontal' 'vertical' 'default'}}
          @onInput={{fn (mut this.orientation)}}
          @value={{this.orientation}}
        />
        <Args.Yield
          @description='Yields an object with the default component to use (RadioInput::Item), the data for the item passed in, and whether that item is selected'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='boxel-radio-input-option-padding'
          @type='dimension'
          @description='padding for each option'
          @defaultValue={{this.boxelRadioInputOptionPadding.defaults}}
          @value={{this.boxelRadioInputOptionPadding.value}}
          @onInput={{this.boxelRadioInputOptionPadding.update}}
        />
        <Css.Basic
          @name='boxel-radio-input-option-gap'
          @type='dimension'
          @description='gap between circle and label'
          @defaultValue={{this.boxelRadioInputOptionGap.defaults}}
          @value={{this.boxelRadioInputOptionGap.value}}
          @onInput={{this.boxelRadioInputOptionGap.update}}
        />
      </:cssVars>
    </FreestyleUsage>

      <FreestyleUsage @name='Multiple Choice Example'>
        <:example>
          <RadioInput
            @groupDescription={{this.groupDescription}}
            @items={{this.items}}
            @name='example-radio-usage'
            @checkedId={{this.checkedId}}
            @disabled={{this.disabled}}
            @orientation={{'vertical'}}
            @spacing={{'compact'}}
            @hideRadio={{false}}
            @hideBorder={{true}}
            style={{cssVar
              boxel-radio-input-option-padding=this.boxelRadioInputOptionPadding.value
              boxel-radio-input-option-gap=this.boxelRadioInputOptionGap.value
            }}
            as |item|
          >
            <item.component @onChange={{fn this.onChange item.data.id}}>
              {{item.data.text}}
            </item.component>
          </RadioInput>
        </:example>
      </FreestyleUsage>

      <FreestyleUsage @name='T Shirt Variants Example'>
        <:example>
          <RadioInput
            @groupDescription={{this.groupDescription}}
            @items={{this.tshirts}}
            @name='example-radio-usage'
            @checkedId={{this.checkedId}}
            @disabled={{this.disabled}}
            @orientation={{'horizontal'}}
            @spacing={{'default'}}
            @hideRadio={{true}}
            @hideBorder={{false}}
            style={{cssVar
              boxel-radio-input-option-padding=this.boxelRadioInputOptionPadding.value
              boxel-radio-input-option-gap=this.boxelRadioInputOptionGap.value
            }}
            as |item|
          >
            <item.component @onChange={{fn this.onChange item.data.id}}>
              {{item.data.text}}
            </item.component>
          </RadioInput>
        </:example>
      </FreestyleUsage>
  </template>
}
