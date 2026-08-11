import {
  CardDef,
  Component,
  field,
  contains,
  StringField,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import UrlField from '@cardstack/base/url';
import EmailField from '@cardstack/base/email';
import BuildingIcon from '@cardstack/boxel-icons/building';

import { htmlSafe } from '@ember/template';

import { ScoreField } from './score-field';
import { DurationField } from './duration-field';
import {
  durationInDays,
  initialsOf,
  stateColor,
  stateColorOf,
  type StateColor,
} from './utils/index';

// Contract lifecycle colours. The state is DERIVED — a contract is "expiring"
// when its computed end date falls inside the renewal window — so the palette
// keys on that derivation rather than on a persisted status field.
// Token-first with literal fallbacks so a themeless realm still reads right.
export const VENDOR_CONTRACT_COLORS: Record<string, StateColor> = {
  upcoming: stateColor('slate'),
  active: stateColor('teal'),
  expiring: stateColor('amber'),
  expired: stateColor('red'),
};

const RENEWAL_WINDOW_MONTHS = 6;
const MAX_STARS = 5;

interface ContractShape {
  contractStart?: Date | null;
  contractLength?: { value?: number | null; unit?: string | null } | null;
}

// Shared by isolated and fitted so the two formats can never disagree about
// what state a contract is in, or when it ends.
function contractFacts(model: ContractShape) {
  let start = model.contractStart ? new Date(model.contractStart) : undefined;
  if (start && isNaN(start.getTime())) {
    start = undefined;
  }
  let days = durationInDays(
    model.contractLength?.value,
    model.contractLength?.unit,
  );
  let end: Date | undefined;
  if (start && days != null) {
    end = new Date(start.getTime());
    end.setDate(end.getDate() + Math.round(days));
  }
  let monthsLeft: number | undefined;
  if (end) {
    monthsLeft = Math.round(
      (end.getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30),
    );
  }
  let state = 'upcoming';
  if (monthsLeft != null) {
    state =
      monthsLeft < 0
        ? 'expired'
        : monthsLeft <= RENEWAL_WINDOW_MONTHS
          ? 'expiring'
          : 'active';
  } else if (start) {
    state = 'active';
  }
  return { start, end, monthsLeft, state };
}

export class Vendor extends CardDef {
  static displayName = 'Vendor';
  static icon = BuildingIcon;

  @field name = contains(StringField);
  @field contactName = contains(StringField);
  @field email = contains(EmailField);
  @field website = contains(UrlField);
  @field serviceCategory = contains(StringField, {
    description: 'e.g. staffing agency, payroll, freelance design',
  });
  @field contractStart = contains(DateField);
  @field contractLength = contains(DurationField);
  @field performanceRating = contains(ScoreField);

  @field title = contains(StringField, {
    computeVia: function (this: Vendor) {
      return this.name?.trim() || 'Unnamed Vendor';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    get initials() {
      return initialsOf(this.args.model?.name);
    }

    get facts() {
      return contractFacts(this.args.model ?? {});
    }

    get contractColor() {
      return stateColorOf(VENDOR_CONTRACT_COLORS, this.facts.state);
    }

    get contractPillStyle() {
      let c = this.contractColor;
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }

    get contractStateLabel() {
      switch (this.facts.state) {
        case 'expired':
          return 'Contract ended';
        case 'expiring':
          return 'Contract active';
        case 'upcoming':
          return 'Not started';
        default:
          return 'Contract active';
      }
    }

    // Second pill: the countdown. Only shown when there is an end date to
    // count toward, so an open-ended contract renders one pill, not a blank.
    get expiryLabel() {
      let { monthsLeft } = this.facts;
      if (monthsLeft == null) {
        return undefined;
      }
      if (monthsLeft < 0) {
        return `Ended ${Math.abs(monthsLeft)} mo ago`;
      }
      if (monthsLeft === 0) {
        return 'Ends this month';
      }
      return `${monthsLeft} mo to renewal`;
    }

    get contractEndLabel() {
      let { end } = this.facts;
      return end ? end.toISOString().slice(0, 10) : undefined;
    }

    // Star row is shape + number, never colour alone (grayscale-safe).
    get stars() {
      let v = this.args.model?.performanceRating;
      let filled = typeof v === 'number' ? Math.round(v) : 0;
      return Array.from({ length: MAX_STARS }, (_, i) => i < filled);
    }

    get ratingLabel() {
      let v = this.args.model?.performanceRating;
      return typeof v === 'number' ? `${v} / ${MAX_STARS}` : undefined;
    }

    // One getter rather than branching in the template — keeps the template
    // free of helper imports and puts the wording next to the logic.
    get renewalNote() {
      let { state } = this.facts;
      let left = this.expiryLabel;
      if (!left) {
        return undefined;
      }
      if (state === 'expired') {
        return 'This contract has ended. Confirm no work is still in flight before archiving the vendor.';
      }
      if (state === 'expiring') {
        return `Inside the ${RENEWAL_WINDOW_MONTHS}-month renewal window — ${left}. Check any project depending on this vendor before renewing.`;
      }
      return `${left}. No action needed yet.`;
    }

    <template>
      <article class='vendor-isolated'>
        <header class='hero'>
          <span class='avatar' aria-hidden='true'>{{this.initials}}</span>
          <div class='hero-text'>
            <h1>{{@model.title}}</h1>
            <p class='byline'>
              {{#if @model.serviceCategory}}{{@model.serviceCategory}}{{/if}}
              {{#if @model.contractLength.label}}
                <span class='sep-dot'>&middot;</span>
                {{@model.contractLength.label}}
                contract
              {{/if}}
            </p>
            <div class='pill-row'>
              <span class='pill' style={{this.contractPillStyle}}>
                <span class='pill-dot'></span>{{this.contractStateLabel}}
              </span>
              {{#if this.expiryLabel}}
                <span class='pill' style={{this.contractPillStyle}}>
                  <span class='pill-dot'></span>{{this.expiryLabel}}
                </span>
              {{/if}}
            </div>
          </div>
          {{#if this.ratingLabel}}
            <div class='hero-rating'>
              <span class='stars' aria-hidden='true'>
                {{#each this.stars as |on|}}
                  <span class='star {{if on "on"}}'>&#9733;</span>
                {{/each}}
              </span>
              <span class='rating-num'>Performance {{this.ratingLabel}}</span>
            </div>
          {{/if}}
        </header>

        <div class='body'>
          <div class='main'>
            <h2 class='panel-title'>Contract</h2>
            <dl class='facts'>
              <dt>Service</dt>
              <dd>{{if @model.serviceCategory @model.serviceCategory '—'}}</dd>
              <dt>Starts</dt>
              <dd>{{#if @model.contractStart}}<@fields.contractStart
                  />{{else}}&mdash;{{/if}}</dd>
              <dt>Length</dt>
              <dd>{{#if
                  @model.contractLength.label
                }}{{@model.contractLength.label}}{{else}}&mdash;{{/if}}</dd>
              <dt>Projected end</dt>
              <dd>
                {{#if this.contractEndLabel}}
                  {{this.contractEndLabel}}
                  {{#if this.expiryLabel}}
                    <span class='dd-note'>&middot; {{this.expiryLabel}}</span>
                  {{/if}}
                {{else}}
                  &mdash;
                {{/if}}
              </dd>
              <dt>Performance</dt>
              <dd>{{if
                  this.ratingLabel
                  this.ratingLabel
                  '— not yet rated'
                }}</dd>
            </dl>
          </div>

          <aside class='side'>
            <h2 class='panel-title'>Contact</h2>
            <dl class='facts stacked'>
              <dt>Contact</dt>
              <dd>{{if @model.contactName @model.contactName '—'}}</dd>
              <dt>Email</dt>
              <dd>{{if @model.email @model.email '—'}}</dd>
              <dt>Website</dt>
              <dd>{{#if @model.website}}<@fields.website
                  />{{else}}&mdash;{{/if}}</dd>
            </dl>

            {{#if this.renewalNote}}
              <h2 class='panel-title spaced'>Renewal</h2>
              <p class='side-note'>{{this.renewalNote}}</p>
            {{/if}}
          </aside>
        </div>
      </article>
      <style scoped>
        .vendor-isolated {
          container-type: inline-size;
          container-name: iso;
          height: 100%;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
          --vendor-id: var(--primary, var(--boxel-highlight));
          --vendor-strong: color-mix(
            in oklch,
            var(--vendor-id) 45%,
            var(--foreground, var(--boxel-dark))
          );
        }
        /* ---------- hero ---------- */
        .hero {
          flex: none;
          display: flex;
          align-items: flex-start;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp-lg);
          border-bottom: 1px solid var(--border, var(--boxel-200));
        }
        .avatar {
          flex: none;
          width: 3.25rem;
          height: 3.25rem;
          border-radius: 50%;
          display: grid;
          place-items: center;
          font-weight: 700;
          font-size: var(--boxel-font-size-sm);
          background: var(--vendor-strong);
          color: var(--background, var(--boxel-light));
        }
        .hero-text {
          flex: 1;
          min-width: 0;
        }
        h1 {
          margin: 0;
          font-size: var(--boxel-font-size-xl);
          font-weight: 750;
          letter-spacing: -0.02em;
          line-height: 1.2;
          overflow-wrap: anywhere;
          font-family: var(--font-heading, inherit);
        }
        .byline {
          margin: var(--boxel-sp-5xs) 0 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .sep-dot {
          margin: 0 0.25rem;
        }
        .pill-row {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-5xs);
          margin-top: var(--boxel-sp-xs);
        }
        .pill {
          display: inline-flex;
          align-items: center;
          gap: 0.3rem;
          font-size: var(--boxel-font-size-xs);
          font-weight: 700;
          padding: 0.18em 0.5em;
          border-radius: 3px;
          white-space: nowrap;
        }
        .pill-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: currentColor;
          flex: none;
        }
        .hero-rating {
          flex: none;
          text-align: right;
        }
        .stars {
          font-size: 1.25rem;
          letter-spacing: 0.04em;
          color: var(--vendor-strong);
        }
        .star {
          opacity: 0.28;
        }
        .star.on {
          opacity: 1;
        }
        .rating-num {
          display: block;
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
        /* ---------- body: two columns ---------- */
        .body {
          display: grid;
          grid-template-columns: 1fr 17rem;
          /* Fill whatever height is left so the aside's surface reaches the
             bottom edge. Without this the grid is only as tall as its content
             and the panel stops mid-card, reading as a cut-off seam. */
          flex: 1;
          min-height: 0;
          align-content: start;
        }
        .main {
          padding: var(--boxel-sp-lg);
          min-width: 0;
        }
        .side {
          padding: var(--boxel-sp-lg);
          border-left: 1px solid var(--border, var(--boxel-200));
          background: var(--muted, var(--boxel-100));
        }
        .panel-title {
          margin: 0 0 var(--boxel-sp-xs);
          font-size: var(--boxel-font-size-sm);
          font-weight: 700;
          letter-spacing: -0.01em;
        }
        .panel-title.spaced {
          margin-top: var(--boxel-sp-lg);
        }
        /* ---------- real description lists ---------- */
        .facts {
          margin: 0;
          display: grid;
          grid-template-columns: 9rem 1fr;
        }
        .facts.stacked {
          grid-template-columns: 1fr;
        }
        .facts dt {
          font-size: var(--boxel-font-size-xs);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground, var(--boxel-450));
          padding: 0.45rem var(--boxel-sp-xs) 0.45rem 0;
          border-bottom: 1px solid var(--border, var(--boxel-200));
        }
        .facts.stacked dt {
          border-bottom: 0;
          padding-bottom: 0;
        }
        .facts dd {
          margin: 0;
          padding: 0.45rem 0;
          font-size: var(--boxel-font-size-sm);
          border-bottom: 1px solid var(--border, var(--boxel-200));
          overflow-wrap: anywhere;
          font-variant-numeric: tabular-nums;
        }
        .facts.stacked dd {
          padding-top: 0.1rem;
        }
        .dd-note {
          color: var(--muted-foreground, var(--boxel-450));
        }
        .side-note {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          line-height: 1.6;
          color: var(--muted-foreground, var(--boxel-450));
        }
        /* ---------- narrow container collapses to one column ---------- */
        @container iso (max-width: 40rem) {
          .body {
            grid-template-columns: 1fr;
          }
          .side {
            border-left: 0;
            border-top: 1px solid var(--border, var(--boxel-200));
          }
          .hero {
            flex-wrap: wrap;
          }
          .hero-rating {
            text-align: left;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='vendor-embedded'>
        <header>
          <h3>{{@model.title}}</h3>
          <span class='category'>{{@model.serviceCategory}}</span>
        </header>
        <dl class='facts'>
          <div><dt>Contact</dt><dd>{{@model.contactName}}</dd></div>
          <div><dt>Contract start</dt><dd><@fields.contractStart /></dd></div>
          <div><dt>Length</dt><dd><@fields.contractLength /></dd></div>
          <div><dt>Rating</dt><dd><@fields.performanceRating /></dd></div>
        </dl>
      </div>
      <style scoped>
        .vendor-embedded {
          padding: var(--boxel-sp);
          background: var(--card, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
          transition: box-shadow 0.15s ease-out;
        }
        header {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: var(--boxel-sp-xs);
        }
        h3 {
          margin: 0;
          font-size: var(--boxel-font-size);
        }
        .category {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
        }
        .facts {
          margin: var(--boxel-sp-xs) 0 0;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: var(--boxel-sp-xs);
        }
        .facts > div {
          min-width: 0;
        }
        .facts dt {
          font-size: var(--boxel-font-size-xs);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .facts dd {
          margin: var(--boxel-sp-5xs) 0 0;
          font-size: var(--boxel-font-size-sm);
          overflow-wrap: anywhere;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='vendor-atom'>
        <BuildingIcon class='vendor-atom-icon' />
        <span class='vendor-atom-name'>{{@model.title}}</span>
      </span>
      <style scoped>
        .vendor-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, var(--boxel-dark));
        }
        .vendor-atom-icon {
          width: 14px;
          height: 14px;
          color: var(--muted-foreground, var(--boxel-450));
          flex-shrink: 0;
        }
        .vendor-atom-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    get initials() {
      return initialsOf(this.args.model?.name);
    }

    get facts() {
      return contractFacts(this.args.model ?? {});
    }

    get contractPillStyle() {
      let c = stateColorOf(VENDOR_CONTRACT_COLORS, this.facts.state);
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }

    // Shortest truthful wording — this pill survives to the smallest tier, so
    // it has to fit a badge without being cut.
    get contractPillLabel() {
      let { state, monthsLeft } = this.facts;
      if (state === 'expired') {
        return 'Ended';
      }
      if (state === 'upcoming') {
        return 'Not started';
      }
      if (monthsLeft != null && monthsLeft <= RENEWAL_WINDOW_MONTHS) {
        return `${monthsLeft} mo left`;
      }
      return 'Active';
    }

    get contractEndShort() {
      let { end } = this.facts;
      return end ? end.toISOString().slice(0, 7) : undefined;
    }

    get contractStartShort() {
      let { start } = this.facts;
      return start ? start.toISOString().slice(0, 7) : undefined;
    }

    get stars() {
      let v = this.args.model?.performanceRating;
      let filled = typeof v === 'number' ? Math.round(v) : 0;
      return Array.from({ length: MAX_STARS }, (_, i) => i < filled);
    }

    get ratingLabel() {
      let v = this.args.model?.performanceRating;
      return typeof v === 'number' ? `${v} / ${MAX_STARS}` : undefined;
    }

    <template>
      <article class='fit'>
        <div class='fit-top'>
          <span class='avatar' aria-hidden='true'>{{this.initials}}</span>
          <div class='fit-head'>
            <h3 class='fit-name'>{{@model.title}}</h3>
            {{#if @model.serviceCategory}}
              <span class='fit-eb'>{{@model.serviceCategory}}</span>
            {{/if}}
          </div>
          {{! Status pill is the last thing to be dropped — never hidden. }}
          <span class='fit-pill' style={{this.contractPillStyle}}>
            <span class='pill-dot'></span>{{this.contractPillLabel}}
          </span>
        </div>

        {{#if this.ratingLabel}}
          <div class='fit-rating'>
            <span class='stars' aria-hidden='true'>
              {{#each this.stars as |on|}}
                <span class='star {{if on "on"}}'>&#9733;</span>
              {{/each}}
            </span>
            <span class='rating-text'>{{this.ratingLabel}}
              {{#if @model.contractLength.label}}
                &middot;
                {{@model.contractLength.label}}
              {{/if}}
            </span>
          </div>
        {{/if}}

        <dl class='fit-add'>
          {{#if @model.contactName}}
            <div><dt>Contact</dt><dd>{{@model.contactName}}</dd></div>
          {{/if}}
          {{#if this.contractStartShort}}
            <div><dt>From</dt><dd>{{this.contractStartShort}}</dd></div>
          {{/if}}
          {{#if this.contractEndShort}}
            <div><dt>Until</dt><dd>{{this.contractEndShort}}</dd></div>
          {{/if}}
          {{#if @model.email}}
            <div><dt>Email</dt><dd>{{@model.email}}</dd></div>
          {{/if}}
        </dl>
      </article>
      <style scoped>
        /* Four deliberate tiers. Each larger tier ADDS fields rather than
           enlarging the same ones; anything that cannot fit at a readable
           size is removed, never shrunk below the 11px floor. */
        .fit {
          height: 100%;
          /* Flex, not a three-row grid: with `minmax(0, 1fr)` in the middle
             a taller bottom block squeezed the middle row and clipped its
             text. Here the middle keeps its natural height and the extras
             block is pushed to the bottom by `margin-top: auto`. */
          display: flex;
          flex-direction: column;
          gap: 0.3rem;
          padding: 0.55rem 0.6rem;
          overflow: hidden;
          background: var(--card, var(--boxel-light));
          color: var(--card-foreground, var(--foreground, var(--boxel-dark)));
          font-family: var(--font-sans, var(--boxel-font-family));
          --vendor-id: var(--primary, var(--boxel-highlight));
          --vendor-strong: color-mix(
            in oklch,
            var(--vendor-id) 45%,
            var(--foreground, var(--boxel-dark))
          );
          /* 11px floor, scaling with the tile but never below readable. */
          --fit-name: clamp(11px, 3.2cqi, 15px);
          --fit-small: clamp(11px, 2.6cqi, 12px);
        }
        .fit > * {
          min-height: 0;
          overflow: hidden;
        }
        .fit-top {
          flex: none;
          display: flex;
          align-items: flex-start;
          gap: 0.4rem;
          flex-wrap: wrap;
        }
        .avatar {
          flex: none;
          width: 1.6rem;
          height: 1.6rem;
          border-radius: 50%;
          display: grid;
          place-items: center;
          font-size: var(--fit-small);
          font-weight: 700;
          background: var(--vendor-strong);
          color: var(--background, var(--boxel-light));
        }
        .fit-head {
          flex: 1;
          min-width: 0;
        }
        .fit-name {
          margin: 0;
          font-size: var(--fit-name);
          font-weight: 700;
          line-height: 1.25;
          letter-spacing: -0.01em;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        /* --- category: tier 2, hidden on the badge --- */
        .fit-eb {
          display: none;
          font-size: var(--fit-small);
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fit-pill {
          flex: none;
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          font-size: var(--fit-small);
          font-weight: 700;
          padding: 0.1em 0.4em;
          border-radius: 3px;
          white-space: nowrap;
          align-self: flex-start;
        }
        .pill-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: currentColor;
          flex: none;
        }
        /* --- rating: tier 3 --- */
        .fit-rating {
          flex: none;
          display: none;
          align-items: baseline;
          gap: 0.3rem;
          flex-wrap: wrap;
        }
        .stars {
          font-size: calc(var(--fit-name) * 1.05);
          letter-spacing: 0.03em;
          color: var(--vendor-strong);
          white-space: nowrap;
        }
        .star {
          opacity: 0.28;
        }
        .star.on {
          opacity: 1;
        }
        .rating-text {
          font-size: var(--fit-small);
          color: var(--muted-foreground, var(--boxel-450));
        }
        /* --- extra facts: tier 4, width-driven --- */
        .fit-add {
          display: none;
          margin: 0;
          margin-top: auto;
          padding-top: 0.3rem;
          border-top: 1px dashed var(--border, var(--boxel-200));
          grid-template-columns: 1fr 1fr;
          gap: 0.05rem 0.5rem;
        }
        .fit-add > div {
          display: flex;
          gap: 0.25rem;
          min-width: 0;
        }
        .fit-add dt {
          flex: none;
          font-size: var(--fit-small);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .fit-add dd {
          margin: 0;
          font-size: var(--fit-small);
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-variant-numeric: tabular-nums;
        }

        /* ===== TIER 2 — add the service category.
           Two rules rather than one, because container queries have no `or`:
           reached either by having vertical room, or by being a wide strip. */
        @container fitted-card (height > 80px) {
          .fit-eb {
            display: block;
          }
        }
        @container fitted-card (width > 240px) {
          .fit-eb {
            display: block;
          }
        }

        /* ===== TIER 3 — add the star rating + contract length. */
        @container fitted-card (height > 130px) and (width > 180px) {
          .fit-rating {
            display: flex;
          }
        }

        /* ===== TIER 4 — add four more facts. Width-driven, which is the tier
           the previous implementation was missing entirely. */
        @container fitted-card (height > 150px) and (width > 180px) {
          .fit-add {
            display: grid;
            grid-template-columns: 1fr;
          }
        }
        @container fitted-card (width > 340px) and (height > 130px) {
          .fit-add {
            display: grid;
            grid-template-columns: 1fr 1fr;
          }
        }

        /* ===== Short strip: go horizontal and drop the name to one line. */
        @container fitted-card (height <= 90px) {
          .fit {
            grid-template-rows: 1fr;
            align-content: center;
          }
          .fit-top {
            align-items: center;
            flex-wrap: nowrap;
          }
          .fit-pill {
            align-self: center;
          }
          .fit-name {
            -webkit-line-clamp: 1;
          }
        }

        /* ===== Smallest tier: the category goes, the pill stays. */
        @container fitted-card (height <= 50px) {
          .avatar {
            width: 1.25rem;
            height: 1.25rem;
          }
          .fit-eb {
            display: none;
          }
        }
      </style>
    </template>
  };
}
