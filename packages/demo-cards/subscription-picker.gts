import {
  contains,
  containsMany,
  linksTo,
  field,
  Card,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import TextAreaCard from 'https://cardstack.com/base/text-area';
import IntegerCard from 'https://cardstack.com/base/integer';
import BooleanCard from 'https://cardstack.com/base/boolean';
import { CardContainer, FieldContainer, Label } from '@cardstack/boxel-ui';

class Feature extends Card {
  @field name = contains(StringCard);
  @field description = contains(TextAreaCard);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='feature'>
        <strong><@fields.name /></strong>
        <@fields.description />
      </div>
    </template>
  };

  static edit = class Edit extends Component<typeof this> {
    <template>
      <div class='feature'>
        <FieldContainer @tag='label' @label='Feature Name'><@fields.name
          /></FieldContainer>
        <FieldContainer
          @tag='label'
          @label='Feature Description'
        ><@fields.description /></FieldContainer>
      </div>
    </template>
  };
}

class Plan extends Card {
  @field name = contains(StringCard);
  @field price = contains(IntegerCard);
  @field description = contains(TextAreaCard);
  @field popular = contains(BooleanCard);
  @field features = containsMany(Feature);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContainer class='plan'>
        <h3><@fields.name /></h3>
        <div class='plan__price'>{{@model.price}} /mo</div>
        <@fields.description />
        <div class='plan__features'>
          <@fields.features />
        </div>
        {{#if @model.popular}}
          <div class='plan__popular'>Popular</div>
        {{/if}}
      </CardContainer>
    </template>
  };

  static edit = class Edit extends Component<typeof this> {
    <template>
      <CardContainer class='plan plan--edit' @displayBoundaries={{true}}>
        <FieldContainer @tag='label' @label='Plan Name'><@fields.name
          /></FieldContainer>
        <FieldContainer @tag='label' @label='Price'><@fields.price
          /></FieldContainer>
        <FieldContainer @tag='label' @label='Description'><@fields.description
          /></FieldContainer>
        <FieldContainer @tag='label' @label='Popular Plan'><@fields.popular
          /></FieldContainer>
        <FieldContainer @label='Features'><@fields.features /></FieldContainer>
      </CardContainer>
    </template>
  };
}

class SubscriptionPickerTemplate extends Component<typeof SubscriptionPicker> {
  <template>
    <CardContainer
      class='subscription-picker'
      @displayBoundaries={{true}}
      @title='Subscription Plans'
    >
      <h2>Choose Your Plan</h2>
      <div class='subscription-picker__plans'>
        <@fields.plans />
      </div>
    </CardContainer>
  </template>
}

class EditSubscriptionPickerTemplate extends Component<
  typeof SubscriptionPicker
> {
  <template>
    <CardContainer
      class='subscription-picker subscription-picker--edit'
      @displayBoundaries={{true}}
      @title='Edit Subscription Plans'
    >
      <FieldContainer @label='Plans'><@fields.plans /></FieldContainer>
    </CardContainer>
  </template>
}
export class SubscriptionPicker extends Card {
  @field plans = containsMany(Plan);

  static embedded = SubscriptionPickerTemplate;
  static isolated = SubscriptionPickerTemplate;
  static edit = EditSubscriptionPickerTemplate;
}
