import { contains, field, Card, Component, linksTo } from "https://cardstack.com/base/card-api";
import StringCard from 'https://cardstack.com/base/string';
import { Chain } from './chain';
import { Token, Currency } from './asset';
import { initStyleSheet, attachStyles } from '@cardstack/boxel-ui/attach-styles';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';
import { FieldContainer } from '@cardstack/boxel-ui';
import { PaymentType } from './payment-type';

let styles = initStyleSheet(`
  .boxel-field {
    margin-top: var(--boxel-sp);
  }
`);

// TODO: card catalog does not show payment types when the class is not externally loaded
// export class PaymentType extends Card {
//   @field type = contains(StringCard);
//   @field name = contains(StringCard);
//   static embedded = class Embedded extends Component<typeof this> {
//     <template><@fields.name/></template>
//   }
//   static isolated = this.embedded;
// }

export class CryptoPayment extends Card {
  @field chain = linksTo(Chain); // dropdown
  @field token = linksTo(Token);  // dropdown
  @field toAddress = contains(StringCard);
  static edit = class Edit extends Component<typeof this> {
    <template>
      <div {{attachStyles styles}}>
        <FieldContainer @label="Chain">
          <@fields.chain/>
        </FieldContainer>
        {{#if @model.chain.chainId}}
          <FieldContainer @label="Token">
            <@fields.token/>
          </FieldContainer>
          {{#if @model.token}}
            <FieldContainer @label="Token Name">
              {{@model.token.name}}
            </FieldContainer>
            <FieldContainer @label="Token Address">
              {{@model.token.address}}
            </FieldContainer>
            <FieldContainer @label="To Address">
              <@fields.toAddress/>
            </FieldContainer>
          {{/if}}
        {{/if}}
      </div>
    </template>
  }
  static embedded = this.edit;
}

export class WireTransfer extends Card {
  @field currency = linksTo(Currency); // dropdown
  @field iban = contains(StringCard); // IBAN format
  @field bic = contains(StringCard); // BIC format
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div><@fields.iban/></div>
      <div><@fields.bic/></div>
    </template>
  }
  static edit = class Edit extends Component<typeof this> {
    <template>
      <div {{attachStyles styles}}>
        <FieldContainer @label="Currency">
          <@fields.currency/>
        </FieldContainer>
        <FieldContainer @label="IBAN">
          <@fields.iban/>
        </FieldContainer>
        <FieldContainer @label="BIC">
          <@fields.bic/>
        </FieldContainer>
      </div>
    </template>
  }
  static embedded = this.edit;
}

class EditPaymentMethod extends Component<typeof PaymentMethod> {
  <template>
    <div {{attachStyles styles}}>
      <FieldContainer @label="Payment Method">
        <@fields.paymentType/>
      </FieldContainer>
      {{#if (eq @model.paymentType.type "crypto-payment")}}
        <@fields.cryptoPayment/>
      {{else if (eq @model.paymentType.type "wire-transfer")}}
        {{!-- TODO: deserialization error "wireTransfer.currency not loaded" --}}
        {{!-- <@fields.wireTransfer/> --}}
      {{/if}}
    </div>
  </template>
};
export class PaymentMethod extends Card {
  @field paymentType = linksTo(PaymentType); // dropdown
  @field cryptoPayment = contains(CryptoPayment);
  @field wireTransfer = contains(WireTransfer);
  static edit = EditPaymentMethod;
  static embedded = EditPaymentMethod;
}
