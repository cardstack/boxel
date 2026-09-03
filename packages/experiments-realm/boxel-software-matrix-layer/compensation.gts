import {
  CardDef,
  Component,
  field,
  contains,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import TextAreaField from '@cardstack/base/text-area';
import enumField from '@cardstack/base/enum';
import { tracked } from '@glimmer/tracking';
import { FieldContainer } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import { Employee } from './employee';
import { CompensationField } from './compensation-field';
import { StatePill } from './components/state-pill';
import { EditSectionNav } from './components/edit-section-nav';

export const COMP_CHANGE_REASONS = [
  'new-hire',
  'merit',
  'promotion',
  'market-adjustment',
  'role-change',
];

export const COMP_CHANGE_REASON_LABELS: Record<string, string> = {
  'new-hire': 'New hire',
  merit: 'Merit increase',
  promotion: 'Promotion',
  'market-adjustment': 'Market adjustment',
  'role-change': 'Role change',
};

export const CompChangeReasonField = enumField(StringField, {
  options: COMP_CHANGE_REASONS.map((value) => ({
    value,
    label: COMP_CHANGE_REASON_LABELS[value],
  })),
  displayName: 'Compensation Change Reason',
});

// One dated compensation decision for one employee — the record that makes
// pay history auditable. The package itself is the reusable
// CompensationField; this card adds who, when, why, and who approved.
// Records are append-only in spirit: a correction is a new record, so the
// history never rewrites itself.
export class Compensation extends CardDef {
  static displayName = 'Compensation';
  static headerColor = '#2f4f4f';

  @field employee = linksTo(() => Employee);
  @field effectiveDate = contains(DateField);
  @field package = contains(CompensationField);
  @field reason = contains(CompChangeReasonField);
  @field approvedBy = linksTo(() => Employee);
  @field notes = contains(TextAreaField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Compensation) {
      let who = this.employee?.name?.trim();
      let when = this.effectiveDate
        ? this.effectiveDate.toLocaleDateString('en-US', {
            month: 'short',
            year: 'numeric',
          })
        : '';
      return [who, when].filter(Boolean).join(' · ') || 'Compensation Record';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    get reasonLabel() {
      return COMP_CHANGE_REASON_LABELS[this.args.model?.reason ?? ''] ?? '—';
    }
    get effectiveLabel() {
      let d = this.args.model?.effectiveDate;
      return d
        ? d.toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          })
        : '—';
    }
    <template>
      <article class='comp-rec'>
        <header class='head'>
          <div>
            <p class='kicker'>Compensation Record</p>
            <h1>{{@model.cardTitle}}</h1>
            <p class='sub'>effective {{this.effectiveLabel}}</p>
          </div>
          <StatePill @label={{this.reasonLabel}} @hue='blue' @emphatic={{true}} />
        </header>
        <section class='panel'>
          <h2>Package</h2>
          <@fields.package @format='embedded' />
        </section>
        <div class='grid'>
          <section class='panel'>
            <h2>Employee</h2>
            {{#if @model.employee}}<@fields.employee @format='atom' />{{else}}
              <p class='empty'>No employee linked.</p>{{/if}}
          </section>
          <section class='panel'>
            <h2>Approved By</h2>
            {{#if @model.approvedBy}}<@fields.approvedBy @format='atom' />{{else}}
              <p class='empty'>Unapproved draft.</p>{{/if}}
          </section>
        </div>
        {{#if @model.notes}}
          <section class='panel'>
            <h2>Notes</h2>
            <p class='notes'>{{@model.notes}}</p>
          </section>
        {{/if}}
      </article>
      <style scoped>
        .comp-rec {
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
        }
        .sub {
          margin: 0;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: var(--boxel-sp);
        }
        .panel {
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--radius, var(--boxel-border-radius));
          padding: var(--boxel-sp);
          background: var(--card, transparent);
        }
        h2 {
          margin: 0 0 var(--boxel-sp-xs);
          font-size: 0.8125rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .empty {
          margin: 0;
          color: var(--muted-foreground, var(--boxel-450));
          font-style: italic;
          font-size: 0.875rem;
        }
        .notes {
          margin: 0;
          white-space: pre-wrap;
          font-size: 0.875rem;
        }
        @container (max-width: 480px) {
          .grid {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get reasonLabel() {
      return COMP_CHANGE_REASON_LABELS[this.args.model?.reason ?? ''] ?? '—';
    }
    <template>
      <div class='row'>
        <span class='name'>{{@model.cardTitle}}</span>
        <span class='pkg'>{{@model.package.summary}}</span>
        <StatePill @label={{this.reasonLabel}} @hue='blue' />
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
        }
        .pkg {
          font-size: 0.8125rem;
          font-variant-numeric: tabular-nums;
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='atom'>{{@model.cardTitle}} · {{@model.package.summary}}</span>
      <style scoped>
        .atom {
          font-size: 0.8125rem;
          font-variant-numeric: tabular-nums;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <div class='fit'>
        <span class='fit-name'>{{@model.cardTitle}}</span>
        <span class='fit-pkg'>{{@model.package.summary}}</span>
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
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .fit-pkg {
          font-size: 0.75rem;
          color: var(--muted-foreground, var(--boxel-450));
          font-variant-numeric: tabular-nums;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        @container fitted-card (height <= 65px) {
          .fit {
            flex-direction: row;
            align-items: center;
            gap: var(--boxel-sp-xs);
          }
        }
      </style>
    </template>
  };

  // The form for recording one pay decision, grouped the way the decision is
  // made: who/when/why first (the audit facts), then the package itself and
  // its sign-off. cardTitle is computed and never appears here. Two
  // sections tracked by a left anchor rail (EditSectionNav).
  static edit = class Edit extends Component<typeof this> {
    @tracked activeSection = 'decision';

    sections = [
      { id: 'decision', label: 'Decision' },
      { id: 'package-approval', label: 'Package & Approval' },
    ];

    goTo = (id: string, event: Event) => {
      this.activeSection = id;
      let root = (event.currentTarget as HTMLElement).closest('.comp-edit');
      root
        ?.querySelector(`[data-sect='${id}']`)
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    };

    <template>
      <div class='comp-edit'>
        {{! responsive rows live on this inner wrapper — the container
            element cannot be restyled by its own query (edit-card Rule 1) }}
        <div class='edit-body'>
          <EditSectionNav
            @sections={{this.sections}}
            @activeId={{this.activeSection}}
            @onSelect={{this.goTo}}
            class='sect-nav'
          />
          <div class='sects'>
          <section
            class='sect {{if (eq this.activeSection "decision") "focused"}}'
            data-sect='decision'
          >
            <h3>Decision
              <span class='sect-hint'>a correction is a new record — history
                never rewrites itself</span></h3>
            <div class='row'>
              <FieldContainer @label='Employee' @vertical={{true}}>
                <@fields.employee />
              </FieldContainer>
              <FieldContainer @label='Effective date' @vertical={{true}}>
                <@fields.effectiveDate />
              </FieldContainer>
              <FieldContainer @label='Reason' @vertical={{true}}>
                <@fields.reason />
              </FieldContainer>
            </div>
          </section>

          <section
            class='sect
              {{if (eq this.activeSection "package-approval") "focused"}}'
            data-sect='package-approval'
          >
            <h3>Package &amp; Approval</h3>
            <FieldContainer
              @label='Package (salary, bonus, equity)'
              @vertical={{true}}
            >
              <@fields.package />
            </FieldContainer>
            <FieldContainer @label='Approved by' @vertical={{true}}>
              <@fields.approvedBy />
            </FieldContainer>
            <FieldContainer @label='Notes' @vertical={{true}}>
              <@fields.notes />
            </FieldContainer>
          </section>
          </div>
        </div>
      </div>
      <style scoped>
        .comp-edit {
          container-type: inline-size;
          container-name: edit;
          height: 100%;
          overflow-y: auto;
          padding: var(--boxel-sp);
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
        }
        .edit-body {
          display: grid;
          grid-template-columns: 9.5rem minmax(0, 1fr);
          align-items: start;
          gap: var(--boxel-sp);
        }
        /* the root is the scroller, so sticky pins the nav to its top */
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
          outline-color: var(--foreground, var(--boxel-dark));
          box-shadow: 0 0 0 4px
            color-mix(in oklch, var(--foreground, var(--boxel-dark)) 10%, transparent);
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
        @container edit (width < 640px) {
          .row {
            grid-template-columns: 1fr;
          }
          .edit-body {
            grid-template-columns: 1fr;
          }
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
