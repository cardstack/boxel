import {
  contains,
  field,
  FieldDef,
  Component,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import { Chain } from './chain';
import { Token, Currency } from './asset';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';
import { FieldContainer } from '@cardstack/boxel-ui';

class CryptoPayment extends FieldDef {
  static displayName = 'Payment Method';
  @field chain = linksTo(Chain); // dropdown
  @field token = linksTo(Token); // filtered dropdown
  @field toAddress = contains(StringCard);
  static edit = class Edit extends Component<typeof this> {
    <template>
      <div class='payment-method-card'>
        <FieldContainer @label='Chain'>
          <@fields.chain />
        </FieldContainer>
        {{#if @model.chain.chainId}}
          <FieldContainer @label='Token'>
            <@fields.token />
          </FieldContainer>
          {{#if @model.token}}
            <FieldContainer @label='Token Name'>
              {{@model.token.name}}
            </FieldContainer>
            <FieldContainer @label='Token Address'>
              {{@model.token.address}}
            </FieldContainer>
            <FieldContainer @label='To Address'>
              <@fields.toAddress />
            </FieldContainer>
          {{/if}}
        {{/if}}
      </div>
    </template>
  };
  static embedded = this.edit;
}

class WireTransfer extends FieldDef {
  @field currency = linksTo(Currency); // dropdown
  @field iban = contains(StringCard); // IBAN format
  @field bic = contains(StringCard); // BIC format
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div><@fields.iban /></div>
      <div><@fields.bic /></div>
    </template>
  };
  static edit = class Edit extends Component<typeof this> {
    <template>
      <div class='payment-method-card'>
        <FieldContainer @label='Currency'>
          <@fields.currency />
        </FieldContainer>
        <FieldContainer @label='IBAN'>
          <@fields.iban />
        </FieldContainer>
        <FieldContainer @label='BIC'>
          <@fields.bic />
        </FieldContainer>
      </div>
    </template>
  };
  static embedded = this.edit;
}

class EditPaymentMethod extends Component<typeof PaymentMethod> {
  <template>
    <div class='payment-method-card'>
      <FieldContainer @label='Payment Method'>
        <@fields.type />
      </FieldContainer>
      {{#if (eq @model.type 'Crypto Payment')}}
        <@fields.cryptoPayment />
      {{else if (eq @model.type 'Wire Transfer')}}
        {{! TODO: uncommenting the below causes the app to crash }}
        {{! <@fields.wireTransfer/> }}
      {{/if}}
    </div>
  </template>
}
export class PaymentMethod extends FieldDef {
  @field type = contains(StringCard); // dropdown
  @field cryptoPayment = contains(CryptoPayment);
  @field wireTransfer = contains(WireTransfer);
  static edit = EditPaymentMethod;
  static embedded = EditPaymentMethod;
  static isolated = EditPaymentMethod;
}
