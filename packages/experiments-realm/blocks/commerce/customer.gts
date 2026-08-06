import {
  CardDef,
  Component,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import EmailField from 'https://cardstack.com/base/email';
import PhoneNumberField from 'https://cardstack.com/base/phone-number';
import AddressField from 'https://cardstack.com/base/address';
import UsersIcon from '@cardstack/boxel-icons/users';

export class Customer extends CardDef {
  static displayName = 'Customer';
  static icon = UsersIcon;

  @field name = contains(StringField);
  @field email = contains(EmailField);
  @field phone = contains(PhoneNumberField);
  @field billingAddress = contains(AddressField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Customer) {
      return this.name?.trim()?.length
        ? this.name
        : `Untitled ${this.constructor.displayName}`;
    },
  });

  static embedded = class Embedded extends Component<typeof Customer> {
    <template>
      <div class='customer'>
        <UsersIcon class='icon' />
        <div>
          <div class='name'>{{@model.cardTitle}}</div>
          <div class='meta'><@fields.email /></div>
        </div>
      </div>
      <style scoped>
        .customer {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          padding: 0.625rem 0.875rem;
        }
        .icon {
          width: 22px;
          height: 22px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .name {
          font-weight: 600;
          font-size: 0.9375rem;
        }
        .meta {
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Customer> {
    <template>
      <article class='customer-page'>
        <header>
          <h1>{{@model.cardTitle}}</h1>
        </header>
        <section class='panel'>
          <h2>Contact</h2>
          <dl>
            <dt>Email</dt>
            <dd><@fields.email /></dd>
            <dt>Phone</dt>
            <dd><@fields.phone /></dd>
          </dl>
        </section>
        <section class='panel'>
          <h2>Billing Address</h2>
          <@fields.billingAddress />
        </section>
      </article>
      <style scoped>
        .customer-page {
          padding: 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
          max-width: 40rem;
        }
        h1 {
          margin: 0;
          font-size: 1.375rem;
        }
        .panel {
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.75rem;
          padding: 1rem;
          background: var(--card, #ffffff);
        }
        h2 {
          margin: 0 0 0.75rem;
          font-size: 0.8125rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--muted-foreground, #6b7280);
        }
        dl {
          margin: 0;
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 0.375rem 1rem;
          font-size: 0.875rem;
        }
        dt {
          color: var(--muted-foreground, #6b7280);
        }
        dd {
          margin: 0;
        }
      </style>
    </template>
  };
}
