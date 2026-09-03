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
import { tracked } from '@glimmer/tracking';
import { eq } from '@cardstack/boxel-ui/helpers';
import { FieldContainer } from '@cardstack/boxel-ui/components';

import { Ticket } from './ticket';
import { Account } from './account';
import { Employee } from './employee';
import { StatePill } from './components/state-pill';
import { EditSectionNav } from './components/edit-section-nav';
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

  // The form for working a case, grouped by how an investigation actually
  // runs: what is it and how bad (identity) → who reported it and who owns
  // it → what we know → how it ended. cardTitle is computed and never
  // appears here. Four sections → the EditSectionNav rail (edit-card
  // Rule 0b). This family asserts no brand token in its other formats, so
  // the accent is the theme's own foreground (boxel-theming §4a).
  static edit = class Edit extends Component<typeof this> {
    // Left section nav: clicking anchors that section to the top of the
    // form's own scroller (the root, per edit-card Rule 1 — never a nested
    // scroller). Scoped through the event's own root so several open edit
    // panels never cross-scroll each other.
    @tracked activeSection = 'identity';

    sections = [
      { id: 'identity', label: 'Case' },
      { id: 'people', label: 'Reporter & Owner' },
      { id: 'description', label: 'Description' },
      { id: 'resolution', label: 'Resolution' },
    ];

    goTo = (id: string, event: Event) => {
      this.activeSection = id;
      let root = (event.currentTarget as HTMLElement).closest('.case-edit');
      root
        ?.querySelector(`[data-sect='${id}']`)
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    };

    <template>
      <div class='case-edit'>
        {{! the container element cannot be restyled by its own query
            (edit-card Rule 1 corollary) — the responsive grid lives on
            this inner wrapper instead }}
        <div class='edit-body'>
          <EditSectionNav
            @sections={{this.sections}}
            @activeId={{this.activeSection}}
            @onSelect={{this.goTo}}
            class='sect-nav'
          />
          <div class='sects'>
            <section
              class='sect {{if (eq this.activeSection "identity") "focused"}}'
              data-sect='identity'
            >
              <h3>Case</h3>
              <FieldContainer @label='Subject' @vertical={{true}}>
                <@fields.subject />
              </FieldContainer>
              <div class='row'>
                <FieldContainer @label='Severity' @vertical={{true}}>
                  <@fields.severity />
                </FieldContainer>
                <FieldContainer @label='Status' @vertical={{true}}>
                  <@fields.status />
                </FieldContainer>
                <FieldContainer @label='Opened on' @vertical={{true}}>
                  <@fields.openedOn />
                </FieldContainer>
              </div>
            </section>

            <section
              class='sect {{if (eq this.activeSection "people") "focused"}}'
              data-sect='people'
            >
              <h3>Reporter &amp; Owner</h3>
              <div class='row two'>
                <FieldContainer @label='Account' @vertical={{true}}>
                  <@fields.account />
                </FieldContainer>
                <FieldContainer @label='Owner' @vertical={{true}}>
                  <@fields.owner />
                </FieldContainer>
              </div>
              <FieldContainer @label='Related tickets' @vertical={{true}}>
                <@fields.relatedTickets />
              </FieldContainer>
            </section>

            <section
              class='sect
                {{if (eq this.activeSection "description") "focused"}}'
              data-sect='description'
            >
              <h3>Description
                <span class='sect-hint'>findings grow as the investigation
                  does — append, don't rewrite</span></h3>
              <FieldContainer @label='Problem statement' @vertical={{true}}>
                <@fields.problemStatement />
              </FieldContainer>
              <FieldContainer @label='Findings' @vertical={{true}}>
                <@fields.findings />
              </FieldContainer>
            </section>

            <section
              class='sect
                {{if (eq this.activeSection "resolution") "focused"}}'
              data-sect='resolution'
            >
              <h3>Resolution
                <span class='sect-hint'>fill in when closing the case</span></h3>
              <FieldContainer @label='Resolution' @vertical={{true}}>
                <@fields.resolution />
              </FieldContainer>
              <div class='row two'>
                <FieldContainer @label='Resolved on' @vertical={{true}}>
                  <@fields.resolvedOn />
                </FieldContainer>
              </div>
            </section>
          </div>
        </div>
      </div>
      <style scoped>
        .case-edit {
          container-type: inline-size;
          container-name: edit;
          height: 100%;
          overflow-y: auto;
          padding: var(--boxel-sp);
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          /* the case family asserts no brand hue of its own — the accent is
             the theme's foreground (boxel-theming §4a: pin nothing) */
          --case-ink: var(--foreground, var(--boxel-dark));
        }
        .edit-body {
          display: grid;
          grid-template-columns: 9.5rem minmax(0, 1fr);
          align-items: start;
          gap: var(--boxel-sp);
        }
        /* the root is the scroller, so sticky pins the nav to its top;
           no ink knobs handed over — the rail's default is already the
           inverted foreground/background pair */
        .sect-nav {
          position: sticky;
          top: 0;
        }
        .sects {
          display: grid;
          gap: var(--boxel-sp);
          min-width: 0;
        }
        .sect {
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--radius, var(--boxel-border-radius));
          padding: var(--boxel-sp);
          display: grid;
          gap: var(--boxel-sp-sm);
          transition:
            outline-color 160ms ease,
            box-shadow 160ms ease;
          outline: 2px solid transparent;
          outline-offset: 2px;
        }
        /* the section the rail points at mirrors the rail's active state */
        .sect.focused {
          outline-color: var(--case-ink);
          box-shadow: 0 0 0 4px
            color-mix(in oklch, var(--case-ink) 12%, transparent);
        }
        h3 {
          margin: 0;
          font-size: 0.8125rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-450));
          display: flex;
          align-items: baseline;
          gap: var(--boxel-sp-xs);
          flex-wrap: wrap;
        }
        .sect-hint {
          text-transform: none;
          letter-spacing: normal;
          font-size: 0.75rem;
          font-weight: 400;
          font-style: italic;
        }
        .row {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: var(--boxel-sp-sm);
          align-items: start;
        }
        .row.two {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        @container edit (width < 640px) {
          .row,
          .row.two {
            grid-template-columns: 1fr;
          }
          /* narrow panel: nav becomes a horizontal chip row above the form */
          .edit-body {
            grid-template-columns: 1fr;
          }
          /* narrow: the rail flips horizontal (consumer's scope attribute
             rides ...attributes onto the component root, so these apply) */
          .sect-nav {
            position: static;
            flex-direction: row;
            flex-wrap: wrap;
          }
          .sect-nav::before {
            display: none;
          }
        }
      </style>
    </template>
  };
}
