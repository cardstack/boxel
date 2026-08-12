import {
  CardDef,
  Component,
  contains,
  linksTo,
  field,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';

import { Invoice } from 'northwind/records';
import { MoneyField } from 'cardstack/contracts';
// PINNED TO THE OLD MAJOR, ON PURPOSE. See the note below — this is the one
// dependency in the slice chosen to be wrong-looking.
import Select from 'openkit/controls';

// ledgerworks/billing-kit — layer 05.5, the vertical ISV.
//
// An ISV does not invent record types and does not invent controls. It takes
// a vendor's records (layer 05) and a UI library's components (layer 03) and
// sells the PROCESS that connects them — here, the collection process that
// turns an invoice into money.
//
// ─── THE DEPENDENCY THAT IS DELIBERATELY BEHIND ─────────────────────────────
//
// This package declares `openkit/controls: ^0.2.0`, and by the time it is
// published openkit 1.0.0 exists. The range EXCLUDES it — `^0.2.0` under the
// 0.x rule admits nothing above 0.2.x — so this pack seals against
// `openkit/controls@0.2.0` while the realm that hosts it resolves the bare
// specifier to 1.0.0.
//
// That is not a mistake in the fixture. It is the single most important thing
// the slice has to demonstrate, and it is what actually happens: an ISV
// qualifies its product against a version of a UI library, ships it to
// regulated customers, and does not re-qualify on somebody else's release
// schedule. openkit shipping 1.0.0 must not reach in and change how this
// vendor's collections screen behaves.
//
// So on any page that renders both this kit and something built on openkit
// 1.0.0, TWO MAJORS OF THE SAME COMPONENT are live at once, resolved through
// the sealed scopes in this pack's own manifest. Visibly: the Select here has
// no search field and its popup is clipped by an ancestor, because that is
// what 0.2.0 was. It is not broken. It is sealed.
//
// The upgrade is a decision this vendor makes, by republishing with a wider
// range — which is exactly the "UPDATE button" of §7, seen from the side of
// the person who has to press it.
//
// ─── PASS 2 (1.1.0): an embedded format ─────────────────────────────────────
//
// 1.0.0 had only `isolated`, which meant a CollectionCase linked from another
// card rendered as a bare title chip — the format a consumer actually gets
// when they write `<@fields.openCase />`. A kit whose card is unusable in the
// one position consumers put it in has shipped half a component.
//
// The embedded format shows the two facts an operator reads at a glance — the
// stage, and the terms — and the terms are a real control rather than text,
// because changing them is the action the row exists to support.
//
// COMPATIBLE: purely additive, nothing existing moved. A consumer on ^1.0.0
// gets it on their next re-seal and nothing else changes.

export type TermsKey = 'net-15' | 'net-30' | 'net-60' | 'due-on-receipt';

interface TermsOption {
  key: TermsKey;
  label: string;
  description: string;
  days: number;
}

// Payment terms as DATA rather than a free-text field, because "Net 30" typed
// by hand is a string that no dunning schedule can compute from. The number of
// days is the part the process needs; the label is the part the customer reads.
export const TERMS: TermsOption[] = [
  {
    key: 'due-on-receipt',
    label: 'Due on receipt',
    description: 'Payable immediately',
    days: 0,
  },
  { key: 'net-15', label: 'Net 15', description: '15 days', days: 15 },
  { key: 'net-30', label: 'Net 30', description: '30 days', days: 30 },
  { key: 'net-60', label: 'Net 60', description: '60 days', days: 60 },
];

export function termsFor(key: string | undefined): TermsOption | undefined {
  return TERMS.find((option) => option.key === key);
}

export class CollectionCase extends CardDef {
  static displayName = 'Collection Case';

  // `searchable`, because the whole point of a collections queue is filtering
  // it — "show me every open case on this invoice". A linksTo is NOT queryable
  // without this, and a filter across a non-searchable link does not return
  // nothing, it ERRORS at query time. Marking it here is cheaper than
  // discovering that from a stack trace in a dashboard.
  @field invoice = linksTo(Invoice, { searchable: true });

  @field paymentTerms = contains(StringField);
  @field amountRecovered = contains(MoneyField);
  @field daysOverdue = contains(NumberField);

  get terms() {
    return termsFor(this.paymentTerms);
  }

  // The escalation ladder as a pure function of one number, so it is the same
  // answer everywhere it is asked and nobody stores a stale copy of it.
  get stage(): 'current' | 'reminder' | 'chase' | 'escalate' {
    let days = this.daysOverdue ?? 0;
    if (days <= 0) {
      return 'current';
    }
    if (days <= 14) {
      return 'reminder';
    }
    return days <= 45 ? 'chase' : 'escalate';
  }

  static embedded = class Embedded extends Component<typeof CollectionCase> {
    @tracked chosen: TermsOption | undefined = TERMS[2];

    options = TERMS;

    @action choose(option: TermsOption) {
      this.chosen = option;
    }

    <template>
      <div class='row'>
        <span class='stage stage-{{@model.stage}}'>{{@model.stage}}</span>
        {{! openkit/controls @0.2.0 — sealed, not stale. No search field, and a
            popup an ancestor can clip. Rendered beside anything built on
            1.0.0, both majors are live on the page at once. }}
        <Select
          @options={{this.options}}
          @selected={{this.chosen}}
          @onChange={{this.choose}}
          @label='Payment terms'
          @placeholder='Choose terms'
        />
      </div>
      <style scoped>
        .row {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs, 0.625rem);
          font-family: var(--font-sans, system-ui, sans-serif);
        }
        /* No border, no radius, no background: the PARENT draws the chrome
           around an embedded card, and a second frame inside it reads as a
           mistake. */
        .stage {
          flex: none;
          padding: 0 0.5rem;
          border-radius: 999px;
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          background: color-mix(in srgb, currentColor 12%, transparent);
        }
        .stage-current {
          color: var(--muted-foreground, #6b6f80);
        }
        .stage-reminder {
          color: var(--primary, #3d6bff);
        }
        .stage-chase {
          color: #b26b00;
        }
        .stage-escalate {
          color: var(--destructive, #b3261e);
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof CollectionCase> {
    @tracked chosen: TermsOption | undefined = TERMS[2];

    options = TERMS;

    @action choose(option: TermsOption) {
      this.chosen = option;
    }

    <template>
      <section class='case'>
        <header>
          <h2>Collection case</h2>
          <p class='stage stage-{{@model.stage}}'>{{@model.stage}}</p>
        </header>

        <div class='row'>
          <span class='label'>Invoice</span>
          <@fields.invoice />
        </div>
        <div class='row'>
          <span class='label'>Recovered</span>
          <@fields.amountRecovered />
        </div>

        <div class='row'>
          <span class='label'>Terms</span>
          {{! openkit/controls @0.2.0 — sealed, not stale. No search field, and
              a popup that an ancestor can clip. Rendered beside anything built
              on 1.0.0, both majors are live on the page at once. }}
          <Select
            @options={{this.options}}
            @selected={{this.chosen}}
            @onChange={{this.choose}}
            @label='Payment terms'
            @placeholder='Choose terms'
          />
        </div>

        <p class='pin'>Select from openkit/controls@0.2.0 (sealed)</p>
      </section>
      <style scoped>
        .case {
          --lw-ink: var(--foreground, #1c1e26);
          --lw-ink-2: var(--muted-foreground, #6b6f80);
          --lw-line: var(--border, #dfe1ea);
          --lw-sp: var(--boxel-sp, 1rem);

          display: flex;
          flex-direction: column;
          gap: var(--lw-sp);
          padding: var(--lw-sp);
          color: var(--lw-ink);
          font-family: var(--font-sans, system-ui, sans-serif);
        }
        h2 {
          margin: 0;
          font-size: 1.125rem;
        }
        .row {
          display: grid;
          grid-template-columns: 7rem 1fr;
          align-items: center;
          gap: var(--lw-sp);
          padding-top: 0.5rem;
          border-top: 1px solid var(--lw-line);
        }
        .label {
          color: var(--lw-ink-2);
          font-size: 0.8125rem;
        }
        /* The ladder gets colour because the stage is the one thing a
           collections operator reads first; everything else is detail. */
        .stage {
          display: inline-block;
          margin: 0.25rem 0 0;
          padding: 0 0.5rem;
          border-radius: 999px;
          font-size: 0.75rem;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          background: color-mix(in srgb, currentColor 12%, transparent);
        }
        .stage-current {
          color: var(--muted-foreground, #6b6f80);
        }
        .stage-reminder {
          color: var(--primary, #3d6bff);
        }
        .stage-chase {
          color: #b26b00;
        }
        .stage-escalate {
          color: var(--destructive, #b3261e);
        }
        .pin {
          margin: 0;
          color: var(--lw-ink-2);
          font-family: ui-monospace, monospace;
          font-size: 0.6875rem;
        }
      </style>
    </template>
  };
}
