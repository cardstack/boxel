import {
  CardDef,
  Component,
  field,
  contains,
  linksTo,
  linksToMany,
  StringField,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import TextAreaField from '@cardstack/base/text-area';
import MarkdownField from '@cardstack/base/markdown';
import enumField from '@cardstack/base/enum';

import { Ticket } from './ticket';
import { Account } from './account';
import { Employee } from './employee';
import { StatePill } from './components/state-pill';
import { stateColor, type StateColor } from './utils/index';

export const CASE_STATUSES = [
  'open',
  'investigating',
  'waiting-on-customer',
  'resolved',
  'closed',
];

export const CASE_STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  investigating: 'Investigating',
  'waiting-on-customer': 'Waiting on Customer',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const CASE_STATUS_COLORS: Record<string, StateColor> = {
  open: stateColor('blue'),
  investigating: stateColor('amber'),
  'waiting-on-customer': stateColor('slate'),
  resolved: stateColor('green'),
  closed: stateColor('slate'),
};

const STATUS_HUES: Record<string, 'blue' | 'amber' | 'slate' | 'green'> = {
  open: 'blue',
  investigating: 'amber',
  'waiting-on-customer': 'slate',
  resolved: 'green',
  closed: 'slate',
};

export const CaseStatusField = enumField(StringField, {
  options: CASE_STATUSES.map((value) => ({
    value,
    label: CASE_STATUS_LABELS[value],
  })),
  displayName: 'Case Status',
});

export const CASE_SEVERITIES = ['low', 'medium', 'high', 'critical'];

export const CaseSeverityField = enumField(StringField, {
  options: CASE_SEVERITIES.map((value) => ({ value, label: value })),
  displayName: 'Case Severity',
});

const SEVERITY_HUES: Record<string, 'slate' | 'amber' | 'red'> = {
  low: 'slate',
  medium: 'slate',
  high: 'amber',
  critical: 'red',
};

// A Case is the longer-running investigation a Ticket is not: one customer
// problem that may span several tickets, days, and owners, with its own
// severity, findings, and resolution record. Tickets stay the unit of
// conversation; the Case is the unit of accountability — it LINKS the
// related tickets rather than replacing them.
export class Case extends CardDef {
  static displayName = 'Case';
  static headerColor = '#8b3a3a';

  @field subject = contains(StringField);
  @field account = linksTo(() => Account);
  @field owner = linksTo(() => Employee);
  @field status = contains(CaseStatusField);
  @field severity = contains(CaseSeverityField);
  @field openedOn = contains(DateField);
  @field resolvedOn = contains(DateField);
  @field relatedTickets = linksToMany(() => Ticket);
  @field problemStatement = contains(TextAreaField);
  @field findings = contains(MarkdownField);
  @field resolution = contains(TextAreaField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Case) {
      return this.subject?.trim()?.length ? this.subject : 'Untitled Case';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    get statusHue() {
      return STATUS_HUES[this.args.model?.status ?? 'open'] ?? 'blue';
    }
    get statusLabel() {
      return CASE_STATUS_LABELS[this.args.model?.status ?? ''] ?? 'Open';
    }
    get severityHue() {
      return SEVERITY_HUES[this.args.model?.severity ?? 'low'] ?? 'slate';
    }
    get openedLabel() {
      let d = this.args.model?.openedOn;
      return d
        ? d.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })
        : '—';
    }
    get ticketCount() {
      try {
        return (this.args.model?.relatedTickets ?? []).filter(Boolean).length;
      } catch {
        return 0;
      }
    }
    <template>
      <article class='case'>
        <header class='head'>
          <div>
            <p class='kicker'>Support Case</p>
            <h1>{{@model.subject}}</h1>
            <p class='sub'>opened {{this.openedLabel}}
              {{#if @model.account}}· <@fields.account @format='atom' />{{/if}}
              {{#if @model.owner}}· owned by
                <@fields.owner @format='atom' />{{/if}}</p>
          </div>
          <div class='head-right'>
            <StatePill
              @label={{this.statusLabel}}
              @hue={{this.statusHue}}
              @emphatic={{true}}
            />
            <StatePill
              @label='{{@model.severity}} severity'
              @hue={{this.severityHue}}
              @dot={{true}}
            />
          </div>
        </header>

        <section class='panel'>
          <h2>Problem</h2>
          <p class='body-text'>{{@model.problemStatement}}</p>
        </section>

        <section class='panel'>
          <h2>Related Tickets ({{this.ticketCount}})</h2>
          <div class='tickets'>
            {{#each @fields.relatedTickets as |T|}}
              <T @format='embedded' />
            {{else}}
              <p class='empty'>No tickets linked yet — a case usually starts
                from at least one.</p>
            {{/each}}
          </div>
        </section>

        {{#if @model.findings}}
          <section class='panel'>
            <h2>Findings</h2>
            <@fields.findings />
          </section>
        {{/if}}

        {{#if @model.resolution}}
          <section class='panel resolved-panel'>
            <h2>Resolution</h2>
            <p class='body-text'>{{@model.resolution}}</p>
          </section>
        {{/if}}
      </article>
      <style scoped>
        .case {
          container-type: inline-size;
          padding: var(--boxel-sp-lg);
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, inherit);
          display: grid;
          gap: var(--boxel-sp);
        }
        .head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: var(--boxel-sp);
          border-bottom: 1px solid var(--border, var(--boxel-200));
          padding-bottom: var(--boxel-sp);
        }
        .kicker {
          margin: 0;
          font-size: 0.6875rem;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-450));
        }
        h1 {
          margin: var(--boxel-sp-5xs) 0;
          font-family: var(--font-heading, inherit);
          font-size: 1.5rem;
          line-height: 1.25;
        }
        .sub {
          margin: 0;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .head-right {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: var(--boxel-sp-xxs);
        }
        .panel {
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--radius, var(--boxel-border-radius));
          padding: var(--boxel-sp);
          background: var(--card, transparent);
        }
        .resolved-panel {
          border-color: var(--state-green-fg, #15803d);
        }
        h2 {
          margin: 0 0 var(--boxel-sp-xs);
          font-size: 0.8125rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .body-text {
          margin: 0;
          white-space: pre-wrap;
          font-size: 0.875rem;
        }
        .tickets {
          display: grid;
          gap: var(--boxel-sp-xs);
        }
        .empty {
          margin: 0;
          color: var(--muted-foreground, var(--boxel-450));
          font-style: italic;
          font-size: 0.875rem;
        }
        @container (max-width: 560px) {
          .head {
            flex-direction: column;
          }
          .head-right {
            flex-direction: row;
            align-items: flex-start;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get statusHue() {
      return STATUS_HUES[this.args.model?.status ?? 'open'] ?? 'blue';
    }
    get statusLabel() {
      return CASE_STATUS_LABELS[this.args.model?.status ?? ''] ?? 'Open';
    }
    get severityHue() {
      return SEVERITY_HUES[this.args.model?.severity ?? 'low'] ?? 'slate';
    }
    <template>
      <div class='row'>
        <span class='name'>{{@model.subject}}</span>
        <StatePill
          @label={{@model.severity}}
          @hue={{this.severityHue}}
          @dot={{true}}
        />
        <StatePill @label={{this.statusLabel}} @hue={{this.statusHue}} />
      </div>
      <style scoped>
        .row {
          display: grid;
          grid-template-columns: 1fr auto auto;
          gap: var(--boxel-sp-sm);
          align-items: center;
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        }
        .name {
          font-weight: 600;
          font-size: 0.9375rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='atom'>{{@model.subject}}</span>
      <style scoped>
        .atom {
          font-size: 0.8125rem;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    get statusLabel() {
      return CASE_STATUS_LABELS[this.args.model?.status ?? ''] ?? 'Open';
    }
    <template>
      <div class='fit'>
        <span class='fit-name'>{{@model.subject}}</span>
        <span class='fit-sub'>{{@model.severity}} · {{this.statusLabel}}</span>
      </div>
      <style scoped>
        .fit {
          height: 100%;
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-5xs);
          padding: var(--boxel-sp-xs);
          overflow: hidden;
        }
        .fit-name {
          font-weight: 600;
          font-size: 0.9375rem;
          line-height: 1.2;
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }
        .fit-sub {
          font-size: 0.75rem;
          color: var(--muted-foreground, var(--boxel-450));
        }
        @container fitted-card (height <= 65px) {
          .fit {
            flex-direction: row;
            align-items: center;
            gap: var(--boxel-sp-xs);
          }
          .fit-name {
            -webkit-line-clamp: 1;
          }
        }
      </style>
    </template>
  };
}
