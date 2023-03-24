import {
  contains,
  field,
  Card,
  Component,
  containsMany,
  relativeTo,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import TextAreaCard from 'https://cardstack.com/base/text-area';
import { CardContainer, FieldContainer } from '@cardstack/boxel-ui';
import { startCase } from 'lodash';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';

class WireTransfer extends Card {
  @field currency = contains(StringCard);
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
      {{#if (eq @model.type 'Wire Transfer')}}
        <@fields.wireTransfer />
      {{/if}}
    </div>
  </template>
}
export class PaymentMethod extends Card {
  @field type = contains(StringCard); // dropdown
  @field wireTransfer = contains(WireTransfer);
  static edit = EditPaymentMethod;
  static embedded = EditPaymentMethod;
  static isolated = EditPaymentMethod;
}

export class Address extends Card {
  @field streetAddress = contains(StringCard); // required
  @field city = contains(StringCard); // required
  @field region = contains(StringCard);
  @field postalCode = contains(StringCard);
  @field poBoxNumber = contains(StringCard);
  @field country = contains(StringCard); // required // dropdown

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <address>
        <div><@fields.streetAddress /></div>
        <@fields.city />
        <@fields.region />
        <@fields.postalCode /><@fields.poBoxNumber />
        <@fields.country />
      </address>
    </template>
  };
}

class VendorDetails extends Card {
  @field name = contains(StringCard); // required
  @field description = contains(TextAreaCard);
  @field logoURL = contains(StringCard); // url format
  @field email = contains(StringCard); // email format
  @field cardXYZ = contains(StringCard);
  @field logoHref = contains(StringCard, {
    computeVia: function (this: VendorDetails) {
      if (!this.logoURL) {
        return null;
      }
      return new URL(this.logoURL, this[relativeTo] || this.id).href;
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContainer class='vendor-card'>
        {{#each-in @fields as |key value|}}
          {{#unless (eq key 'id')}}
            <FieldContainer
              {{! @glint-ignore }}
              @label={{startCase key}}
              @vertical={{true}}
            >
              {{value}}
            </FieldContainer>
          {{/unless}}
        {{/each-in}}
      </CardContainer>
    </template>
  };
}

class Contact extends Card {
  @field fullName = contains(StringCard);
  @field preferredName = contains(StringCard);
  @field jobTitle = contains(StringCard);
  @field email = contains(StringCard); // email format
  @field phone = contains(StringCard); // phone number format
  @field cardXYZ = contains(StringCard);
  @field notes = contains(TextAreaCard);
  @field imageURL = contains(StringCard);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContainer class='vendor-card'>
        {{#each-in @fields as |key value|}}
          {{#unless (eq key 'id')}}
            <FieldContainer
              {{! @glint-ignore }}
              @label={{startCase key}}
              @vertical={{true}}
            >
              {{value}}
            </FieldContainer>
          {{/unless}}
        {{/each-in}}
      </CardContainer>
    </template>
  };
}

class ContactMethod extends Card {
  @field platform = contains(StringCard); // Dropdown (Telegram, Discord, Facebook, LinkedIn, Twitter)
  @field username = contains(StringCard);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.platform />: <@fields.username />
    </template>
  };
}

export class Vendor extends Card {
  @field vendor = contains(VendorDetails); // required
  @field contact = contains(Contact); // required
  @field contactMethod = containsMany(ContactMethod);
  @field mailingAddress = contains(Address); // required
  @field preferredPaymentMethod = contains(PaymentMethod); // required
  @field alternatePaymentMethod = containsMany(PaymentMethod);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContainer class='vendor-card--embedded'>
        <div>
          <@fields.vendor.name />
          <@fields.mailingAddress />
          <@fields.vendor.email />
        </div>
        <img src={{@model.vendor.logoHref}} />
      </CardContainer>
    </template>
  };
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <CardContainer class='vendor-card'>
        <section>
          <h2>Vendor</h2>
          <@fields.vendor />
        </section>
        <section>
          <h2>Contact</h2>
          <@fields.contact />
        </section>
        {{#if @model.contactMethod.length}}
          <section>
            <h2>Contact Method</h2>
            <@fields.contactMethod />
          </section>
        {{/if}}
        <section>
          <h2>Mailing Address</h2>
          <@fields.mailingAddress />
        </section>
        <section>
          <h2>Preferred Payment Method</h2>
          <@fields.preferredPaymentMethod />
          {{#if @model.alternatePaymentMethod.length}}
            <h2>Alternate Payment Method</h2>
            <@fields.alternatePaymentMethod />
          {{/if}}
        </section>
      </CardContainer>
    </template>
  };
  static edit = class Edit extends Component<typeof this> {
    <template>
      <CardContainer class='vendor-card'>
        <section>
          <h2>Vendor</h2>
          <@fields.vendor />
        </section>
        <section>
          <h2>Contact</h2>
          <@fields.contact />
        </section>
        {{#if @model.contactMethod.length}}
          <section>
            <h2>Contact Method</h2>
            <@fields.contactMethod />
          </section>
        {{/if}}
        <section>
          <h2>Mailing Address</h2>
          <@fields.mailingAddress />
        </section>
        <section>
          <h2>Preferred Payment Method</h2>
          <@fields.preferredPaymentMethod />
          <h2>Alternate Payment Method</h2>
          <@fields.alternatePaymentMethod />
        </section>
      </CardContainer>
    </template>
  };
}
