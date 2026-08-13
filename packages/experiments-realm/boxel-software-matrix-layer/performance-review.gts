import {
  CardDef,
  Component,
  field,
  contains,
  linksTo,
  StringField,
  type BaseDefComponent,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import TextAreaField from '@cardstack/base/text-area';
import enumField from '@cardstack/base/enum';
import CalendarRangeIcon from '@cardstack/boxel-icons/calendar-range';
import ClipboardCheckIcon from '@cardstack/boxel-icons/clipboard-check';
import { htmlSafe } from '@ember/template';

import { Employee } from './employee';
import { ScorecardField } from './scorecard-field';
import { ApprovalChainField } from './approval-chain-field';
import { stateColor, stateColorOf, type StateColor } from './utils/index';

export const REVIEW_CYCLE_STATUSES = ['planned', 'active', 'closed'];

// Colocated with ReviewCycle — planned amber (upcoming, needs scheduling),
// active green (reviews are being written now), closed slate (archived).
export const REVIEW_CYCLE_STATUS_COLORS: Record<string, StateColor> = {
  planned: stateColor('amber'),
  active: stateColor('green'),
  closed: stateColor('slate'),
};

export const ReviewCycleStatusField = enumField(StringField, {
  options: REVIEW_CYCLE_STATUSES.map((status) => ({
    value: status,
    label: status,
  })),
  displayName: 'Review Cycle Status',
});

// The review's lifecycle mirrors its sign-off chain (see PerformanceReview's
// `status` computed): draft → in-review → signed-off.
export const REVIEW_STATUSES = ['draft', 'in-review', 'signed-off'];

export const REVIEW_STATUS_COLORS: Record<string, StateColor> = {
  draft: stateColor('slate'),
  'in-review': stateColor('amber'),
  'signed-off': stateColor('green'),
};

function shortDate(value?: Date | string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  let d = new Date(value);
  if (isNaN(d.getTime())) {
    return undefined;
  }
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function periodLabel(
  start?: Date | string | null,
  end?: Date | string | null,
): string | undefined {
  let s = shortDate(start);
  let e = shortDate(end);
  if (!s && !e) {
    return undefined;
  }
  if (s && e) {
    return `${s} – ${e}`;
  }
  return s ?? e;
}

// A named review period ("H2 2026 Reviews") that PerformanceReviews attach
// to via linksTo — the cycle itself does NOT hold a linksToMany of reviews;
// the app lists a cycle's reviews via a live query, so late-added reviews
// appear without touching the cycle card.
export class ReviewCycle extends CardDef {
  static displayName = 'Review Cycle';
  static icon = CalendarRangeIcon;

  @field name = contains(StringField, {
    description: 'Cycle name, e.g. "H2 2026 Reviews"',
  });
  @field periodStart = contains(DateField);
  @field periodEnd = contains(DateField);
  @field status = contains(ReviewCycleStatusField);
  @field description = contains(TextAreaField);

  @field title = contains(StringField, {
    computeVia: function (this: ReviewCycle) {
      return this.name?.trim() || 'Unnamed Cycle';
    },
  });

  // Stack header renders cardTitle (base fallback "Untitled <type>" when
  // cardInfo.name is unset) — route it through our computed title.
  @field cardTitle = contains(StringField, {
    computeVia: function (this: ReviewCycle) {
      return this.cardInfo?.name?.trim() || this.title;
    },
  });

  static isolated: BaseDefComponent = class Isolated extends Component<
    typeof this
  > {
    get statusPillStyle() {
      let c = stateColorOf(REVIEW_CYCLE_STATUS_COLORS, this.args.model?.status);
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }

    get period(): string | undefined {
      return periodLabel(
        this.args.model?.periodStart,
        this.args.model?.periodEnd,
      );
    }

    <template>
      <article class='cycle-isolated'>
        <header class='header'>
          <div class='header-top'>
            <h1>{{@model.title}}</h1>
            {{#if @model.status}}
              <span class='pill' style={{this.statusPillStyle}}>
                <span class='pill-dot'></span>{{@model.status}}
              </span>
            {{/if}}
          </div>
          {{#if this.period}}
            <p class='period'>{{this.period}}</p>
          {{/if}}
        </header>

        <div class='body'>
          {{#if @model.description}}
            <section class='section'>
              <h2 class='section-title'>About this cycle</h2>
              <p class='description'>{{@model.description}}</p>
            </section>
          {{/if}}

          <section class='section note'>
            <h2 class='section-title'>Reviews</h2>
            <p class='note-text'>Performance reviews attach to this cycle via
              their own
              <code>cycle</code>
              link — the tracker lists them with a live query, so this card
              stays untouched as reviews are added.</p>
          </section>
        </div>
      </article>
      <style scoped>
        .cycle-isolated {
          height: 100%;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
        }
        .header {
          flex: none;
          padding: var(--boxel-sp-lg);
          border-bottom: 1px solid var(--border, var(--boxel-200));
        }
        .header-top {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: var(--boxel-sp-sm);
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
        .period {
          margin: var(--boxel-sp-xs) 0 0;
          font-size: var(--boxel-font-size-sm);
          font-weight: 600;
          font-variant-numeric: tabular-nums;
          color: var(--muted-foreground, var(--boxel-450));
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
          flex: none;
        }
        .pill-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: currentColor;
          flex: none;
        }
        .body {
          flex: 1;
          padding: var(--boxel-sp-lg);
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-lg);
        }
        .section {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-sm);
          min-width: 0;
        }
        .section-title {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .description {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          line-height: 1.6;
          max-width: 56ch;
        }
        .note {
          padding: var(--boxel-sp-sm);
          background: var(--muted, var(--boxel-100));
          border-radius: var(--boxel-border-radius);
        }
        .note-text {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          line-height: 1.6;
          color: var(--muted-foreground, var(--boxel-450));
        }
        code {
          font-size: 0.85em;
        }
      </style>
    </template>
  };

  static embedded: BaseDefComponent = class Embedded extends Component<
    typeof this
  > {
    get statusPillStyle() {
      let c = stateColorOf(REVIEW_CYCLE_STATUS_COLORS, this.args.model?.status);
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }

    get period(): string | undefined {
      return periodLabel(
        this.args.model?.periodStart,
        this.args.model?.periodEnd,
      );
    }

    <template>
      <article class='cycle-embedded'>
        <div class='content'>
          <span class='name'>{{@model.title}}</span>
          {{#if this.period}}
            <span class='period'>{{this.period}}</span>
          {{/if}}
        </div>
        {{#if @model.status}}
          <span class='pill' style={{this.statusPillStyle}}>{{@model.status}}
          </span>
        {{/if}}
      </article>
      <style scoped>
        .cycle-embedded {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          padding: 0.625rem 0.75rem;
          font-size: 0.8125rem;
        }
        .content {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 0.0625rem;
        }
        .name {
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .period {
          font-size: 0.6875rem;
          color: var(--muted-foreground, var(--boxel-450));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }
        .pill {
          flex: none;
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 0.125rem 0.4375rem;
          border-radius: 999px;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static fitted: BaseDefComponent = class Fitted extends Component<
    typeof this
  > {
    get statusPillStyle() {
      let c = stateColorOf(REVIEW_CYCLE_STATUS_COLORS, this.args.model?.status);
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }

    get period(): string | undefined {
      return periodLabel(
        this.args.model?.periodStart,
        this.args.model?.periodEnd,
      );
    }

    <template>
      <article class='fit'>
        <div class='fit-top'>
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
          {{#if this.period}}
            <span class='fit-sub'>{{this.period}}</span>
          {{/if}}
        </div>

        {{#if @model.description}}
          <div class='fit-add'>
            <p class='fit-desc'>{{@model.description}}</p>
          </div>
        {{/if}}
      </article>
      <style scoped>
        /* Tiered like its siblings: name + status always, period joins above
           the 50px strip, and the cycle description fills the tall cells
           (Full Card, Expanded). 11px floor. */
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
        .fit-sub {
          font-size: var(--fit-small);
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-variant-numeric: tabular-nums;
        }
        .fit-add {
          display: none;
          margin-top: auto;
          padding-top: 0.3rem;
          border-top: 1px dashed var(--border, var(--boxel-200));
        }
        .fit-desc {
          margin: 0;
          font-size: var(--fit-small);
          color: var(--muted-foreground, var(--boxel-450));
          line-height: 1.45;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        @container fitted-card (height > 50px) {
          .fit-mid {
            display: flex;
          }
        }
        /* TIER 3 — description fills the tall cells. */
        @container fitted-card (height >= 170px) and (width >= 170px) {
          .fit-add {
            display: block;
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

  static atom: BaseDefComponent = class Atom extends Component<typeof this> {
    <template>
      <span class='cycle-atom'>
        <span class='atom-name'>{{@model.title}}</span>
        {{#if @model.status}}
          <span class='atom-status'>{{@model.status}}</span>
        {{/if}}
      </span>
      <style scoped>
        .cycle-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, var(--boxel-dark));
        }
        .atom-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .atom-status {
          flex: none;
          font-size: var(--boxel-font-size-xs);
          padding: 0.1em 0.3em;
          border-radius: 2px;
          background: var(--muted, var(--boxel-100));
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
        }
      </style>
    </template>
  };
}

// A point-in-time review of one employee within one cycle. The SECOND
// consumer of ScorecardField (after Meeting's interview scorecard — its
// criteria become review dimensions like "Delivery" or "Collaboration") and
// the FIFTH of ApprovalChainField (the employee-acknowledge + HR-approve
// sign-off chain).
export class PerformanceReview extends CardDef {
  static displayName = 'Performance Review';
  static icon = ClipboardCheckIcon;

  // One-directional by design — a deliberate live-query choice over a
  // linksToMany back-reference on Employee, matching PtoRequest's employee link.
  @field employee = linksTo(() => Employee);
  @field reviewer = linksTo(() => Employee);
  @field cycle = linksTo(() => ReviewCycle);
  // Reused UNCHANGED from scorecard-field.gts — criteria + recommendation +
  // averageScore, exactly as Meeting consumes it.
  @field scorecard = contains(ScorecardField);
  @field selfAssessment = contains(TextAreaField);
  @field managerSummary = contains(TextAreaField);
  // Reused UNCHANGED from approval-chain-field.gts: step 0 is the employee's
  // own acknowledgement, step 1 HR's approval.
  @field signOff = contains(ApprovalChainField);

  // draft (no sign-off chain yet) → in-review (chain configured but not
  // fully approved — includes a rejected/sent-back chain, which loops back
  // into review) → signed-off.
  @field status = contains(StringField, {
    computeVia: function (this: PerformanceReview) {
      if (!this.signOff?.steps?.length) {
        return 'draft';
      }
      return this.signOff.status === 'approved' ? 'signed-off' : 'in-review';
    },
  });

  // Denormalized for fitted — prerendered fitted does not resolve linksTo.
  @field employeeName = contains(StringField, {
    computeVia: function (this: PerformanceReview) {
      return this.employee?.name ?? '';
    },
  });

  @field reviewerName = contains(StringField, {
    computeVia: function (this: PerformanceReview) {
      return this.reviewer?.name ?? '';
    },
  });

  @field cycleName = contains(StringField, {
    computeVia: function (this: PerformanceReview) {
      return this.cycle?.name ?? '';
    },
  });

  // Denormalized score label — fitted-safe scalar derived from the
  // scorecard's own computed average. '' (not undefined) when unscored so
  // the tile row hides cleanly.
  @field scoreLabel = contains(StringField, {
    computeVia: function (this: PerformanceReview) {
      let avg = this.scorecard?.averageScore;
      return typeof avg === 'number' ? `${avg} / 5` : '';
    },
  });

  @field title = contains(StringField, {
    computeVia: function (this: PerformanceReview) {
      let name = this.employeeName?.trim() || 'Unassigned review';
      let cycle = this.cycleName?.trim();
      return cycle ? `${name} — ${cycle}` : name;
    },
  });

  // Stack header renders cardTitle (base fallback "Untitled <type>" when
  // cardInfo.name is unset) — route it through our computed title.
  @field cardTitle = contains(StringField, {
    computeVia: function (this: PerformanceReview) {
      return this.cardInfo?.name?.trim() || this.title;
    },
  });

  static isolated: BaseDefComponent = class Isolated extends Component<
    typeof this
  > {
    get statusPillStyle() {
      let c = stateColorOf(REVIEW_STATUS_COLORS, this.args.model?.status);
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }

    <template>
      <article class='review-isolated'>
        <header class='header'>
          <div class='header-top'>
            <div class='header-text'>
              <h1>{{if
                  @model.employeeName
                  @model.employeeName
                  'Unassigned review'
                }}</h1>
              <p class='byline'>
                {{#if @model.cycle}}
                  <@fields.cycle @format='atom' @displayContainer={{false}} />
                {{/if}}
                {{#if @model.reviewerName}}
                  <span class='byline-sep'>&middot;</span>
                  reviewed by
                  {{@model.reviewerName}}
                {{/if}}
              </p>
            </div>
            <div class='header-side'>
              {{#if @model.status}}
                <span class='pill' style={{this.statusPillStyle}}>
                  <span class='pill-dot'></span>{{@model.status}}
                </span>
              {{/if}}
              {{#if @model.scoreLabel}}
                <span class='score'>{{@model.scoreLabel}}</span>
              {{/if}}
            </div>
          </div>
        </header>

        <div class='body'>
          <section class='section panel'>
            <h2 class='section-title'>Scorecard</h2>
            <@fields.scorecard @format='embedded' />
          </section>

          {{#if @model.selfAssessment}}
            <section class='section'>
              <h2 class='section-title'>Self-assessment</h2>
              <p class='prose'>{{@model.selfAssessment}}</p>
            </section>
          {{/if}}

          {{#if @model.managerSummary}}
            <section class='section'>
              <h2 class='section-title'>Manager summary</h2>
              <p class='prose'>{{@model.managerSummary}}</p>
            </section>
          {{/if}}

          <section class='section panel'>
            <h2 class='section-title'>Sign-off</h2>
            <@fields.signOff @format='embedded' />
          </section>
        </div>
      </article>
      <style scoped>
        .review-isolated {
          height: 100%;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
        }
        .header {
          flex: none;
          padding: var(--boxel-sp-lg);
          border-bottom: 1px solid var(--border, var(--boxel-200));
        }
        .header-top {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: var(--boxel-sp-sm);
        }
        .header-text {
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
          margin: var(--boxel-sp-xs) 0 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 0.25rem;
        }
        .byline-sep {
          margin: 0 0.1rem;
        }
        .header-side {
          flex: none;
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: var(--boxel-sp-5xs);
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
        .score {
          font-size: 1.25rem;
          font-weight: 800;
          letter-spacing: -0.02em;
          font-variant-numeric: tabular-nums;
        }
        .body {
          flex: 1;
          padding: var(--boxel-sp-lg);
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-lg);
        }
        .section {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-sm);
          min-width: 0;
        }
        .section-title {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .prose {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          line-height: 1.65;
          max-width: 56ch;
          white-space: pre-line;
        }
        .panel {
          padding: var(--boxel-sp-sm);
          background: var(--card, var(--boxel-light));
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--boxel-border-radius);
        }
      </style>
    </template>
  };

  static embedded: BaseDefComponent = class Embedded extends Component<
    typeof this
  > {
    get statusPillStyle() {
      let c = stateColorOf(REVIEW_STATUS_COLORS, this.args.model?.status);
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }

    <template>
      <article class='review-embedded'>
        <div class='content'>
          <span class='name'>{{if
              @model.employeeName
              @model.employeeName
              'Unassigned'
            }}</span>
          {{#if @model.cycleName}}
            <span class='cycle'>{{@model.cycleName}}</span>
          {{/if}}
        </div>
        {{#if @model.scoreLabel}}
          <span class='score'>{{@model.scoreLabel}}</span>
        {{/if}}
        {{#if @model.status}}
          <span class='pill' style={{this.statusPillStyle}}>{{@model.status}}
          </span>
        {{/if}}
      </article>
      <style scoped>
        .review-embedded {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          padding: 0.625rem 0.75rem;
          font-size: 0.8125rem;
        }
        .content {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 0.0625rem;
        }
        .name {
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .cycle {
          font-size: 0.6875rem;
          color: var(--muted-foreground, var(--boxel-450));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .score {
          flex: none;
          font-weight: 700;
          font-variant-numeric: tabular-nums;
        }
        .pill {
          flex: none;
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 0.125rem 0.4375rem;
          border-radius: 999px;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static fitted: BaseDefComponent = class Fitted extends Component<
    typeof this
  > {
    get statusPillStyle() {
      let c = stateColorOf(REVIEW_STATUS_COLORS, this.args.model?.status);
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }

    // Attribute-only: employeeName/cycleName/scoreLabel/status are the
    // review's OWN denormalized/computed-scalar attributes — no linksTo read
    // happens in this prerendered format.
    <template>
      <article class='fit'>
        <div class='fit-top'>
          <div class='fit-head'>
            <h3 class='fit-name'>{{if
                @model.employeeName
                @model.employeeName
                'Unassigned'
              }}</h3>
          </div>
          {{#if @model.status}}
            <span class='fit-pill' style={{this.statusPillStyle}}>
              <span class='pill-dot'></span>{{@model.status}}
            </span>
          {{/if}}
        </div>

        <div class='fit-mid'>
          {{#if @model.scoreLabel}}
            <span class='money'>{{@model.scoreLabel}}</span>
          {{/if}}
          {{#if @model.cycleName}}
            <span class='fit-sub cycle'>{{@model.cycleName}}</span>
          {{/if}}
        </div>

        {{#if @model.managerSummary}}
          <p class='fit-summary'>{{@model.managerSummary}}</p>
        {{/if}}

        <dl class='fit-add'>
          {{#if @model.reviewerName}}
            <div><dt>Reviewer</dt><dd>{{@model.reviewerName}}</dd></div>
          {{/if}}
          {{#if @model.signOff.steps.length}}
            <div><dt>Sign-offs</dt><dd>{{@model.signOff.currentStepIndex}}
                of
                {{@model.signOff.steps.length}}</dd></div>
          {{/if}}
        </dl>
      </article>
      <style scoped>
        /* Four tiers, each ADDING fields. 11px floor. Name + status never
           hidden. Tier 2 adds the average score, tier 3 the cycle, tier 4
           reviewer + sign-off progress. */
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
        .fit-sub.cycle {
          display: none;
        }
        .fit-summary {
          display: none;
          margin: 0;
          font-size: var(--fit-small);
          color: var(--muted-foreground, var(--boxel-450));
          line-height: 1.45;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
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
          font-variant-numeric: tabular-nums;
        }

        /* TIER 2 — average score joins above the 50px strip. */
        @container fitted-card (height > 50px) {
          .fit-mid {
            display: flex;
          }
        }
        /* TIER 3 — cycle name. */
        @container fitted-card (height > 80px) {
          .fit-sub.cycle {
            display: block;
          }
        }
        @container fitted-card (width > 240px) and (height > 50px) {
          .fit-sub.cycle {
            display: block;
          }
        }
        /* TIER 4 — reviewer + sign-off progress. */
        @container fitted-card (height > 130px) and (width >= 170px) {
          .fit-add {
            display: grid;
            grid-template-columns: 1fr;
          }
        }
        /* TIER 5 — manager-summary excerpt on tall cells. */
        @container fitted-card (height >= 170px) and (width >= 170px) {
          .fit-summary {
            display: -webkit-box;
          }
        }
        @container fitted-card (width > 340px) and (height > 130px) {
          .fit-add {
            display: grid;
            grid-template-columns: 1fr 1fr;
          }
        }
        /* Short strip: horizontal, single-line name; the tall score figure
           yields to the strip. */
        @container fitted-card (height <= 80px) {
          .money {
            font-size: var(--fit-small);
            font-weight: 700;
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

  static atom: BaseDefComponent = class Atom extends Component<typeof this> {
    <template>
      <span class='review-atom'>
        <ClipboardCheckIcon class='atom-icon' />
        <span class='atom-name'>{{@model.title}}</span>
        {{#if @model.scoreLabel}}
          <span class='atom-score'>{{@model.scoreLabel}}</span>
        {{/if}}
      </span>
      <style scoped>
        .review-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, var(--boxel-dark));
        }
        .atom-icon {
          width: 14px;
          height: 14px;
          color: var(--muted-foreground, var(--boxel-450));
          flex-shrink: 0;
        }
        .atom-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .atom-score {
          flex: none;
          font-size: var(--boxel-font-size-xs);
          padding: 0.1em 0.3em;
          border-radius: 2px;
          background: var(--muted, var(--boxel-100));
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }
      </style>
    </template>
  };
}
