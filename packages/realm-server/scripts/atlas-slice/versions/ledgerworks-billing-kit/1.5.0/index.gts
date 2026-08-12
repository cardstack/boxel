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

// ledgerworks/billing-kit 1.4.0 — house style, and a resealed 1.x invoice.
//
// TWO THINGS, and the second is the one to read carefully.
//
// FIRST, the style pass: the case row's rule becomes an inset shadow, its label
// takes the mono eyebrow voice, and the collection STAGE becomes a proper chip
// — a surface and a ring both derived from the one hue the stage sets, rather
// than a wash of `currentColor` over nothing.
//
// SECOND, and structurally: this kit re-exports the `Invoice` its own seal
// resolved, and that seal now lands on northwind/records 1.3.0 instead of
// 1.2.0. That is the whole reason a style pass on a record vendor needs a pass
// here too — the apps take their `Invoice` from the KIT, not from the vendor
// (see the app surface's note on two classes with one name), so a restyled
// invoice reaches a card only if the kit reseals against it.
//
// The declared range is untouched at ^1.0.0. Nothing was widened; the range
// always admitted 1.3.0, and 1.3.0 is simply what it resolves to now.

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
//
// ─── PASS 3 (1.2.0): the embedded row, properly ─────────────────────────────
//
// 1.1.0's row was a stage pill and a control shoved together with a gap, which
// left the control at its natural width and a lake of empty space beside it in
// any parent wider than a phone. It read as unfinished, because it was.
//
// A row is a LABELLED FIELD, not two things next to each other: a fixed-width
// label column, then the control taking the rest. That is the same shape as
// every form row in the isolated view, which is the point — an embedded card
// should look like it came from the same kit as the card it is embedded in.
//
// ─── PASS 4 (1.3.0): a card that can be looked at, and named ────────────────
//
// Three changes, all the same complaint from different angles: this card was
// unusable anywhere except the one screen it was written for.
//
// IT HAD NO NAME. Every case rendered as "Untitled Collection Case" — in the
// browser tab, in the stack header, in the workspace feed, and worst of all
// inside anything that LINKED to one, where the name is the entire visible
// content. A case is identified by the invoice it chases, so the title is now
// computed across that link.
//
// IT HAD NO FITTED FORMAT. A card with no `fitted` falls back to a bare title
// chip, which is exactly the empty box a consumer sees. `fitted` is not one
// layout: it is four — badge, strip, tile, card — answered from a single
// template by container queries, and drawing NO chrome of its own, because the
// parent draws that.
//
// IT DID NOT RE-EXPORT THE TYPE IT LINKS TO, which was a runtime failure and
// not a cosmetic gap. See the note on the re-export below.
//
// COMPATIBLE: two formats, a computed title, and a re-export. Nothing moved.

// RE-EXPORTED, and this is load-bearing rather than a convenience.
//
// A consumer that imports `northwind/records` itself resolves it through its
// OWN map, which may name a different Version than the one this kit sealed.
// Two Versions of a card type are two classes, so `CollectionCase.invoice`
// then rejects the consumer's `Invoice` with:
//
//     field validation error: tried set Invoice as field 'invoice'
//     but it is not an instance of Invoice
//
// — a message that reads like nonsense until you notice there are two classes
// with that name. Both resolutions are individually correct; they are simply
// not the same type.
//
// THE GENERAL RULE. Two versions of a COMPONENT can coexist on one page — this
// package proves it below, rendering `openkit/controls@0.2.0` beside a
// consumer's 1.0.0. Two versions of a TYPE cannot, wherever instances of one
// are assigned to fields typed by the other. A component is CALLED and the
// caller never asks what it is; a card type is ASSIGNED, and assignment is
// checked by identity.
//
// So a kit that links to a type owes its consumers a way to obtain that exact
// type, and this is it.
export { Invoice, LineItem } from 'northwind/records';

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

  // A case has no name of its own — it is identified by the invoice it is
  // chasing — so the title is computed ACROSS THE LINK.
  //
  // WHICH NEEDS CARE, and is why this is not a one-liner. A title getter runs
  // in every list and every card header, and the link may not be loaded yet;
  // the optional chaining is what keeps that a plain fallback instead of a
  // throw inside a render. It degrades in two steps rather than one, because
  // "Collection case" still tells a reader what they are looking at, and
  // "Untitled Collection Case" never did.
  @field cardTitle = contains(StringField, {
    computeVia: function (this: CollectionCase) {
      let number = this.invoice?.invoiceNumber?.trim();
      return number?.length ? `Collection · ${number}` : 'Collection case';
    },
  });

  // What a list wants under the name: the one number that decides whether
  // this case needs attention today.
  @field cardDescription = contains(StringField, {
    computeVia: function (this: CollectionCase) {
      let days = this.daysOverdue ?? 0;
      if (days <= 0) {
        return 'Not yet due';
      }
      return `${days} ${days === 1 ? 'day' : 'days'} overdue`;
    },
  });

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

  static atom = class Atom extends Component<typeof CollectionCase> {
    <template>
      <span class='atom'>{{@model.cardTitle}}
        <span class='stage stage-{{@model.stage}}'>{{@model.stage}}</span></span>
      <style scoped>
        .atom {
          white-space: nowrap;
        }
        .stage {
          color: var(--muted-foreground, #6b6f80);
          font-size: var(--boxel-font-size-xs, 0.6875rem);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .stage-escalate {
          color: var(--destructive, #b3261e);
        }
      </style>
    </template>
  };

  // FOUR LAYOUTS, ONE TEMPLATE. A fitted card does not know how big its slot
  // is — badge, strip, tile and card are all `fitted` — so the sizes are
  // answered by container queries rather than by four components that would
  // drift apart. And NO border, radius or fill: the parent draws the chrome
  // around a fitted card, and a second frame inside it reads as a mistake.
  //
  // The stage is the one thing that survives to the smallest size, because it
  // is what a collections operator scans for. Everything else is detail.
  static fitted = class Fitted extends Component<typeof CollectionCase> {
    <template>
      <div class='fit'>
        <span class='stage stage-{{@model.stage}}'>{{@model.stage}}</span>
        <span class='title'>{{@model.cardTitle}}</span>
        <span class='meta'>{{@model.cardDescription}}</span>
      </div>
      <style scoped>
        .fit {
          --lw-ink: var(--foreground, #16181f);
          --lw-ink-2: var(--muted-foreground, #6b6f80);

          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 0.15rem;
          width: 100%;
          height: 100%;
          padding: var(--boxel-sp-xs, 0.625rem);
          overflow: hidden;
          color: var(--lw-ink);
          font-family: var(--font-sans, system-ui, sans-serif);
        }
        .title {
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .meta {
          color: var(--lw-ink-2);
          font-size: var(--boxel-font-size-xs, 0.6875rem);
          white-space: nowrap;
        }
        .stage {
          align-self: start;
          padding: 0 var(--boxel-sp-xxs, 0.5rem);
          border-radius: 999px;
          background: color-mix(in srgb, currentColor 12%, transparent);
          font-size: var(--boxel-font-size-xs, 0.6875rem);
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          white-space: nowrap;
        }
        .stage-current {
          color: var(--muted-foreground, #6b6f80);
        }
        .stage-reminder {
          color: var(--primary, #3d6bff);
        }
        .stage-chase {
          color: #a35c00;
        }
        .stage-escalate {
          color: var(--destructive, #b3261e);
        }
        /* BADGE. Only the thing being scanned for. */
        @container (max-width: 9rem) {
          .title,
          .meta {
            display: none;
          }
        }
        /* STRIP. The stage and who it is about, on one line. */
        @container (min-width: 9rem) and (max-width: 15rem) {
          .fit {
            flex-direction: row;
            align-items: center;
            gap: var(--boxel-sp-xxs, 0.5rem);
          }
          .meta {
            display: none;
          }
        }
        /* CARD. Room to let the name lead. */
        @container (min-width: 24rem) {
          .fit {
            padding: var(--boxel-sp-sm, 0.75rem);
          }
          .title {
            font-size: 1.0625rem;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof CollectionCase> {
    @tracked chosen: TermsOption | undefined = TERMS[2];

    options = TERMS;

    @action choose(option: TermsOption) {
      this.chosen = option;
    }

    <template>
      <div class='row'>
        <span class='label'>Terms</span>
        <span class='control'>
          {{! openkit/controls @0.2.0 — sealed, not stale. No search field, and
              a popup an ancestor can clip. Rendered beside anything built on
              1.0.0, both majors are live on the page at once. }}
          <Select
            @options={{this.options}}
            @selected={{this.chosen}}
            @onChange={{this.choose}}
            @label='Payment terms'
            @placeholder='Choose terms'
          />
        </span>
        <span class='stage stage-{{@model.stage}}'>{{@model.stage}}</span>
      </div>
      <style scoped>
        .row {
          --lw-ink-2: var(--muted-foreground, #6b6f80);
          --lw-sp: var(--boxel-sp-xs, 0.625rem);

          display: grid;
          /* Label column fixed, control takes the rest, status hugs the end.
             The control stretching is what removes the empty lake. */
          grid-template-columns: auto 1fr auto;
          align-items: center;
          gap: var(--lw-sp);
          font-family: var(--font-sans, system-ui, sans-serif);
          font-size: var(--boxel-font-size-sm, 0.8125rem);
        }
        .label {
          color: var(--lw-ink-2);
        }
        .control {
          display: block;
          min-width: 0;
        }
        /* The Select's own min-width is a floor for a bare control; inside a
           row that stretches, the row decides. */
        .control > * {
          min-width: 0;
          width: 100%;
        }
        /* No border, no radius, no background on the row itself: the PARENT
           draws the chrome around an embedded card, and a second frame inside
           it reads as a mistake. */
        .stage {
          flex: none;
          padding: 0 var(--boxel-sp-xxs, 0.5rem);
          border-radius: 999px;
          font-size: var(--boxel-font-size-xs, 0.6875rem);
          font-weight: 600;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          white-space: nowrap;
          /* Tinted from the status colour itself, so one declaration below
             sets both the text and its wash. */
          background: color-mix(in srgb, currentColor 12%, transparent);
        }
        .stage-current {
          color: var(--muted-foreground, #6b6f80);
        }
        .stage-reminder {
          color: var(--primary, #3d6bff);
        }
        .stage-chase {
          color: #a35c00;
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
          {{! The case's own name rather than the class's. A screen whose
              heading is the type name tells a reader nothing they did not
              already know from opening it. }}
          <h2>{{@model.cardTitle}}</h2>
          <p class='stage stage-{{@model.stage}}'>{{@model.stage}}
            <span class='days'>· {{@model.cardDescription}}</span></p>
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
        /* Law 1 — depth is one property: the row's rule is an inset shadow. */
        .row {
          display: grid;
          grid-template-columns: 7rem 1fr;
          align-items: center;
          gap: var(--lw-sp);
          padding-top: 0.55rem;
          box-shadow: inset 0 1px 0 var(--lw-line);
        }
        .label {
          font-family: var(--font-mono, ui-monospace, monospace);
          color: var(--lw-ink-2);
          font-size: 10.5px;
          font-weight: 500;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        /* The ladder gets colour because the stage is the one thing a
           collections operator reads first; everything else is detail. */
        /* Law 2 — one hue in, a complete treatment out. The stage sets
           `color`; the surface and the ring are both derived from it. */
        .stage {
          display: inline-flex;
          align-items: center;
          margin: 0.3rem 0 0;
          padding: 1px 8px;
          border-radius: var(--radius-chip, 6px);
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 10.5px;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          background: color-mix(in srgb, currentColor 16%, var(--card, #fff));
          box-shadow: 0 0 0 1px
            color-mix(in srgb, currentColor 40%, var(--lw-line));
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
        .days {
          font-weight: 400;
          letter-spacing: 0;
          text-transform: none;
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
