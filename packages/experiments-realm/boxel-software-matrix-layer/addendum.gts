import {
  CardDef,
  Component,
  field,
  contains,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import MarkdownField from '@cardstack/base/markdown';
import enumField from '@cardstack/base/enum';

import { Contract } from './contract';
import { StatePill } from './components/state-pill';

export const MOD_DOC_STATUSES = ['draft', 'executed'];

export const ModDocStatusField = enumField(StringField, {
  options: MOD_DOC_STATUSES.map((value) => ({ value, label: value })),
  displayName: 'Modification Document Status',
});

// An addendum ADDS terms to an executed contract without altering what was
// already agreed — new scope, an extra schedule, an additional service.
// Contrast with Amendment (changes existing terms) and Waiver (excuses one
// obligation without changing the text). Keeping the three as distinct
// cards is the domain distinction itself.
export class Addendum extends CardDef {
  static displayName = 'Addendum';
  static headerColor = '#41337a';

  @field contract = linksTo(() => Contract);
  @field name = contains(StringField);
  @field effectiveDate = contains(DateField);
  @field addedTerms = contains(MarkdownField);
  @field status = contains(ModDocStatusField);
  @field executedOn = contains(DateField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Addendum) {
      return this.name?.trim()?.length ? this.name : 'Untitled Addendum';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    get effectiveLabel() {
      let d = this.args.model?.effectiveDate;
      return d
        ? d.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })
        : '—';
    }
    <template>
      <article class='doc'>
        <header class='head'>
          <div>
            <p class='kicker'>Addendum</p>
            <h1>{{@model.name}}</h1>
            <p class='sub'>effective {{this.effectiveLabel}}</p>
          </div>
          <StatePill
            @label={{if (eqStr @model.status 'executed') 'EXECUTED' 'DRAFT'}}
            @hue={{if (eqStr @model.status 'executed') 'green' 'slate'}}
            @emphatic={{true}}
          />
        </header>
        {{#if @model.contract}}
          <section class='panel'>
            <h2>Supplements Contract</h2>
            <@fields.contract @format='atom' />
          </section>
        {{/if}}
        <section class='panel'>
          <h2>Added Terms</h2>
          {{#if @model.addedTerms}}
            <@fields.addedTerms />
          {{else}}
            <p class='empty'>No terms drafted yet.</p>
          {{/if}}
        </section>
      </article>
      <style scoped>
        .doc {
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
          font-style: italic;
          color: var(--muted-foreground, var(--boxel-450));
          font-size: 0.875rem;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='row'>
        <span class='name'>{{@model.name}}</span>
        <StatePill
          @label={{if (eqStr @model.status 'executed') 'executed' 'draft'}}
          @hue={{if (eqStr @model.status 'executed') 'green' 'slate'}}
          @dot={{true}}
        />
      </div>
      <style scoped>
        .row {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: var(--boxel-sp-sm);
          align-items: center;
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        }
        .name {
          font-weight: 600;
          font-size: 0.9375rem;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='atom'>{{@model.name}}</span>
      <style scoped>
        .atom {
          font-size: 0.8125rem;
        }
      </style>
    </template>
  };
}

function eqStr(a?: string | null, b?: string | null) {
  return a === b;
}
