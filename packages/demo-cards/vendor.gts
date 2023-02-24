import { contains, field, Card, Component, containsMany, relativeTo } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import TextAreaCard from 'https://cardstack.com/base/text-area';
import { Address } from './address';
import { initStyleSheet, attachStyles } from '@cardstack/boxel-ui/attach-styles';
import { CardContainer, FieldContainer } from '@cardstack/boxel-ui';
import { startCase } from 'lodash';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';
import { PaymentMethod } from './payment-method';

let styles = initStyleSheet(`
  .boxel-field + .boxel-field {
    margin-top: var(--boxel-sp);
  }
`);

class VendorDetails extends Card {
  @field name = contains(StringCard); // required
  @field description = contains(TextAreaCard);
  @field logoURL = contains(StringCard); // url format
  @field email = contains(StringCard); // email format
  @field cardXYZ = contains(StringCard);
  @field logoHref = contains(StringCard, { computeVia: function(this: VendorDetails) {
    if (!this.logoURL) {
      return null;
    }
    return new URL(this.logoURL, this[relativeTo] || this.id).href;
  }});

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContainer {{attachStyles styles}}>
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
      <CardContainer {{attachStyles styles}}>
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
  }
}

class ContactMethod extends Card {
  @field platform = contains(StringCard); // Dropdown (Telegram, Discord, Facebook, LinkedIn, Twitter)
  @field username = contains(StringCard);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.platform/>: <@fields.username/>
    </template>
  };
}

let embeddedVendorStyles = initStyleSheet(`
  this {
    display: grid;
    grid-template-columns: 1fr auto;
  }
`);
export class Vendor extends Card {
  @field vendor = contains(VendorDetails); // required
  @field contact = contains(Contact); // required
  @field contactMethod = containsMany(ContactMethod);
  @field mailingAddress = contains(Address); // required
  @field preferredPaymentMethod = contains(PaymentMethod); // required
  @field alternatePaymentMethod = containsMany(PaymentMethod);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContainer {{attachStyles embeddedVendorStyles}}>
        <div>
          <@fields.vendor.name/>
          <@fields.mailingAddress/>
          <@fields.vendor.email/>
        </div>
        <img src={{@model.vendor.logoHref}} />
      </CardContainer>
    </template>
  };
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <CardContainer {{attachStyles styles}}>
        <section>
          <h2>Vendor</h2>
          <@fields.vendor/>
        </section>
        <section>
          <h2>Contact</h2>
          <@fields.contact/>
        </section>
        {{#if @model.contactMethod.length}}
          <section>
            <h2>Contact Method</h2>
            <@fields.contactMethod/>
          </section>
        {{/if}}
        <section>
          <h2>Mailing Address</h2>
          <@fields.mailingAddress/>
        </section>
        <section>
          <h2>Preferred Payment Method</h2>
          <@fields.preferredPaymentMethod/>
          {{#if @model.alternatePaymentMethod.length}}
            <h2>Alternate Payment Method</h2>
            <@fields.alternatePaymentMethod/>
          {{/if}}
        </section>
      </CardContainer>
    </template>
  };
  static edit = class Edit extends Component<typeof this> {
    <template>
      <CardContainer {{attachStyles styles}}>
        <section>
          <h2>Vendor</h2>
          <@fields.vendor/>
        </section>
        <section>
          <h2>Contact</h2>
          <@fields.contact/>
        </section>
        {{#if @model.contactMethod.length}}
          <section>
            <h2>Contact Method</h2>
            <@fields.contactMethod/>
          </section>
        {{/if}}
        <section>
          <h2>Mailing Address</h2>
          <@fields.mailingAddress/>
        </section>
        <section>
          <h2>Preferred Payment Method</h2>
          <@fields.preferredPaymentMethod/>
          <h2>Alternate Payment Method</h2>
          <@fields.alternatePaymentMethod/>
        </section>
      </CardContainer>
    </template>
  };
}
