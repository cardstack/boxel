import {
  CardDef,
  Component,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown';
import DateTimeField from 'https://cardstack.com/base/datetime';
import TrendingUpIcon from '@cardstack/boxel-icons/trending-up';

interface Delta {
  label: string;
  value: number;
}

function parseDeltas(raw: string | undefined): Delta[] {
  try {
    let parsed = raw ? JSON.parse(raw) : {};
    return Object.entries(parsed)
      .filter(([, v]) => typeof v === 'number' && v !== 0)
      .map(([label, value]) => ({ label, value: value as number }));
  } catch {
    return [];
  }
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

export class ProgressReport extends CardDef {
  static displayName = 'Progress Report';
  static icon = TrendingUpIcon;

  @field roundDate = contains(DateTimeField);
  // AI-written narrative for the round: what moved and why.
  @field summary = contains(MarkdownField);
  // JSON snapshot of the round's totals (verified/consumed/reused/gold and
  // per-layer verified counts) — the report history is the time series.
  @field metrics = contains(StringField);
  // JSON diff vs the previous report, e.g. {"verified": 12, "gold": 3}.
  @field deltas = contains(StringField);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: ProgressReport) {
      let d = this.roundDate;
      return d
        ? `Progress — ${d.toISOString().slice(0, 10)}`
        : 'Progress report';
    },
  });

  get deltaChips(): Delta[] {
    return parseDeltas(this.deltas);
  }

  static embedded = class Embedded extends Component<typeof ProgressReport> {
    get deltaChips() {
      return parseDeltas((this.args.model as ProgressReport)?.deltas);
    }

    <template>
      <div class='report-row'>
        <div class='head'>
          <span class='when'><@fields.roundDate /></span>
          {{#each this.deltaChips as |d|}}
            <span
              class='delta {{if (isUp d.value) "up" "down"}}'
            >{{signed d.value}} {{d.label}}</span>
          {{/each}}
        </div>
        {{#if @model.summary}}
          <div class='body'><@fields.summary /></div>
        {{/if}}
      </div>
      <style scoped>
        .report-row {
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
          padding: 0.625rem 0.875rem;
          font-size: 0.8125rem;
        }
        .head {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          flex-wrap: wrap;
        }
        .when {
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--muted-foreground, #6b7280);
        }
        .delta {
          font-size: 0.6875rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          padding: 0.125rem 0.4375rem;
          border-radius: 999px;
        }
        .delta.up {
          background: var(--state-done-bg, #dcfce7);
          color: var(--state-done-fg, #166534);
        }
        .delta.down {
          background: var(--state-next-bg, #fef3c7);
          color: var(--state-next-fg, #92400e);
        }
        .body {
          line-height: 1.5;
        }
        .body :deep(p) {
          margin: 0 0 0.375rem;
        }
        .body :deep(p:last-child) {
          margin-bottom: 0;
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof ProgressReport> {
    get deltaChips() {
      return parseDeltas((this.args.model as ProgressReport)?.deltas);
    }

    get metricRows(): { label: string; value: string }[] {
      try {
        let raw = (this.args.model as ProgressReport)?.metrics;
        let parsed = raw ? JSON.parse(raw) : {};
        return Object.entries(parsed).map(([label, value]) => ({
          label,
          value:
            typeof value === 'object' ? JSON.stringify(value) : String(value),
        }));
      } catch {
        return [];
      }
    }

    <template>
      <article class='report-page'>
        <header class='rh'>
          <div>
            <p class='doc-kind'>Crawl-round progress report</p>
            <h1><@fields.roundDate /></h1>
          </div>
          <div class='deltas'>
            {{#each this.deltaChips as |d|}}
              <span
                class='delta {{if (isUp d.value) "up" "down"}}'
              >{{signed d.value}} {{d.label}}</span>
            {{/each}}
          </div>
        </header>
        {{#if @model.summary}}
          <section class='panel'><@fields.summary /></section>
        {{/if}}
        {{#if this.metricRows.length}}
          <section class='panel'>
            <h2>Snapshot</h2>
            <dl>
              {{#each this.metricRows as |m|}}
                <dt>{{m.label}}</dt>
                <dd>{{m.value}}</dd>
              {{/each}}
            </dl>
          </section>
        {{/if}}
      </article>
      <style scoped>
        .report-page {
          max-width: 44rem;
          margin: 0 auto;
          padding: 2rem 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }
        .rh {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          flex-wrap: wrap;
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
        .deltas {
          display: flex;
          gap: 0.375rem;
          flex-wrap: wrap;
        }
        .delta {
          font-size: 0.6875rem;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          padding: 0.1875rem 0.5625rem;
          border-radius: 999px;
        }
        .delta.up {
          background: var(--state-done-bg, #dcfce7);
          color: var(--state-done-fg, #166534);
        }
        .delta.down {
          background: var(--state-next-bg, #fef3c7);
          color: var(--state-next-fg, #92400e);
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
        }
        dt {
          color: var(--muted-foreground, #6b7280);
        }
        dd {
          margin: 0;
          font-variant-numeric: tabular-nums;
          overflow-wrap: anywhere;
        }
      </style>
    </template>
  };
}

function isUp(n: number): boolean {
  return n > 0;
}
