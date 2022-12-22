import { contains, field, linksTo, Card, Component, containsMany } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import TextAreaCard from 'https://cardstack.com/base/text-area';
import { Contact } from './contact';
import { Address } from './address';
import { initStyleSheet, attachStyles } from '@cardstack/boxel-ui/attach-styles';
import { CardContainer, FieldContainer } from '@cardstack/boxel-ui';
import { startCase } from 'lodash';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';
import { Payment } from './payment';
import { Token } from './token';

class ContactMethod extends Card {
  @field platform = contains(StringCard); // Dropdown (Telegram, Discord, Facebook, LinkedIn, Twitter)
  @field username = contains(StringCard);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.platform/>: <@fields.username/>
    </template>
  };
  static isolated = this.embedded;
}

let embedded = initStyleSheet(`
  this {
    display: grid;
    grid-template-columns: 1fr auto;
  }
`);
let isolated = initStyleSheet(`
  this {
    display: grid;
    gap: var(--boxel-sp);
  }
`);
export class Vendor extends Card {
  @field name = contains(StringCard); // required
  @field description = contains(TextAreaCard);
  @field logoURL = contains(StringCard); // url format
  @field cardXYZ = contains(StringCard);
  @field email = contains(StringCard); // email format
  @field contact = linksTo(Contact); // required
  @field contactMethod = containsMany(ContactMethod);
  @field mailingAddress = contains(Address); // required
  @field preferredPaymentMethod = contains(Payment); // required // dropdown of PaymentTypes (CryptoPayment or WireTransfer)
  @field token = linksTo(Token);
  static embedded = class Embedded extends Component<typeof Vendor> {
    <template>
      <CardContainer {{attachStyles embedded}}>
        <div>
          <@fields.name/>
          <@fields.mailingAddress/>
          <@fields.email/>
        </div>
        <img src={{@model.logoURL}} />
      </CardContainer>
    </template>
  };
  static isolated = class Isolated extends Component<typeof Vendor> {
    <template>
      <CardContainer {{attachStyles isolated}}>
        {{#each-in @fields as |key value|}}
          {{#unless (eq key 'id')}}
            <FieldContainer
              {{!-- @glint-ignore --}}
              @label={{startCase key}}
              @vertical={{true}}>
                {{value}}
              </FieldContainer>
          {{/unless}}
        {{/each-in}}
      </CardContainer>
    </template>
  };
  static edit = class Edit extends Component<typeof Vendor> {
    <template>
      <CardContainer {{attachStyles isolated}}>
        <FieldContainer @label="Name">
          <@fields.name/>
        </FieldContainer>
        <FieldContainer @label="Mailing Address">
          <@fields.mailingAddress/>
        </FieldContainer>
        <FieldContainer @label="Email">
          <@fields.email/>
        </FieldContainer>
        <FieldContainer @label="Payment Method">
          <@fields.preferredPaymentMethod/>
        </FieldContainer>
        {{#if @model.preferredPaymentMethod}}
          {{#if (eq @model.preferredPaymentMethod.typeId.typeId "crypto")}}
            <FieldContainer @label="Chain ID">
              <@fields.preferredPaymentMethod.cryptoPayment/>
            </FieldContainer>
            {{#if @model.preferredPaymentMethod.cryptoPayment}}
              {{#if (eq @model.preferredPaymentMethod.cryptoPayment.chainId "1")}}
                <FieldContainer @label="Token">
                  <@fields.token/>
                </FieldContainer>
              {{/if}}
            {{/if}}
          {{else if (eq @model.preferredPaymentMethod.typeId.typeId "wire")}}
            Wire Transfer: <@fields.preferredPaymentMethod.wireTransfer/>
          {{/if}}
        {{/if}}
      </CardContainer>
    </template>
  };
}
