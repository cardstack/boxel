import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import { on } from '@ember/modifier';
import StringField from 'https://cardstack.com/base/string';
import EmailField from 'https://cardstack.com/base/email';
import PhoneNumberField from 'https://cardstack.com/base/phone-number';
import enumField from 'https://cardstack.com/base/enum';
import ContactIcon from '@cardstack/boxel-icons/address-book';
import PhoneIcon from '@cardstack/boxel-icons/phone';
import MailIcon from '@cardstack/boxel-icons/mail';
import { Avatar } from '@cardstack/boxel-ui/components';
import { Account } from './account';

const ContactRoleField = enumField(StringField, {
  options: ['decision maker', 'champion', 'influencer', 'user', 'billing'],
  displayName: 'Contact Role',
});

export class Contact extends CardDef {
  static displayName = 'Contact';
  static icon = ContactIcon;

  @field firstName = contains(StringField);
  @field lastName = contains(StringField);
  @field email = contains(EmailField);
  @field phone = contains(PhoneNumberField);
  @field jobTitle = contains(StringField);
  @field role = contains(ContactRoleField);
  @field account = linksTo(Account);

  @field name = contains(StringField, {
    computeVia: function (this: Contact) {
      return [this.firstName, this.lastName].filter(Boolean).join(' ');
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Contact) {
      return this.name?.trim()?.length
        ? this.name
        : `Untitled ${this.constructor.displayName}`;
    },
  });

  static atom = class Atom extends Component<typeof Contact> {
    <template>
      <span class='contact-atom'>
        <Avatar
          class='cta-avatar'
          @userId={{@model.email}}
          @displayName={{@model.name}}
          @isReady={{true}}
        />
        <span class='cta-name'>{{if
            @model.name
            @model.name
            'Unnamed Contact'
          }}</span>
      </span>
      <style scoped>
        .contact-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, #111111);
        }
        .cta-avatar {
          --profile-avatar-icon-size: 18px;
          --profile-avatar-icon-border: 0;
          font-weight: 700;
          flex-shrink: 0;
        }
        .cta-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Contact> {
    get subtitle() {
      return this.args.model?.jobTitle;
    }
    // A consumer may wrap this row in its own click target; reaching the person
    // should not also open their card.
    stopClick = (event: Event) => event.stopPropagation();
    <template>
      <div class='contact'>
        <Avatar
          class='avatar'
          @userId={{@model.email}}
          @displayName={{@model.name}}
          @isReady={{true}}
        />
        <div class='info'>
          <div class='name'>{{if @model.name @model.name 'Unnamed'}}</div>
          {{#if this.subtitle}}
            <div class='meta'>{{this.subtitle}}</div>
          {{/if}}
        </div>
        <span class='reach'>
          {{#if @model.phone}}
            <a
              class='reach-link'
              href='tel:{{@model.phone}}'
              title='Call {{@model.name}}'
              {{on 'click' this.stopClick}}
            ><PhoneIcon /></a>
          {{/if}}
          {{#if @model.email}}
            <a
              class='reach-link'
              href='mailto:{{@model.email}}'
              title='Email {{@model.name}}'
              {{on 'click' this.stopClick}}
            ><MailIcon /></a>
          {{/if}}
        </span>
        {{#if @model.role}}
          <span class='role'>{{@model.role}}</span>
        {{/if}}
      </div>
      <style scoped>
        .contact {
          display: flex;
          align-items: center;
          gap: 0.625rem;
          padding: 0.625rem 0.875rem;
        }
        .avatar {
          --profile-avatar-icon-size: 32px;
          --profile-avatar-icon-border: 0;
          font-weight: 700;
          flex-shrink: 0;
        }
        .info {
          min-width: 0;
          flex: 1;
        }
        /* Constant-width slot so rows line up whether or not a contact is
           reachable — see the column-alignment rule. */
        .reach {
          display: inline-flex;
          gap: 0.25rem;
          width: 3.25rem;
          justify-content: flex-end;
          flex-shrink: 0;
        }
        .reach-link {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          color: var(--muted-foreground, #6b7280);
          background: var(--muted, #f3f4f6);
        }
        .reach-link:hover {
          color: var(--primary-foreground, #ffffff);
          background: var(--primary, #111111);
        }
        .reach-link :deep(svg) {
          width: 13px;
          height: 13px;
        }
        .name {
          font-weight: 600;
          font-size: 0.875rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .meta {
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .role {
          font-size: 0.625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          padding: 0.125rem 0.5rem;
          border-radius: 999px;
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
          white-space: nowrap;
          flex-shrink: 0;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Contact> {
    get name() {
      return this.args.model?.name?.trim() || 'Unnamed Contact';
    }
    <template>
      <div class='fitted'>
        <Avatar
          class='avatar'
          @userId={{@model.email}}
          @displayName={{@model.name}}
          @isReady={{true}}
        />
        <div class='info'>
          <span class='name'>{{this.name}}</span>
          {{#if @model.jobTitle}}
            <span class='meta line-title'>{{@model.jobTitle}}</span>
          {{/if}}
          {{#if @model.email}}
            <span class='meta line-email'>{{@model.email}}</span>
          {{/if}}
          {{#if @model.phone}}
            <span class='meta line-phone'>{{@model.phone}}</span>
          {{/if}}
        </div>
      </div>
      <style scoped>
        .fitted {
          display: flex;
          align-items: center;
          gap: 0.625rem;
          width: 100%;
          height: 100%;
          padding: 0.625rem 0.75rem;
          box-sizing: border-box;
          overflow: hidden;
          color: var(--foreground, #111111);
        }
        .avatar {
          --profile-avatar-icon-size: 28px;
          --profile-avatar-icon-border: 0;
          font-weight: 700;
          flex-shrink: 0;
        }
        .info {
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
          min-width: 0;
        }
        .name {
          font-weight: 600;
          font-size: 0.8125rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .meta {
          font-size: 0.6875rem;
          color: var(--muted-foreground, #6b7280);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .line-title,
        .line-email,
        .line-phone {
          display: none;
        }
        @container fitted-card (min-height: 65px) {
          .line-title {
            display: block;
          }
        }
        @container fitted-card (min-height: 170px) {
          .fitted {
            flex-direction: column;
            align-items: flex-start;
            justify-content: center;
            padding: 0.875rem;
          }
          .avatar {
            --profile-avatar-icon-size: 40px;
          }
          .line-email {
            display: block;
          }
        }
        @container fitted-card (min-width: 400px) and (min-height: 170px) {
          .line-phone {
            display: block;
          }
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Contact> {
    get name() {
      return this.args.model?.name?.trim() || 'Unnamed Contact';
    }
    <template>
      <article class='contact-page'>
        <header class='ch'>
          <Avatar
            class='avatar'
            @userId={{@model.email}}
            @displayName={{@model.name}}
            @isReady={{true}}
          />
          <div class='ch-id'>
            <p class='doc-kind'>Contact</p>
            <h1>{{this.name}}</h1>
            {{#if @model.jobTitle}}
              <p class='job-title'>{{@model.jobTitle}}</p>
            {{/if}}
          </div>
          {{#if @model.role}}
            <span class='role'>{{@model.role}}</span>
          {{/if}}
        </header>
        <section class='panel'>
          <h2>Reach</h2>
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
        {{#if @model.account}}
          <section class='panel'>
            <h2>Account</h2>
            <div class='acct'><@fields.account @format='embedded' /></div>
          </section>
        {{/if}}
      </article>
      <style scoped>
        .contact-page {
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
          --profile-avatar-icon-size: 56px;
          font-weight: 700;
          flex-shrink: 0;
        }
        .ch-id {
          flex: 1;
          min-width: 0;
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
        .job-title {
          margin: 0.25rem 0 0;
          font-size: 0.875rem;
          color: var(--muted-foreground, #6b7280);
        }
        .role {
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          padding: 0.1875rem 0.625rem;
          border-radius: 999px;
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
          white-space: nowrap;
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
        .acct {
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.5rem;
        }
      </style>
    </template>
  };
}
