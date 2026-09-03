import {
  CardDef,
  FieldDef,
  Component,
  field,
  contains,
  containsMany,
  StringField,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import DateField from '@cardstack/base/date';

import { StatePill } from './components/state-pill';
import { MoneyDisplay } from './components/money-display';
import { EditSectionNav } from './components/edit-section-nav';
import { FieldContainer } from '@cardstack/boxel-ui/components';
import { tracked } from '@glimmer/tracking';
import { eq } from '@cardstack/boxel-ui/helpers';

export function rateAgeDays(asOf?: Date | null, now: Date = new Date()): number {
  if (!asOf) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.floor((now.getTime() - asOf.getTime()) / 86_400_000);
}

// One dated exchange-rate row: how many units of BASE one unit of `currency`
// buys, where it came from, and when. Staleness is judged by the registry's
// own staleAfterDays — a rate is never "old" in the abstract, only older
// than this book allows.
export class RateEntryField extends FieldDef {
  static displayName = 'Rate Entry';

  @field currency = contains(StringField, {
    description: 'ISO code, e.g. EUR',
  });
  @field rate = contains(NumberField, {
    description: '1 unit of this currency = rate units of the base currency',
  });
  @field asOf = contains(DateField);
  @field source = contains(StringField, {
    description: 'e.g. ECB daily fix, treasury desk',
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='rate-row'>
        <span class='rate-cur'>{{@model.currency}}</span>
        <span class='rate-val'>{{@model.rate}}</span>
        <span class='rate-meta'>{{@model.source}}</span>
      </div>
      <style scoped>
        .rate-row {
          display: grid;
          grid-template-columns: 4rem auto 1fr;
          gap: var(--boxel-sp-sm);
          align-items: baseline;
          font-size: 0.875rem;
          padding: var(--boxel-sp-4xs) 0;
        }
        .rate-cur {
          font-weight: 700;
          font-family: var(--font-mono, ui-monospace, monospace);
        }
        .rate-val {
          font-variant-numeric: tabular-nums;
        }
        .rate-meta {
          color: var(--muted-foreground, var(--boxel-450));
          font-size: 0.8125rem;
          text-align: right;
        }
      </style>
    </template>
  };
}

// The desk's book of exchange rates: one base (booking) currency, dated
// rates per foreign currency, and a staleness policy. ResolveCurrencyCommand
// is the only reader that matters — it refuses to convert on a rate older
// than staleAfterDays rather than guessing, which is the entire point of
// keeping rates as dated data instead of calling a live API.
export class CurrencyRegistry extends CardDef {
  static displayName = 'Currency Registry';
  static headerColor = '#3e4e88';

  @field baseCurrency = contains(StringField, {
    description: 'ISO code the books are kept in, e.g. USD',
  });
  @field rates = containsMany(RateEntryField);
  @field staleAfterDays = contains(NumberField, {
    description: 'Rates older than this refuse to resolve',
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: CurrencyRegistry) {
      let base = this.baseCurrency?.trim()?.toUpperCase();
      return base ? `Currency Registry (${base} base)` : 'Currency Registry';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    get rows() {
      let staleAfter = this.args.model?.staleAfterDays ?? 30;
      return (this.args.model?.rates ?? []).filter(Boolean).map((r) => ({
        rate: r,
        age: rateAgeDays(r.asOf),
        stale: rateAgeDays(r.asOf) > staleAfter,
        asOfLabel: r.asOf
          ? r.asOf.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            })
          : 'undated',
      }));
    }
    get base() {
      return this.args.model?.baseCurrency?.toUpperCase() ?? 'USD';
    }
    <template>
      <article class='registry'>
        <header class='head'>
          <div>
            <p class='kicker'>Currency Registry</p>
            <h1>{{this.base}} base · {{@model.staleAfterDays}}-day staleness
              policy</h1>
          </div>
        </header>
        <section class='panel'>
          <h2>Rates · 1 unit → {{this.base}}</h2>
          <div class='rows'>
            {{#each this.rows as |row|}}
              <div class='row {{if row.stale "stale"}}'>
                <span class='cur'>{{row.rate.currency}}</span>
                <MoneyDisplay
                  @amount={{row.rate.rate}}
                  @currency={{this.base}}
                />
                <span class='asof'>as of {{row.asOfLabel}}
                  ({{row.age}}d)</span>
                <StatePill
                  @label={{if row.stale 'stale — will refuse' 'usable'}}
                  @hue={{if row.stale 'red' 'green'}}
                  @dot={{true}}
                />
              </div>
            {{else}}
              <p class='empty'>No rates recorded — Resolve Currency will
                refuse every conversion until the book has rows.</p>
            {{/each}}
          </div>
        </section>
      </article>
      <style scoped>
        .registry {
          container-type: inline-size;
          padding: var(--boxel-sp-lg);
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, inherit);
          display: grid;
          gap: var(--boxel-sp);
        }
        .head {
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
          margin: var(--boxel-sp-5xs) 0 0;
          font-family: var(--font-heading, inherit);
          font-size: 1.375rem;
        }
        .panel {
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--radius, var(--boxel-border-radius));
          padding: var(--boxel-sp);
        }
        h2 {
          margin: 0 0 var(--boxel-sp-xs);
          font-size: 0.8125rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .rows {
          display: grid;
          gap: var(--boxel-sp-5xs);
        }
        .row {
          display: grid;
          grid-template-columns: 4rem auto 1fr auto;
          gap: var(--boxel-sp-sm);
          align-items: center;
          padding: var(--boxel-sp-4xs) 0;
          border-bottom: 1px solid var(--border, var(--boxel-100));
        }
        .row.stale .cur {
          color: var(--muted-foreground, var(--boxel-450));
        }
        .cur {
          font-weight: 700;
          font-family: var(--font-mono, ui-monospace, monospace);
        }
        .asof {
          font-size: 0.8125rem;
          color: var(--muted-foreground, var(--boxel-450));
          font-variant-numeric: tabular-nums;
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
    get count() {
      return (this.args.model?.rates ?? []).length;
    }
    <template>
      <div class='row'>
        <span class='name'>{{@model.cardTitle}}</span>
        <span class='meta'>{{this.count}} rates ·
          {{@model.staleAfterDays}}d policy</span>
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
        .meta {
          font-size: 0.8125rem;
          color: var(--muted-foreground, var(--boxel-450));
          font-variant-numeric: tabular-nums;
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

  static fitted = class Fitted extends Component<typeof this> {
    get count() {
      return (this.args.model?.rates ?? []).length;
    }
    <template>
      <div class='fit'>
        <span class='fit-name'>{{@model.cardTitle}}</span>
        <span class='fit-sub'>{{this.count}} rates ·
          {{@model.staleAfterDays}}d staleness</span>
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
          font-weight: 700;
          font-size: 0.9375rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .fit-sub {
          font-size: 0.75rem;
          color: var(--muted-foreground, var(--boxel-450));
          font-variant-numeric: tabular-nums;
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

  // The book's policy first (base currency + how old a rate may be), then
  // the rate rows themselves. Two sections, no rail. Computed cardTitle is
  // excluded.
  static edit = class Edit extends Component<typeof this> {
    @tracked activeSection = 'identity';

    sections = [
      { id: 'identity', label: 'Registry identity' },
      { id: 'rates', label: 'Rates' },
    ];

    goTo = (id: string, event: Event) => {
      this.activeSection = id;
      let root = (event.currentTarget as HTMLElement).closest('.registry-edit');
      root
        ?.querySelector(`[data-sect='${id}']`)
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    };

    <template>
      <div class='registry-edit'>
        <div class='edit-body'>
          <EditSectionNav
            @sections={{this.sections}}
            @activeId={{this.activeSection}}
            @onSelect={{this.goTo}}
            class='sect-nav'
          />
          <div class='sects'>
          <section
            class='sect policy
              {{if (eq this.activeSection "identity") "focused"}}'
            data-sect='identity'
          >
            <h3>Registry identity</h3>
            <div class='row'>
              <FieldContainer @label='Base currency (ISO)' @vertical={{true}}>
                <@fields.baseCurrency />
              </FieldContainer>
              <FieldContainer @label='Stale after (days)' @vertical={{true}}>
                <@fields.staleAfterDays />
              </FieldContainer>
            </div>
          </section>

          <section
            class='sect {{if (eq this.activeSection "rates") "focused"}}'
            data-sect='rates'
          >
            <h3>Rates
              <span class='sect-hint'>rates older than the staleness policy
                make Resolve Currency refuse to convert</span></h3>
            <FieldContainer
              @label='Dated rates (1 unit → base)'
              @vertical={{true}}
            >
              <@fields.rates />
            </FieldContainer>
          </section>
          </div>
        </div>
      </div>
      <style scoped>
        .registry-edit {
          container-type: inline-size;
          container-name: edit;
          height: 100%;
          overflow-y: auto;
          padding: var(--boxel-sp);
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          /* family ink, declared ONCE */
          --cr-ink: var(--procurement-ink, #27306b);
          --cr-ink-fg: var(--procurement-ink-fg, var(--boxel-light));
        }
        .edit-body {
          display: grid;
          grid-template-columns: 9.5rem minmax(0, 1fr);
          align-items: start;
          gap: var(--boxel-sp);
        }
        .sect-nav {
          position: sticky;
          top: 0;
          --edit-section-nav-ink: var(--cr-ink);
          --edit-section-nav-ink-fg: var(--cr-ink-fg);
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
        .sect.focused {
          outline-color: var(--cr-ink);
          box-shadow: 0 0 0 4px
            color-mix(in oklch, var(--cr-ink) 12%, transparent);
        }
        .sect.policy {
          border-left: 3px solid var(--cr-ink);
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
          grid-template-columns: repeat(2, minmax(0, 1fr));
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
