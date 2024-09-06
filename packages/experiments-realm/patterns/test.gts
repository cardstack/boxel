import {
  CardDef,
  field,
  contains,
  containsMany,
  linksTo,
  FieldDef,
  Component,
  StringField,
} from 'https://cardstack.com/base/card-api';
import { Friend } from './friend';
import { MonetaryAmount } from './monetary-amount';

export class CompoundField extends FieldDef {
  static displayName = 'Some compound field';
  @field firstName = contains(StringField);
  @field friend = linksTo(Friend);
  @field monetaryAmount = contains(MonetaryAmount);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div style='width: 200px; height: 50px'>
        <@fields.firstName />
        <@fields.friend />
        <@fields.monetaryAmount />
      </div>
    </template>
  };
}

export class Test extends CardDef {
  static displayName = 'Test card';
  @field linksToField = linksTo(Friend); //good
  @field compoundField = contains(CompoundField);
  @field compoundFields = containsMany(CompoundField);
  @field computedField = contains(CompoundField, {
    computeVia: function (this: Test) {
      let compoundField = this.compoundFields[0];
      let o = new CompoundField();
      o.firstName = 'Mad';
      o.friend = compoundField.friend;
      let m = new MonetaryAmount(); //bcos of link by reference we must be very careful to make a new object
      m.amount = 3333;
      m.currency = compoundField.monetaryAmount.currency;
      o.monetaryAmount = m;
      return o;
    },
  });
  @field computedFields = containsMany(CompoundField, {
    computeVia: function (this: Test) {
      return this.compoundFields.map((compoundField) => {
        let o = new CompoundField();
        o.firstName = 'Mad';
        o.friend = compoundField.friend;
        let m = new MonetaryAmount(); //bcos of link by reference we must be very careful to make a new object
        m.amount = 4444;
        m.currency = compoundField.monetaryAmount.currency;
        o.monetaryAmount = m;
        return o;
      });
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <p>Purpose of this card is to show how fields and model api can be used
        for some complex cases</p>
      <h3>linksTo</h3>
      <div style='width: 200px; height: 100px'>
        <@fields.linksToField />
      </div>
      {{! Must always access primitive with linksTo }}
      {{@model.linksToField.firstName}}
      {{@model.linksToField.friend.firstName}}
      <h3>contains Compound Field </h3>
      <div style='width: 200px; height: 100px'>
        <@fields.compoundField />
      </div>
      {{! Must always access primitive with contains compound }}
      {{@model.compoundField.monetaryAmount.amount}}
      {{@model.compoundField.monetaryAmount.currency.sign}}
      {{@model.compoundField.friend.firstName}}
      {{@model.compoundField.friend.friend.firstName}}
      <h3>containsMany Compound Field </h3>
      <div style='width: 200px; height: 100px'>
        <@fields.compoundFields />
      </div>
      {{#each @fields.compoundFields as |f|}}
        <div style='width: 200px; height: 100px'>
          <f />
        </div>
      {{/each}}
      {{#each @model.compoundFields as |f|}}
        {{f.monetaryAmount.amount}}
        {{f.monetaryAmount.currency.sign}}
        {{f.friend.firstName}}
      {{/each}}
      <h3>contains (Computed) Compound Field </h3>
      <div style='width: 200px; height: 100px'>
        <@fields.computedField />
      </div>
      <h3>containsMany (Computed) Compound Field </h3>
      {{#each @fields.computedFields as |f|}}
        <div style='width: 200px; height: 100px'>
          <f />
        </div>
      {{/each}}
      <style>
        h3 {
          color: red;
        }
      </style>
    </template>
  };
}
