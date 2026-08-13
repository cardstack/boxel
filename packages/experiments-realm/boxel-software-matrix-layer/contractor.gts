import {
  Component,
  field,
  contains,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import NumberField from '@cardstack/base/number';
import enumField from '@cardstack/base/enum';
import ShieldIcon from '@cardstack/boxel-icons/shield';
import { htmlSafe } from '@ember/template';

import { PersonBase } from './person-base';
import { Project } from './project';
import { Vendor } from './vendor';
import { stateColor, stateColorOf, type StateColor } from './utils/index';

// Inside this window the contract window turns amber; past zero it turns red.
const EXPIRY_WARNING_DAYS = 30;

// Signed variant of utils' daysBetween — that helper clamps at 0
// (Math.max(0, …)), which is right for "days since applied" but erases the
// difference between "ends today" and "ended three weeks ago". A contract
// window needs the sign.
function signedDaysUntil(date?: Date | string | null): number | undefined {
  if (!date) {
    return undefined;
  }
  let end = new Date(date);
  if (isNaN(end.getTime())) {
    return undefined;
  }
  return Math.round((end.getTime() - Date.now()) / 86400000);
}

// Shared by every format so a tile and the isolated view can never disagree
// about how urgent the same end date is.
export function expiryTone(
  days: number | undefined,
): 'expired' | 'warning' | undefined {
  if (days == null) {
    return undefined;
  }
  if (days < 0) {
    return 'expired';
  }
  if (days <= EXPIRY_WARNING_DAYS) {
    return 'warning';
  }
  return undefined;
}

export const EXPIRY_TONE_COLORS: Record<string, StateColor> = {
  warning: stateColor('amber'),
  expired: stateColor('red'),
};

export const CONTRACTOR_STATUSES = ['active', 'inactive', 'terminated'];

export const CONTRACTOR_STATUS_COLORS: Record<string, StateColor> = {
  active: stateColor('green'),
  inactive: stateColor('amber'),
  terminated: stateColor('red'),
};

export const ContractorStatusField = enumField(StringField, {
  options: CONTRACTOR_STATUSES.map((status) => ({
    value: status,
    label: status,
  })),
  displayName: 'Contract Status',
});

export const InvoiceFrequencyOptions = ['monthly', 'quarterly', 'annually'];

export const InvoiceFrequencyField = enumField(StringField, {
  options: InvoiceFrequencyOptions.map((freq) => ({
    value: freq,
    label: freq,
  })),
  displayName: 'Invoice Frequency',
});

export class Contractor extends PersonBase {
  static displayName = 'Contractor';
  static icon = ShieldIcon;

  @field status = contains(ContractorStatusField);
  @field billableRate = contains(NumberField, {
    description: 'Hourly or day rate in dollars',
  });
  @field vatId = contains(StringField, {
    description: 'VAT ID for invoicing',
  });
  @field invoiceFrequency = contains(InvoiceFrequencyField);
  @field contractStartDate = contains(DateField);
  @field contractEndDate = contains(DateField, {
    description: 'When the current contract window closes',
  });
  // One-directional by design — a deliberate live-query choice over a
  // linksToMany back-reference on Contractor, matching PtoRequest's employee link.
  @field vendor = linksTo(() => Vendor, {
    description: 'Agency or supplier this contractor comes through',
  });
  // One-directional by design — a deliberate live-query choice over a
  // linksToMany back-reference on Contractor, matching PtoRequest's employee link.
  @field project = linksTo(() => Project, {
    description: 'Project this contractor is currently staffed on',
  });

  // Signed days until the contract window closes; negative once expired,
  // undefined when no end date is set (an open-ended engagement is not the
  // same fact as one expiring today).
  @field daysRemaining = contains(NumberField, {
    computeVia: function (this: Contractor) {
      return signedDaysUntil(this.contractEndDate);
    },
  });

  // Denormalized for fitted — prerendered fitted reads this own attribute
  // instead of re-deriving from contractEndDate at render time, and the
  // grid stays truthful even before hydration. '' (not undefined) when
  // open-ended so the tile row simply doesn't render.
  @field expiryLabel = contains(StringField, {
    computeVia: function (this: Contractor) {
      let days = signedDaysUntil(this.contractEndDate);
      if (days == null) {
        return '';
      }
      if (days < 0) {
        return 'expired';
      }
      if (days === 0) {
        return 'ends today';
      }
      return `${days}d left`;
    },
  });

  // Denormalized for fitted — prerendered fitted does not resolve linksTo,
  // so the tall tiles read these own attributes instead of walking
  // vendor/project. Same pattern as OnboardingChecklist.personName.
  @field vendorName = contains(StringField, {
    computeVia: function (this: Contractor) {
      return this.vendor?.name ?? '';
    },
  });

  @field projectName = contains(StringField, {
    computeVia: function (this: Contractor) {
      return this.project?.name ?? '';
    },
  });

  @field title = contains(StringField, {
    computeVia: function (this: Contractor) {
      return this.name?.trim() || 'Unnamed Contractor';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    get statusColor() {
      return stateColorOf(
        CONTRACTOR_STATUS_COLORS,
        this.args.model?.status,
      );
    }

    get statusPillStyle() {
      return htmlSafe(
        `background: ${this.statusColor.bg}; color: ${this.statusColor.fg};`,
      );
    }

    get rateLabel(): string | undefined {
      let rate = this.args.model?.billableRate;
      if (rate == null) {
        return undefined;
      }
      return `$${rate}/hr`;
    }

    get expiryToneKey(): string | undefined {
      return expiryTone(this.args.model?.daysRemaining ?? undefined);
    }

    get daysRemainingLabel(): string | undefined {
      let days = this.args.model?.daysRemaining;
      if (days == null) {
        return undefined;
      }
      if (days < 0) {
        return `expired ${Math.abs(days)}d ago`;
      }
      if (days === 0) {
        return 'ends today';
      }
      return `${days} days remaining`;
    }

    get daysRemainingStyle() {
      let tone = this.expiryToneKey;
      if (!tone) {
        return htmlSafe('');
      }
      let c = stateColorOf(EXPIRY_TONE_COLORS, tone);
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }

    <template>
      <article class='contractor-isolated'>
        <header class='hero'>
          {{#if @model.photo.resolvedUrl}}
            <img
              class='avatar avatar-photo'
              src={{@model.photo.resolvedUrl}}
              alt=''
            />
          {{else}}
            <span class='avatar'>{{@model.initials}}</span>
          {{/if}}
          <div class='hero-text'>
            <h1>{{@model.title}}</h1>
            <p class='byline'>Contractor</p>
            <div class='pill-row'>
              {{#if @model.status}}
                <span class='pill' style={{this.statusPillStyle}}>
                  <span class='pill-dot'></span>{{@model.status}}
                </span>
              {{/if}}
              {{#if this.rateLabel}}
                <span class='pill neutral'>{{this.rateLabel}}</span>
              {{/if}}
            </div>
          </div>
        </header>

        <div class='body'>
          <div class='main'>
            <h2 class='panel-title'>Contact</h2>
            <dl class='facts'>
              <dt>Email</dt>
              <dd>{{if @model.email @model.email '—'}}</dd>
              <dt>Phone</dt>
              <dd>{{if @model.phone @model.phone '—'}}</dd>
            </dl>

            <h2 class='panel-title spaced'>Rate & Terms</h2>
            <dl class='facts'>
              <dt>Billable rate</dt>
              <dd>{{if this.rateLabel this.rateLabel '—'}}</dd>
              <dt>Invoice frequency</dt>
              <dd>{{if
                  @model.invoiceFrequency
                  @model.invoiceFrequency
                  '—'
                }}</dd>
            </dl>
          </div>

          <aside class='side'>
            <h2 class='panel-title'>Contract</h2>
            <dl class='facts stacked'>
              <dt>Status</dt>
              <dd>{{if @model.status @model.status '—'}}</dd>
              <dt>Starts</dt>
              <dd>{{#if @model.contractStartDate}}<@fields.contractStartDate
                  />{{else}}&mdash;{{/if}}</dd>
              <dt>Ends</dt>
              <dd>{{#if @model.contractEndDate}}<@fields.contractEndDate
                  />{{else}}&mdash; open-ended{{/if}}</dd>
              <dt>Remaining</dt>
              <dd>{{#if this.daysRemainingLabel}}
                  <span
                    class='remaining {{if this.expiryToneKey "toned"}}'
                    style={{this.daysRemainingStyle}}
                  >{{this.daysRemainingLabel}}</span>
                {{else}}&mdash;{{/if}}</dd>
              <dt>Vendor</dt>
              <dd>{{#if @model.vendor}}<@fields.vendor
                    @format='atom'
                    @displayContainer={{false}}
                  />{{else}}&mdash; direct{{/if}}</dd>
              <dt>Project</dt>
              <dd>{{#if @model.project}}<@fields.project
                    @format='atom'
                    @displayContainer={{false}}
                  />{{else}}&mdash; unassigned{{/if}}</dd>
              <dt>VAT ID</dt>
              <dd>{{if @model.vatId @model.vatId '—'}}</dd>
            </dl>
          </aside>
        </div>
      </article>
      <style scoped>
        .contractor-isolated {
          container-type: inline-size;
          container-name: iso;
          height: 100%;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
          --contractor-id: var(--primary, var(--boxel-highlight));
          --contractor-strong: color-mix(
            in oklch,
            var(--contractor-id) 45%,
            var(--foreground, var(--boxel-dark))
          );
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
          background: var(--contractor-strong);
          color: var(--background, var(--boxel-light));
        }
        .avatar-photo {
          object-fit: cover;
        }
        .hero {
          flex: none;
          display: flex;
          align-items: flex-start;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp-lg);
          border-bottom: 1px solid var(--border, var(--boxel-200));
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
        .pill.neutral {
          background: var(--muted, var(--boxel-100));
          color: var(--muted-foreground, var(--boxel-450));
        }
        .pill-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: currentColor;
          flex: none;
        }
        .body {
          display: grid;
          grid-template-columns: 1fr 17rem;
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
        }
        .panel-title.spaced {
          margin-top: var(--boxel-sp-lg);
        }
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
        }
        .facts.stacked dd {
          padding-top: 0.1rem;
        }
        .remaining.toned {
          display: inline-flex;
          font-size: var(--boxel-font-size-xs);
          font-weight: 700;
          padding: 0.18em 0.5em;
          border-radius: 3px;
          white-space: nowrap;
        }
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
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get statusStyle() {
      let c = stateColorOf(
        CONTRACTOR_STATUS_COLORS,
        this.args.model?.status,
      );
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }

    // Chip only appears when the window is closing (or closed) — an
    // expiry that needs no action is noise in a one-line row.
    get expiryChipStyle() {
      let tone = expiryTone(this.args.model?.daysRemaining ?? undefined);
      if (!tone) {
        return undefined;
      }
      let c = stateColorOf(EXPIRY_TONE_COLORS, tone);
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }

    <template>
      <div class='contractor-embedded'>
        {{#if @model.photo.resolvedUrl}}
          <img class='ce-avatar' src={{@model.photo.resolvedUrl}} alt='' />
        {{else}}
          <span class='ce-avatar ce-initials'>{{@model.initials}}</span>
        {{/if}}
        <div class='ce-main'>
          <span class='ce-name'>{{if @model.name @model.name 'Unnamed'}}</span>
        </div>
        <div class='ce-side'>
          {{#if @model.status}}
            <span
              class='ce-status'
              style={{this.statusStyle}}
            >{{@model.status}}</span>
          {{/if}}
          {{#if this.expiryChipStyle}}
            <span
              class='ce-status'
              style={{this.expiryChipStyle}}
            >{{@model.expiryLabel}}</span>
          {{/if}}
        </div>
      </div>
      <style scoped>
        .contractor-embedded {
          display: flex;
          align-items: center;
          gap: 0.625rem;
          padding: 0.625rem 0.75rem;
          font-size: 0.8125rem;
        }
        .ce-avatar {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          object-fit: cover;
          flex-shrink: 0;
        }
        .ce-initials {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: var(--muted, var(--boxel-100));
          color: var(--muted-foreground, var(--boxel-450));
          font-size: 0.6875rem;
          font-weight: 700;
        }
        .ce-main {
          display: flex;
          flex-direction: column;
          gap: 0.0625rem;
          min-width: 0;
          flex: 1;
        }
        .ce-name {
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ce-side {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 0.1875rem;
          flex-shrink: 0;
        }
        .ce-status {
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 0.125rem 0.4375rem;
          border-radius: 999px;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    get expiryChipStyle() {
      let tone = expiryTone(this.args.model?.daysRemaining ?? undefined);
      if (!tone) {
        return undefined;
      }
      let c = stateColorOf(EXPIRY_TONE_COLORS, tone);
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }

    <template>
      <span class='contractor-atom'>
        <span class='contractor-atom-name'>{{@model.title}}</span>
        {{#if this.expiryChipStyle}}
          <span
            class='contractor-atom-chip'
            style={{this.expiryChipStyle}}
          >{{@model.expiryLabel}}</span>
        {{/if}}
      </span>
      <style scoped>
        .contractor-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, var(--boxel-dark));
        }
        .contractor-atom-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .contractor-atom-chip {
          flex: none;
          font-size: 0.6875rem;
          font-weight: 700;
          padding: 0.1em 0.4em;
          border-radius: 3px;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    get statusColor() {
      return stateColorOf(
        CONTRACTOR_STATUS_COLORS,
        this.args.model?.status,
      );
    }

    get statusPillStyle() {
      return htmlSafe(
        `background: ${this.statusColor.bg}; color: ${this.statusColor.fg};`,
      );
    }

    get rateLabel(): string | undefined {
      let rate = this.args.model?.billableRate;
      if (rate == null) {
        return undefined;
      }
      return `$${rate}/hr`;
    }

    // Attribute-only: expiryLabel and daysRemaining are the contractor's OWN
    // (denormalized/computed-scalar) attributes — no linksTo read happens in
    // this prerendered format.
    get expiryChipStyle() {
      let tone = expiryTone(this.args.model?.daysRemaining ?? undefined);
      if (!tone) {
        return undefined;
      }
      let c = stateColorOf(EXPIRY_TONE_COLORS, tone);
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }

    <template>
      <article class='fit'>
        <div class='fit-top'>
          {{#if @model.photo.resolvedUrl}}
            <img
              class='avatar avatar-photo'
              src={{@model.photo.resolvedUrl}}
              alt=''
            />
          {{else}}
            <span class='avatar'>{{@model.initials}}</span>
          {{/if}}
          <div class='fit-head'>
            <h3 class='fit-name'>{{@model.title}}</h3>
          </div>
          {{#if @model.status}}
            <span class='fit-pill' style={{this.statusPillStyle}}>
              <span class='pill-dot'></span>{{@model.status}}
            </span>
          {{/if}}
        </div>

        <div class='fit-mid'>
          {{#if this.rateLabel}}
            <span class='money'>{{this.rateLabel}}</span>
          {{/if}}
          {{#if @model.expiryLabel}}
            {{#if this.expiryChipStyle}}
              <span
                class='fit-expiry'
                style={{this.expiryChipStyle}}
              >{{@model.expiryLabel}}</span>
            {{else}}
              <span class='fit-sub'>{{@model.expiryLabel}}</span>
            {{/if}}
          {{/if}}
        </div>

        <dl class='fit-add'>
          {{#if @model.contractEndDate}}
            <div><dt>Ends</dt><dd><@fields.contractEndDate /></dd></div>
          {{/if}}
          {{#if @model.invoiceFrequency}}
            <div><dt>Invoice</dt><dd>{{@model.invoiceFrequency}}</dd></div>
          {{/if}}
          {{#if @model.vatId}}
            <div><dt>VAT</dt><dd>{{@model.vatId}}</dd></div>
          {{/if}}
          {{! Denormalized own attributes — safe in prerendered fitted. }}
          {{#if @model.vendorName}}
            <div class='deep'><dt>Vendor</dt><dd>{{@model.vendorName}}</dd></div>
          {{/if}}
          {{#if @model.projectName}}
            <div class='deep'><dt>Project</dt><dd>{{@model.projectName}}</dd></div>
          {{/if}}
        </dl>
      </article>
      <style scoped>
        .fit {
          height: 100%;
          display: flex;
          flex-direction: column;
          gap: 0.28rem;
          padding: 0.55rem 0.6rem;
          overflow: hidden;
          background: var(--card, var(--boxel-light));
          color: var(--card-foreground, var(--foreground, var(--boxel-dark)));
          font-family: var(--font-sans, var(--boxel-font-family));
          --contractor-id: var(--primary, var(--boxel-highlight));
          --contractor-strong: color-mix(
            in oklch,
            var(--contractor-id) 45%,
            var(--foreground, var(--boxel-dark))
          );
          --fit-name: clamp(11px, 3.2cqi, 15px);
          --fit-small: clamp(11px, 2.6cqi, 12px);
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
          background: var(--contractor-strong);
          color: var(--background, var(--boxel-light));
        }
        .avatar-photo {
          object-fit: cover;
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
          overflow: visible;
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
        .fit-pill {
          flex: none;
          align-self: flex-start;
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          font-size: var(--fit-small);
          font-weight: 700;
          padding: 0.1em 0.4em;
          border-radius: 3px;
          white-space: nowrap;
        }
        .pill-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: currentColor;
          flex: none;
        }
        .fit-mid {
          flex: none;
          display: none;
          flex-direction: column;
          gap: 1px;
        }
        .money {
          font-size: calc(var(--fit-name) * 1.15);
          font-weight: 800;
          letter-spacing: -0.02em;
          font-variant-numeric: tabular-nums;
        }
        .fit-sub {
          font-size: var(--fit-small);
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fit-expiry {
          align-self: flex-start;
          font-size: var(--fit-small);
          font-weight: 700;
          padding: 0.1em 0.4em;
          border-radius: 3px;
          white-space: nowrap;
        }
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
        }

        /* Vendor/project rows only join on the tall cells. */
        .fit-add > .deep {
          display: none;
        }

        @container fitted-card (height > 80px) {
          .fit-mid {
            display: flex;
          }
        }
        @container fitted-card (width > 240px) {
          .fit-mid {
            display: flex;
          }
        }
        /* Double Strip (250×65): the expiry chip row half-clips — the rate
           figure alone fits, so the chip yields below 105px. */
        @container fitted-card (height < 105px) {
          .fit-expiry,
          .fit-mid .fit-sub {
            display: none;
          }
        }
        @container fitted-card (height > 130px) and (width >= 170px) {
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
        /* TIER 5 — vendor + project names on tall cells. */
        @container fitted-card (height >= 170px) and (width >= 170px) {
          .fit-add > .deep {
            display: flex;
          }
        }
        @container fitted-card (height <= 90px) {
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
      </style>
    </template>
  };
}
