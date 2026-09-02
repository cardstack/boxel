import {
  CardDef,
  Component,
  field,
  contains,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import NumberField from '@cardstack/base/number';
import TextAreaField from '@cardstack/base/text-area';
import MarkdownField from '@cardstack/base/markdown';

import { Contract } from './contract';
import { ModDocStatusField } from './addendum';
import { StatePill } from './components/state-pill';

// An amendment CHANGES existing terms of an executed contract — a new
// price, a moved end date, a rewritten section. Numbered per contract so
// "as amended by Amendment No. 2" resolves unambiguously; the sibling
// ContractVersion card snapshots the contract's state at each execution
// (AmendContractCommand writes both). Contrast with Addendum (adds terms)
// and Waiver (excuses one obligation without changing text).
export class Amendment extends CardDef {
  static displayName = 'Amendment';
  static headerColor = '#41337a';

  @field contract = linksTo(() => Contract);
  @field amendmentNumber = contains(NumberField);
  @field effectiveDate = contains(DateField);
  @field changesSummary = contains(TextAreaField, {
    description: 'One paragraph a reviewer reads before the redline',
  });
  @field changedTerms = contains(MarkdownField, {
    description: 'The amended text itself',
  });
  @field status = contains(ModDocStatusField);
  @field executedOn = contains(DateField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Amendment) {
      let n = this.amendmentNumber;
      let base = n != null ? `Amendment No. ${n}` : 'Amendment';
      let contractName = this.contract?.title?.trim();
      return contractName ? `${base} — ${contractName}` : base;
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
    get executed() {
      return this.args.model?.status === 'executed';
    }
    <template>
      <article class='doc'>
        <header class='head'>
          <div>
            <p class='kicker'>Amendment</p>
            <h1>{{@model.cardTitle}}</h1>
            <p class='sub'>effective {{this.effectiveLabel}}</p>
          </div>
          <StatePill
            @label={{if this.executed 'EXECUTED' 'DRAFT'}}
            @hue={{if this.executed 'green' 'slate'}}
            @emphatic={{true}}
          />
        </header>
        {{#if @model.contract}}
          <section class='panel'>
            <h2>Amends Contract</h2>
            <@fields.contract @format='atom' />
          </section>
        {{/if}}
        {{#if @model.changesSummary}}
          <section class='panel'>
            <h2>Summary of Changes</h2>
            <p class='summary'>{{@model.changesSummary}}</p>
          </section>
        {{/if}}
        <section class='panel'>
          <h2>Amended Terms</h2>
          {{#if @model.changedTerms}}
            <@fields.changedTerms />
          {{else}}
            <p class='empty'>No amended text drafted yet.</p>
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
        .summary,
        .empty {
          margin: 0;
          font-size: 0.875rem;
          white-space: pre-wrap;
        }
        .empty {
          font-style: italic;
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get executed() {
      return this.args.model?.status === 'executed';
    }
    <template>
      <div class='row'>
        <span class='name'>{{@model.cardTitle}}</span>
        <StatePill
          @label={{if this.executed 'executed' 'draft'}}
          @hue={{if this.executed 'green' 'slate'}}
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
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='atom'>{{@model.cardTitle}}</span>
      <style scoped>
        .atom {
          font-size: 0.8125rem;
        }
      </style>
    </template>
  };
}
