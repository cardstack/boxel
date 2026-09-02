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

import { Contract } from './contract';
import { LegalEntity } from './legal-entity';
import { StatePill } from './components/state-pill';

export const WAIVER_SCOPES = ['one-time', 'ongoing'];

export const WaiverScopeField = enumField(StringField, {
  options: WAIVER_SCOPES.map((value) => ({ value, label: value })),
  displayName: 'Waiver Scope',
});

// A waiver EXCUSES one obligation without changing the contract's text —
// "we will not enforce the late fee for the March invoice." The scope
// distinction is the legally dangerous part and is therefore a first-class
// field: a one-time waiver expires with its occasion; an ongoing one can be
// read as abandoning the right, which is why real waivers name an expiry.
// Contrast with Amendment (changes terms) and Addendum (adds terms).
export class Waiver extends CardDef {
  static displayName = 'Waiver';
  static headerColor = '#41337a';

  @field contract = linksTo(() => Contract);
  @field grantedTo = linksTo(() => LegalEntity);
  @field provisionWaived = contains(StringField, {
    description: 'Which section/obligation is being waived',
  });
  @field scope = contains(WaiverScopeField);
  @field effectiveDate = contains(DateField);
  @field expiresOn = contains(DateField);
  @field reason = contains(TextAreaField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Waiver) {
      return this.provisionWaived?.trim()?.length
        ? `Waiver — ${this.provisionWaived}`
        : 'Waiver';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    get windowLabel() {
      let from = this.args.model?.effectiveDate;
      let to = this.args.model?.expiresOn;
      let fmt = (d: Date) =>
        d.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });
      if (from && to) {
        return `${fmt(from)} → ${fmt(to)}`;
      }
      if (from) {
        return `from ${fmt(from)}`;
      }
      return '—';
    }
    <template>
      <article class='doc'>
        <header class='head'>
          <div>
            <p class='kicker'>Waiver</p>
            <h1>{{@model.cardTitle}}</h1>
            <p class='sub'>{{this.windowLabel}}</p>
          </div>
          <StatePill
            @label='{{@model.scope}}'
            @hue={{if (isOngoing @model.scope) 'amber' 'slate'}}
            @emphatic={{true}}
          />
        </header>
        <div class='grid'>
          {{#if @model.contract}}
            <section class='panel'>
              <h2>Under Contract</h2>
              <@fields.contract @format='atom' />
            </section>
          {{/if}}
          {{#if @model.grantedTo}}
            <section class='panel'>
              <h2>Granted To</h2>
              <@fields.grantedTo @format='atom' />
            </section>
          {{/if}}
        </div>
        {{#if @model.reason}}
          <section class='panel'>
            <h2>Reason</h2>
            <p class='reason'>{{@model.reason}}</p>
          </section>
        {{/if}}
        {{#if (isOngoing @model.scope)}}
          <p class='caution'>⚠ Ongoing waiver — without an expiry this can
            read as abandoning the right entirely.</p>
        {{/if}}
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
        .reason {
          margin: 0;
          font-size: 0.875rem;
          white-space: pre-wrap;
        }
        .caution {
          margin: 0;
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          border-radius: var(--radius, var(--boxel-border-radius));
          background: color-mix(
            in oklch,
            var(--state-amber-fg, #b45309) 10%,
            transparent
          );
          color: var(--state-amber-fg, #b45309);
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
    <template>
      <div class='row'>
        <span class='name'>{{@model.provisionWaived}}</span>
        <StatePill
          @label='{{@model.scope}}'
          @hue={{if (isOngoing @model.scope) 'amber' 'slate'}}
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
      <span class='atom'>{{@model.cardTitle}}</span>
      <style scoped>
        .atom {
          font-size: 0.8125rem;
        }
      </style>
    </template>
  };
}

function isOngoing(scope?: string | null) {
  return scope === 'ongoing';
}
