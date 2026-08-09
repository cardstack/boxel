import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import BooleanField from 'https://cardstack.com/base/boolean';
import DateField from 'https://cardstack.com/base/date';
import EmailField from 'https://cardstack.com/base/email';
import PhoneNumberField from 'https://cardstack.com/base/phone-number';
import AddressField from 'https://cardstack.com/base/address';
import UsersIcon from '@cardstack/boxel-icons/users';
import { User } from './user';

export class Account extends CardDef {
  static displayName = 'Account';
  static icon = UsersIcon;

  @field name = contains(StringField);
  @field domain = contains(StringField);
  @field industry = contains(StringField);
  @field email = contains(EmailField);
  @field phone = contains(PhoneNumberField);
  @field billingAddress = contains(AddressField);
  @field owner = linksTo(User);
  @field firstPaidAt = contains(DateField);

  @field isCustomer = contains(BooleanField, {
    computeVia: function (this: Account) {
      return Boolean(this.firstPaidAt);
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Account) {
      return this.name?.trim()?.length
        ? this.name
        : `Untitled ${this.constructor.displayName}`;
    },
  });

  static embedded = class Embedded extends Component<typeof Account> {
    <template>
      <div class='account'>
        <UsersIcon class='icon' />
        <div>
          <div class='name'>{{@model.cardTitle}}</div>
          <div class='meta'><@fields.email /></div>
        </div>
      </div>
      <style scoped>
        .account {
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

  static atom = class Atom extends Component<typeof Account> {
    <template>
      <span class='account-atom'>
        <UsersIcon class='ca-icon' />
        <span class='ca-name'>{{if
            @model.name
            @model.name
            'Unnamed Account'
          }}</span>
      </span>
      <style scoped>
        .account-atom {
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

  static fitted = class Fitted extends Component<typeof Account> {
    get name() {
      return this.args.model?.name?.trim() || 'Unnamed Account';
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
          {{#if @model.industry}}
            <span class='meta'>{{@model.industry}}</span>
          {{/if}}
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
            {{#if @model.industry}}
              <span class='meta'>{{@model.industry}}</span>
            {{/if}}
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
          {{#if @model.isCustomer}}
            <span class='badge-pill'>Customer</span>
          {{/if}}
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
          flex: 1;
        }
        .badge-pill {
          align-self: flex-start;
          padding: 0.125rem 0.5rem;
          border-radius: 999px;
          font-size: 0.625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          background: var(--state-positive-bg, #dcfce7);
          color: var(--state-positive-fg, #166534);
          flex-shrink: 0;
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

  static isolated = class Isolated extends Component<typeof Account> {
    get name() {
      return this.args.model?.name?.trim() || 'Unnamed Account';
    }
    get initials() {
      let words = this.name.split(/\s+/).filter(Boolean).slice(0, 2);
      let letters = words.map((w) => w[0]?.toUpperCase() ?? '').join('');
      return letters || '?';
    }
    <template>
      <article class='account-page'>
        <header class='ch'>
          <span class='avatar'>{{this.initials}}</span>
          <div class='ch-id'>
            <p class='doc-kind'>Account</p>
            <h1>{{this.name}}</h1>
            {{#if @model.isCustomer}}
              <p class='status-line customer'>Customer since
                <@fields.firstPaidAt /></p>
            {{else}}
              <p class='status-line'>Prospect</p>
            {{/if}}
          </div>
        </header>
        <section class='panel'>
          <h2>Company</h2>
          <dl>
            {{#if @model.industry}}
              <dt>Industry</dt>
              <dd>{{@model.industry}}</dd>
            {{/if}}
            {{#if @model.domain}}
              <dt>Domain</dt>
              <dd>{{@model.domain}}</dd>
            {{/if}}
            {{#if @model.owner}}
              <dt>Owner</dt>
              <dd><@fields.owner @format='atom' /></dd>
            {{/if}}
          </dl>
        </section>
        <section class='panel'>
          <h2>Contact</h2>
          <dl>
            {{#if @model.email}}
              <dt>Email</dt>
              <dd><@fields.email /></dd>
            {{/if}}
            {{#if @model.phone}}
              <dt>Phone</dt>
              <dd><@fields.phone /></dd>
            {{/if}}
          </dl>
        </section>
        <section class='panel'>
          <h2>Billing Address</h2>
          <@fields.billingAddress />
        </section>
      </article>
      <style scoped>
        .account-page {
          max-width: 40rem;
          margin: 0 auto;
          padding: 2rem 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }
        .ch {
          display: flex;
          align-items: center;
          gap: 1rem;
          border-bottom: 2px solid var(--foreground, #111111);
          padding-bottom: 1.25rem;
        }
        .avatar {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 56px;
          height: 56px;
          border-radius: 50%;
          background: var(--primary, #111111);
          color: var(--primary-foreground, #ffffff);
          font-size: 1.25rem;
          font-weight: 700;
          letter-spacing: 0.02em;
          flex-shrink: 0;
        }
        .doc-kind {
          margin: 0 0 0.125rem;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          color: var(--muted-foreground, #6b7280);
        }
        h1 {
          margin: 0;
          font-size: 1.625rem;
          line-height: 1.1;
          font-family: var(--font-heading, inherit);
        }
        .status-line {
          margin: 0.25rem 0 0;
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--muted-foreground, #6b7280);
        }
        .status-line.customer {
          color: var(--state-positive-fg, #166534);
        }
        .panel {
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.75rem;
          padding: 1rem 1.25rem;
          background: var(--card, #ffffff);
        }
        h2 {
          margin: 0 0 0.75rem;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--muted-foreground, #6b7280);
        }
        dl {
          margin: 0;
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 0.5rem 1.25rem;
          font-size: 0.875rem;
          align-items: center;
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
