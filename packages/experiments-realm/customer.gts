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

  static atom = class Atom extends Component<typeof Customer> {
    <template>
      <span class='customer-atom'>
        <UsersIcon class='ca-icon' />
        <span class='ca-name'>{{if
            @model.name
            @model.name
            'Unnamed Customer'
          }}</span>
      </span>
      <style scoped>
        .customer-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, #111111);
        }
        .ca-icon {
          width: 14px;
          height: 14px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .ca-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Customer> {
    get name() {
      return this.args.model?.name?.trim() || 'Unnamed Customer';
    }
    get initials() {
      let words = this.name.split(/\s+/).filter(Boolean).slice(0, 2);
      let letters = words.map((w) => w[0]?.toUpperCase() ?? '').join('');
      return letters || '?';
    }
    get location() {
      let a = this.args.model?.billingAddress;
      return [a?.city, a?.country?.name].filter(Boolean).join(', ');
    }
    <template>
      <div class='fitted'>
        <div class='fmt badge'>
          <span class='avatar'>{{this.initials}}</span>
          <span class='name'>{{this.name}}</span>
        </div>
        <div class='fmt strip'>
          <span class='avatar'>{{this.initials}}</span>
          <div class='info'>
            <span class='name'>{{this.name}}</span>
            {{#if @model.email}}
              <span class='meta'>{{@model.email}}</span>
            {{/if}}
          </div>
        </div>
        <div class='fmt tile'>
          <span class='avatar avatar-lg'>{{this.initials}}</span>
          <span class='name'>{{this.name}}</span>
          {{#if @model.email}}
            <span class='meta'>{{@model.email}}</span>
          {{/if}}
          {{#if this.location}}
            <span class='meta'>{{this.location}}</span>
          {{/if}}
        </div>
        <div class='fmt card'>
          <span class='avatar avatar-lg'>{{this.initials}}</span>
          <div class='info'>
            <span class='name name-lg'>{{this.name}}</span>
            {{#if @model.email}}
              <span class='meta'>{{@model.email}}</span>
            {{/if}}
            {{#if @model.phone}}
              <span class='meta'>{{@model.phone}}</span>
            {{/if}}
            {{#if this.location}}
              <span class='meta'>{{this.location}}</span>
            {{/if}}
          </div>
        </div>
      </div>
      <style scoped>
        .fitted {
          width: 100%;
          height: 100%;
          color: var(--foreground, #111111);
        }
        .fmt {
          display: none;
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          overflow: hidden;
        }
        .avatar {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          border-radius: 50%;
          background: var(--muted, #eef2f7);
          color: var(--muted-foreground, #6b7280);
          font-size: 0.6875rem;
          font-weight: 700;
          letter-spacing: 0.02em;
          flex-shrink: 0;
        }
        .avatar-lg {
          width: 40px;
          height: 40px;
          font-size: 0.875rem;
        }
        .name {
          font-weight: 600;
          font-size: 0.8125rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 100%;
        }
        .name-lg {
          font-size: 1rem;
        }
        .meta {
          font-size: 0.6875rem;
          color: var(--muted-foreground, #6b7280);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          max-width: 100%;
        }
        .info {
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
          min-width: 0;
        }
        @container fitted-card (max-width: 150px) and (max-height: 169px) {
          .badge {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 0.375rem;
            padding: 0.5rem;
            text-align: center;
          }
        }
        @container fitted-card (min-width: 151px) and (max-height: 169px) {
          .strip {
            display: flex;
            align-items: center;
            gap: 0.625rem;
            padding: 0.625rem 0.75rem;
          }
        }
        @container fitted-card (max-width: 399px) and (min-height: 170px) {
          .tile {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            justify-content: center;
            gap: 0.25rem;
            padding: 0.875rem;
          }
          .tile .avatar-lg {
            margin-bottom: 0.25rem;
          }
        }
        @container fitted-card (min-width: 400px) and (min-height: 170px) {
          .card {
            display: flex;
            align-items: center;
            gap: 1rem;
            padding: 1.25rem;
          }
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
          font-family: var(--font-heading, inherit);
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
