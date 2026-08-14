import {
  CardDef,
  FieldDef,
  Component,
  field,
  contains,
  containsMany,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import BooleanField from '@cardstack/base/boolean';
import enumField from '@cardstack/base/enum';
import ShieldCheckIcon from '@cardstack/boxel-icons/shield-check';

import { Schedule } from './schedule';
import { TicketPriorityField, ticketPriorityFactor } from './ticket-taxonomy';
import { formatMinutes, ALWAYS_ON, type BusinessSchedule } from './utils/sla';

export const CONDITION_OPERATORS = ['is', 'is not', 'contains'] as const;

// `customerTier` reads as a field name; "Customer tier" reads as a sentence.
// The condition title is the only place an administrator gets to check that a
// policy still matches what they meant, so it is written in their words.
function humanize(attribute: string): string {
  let spaced = attribute.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const OperatorField = enumField(StringField, {
  displayName: 'Operator',
  options: CONDITION_OPERATORS as unknown as string[],
});

/**
 * One clause of "when does this policy apply".
 *
 * Stored as three readable parts rather than an expression string, so the
 * isolated view can render "Customer tier is VIP" as a chip an administrator
 * can check at a glance. A policy nobody can verify by looking at it is a
 * policy that quietly stops matching.
 */
export class PolicyConditionField extends FieldDef {
  static displayName = 'Condition';

  @field attribute = contains(StringField, {
    description: 'e.g. customerTier, priority, categoryName, channel',
  });
  @field operator = contains(OperatorField);
  @field value = contains(StringField);

  @field title = contains(StringField, {
    computeVia: function (this: PolicyConditionField) {
      if (!this.attribute) {
        return 'Any ticket';
      }
      return `${humanize(this.attribute)} ${this.operator ?? 'is'} ${this.value ?? '—'}`;
    },
  });

  matches(subject: Record<string, unknown>): boolean {
    if (!this.attribute) {
      return true;
    }
    let actual = String(subject[this.attribute] ?? '').toLowerCase();
    let expected = String(this.value ?? '').toLowerCase();
    switch (this.operator) {
      case 'is not':
        return actual !== expected;
      case 'contains':
        return actual.includes(expected);
      default:
        return actual === expected;
    }
  }

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <span class='cond'>{{@model.title}}</span>
      <style scoped>
        .cond {
          display: inline-flex;
          padding: 0.1em 0.5em;
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: 999px;
          background: var(--muted, var(--boxel-100));
          font-family: var(--font-sans, var(--boxel-font-family));
          font-size: var(--boxel-font-size-xs);
          white-space: nowrap;
        }
      </style>
    </template>
  };
}

/**
 * The committed time for one metric, before priority scaling.
 *
 * A policy states ONE target per metric and lets each priority's factor scale
 * it — a P1 gets a quarter, a P4 gets double. Stating all four explicitly is
 * how a policy ends up with a P3 that resolves faster than a P2 after somebody
 * edits one row.
 */
export class SlaTargetField extends FieldDef {
  static displayName = 'SLA Target';

  @field metric = contains(
    enumField(StringField, {
      displayName: 'Metric',
      options: ['First response', 'Next response', 'Resolution'],
    }),
  );
  @field baseMinutes = contains(NumberField, {
    description: 'Target for a P3 ticket, in minutes. Other priorities scale.',
  });

  @field title = contains(StringField, {
    computeVia: function (this: SlaTargetField) {
      return `${this.metric ?? 'Target'} — ${
        typeof this.baseMinutes === 'number'
          ? formatMinutes(this.baseMinutes)
          : '—'
      }`;
    },
  });

  minutesFor(priority?: string | null): number | undefined {
    if (typeof this.baseMinutes !== 'number') {
      return undefined;
    }
    return Math.round(this.baseMinutes * ticketPriorityFactor(priority));
  }

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <span class='tgt'>
        <span class='tgt-metric'>{{@model.metric}}</span>
        <span class='tgt-value'>{{@model.title}}</span>
      </span>
      <style scoped>
        .tgt {
          display: inline-flex;
          gap: var(--boxel-sp-xs);
          font-size: var(--boxel-font-size-xs);
          font-family: var(--font-sans, var(--boxel-font-family));
        }
        .tgt-metric {
          color: var(--muted-foreground, var(--boxel-450));
        }
        .tgt-value {
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
      </style>
    </template>
  };
}

interface MatrixRow {
  priority: string;
  cells: string[];
}

/**
 * A set of commitments and the conditions under which they apply.
 *
 * The Domain Layers row for SLA Policy has nothing behind it, and neither do
 * SLA Window or Compute SLA Deadline — this card plus `SlaTimerField` plus
 * `utils/sla` are the first implementation of all three.
 */
export class SlaPolicy extends CardDef {
  static displayName = 'SLA Policy';
  static icon = ShieldCheckIcon;

  @field name = contains(StringField);
  @field conditions = containsMany(PolicyConditionField);
  @field targets = containsMany(SlaTargetField);
  @field businessHours = linksTo(() => Schedule);
  @field breachActions = containsMany(StringField, {
    description: 'Fired in order when a target is missed.',
  });
  @field isDefault = contains(BooleanField);
  @field samplePriority = contains(TicketPriorityField, {
    description: 'Only drives the preview in the editor.',
  });

  @field title = contains(StringField, {
    computeVia: function (this: SlaPolicy) {
      return this.name?.trim() || 'Untitled policy';
    },
  });

  @field conditionSummary = contains(StringField, {
    computeVia: function (this: SlaPolicy) {
      let parts = (this.conditions ?? []).map((c) => c.title).filter(Boolean);
      return parts.length ? parts.join(' and ') : 'Any ticket';
    },
  });

  // Denormalized for tiles: 'P1 15m / 2h'. A prerendered view can walk
  // containsMany, but it cannot do the priority arithmetic and stay readable.
  @field targetSummary = contains(StringField, {
    computeVia: function (this: SlaPolicy) {
      let first = (this.targets ?? []).find(
        (t) => t.metric === 'First response',
      );
      let resolve = (this.targets ?? []).find((t) => t.metric === 'Resolution');
      let f = first?.minutesFor('P1');
      let r = resolve?.minutesFor('P1');
      if (f == null && r == null) {
        return 'No targets set';
      }
      return `P1 ${f == null ? '—' : formatMinutes(f)} / ${
        r == null ? '—' : formatMinutes(r)
      }`;
    },
  });

  // Flattened, because a prerendered fitted view resolves no links and
  // READING through one there throws rather than returning undefined — which
  // is how a tile becomes a red error card instead of a slightly emptier tile.
  @field businessHoursSummary = contains(StringField, {
    computeVia: function (this: SlaPolicy) {
      return this.businessHours?.summary ?? 'Always on';
    },
  });

  @field breachActionSummary = contains(StringField, {
    computeVia: function (this: SlaPolicy) {
      let n = (this.breachActions ?? []).filter(Boolean).length;
      return n === 0 ? 'none' : n === 1 ? '1 action' : `${n} actions`;
    },
  });

  /** Does this policy apply to a ticket with these attributes? */
  applies(subject: Record<string, unknown>): boolean {
    let conditions = (this.conditions ?? []).filter((c) => c?.attribute);
    if (!conditions.length) {
      return true;
    }
    return conditions.every((c) => c.matches(subject));
  }

  targetFor(metric: string, priority?: string | null): number | undefined {
    return (this.targets ?? [])
      .find((t) => t.metric === metric)
      ?.minutesFor(priority);
  }

  get schedule(): BusinessSchedule {
    return this.businessHours?.businessSchedule ?? ALWAYS_ON;
  }

  static isolated = class Isolated extends Component<typeof this> {
    get matrix(): MatrixRow[] {
      let model = this.args.model;
      let metrics = ['First response', 'Resolution'];
      return ['P1', 'P2', 'P3', 'P4'].map((priority) => ({
        priority,
        cells: metrics.map((metric) => {
          let minutes = model?.targetFor?.(metric, priority);
          return minutes == null ? '—' : formatMinutes(minutes);
        }),
      }));
    }

    <template>
      <article class='iso'>
        <header class='iso-head'>
          <div>
            <h1>{{@model.title}}</h1>
            <p class='iso-sub'>{{@model.conditionSummary}}</p>
          </div>
          {{#if @model.isDefault}}
            <span class='iso-flag'>Fallback policy</span>
          {{/if}}
        </header>

        <section class='sect'>
          <h2>Applies when</h2>
          {{#if @model.conditions.length}}
            <div class='chips'>
              {{#each @fields.conditions as |Condition|}}
                <Condition />
              {{/each}}
            </div>
          {{else}}
            <p class='empty'>No conditions — this policy matches every ticket.
              Only one policy should be this permissive, and it should be the
              fallback.</p>
          {{/if}}
        </section>

        <section class='sect'>
          <h2>Targets</h2>
          <div class='tablewrap'>
            <table class='matrix'>
              <caption class='sr-only'>Targets by priority</caption>
              <thead>
                <tr>
                  <th scope='col'>Priority</th>
                  <th scope='col'>First response</th>
                  <th scope='col'>Resolution</th>
                </tr>
              </thead>
              <tbody>
                {{#each this.matrix as |row|}}
                  <tr>
                    <th scope='row'>{{row.priority}}</th>
                    {{#each row.cells as |cell|}}
                      <td>{{cell}}</td>
                    {{/each}}
                  </tr>
                {{/each}}
              </tbody>
            </table>
          </div>
          <p class='note'>One target per metric, scaled by each priority's
            factor. Stating all four by hand is how a P3 ends up resolving
            faster than a P2.</p>
        </section>

        <section class='sect'>
          <h2>Clock runs on</h2>
          {{#if @model.businessHours}}
            <@fields.businessHours @format='embedded' />
          {{else}}
            <p class='empty'>No schedule linked — the clock ticks around the
              clock, including weekends and holidays.</p>
          {{/if}}
        </section>

        <section class='sect'>
          <h2>On breach</h2>
          {{#if @model.breachActions.length}}
            <ol class='actions'>
              {{! Not `as |action|`: in a strict-mode template `action`
                  resolves as the classic action helper, which does not exist
                  there — it fails the prerender outright and renders an empty
                  list in the live view. }}
              {{#each @model.breachActions as |breachAction|}}
                <li>{{breachAction}}</li>
              {{/each}}
            </ol>
          {{else}}
            <p class='empty'>Nothing happens on breach. The target is a
              measurement, not a commitment, until something acts on it.</p>
          {{/if}}
        </section>
      </article>

      <style scoped>
        .iso {
          container-name: iso;
          container-type: inline-size;
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-lg);
          padding: var(--boxel-sp-lg);
          min-height: 100%;
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
        }
        .iso-head {
          display: flex;
          justify-content: space-between;
          gap: var(--boxel-sp);
          align-items: flex-start;
          padding-bottom: var(--boxel-sp);
          border-bottom: 1px solid var(--border, var(--boxel-200));
        }
        .iso-head h1 {
          margin: 0;
          font-family: var(--font-heading, inherit);
          font-size: var(--boxel-font-size-lg);
          font-weight: 700;
          letter-spacing: -0.01em;
        }
        .iso-sub {
          margin: 0;
          color: var(--muted-foreground, var(--boxel-450));
          font-size: var(--boxel-font-size-sm);
        }
        .iso-flag {
          flex: none;
          padding: 0.1em 0.5em;
          border-radius: 3px;
          background: var(--muted, var(--boxel-100));
          font-size: var(--boxel-font-size-xs);
          font-weight: 700;
        }
        .sect {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-xs);
        }
        .sect h2 {
          margin: 0;
          font-size: 0.625rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .chips {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-xs);
        }
        .tablewrap {
          overflow-x: auto;
        }
        .matrix {
          border-collapse: collapse;
          font-size: var(--boxel-font-size-sm);
          font-variant-numeric: tabular-nums;
        }
        .matrix th,
        .matrix td {
          border: 1px solid var(--border, var(--boxel-200));
          padding: var(--boxel-sp-4xs) var(--boxel-sp-xs);
          text-align: start;
        }
        .matrix thead th {
          background: var(--muted, var(--boxel-100));
          font-size: 0.625rem;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        .matrix tbody th {
          font-weight: 700;
        }
        .actions {
          margin: 0;
          padding-left: 1.2rem;
          font-size: var(--boxel-font-size-sm);
        }
        .note,
        .empty {
          margin: 0;
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          max-width: 62ch;
          line-height: 1.6;
        }
        .sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='emb'>
        <span class='emb-name'>{{@model.title}}</span>
        <span class='emb-cond'>{{@model.conditionSummary}}</span>
        <span class='emb-tgt'>{{@model.targetSummary}}</span>
      </div>
      <style scoped>
        .emb {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--boxel-border-radius);
          background: var(--card, var(--boxel-light));
          color: var(--card-foreground, var(--foreground, var(--boxel-dark)));
          font-family: var(--font-sans, var(--boxel-font-family));
        }
        .emb-name {
          font-weight: 700;
          font-size: var(--boxel-font-size-sm);
        }
        .emb-cond {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .emb-tgt {
          font-size: var(--boxel-font-size-xs);
          font-variant-numeric: tabular-nums;
          font-weight: 600;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='atom'>{{@model.title}}
        <span class='atom-tgt'>{{@model.targetSummary}}</span></span>
      <style scoped>
        .atom {
          display: inline-flex;
          gap: 0.3rem;
          align-items: baseline;
          font-size: 0.8125rem;
          font-weight: 500;
        }
        .atom-tgt {
          font-size: 0.6875rem;
          color: var(--muted-foreground, var(--boxel-450));
          font-variant-numeric: tabular-nums;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <article class='fit'>
        <header class='r-head'>
          <h3 class='title'>{{@model.title}}</h3>
          <span class='badge'>{{@model.targetSummary}}</span>
        </header>
        <div class='r-body'>
          <span class='line'>{{@model.conditionSummary}}</span>
          <span class='line line-2'>{{@model.businessHoursSummary}}</span>
          <p class='blurb'>{{@model.conditionSummary}}</p>
          <span class='tail'>{{@model.breachActionSummary}}</span>
        </div>
        <footer class='r-meta'>{{@model.targetSummary}}</footer>
      </article>
      <style scoped>
        /* Same skeleton as ticket.gts: one `.fit` grid, no container declared
           here (the host provides `fitted-card`), one continuous type scale,
           and tiers that ADD a row rather than un-crop one. */
        .fit {
          width: 100%;
          height: 100%;
          display: grid;
          grid-template-rows: auto minmax(0, 1fr) auto;
          grid-template-areas: 'head' 'body' 'meta';
          gap: 2px;
          padding: 7px 9px;
          overflow: hidden;
          background: var(--card, var(--boxel-light));
          color: var(--card-foreground, var(--foreground, var(--boxel-dark)));
          font-family: var(--font-sans, var(--boxel-font-family));
          --type-base: clamp(9.5px, 2.7cqi, 12px);
          --type-title: max(11px, calc(var(--type-base) * 1.25));
        }
        .fit > * {
          overflow: hidden;
          min-height: 0;
        }
        .r-head {
          grid-area: head;
          display: flex;
          align-items: baseline;
          gap: 5px;
          min-width: 0;
        }
        .title {
          flex: 1;
          min-width: 0;
          margin: 0;
          font-size: var(--type-title);
          font-weight: 600;
          line-height: 1.25;
          letter-spacing: -0.01em;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .badge {
          flex: none;
          margin-left: auto;
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: var(--type-base);
          font-weight: 600;
          color: var(--muted-foreground, var(--boxel-450));
          font-variant-numeric: tabular-nums;
          white-space: nowrap;
        }
        .r-body {
          grid-area: body;
          display: none;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        .line {
          font-size: var(--type-base);
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .blurb {
          display: none;
          margin: 0;
          font-size: var(--type-base);
          color: var(--muted-foreground, var(--boxel-450));
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .tail {
          display: none;
          margin-top: auto;
          font-size: var(--type-base);
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .r-meta {
          grid-area: meta;
          display: none;
          align-items: center;
          gap: 6px;
          min-width: 0;
          font-size: var(--type-base);
          color: var(--muted-foreground, var(--boxel-450));
        }
        @container fitted-card (height <= 50px) {
          .fit {
            grid-template-rows: 1fr;
            align-content: center;
          }
          .title {
            -webkit-line-clamp: 1;
          }
        }
        @container fitted-card (height > 50px) {
          .r-meta {
            display: flex;
          }
        }
        @container fitted-card (height > 50px) and (height <= 105px) {
          .title {
            -webkit-line-clamp: 1;
          }
        }
        @container fitted-card (height > 80px) {
          .r-body {
            display: flex;
          }
        }
        @container fitted-card (height > 160px) {
          .blurb {
            display: -webkit-box;
          }
        }
        @container fitted-card (height > 240px) {
          .blurb {
            -webkit-line-clamp: 4;
          }
          .tail {
            display: block;
          }
        }
        @container fitted-card (width > 300px) and (height <= 130px) {
          .fit {
            grid-template-columns: minmax(200px, 1fr) auto;
            grid-template-areas: 'head meta' 'body meta';
            align-items: center;
          }
          .r-meta {
            flex-direction: column;
            align-items: flex-end;
            gap: 1px;
          }
        }
        @container fitted-card (width <= 170px) {
          .line-2 {
            display: none;
          }
        }
      </style>
    </template>
  };
}
