import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import EmailField from 'https://cardstack.com/base/email';
import PhoneNumberField from 'https://cardstack.com/base/phone-number';
import enumField from 'https://cardstack.com/base/enum';
import TargetIcon from '@cardstack/boxel-icons/target';
import { ProgressBar } from '@cardstack/boxel-ui/components';
import { Campaign } from './campaign';

const LeadStatusField = enumField(StringField, {
  options: ['new', 'contacted', 'qualified', 'converted', 'disqualified'],
  displayName: 'Lead Status',
});

const LeadSourceField = enumField(StringField, {
  options: [
    'website',
    'referral',
    'webinar',
    'ad',
    'event',
    'cold outreach',
    'other',
  ],
  displayName: 'Lead Source',
});

export class Lead extends CardDef {
  static displayName = 'Lead';
  static icon = TargetIcon;

  @field name = contains(StringField);
  @field company = contains(StringField);
  @field email = contains(EmailField);
  @field phone = contains(PhoneNumberField);
  @field source = contains(LeadSourceField);
  @field status = contains(LeadStatusField);
  @field score = contains(NumberField);
  // Which specific activity produced this lead. `source` names the channel;
  // this names the campaign. The lead points at the campaign, never the
  // reverse — a campaign's lead count is a query, not a stored list.
  @field campaign = linksTo(Campaign);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Lead) {
      return this.name?.trim()?.length
        ? this.name
        : `Untitled ${this.constructor.displayName}`;
    },
  });

  static atom = class Atom extends Component<typeof Lead> {
    <template>
      <span class='lead-atom'>
        <TargetIcon class='la-icon' />
        <span class='la-name'>{{if @model.name @model.name 'Unnamed Lead'}}</span>
      </span>
      <style scoped>
        .lead-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, #111111);
        }
        .la-icon {
          width: 14px;
          height: 14px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .la-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Lead> {
    <template>
      <div class='lead-row'>
        <TargetIcon class='icon' />
        <div class='info'>
          <span class='name'>{{if @model.name @model.name 'Unnamed'}}</span>
          {{#if @model.company}}
            <span class='meta'>{{@model.company}}</span>
          {{/if}}
        </div>
        <span class='score-block'>
          {{#if @model.score}}
            <span class='score'>{{@model.score}}</span>
            <span class='score-caption'>score</span>
          {{else}}
            <span class='score score-none'>—</span>
          {{/if}}
        </span>
        <span class='status-col'>
          {{#if @model.status}}
            <span class='status status-{{@model.status}}'>{{@model.status}}</span>
          {{/if}}
        </span>
      </div>
      <style scoped>
        .lead-row {
          display: flex;
          align-items: center;
          gap: 0.75rem;
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
          gap: 0.125rem;
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
        .score-block {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.0625rem;
          width: 3.25rem;
          flex-shrink: 0;
        }
        .score-none {
          color: var(--muted-foreground, #6b7280);
        }
        .status-col {
          display: flex;
          justify-content: center;
          width: 8.5rem;
          flex-shrink: 0;
        }
        .score {
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          font-size: 0.8125rem;
          line-height: 1;
        }
        .score-caption {
          font-size: 0.5625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--muted-foreground, #6b7280);
        }
        .status {
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 0.125rem 0.5rem;
          border-radius: 999px;
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
          white-space: nowrap;
        }
        .status-new {
          background: var(--lead-new-bg, #dbeafe);
          color: var(--lead-new-fg, #1e40af);
        }
        .status-qualified {
          background: var(--lead-qualified-bg, #dcfce7);
          color: var(--lead-qualified-fg, #166534);
        }
        .status-converted {
          background: var(--lead-converted-bg, #dcfce7);
          color: var(--lead-converted-fg, #166534);
        }
        .status-disqualified {
          background: var(--lead-disqualified-bg, #fee2e2);
          color: var(--lead-disqualified-fg, #991b1b);
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Lead> {
    get name() {
      return this.args.model?.name?.trim() || 'Unnamed Lead';
    }
    <template>
      <div class='fitted'>
        <div class='top'>
          <TargetIcon class='icon' />
          {{#if @model.status}}
            <span class='status status-{{@model.status}}'>{{@model.status}}</span>
          {{/if}}
        </div>
        <span class='name'>{{this.name}}</span>
        {{#if @model.company}}
          <span class='meta line-company'>{{@model.company}}</span>
        {{/if}}
        {{#if @model.score}}
          <span class='meta line-score'>Score {{@model.score}}</span>
        {{/if}}
        {{#if @model.source}}
          <span class='meta line-source'>via {{@model.source}}</span>
        {{/if}}
      </div>
      <style scoped>
        .fitted {
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 0.25rem;
          width: 100%;
          height: 100%;
          padding: 0.625rem 0.75rem;
          box-sizing: border-box;
          overflow: hidden;
          color: var(--foreground, #111111);
        }
        .top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.5rem;
        }
        .icon {
          width: 18px;
          height: 18px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
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
        .status {
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 0.125rem 0.4375rem;
          border-radius: 999px;
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
          white-space: nowrap;
        }
        .status-new {
          background: var(--lead-new-bg, #dbeafe);
          color: var(--lead-new-fg, #1e40af);
        }
        .status-qualified {
          background: var(--lead-qualified-bg, #dcfce7);
          color: var(--lead-qualified-fg, #166534);
        }
        .status-converted {
          background: var(--lead-converted-bg, #dcfce7);
          color: var(--lead-converted-fg, #166534);
        }
        .status-disqualified {
          background: var(--lead-disqualified-bg, #fee2e2);
          color: var(--lead-disqualified-fg, #991b1b);
        }
        .line-company,
        .line-score,
        .line-source {
          display: none;
        }
        @container fitted-card (min-height: 65px) {
          .line-company {
            display: block;
          }
        }
        @container fitted-card (min-height: 170px) {
          .line-score {
            display: block;
          }
        }
        @container fitted-card (min-width: 400px) and (min-height: 170px) {
          .line-source {
            display: block;
          }
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Lead> {
    get name() {
      return this.args.model?.name?.trim() || 'Unnamed Lead';
    }
    get clampedScore() {
      return Math.max(0, Math.min(100, this.args.model?.score ?? 0));
    }
    <template>
      <article class='lead-page'>
        <header class='lh'>
          <div class='lh-id'>
            <p class='doc-kind'>Lead</p>
            <h1>{{this.name}}</h1>
            {{#if @model.company}}
              <p class='company'>{{@model.company}}</p>
            {{/if}}
          </div>
          {{#if @model.status}}
            <span class='status status-{{@model.status}}'>{{@model.status}}</span>
          {{/if}}
        </header>
        {{#if @model.score}}
          <section class='score-panel'>
            <span class='score-value'>{{@model.score}}</span>
            <span class='score-label'>lead score</span>
            <div class='score-bar'>
              <ProgressBar @value={{this.clampedScore}} @max={{100}} />
            </div>
          </section>
        {{/if}}
        <section class='panel'>
          <h2>Details</h2>
          <dl>
            {{#if @model.email}}
              <dt>Email</dt>
              <dd><@fields.email /></dd>
            {{/if}}
            {{#if @model.phone}}
              <dt>Phone</dt>
              <dd><@fields.phone /></dd>
            {{/if}}
            {{#if @model.source}}
              <dt>Source</dt>
              <dd class='cap'>{{@model.source}}</dd>
            {{/if}}
          </dl>
        </section>
      </article>
      <style scoped>
        .lead-page {
          max-width: 40rem;
          margin: 0 auto;
          padding: 2rem 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }
        .lh {
          display: flex;
          align-items: flex-end;
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
          line-height: 1.1;
          font-family: var(--font-heading, inherit);
        }
        .company {
          margin: 0.25rem 0 0;
          font-size: 0.875rem;
          color: var(--muted-foreground, #6b7280);
        }
        .status {
          font-size: 0.6875rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 0.1875rem 0.625rem;
          border-radius: 999px;
          background: var(--muted, #f3f4f6);
          color: var(--muted-foreground, #6b7280);
          margin-bottom: 0.25rem;
          white-space: nowrap;
        }
        .status-new {
          background: var(--lead-new-bg, #dbeafe);
          color: var(--lead-new-fg, #1e40af);
        }
        .status-qualified {
          background: var(--lead-qualified-bg, #dcfce7);
          color: var(--lead-qualified-fg, #166534);
        }
        .status-converted {
          background: var(--lead-converted-bg, #dcfce7);
          color: var(--lead-converted-fg, #166534);
        }
        .status-disqualified {
          background: var(--lead-disqualified-bg, #fee2e2);
          color: var(--lead-disqualified-fg, #991b1b);
        }
        .score-panel {
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.75rem;
          padding: 1rem 1.25rem;
          background: var(--card, #ffffff);
          display: grid;
          grid-template-columns: auto 1fr;
          align-items: baseline;
          gap: 0.25rem 0.75rem;
        }
        .score-value {
          font-size: 2rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          line-height: 1;
        }
        .score-label {
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--muted-foreground, #6b7280);
        }
        .score-bar {
          grid-column: 1 / -1;
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
        .cap {
          text-transform: capitalize;
        }
      </style>
    </template>
  };
}
