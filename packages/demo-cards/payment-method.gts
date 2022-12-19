import { contains, field, Card, Component } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import IntegerCard from 'https://cardstack.com/base/integer';
import { initStyleSheet, attachStyles } from '@cardstack/boxel-ui/attach-styles';
import { CardContainer, FieldContainer } from '@cardstack/boxel-ui';

let styles = initStyleSheet(`
  this {
    display: inline-grid;
    grid-template-columns: var(--boxel-sp) 1fr;
    gap: var(--boxel-sp-xxxs);
  }
  .payment-method__currency {
    font: 700 var(--boxel-font);
  }
`);

class PaymentMethodView extends Component<typeof PaymentMethod> {
  <template>
    <CardContainer {{attachStyles styles}}>
      <img src={{@model.logo}} width="20" height="20"/>
      <div class="payment-method__currency"><@fields.currency/></div>
    </CardContainer>
  </template>
}

export class PaymentMethod extends Card {
  @field currency = contains(StringCard);
  @field logo = contains(StringCard);
  @field exchangeRate = contains(IntegerCard);
  @field balance = contains(IntegerCard);

  static embedded = PaymentMethodView;
  static isolated = PaymentMethodView;

  static edit = class Edit extends Component<typeof PaymentMethod> {
    <template>
      <CardContainer>
        <FieldContainer @tag="label" @label="Currency">
          <@fields.currency/>
        </FieldContainer>
        <FieldContainer @tag="label" @label="Logo">
          <@fields.logo/>
        </FieldContainer>
      </CardContainer>
    </template>
  }
}
