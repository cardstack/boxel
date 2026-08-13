import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import BooleanField from 'https://cardstack.com/base/boolean';
import NumberField from 'https://cardstack.com/base/number';
import DateField from 'https://cardstack.com/base/date';
import UrlField from 'https://cardstack.com/base/url';
import AmountWithCurrency from 'https://cardstack.com/base/amount-with-currency';
import MarkdownField from 'https://cardstack.com/base/markdown';
import enumField from 'https://cardstack.com/base/enum';
import ContractIcon from '@cardstack/boxel-icons/contract';
import { Account } from './account';
import { Opportunity } from './opportunity';
import { formatMoney } from './money';

const ContractStatusField = enumField(StringField, {
  options: ['draft', 'out for signature', 'signed', 'expired', 'terminated'],
  displayName: 'Contract Status',
});

export class Contract extends CardDef {
  static displayName = 'Contract';
  static icon = ContractIcon;

  @field title = contains(StringField);
  @field account = linksTo(Account);
  // Typed against Opportunity so a Deal — or any future subtype — is
  // assignable, the same reason owner links to User rather than Teammate.
  @field deal = linksTo(Opportunity);
  @field status = contains(ContractStatusField);
  @field startDate = contains(DateField);
  @field endDate = contains(DateField);
  @field value = contains(AmountWithCurrency);
  // The event fact behind "signed": a date that is written once, so the
  // signature survives a later status change and can be reported on.
  @field signedAt = contains(DateField);
  @field terms = contains(MarkdownField);
  // Where the executed copy lives. Most teams sign in DocuSign or similar, so
  // the record points at the artifact rather than trying to hold it.
  @field documentUrl = contains(UrlField);

  @field isSigned = contains(BooleanField, {
    computeVia: function (this: Contract) {
      return Boolean(this.signedAt);
    },
  });

  @field daysToExpiry = contains(NumberField, {
    computeVia: function (this: Contract) {
      if (!this.endDate || this.status === 'terminated') return 0;
      let days = Math.ceil(
        (new Date(this.endDate).getTime() - Date.now()) / 86400000,
      );
      return days > 0 ? days : 0;
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Contract) {
      return this.title?.trim()?.length
        ? this.title
        : `Untitled ${this.constructor.displayName}`;
    },
  });

  static atom = class Atom extends Component<typeof Contract> {
    <template>
      <span class='contract-atom'>
        <ContractIcon class='ca-icon' />
        <span class='ca-name'>{{@model.cardTitle}}</span>
      </span>
      <style scoped>
        .contract-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          min-width: 0;
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
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Contract> {
    get valueDisplay() {
      return formatMoney(
        this.args.model?.value?.amount,
        this.args.model?.value?.currency?.code,
      );
    }
    <template>
      <div class='contract'>
        <ContractIcon class='icon' />
        <div class='info'>
          <span class='name'>{{@model.cardTitle}}</span>
          {{#if @model.account.name}}
            <span class='meta'>{{@model.account.name}}</span>
          {{/if}}
        </div>
        <span class='figure'>{{if this.valueDisplay this.valueDisplay '—'}}</span>
        {{#if @model.status}}
          <span
            class='status status-{{this.statusSlug}}'
          >{{@model.status}}</span>
        {{/if}}
      </div>
      <style scoped>
        .contract {
          display: flex;
          align-items: center;
          gap: 0.625rem;
          padding: 0.625rem 0.875rem;
          font-size: 0.875rem;
        }
        .icon {
          width: 20px;
          height: 20px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .info {
          min-width: 0;
          flex: 1;
          display: flex;
          flex-direction: column;
        }
        .name {
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .meta {
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
        }
        .figure {
          font-weight: 600;
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .status {
          width: 7.5rem;
          text-align: center;
          font-size: 0.625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 0.125rem 0.5rem;
          border-radius: 999px;
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .status-signed {
          background: var(--state-positive-bg, #dcfce7);
          color: var(--state-positive-fg, #166534);
        }
        .status-out-for-signature {
          background: var(--state-partial-bg, #fef3c7);
          color: var(--state-partial-fg, #92400e);
        }
        .status-expired,
        .status-terminated {
          background: var(--state-overdue-bg, #fee2e2);
          color: var(--state-overdue-fg, #991b1b);
        }
      </style>
    </template>

    get statusSlug() {
      return (this.args.model?.status ?? '').replace(/\s+/g, '-');
    }
  };

  static fitted = class Fitted extends Component<typeof Contract> {
    get valueDisplay() {
      return formatMoney(
        this.args.model?.value?.amount,
        this.args.model?.value?.currency?.code,
      );
    }
    get statusSlug() {
      return (this.args.model?.status ?? '').replace(/\s+/g, '-');
    }
    get expiryNote() {
      let days = this.args.model?.daysToExpiry;
      if (!days) return '';
      return days === 1 ? 'ends tomorrow' : `${days} days left`;
    }
    <template>
      <div class='fitted'>
        <div class='top'>
          <ContractIcon class='icon' />
          {{#if @model.status}}
            <span
              class='status status-{{this.statusSlug}}'
            >{{@model.status}}</span>
          {{/if}}
        </div>
        <span class='name'>{{@model.cardTitle}}</span>
        {{#if this.valueDisplay}}
          <span class='figure'>{{this.valueDisplay}}</span>
        {{/if}}
        {{#if @model.account.name}}
          <span class='meta line-account'>{{@model.account.name}}</span>
        {{/if}}
        {{#if this.expiryNote}}
          <span class='meta line-expiry'>{{this.expiryNote}}</span>
        {{/if}}
        {{#if @model.startDate}}
          <span class='meta line-term'>Term
            <@fields.startDate />
            –
            <@fields.endDate /></span>
        {{/if}}
        {{#if @model.deal.name}}
          <span class='meta line-deal'>from {{@model.deal.name}}</span>
        {{/if}}
      </div>
      <style scoped>
        .fitted {
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          padding: 0.625rem 0.75rem;
          display: flex;
          flex-direction: column;
          gap: 0.125rem;
          overflow: hidden;
          color: var(--foreground, #111111);
        }
        .top {
          display: flex;
          align-items: center;
          gap: 0.375rem;
        }
        .icon {
          width: 16px;
          height: 16px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .status {
          margin-left: auto;
          font-size: 0.5625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          padding: 0.0625rem 0.375rem;
          border-radius: 999px;
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
          white-space: nowrap;
        }
        .status-signed {
          background: var(--state-positive-bg, #dcfce7);
          color: var(--state-positive-fg, #166534);
        }
        .status-out-for-signature {
          background: var(--state-partial-bg, #fef3c7);
          color: var(--state-partial-fg, #92400e);
        }
        .status-expired,
        .status-terminated {
          background: var(--state-overdue-bg, #fee2e2);
          color: var(--state-overdue-fg, #991b1b);
        }
        .name {
          font-weight: 600;
          font-size: 0.8125rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .figure {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .meta {
          font-size: 0.6875rem;
          color: var(--muted-foreground, #6b7280);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .line-account,
        .line-expiry,
        .line-term,
        .line-deal {
          display: none;
        }
        /* Each taller tier adds a line rather than just unhiding one, so a
           tile-sized render fills its box instead of trailing off. */
        @container fitted-card (min-height: 170px) {
          .line-account,
          .line-expiry {
            display: block;
          }
          /* Anchors the meta block to the bottom so a tall tile reads as a
             composed card rather than content trailing off at the top. */
          .line-account {
            margin-top: auto;
          }
        }
        @container fitted-card (min-height: 215px) {
          .line-term {
            display: block;
          }
        }
        @container fitted-card (min-width: 300px) and (min-height: 170px) {
          .line-deal {
            display: block;
          }
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Contract> {
    get valueDisplay() {
      return formatMoney(
        this.args.model?.value?.amount,
        this.args.model?.value?.currency?.code,
      );
    }
    get statusSlug() {
      return (this.args.model?.status ?? '').replace(/\s+/g, '-');
    }
    <template>
      <article class='contract-page'>
        <header class='ch'>
          <div class='ch-id'>
            <p class='doc-kind'>Contract</p>
            <h1>{{@model.cardTitle}}</h1>
            {{#if @model.isSigned}}
              <p class='status-line signed'>Signed
                <@fields.signedAt /></p>
            {{else}}
              <p class='status-line'>{{if
                  @model.status
                  @model.status
                  'Not yet signed'
                }}</p>
            {{/if}}
          </div>
          {{#if this.valueDisplay}}
            <p class='ch-value'>{{this.valueDisplay}}</p>
          {{/if}}
        </header>

        <section class='panel'>
          <h2>Agreement</h2>
          <dl>
            {{#if @model.account}}
              <dt>Account</dt>
              <dd><@fields.account @format='embedded' /></dd>
            {{/if}}
            {{#if @model.deal}}
              <dt>Deal</dt>
              <dd><@fields.deal @format='atom' /></dd>
            {{/if}}
            {{#if @model.startDate}}
              <dt>Term begins</dt>
              <dd><@fields.startDate /></dd>
            {{/if}}
            {{#if @model.endDate}}
              <dt>Term ends</dt>
              <dd><@fields.endDate />
                {{#if @model.daysToExpiry}}
                  <span class='hint'>{{@model.daysToExpiry}} days left</span>
                {{/if}}
              </dd>
            {{/if}}
            {{#if @model.documentUrl}}
              <dt>Executed copy</dt>
              <dd><@fields.documentUrl /></dd>
            {{/if}}
          </dl>
        </section>

        {{#if @model.terms}}
          <section class='panel'>
            <h2>Terms</h2>
            <div class='terms'><@fields.terms /></div>
          </section>
        {{/if}}
      </article>
      <style scoped>
        .contract-page {
          max-width: 46rem;
          margin: 0 auto;
          padding: 2rem 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
          color: var(--foreground, #111111);
        }
        .ch {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 1rem;
          border-bottom: 2px solid var(--foreground, #111111);
          padding-bottom: 1.25rem;
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
          font-family: var(--font-heading, inherit);
        }
        .status-line {
          margin: 0.25rem 0 0;
          font-size: 0.8125rem;
          color: var(--muted-foreground, #6b7280);
          text-transform: capitalize;
        }
        .status-line.signed {
          color: var(--state-positive-fg, #166534);
          font-weight: 600;
        }
        .ch-value {
          margin: 0;
          font-size: 1.5rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          font-family: var(--font-heading, inherit);
          white-space: nowrap;
        }
        .panel {
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 8px;
          padding: 1rem 1.125rem;
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
          grid-template-columns: 9rem 1fr;
          gap: 0.5rem 1rem;
          font-size: 0.875rem;
        }
        dt {
          color: var(--muted-foreground, #6b7280);
        }
        dd {
          margin: 0;
        }
        .hint {
          margin-left: 0.5rem;
          font-size: 0.75rem;
          color: var(--muted-foreground, #6b7280);
        }
        .terms {
          font-size: 0.875rem;
          line-height: 1.6;
        }
      </style>
    </template>
  };
}
