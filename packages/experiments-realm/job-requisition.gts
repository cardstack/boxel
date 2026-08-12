import {
  CardDef,
  Component,
  field,
  contains,
  linksToMany,
  StringField,
  type BaseDefComponent,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import NumberField from '@cardstack/base/number';
import TextAreaField from '@cardstack/base/text-area';
import BriefcaseBusinessIcon from '@cardstack/boxel-icons/briefcase-business';
import { htmlSafe } from '@ember/template';

import { Position } from './position';
import { ApprovalChainField } from './approval-chain-field';
import {
  RequisitionStatusField,
  REQUISITION_STATUS_COLORS,
} from './requisition-field';
import {
  formatMoney,
  liveCount,
  stateColorOf,
  type StateColor,
} from './utils/index';

// Helper to format salary range display
function salaryRangeLabel(
  min?: number | null,
  max?: number | null,
  opts?: { compact?: boolean },
): string | undefined {
  if (min == null && max == null) {
    return undefined;
  }
  let fmt = (n: number) => formatMoney(n, opts)!;
  if (min != null && max != null) {
    return `${fmt(min)}–${fmt(max)}`;
  }
  return fmt(min ?? max!);
}

// Job requisition — a request to hire one or more people for a role.
// Tracks approval chain, status, and target fill date. Positions created from
// this requisition are linked as read-only backlinks (denormalized in fitted).
export class JobRequisition extends CardDef {
  static displayName = 'Job Requisition';
  static icon = BriefcaseBusinessIcon;

  @field title = contains(StringField, {
    description: 'Job title (e.g., "Senior Backend Engineer")',
  });
  @field department = contains(StringField);
  @field description = contains(TextAreaField);
  @field headcount = contains(NumberField, {
    description: 'Number of roles to fill',
  });
  @field salaryRangeMin = contains(NumberField, {
    description: 'Minimum salary in dollars',
  });
  @field salaryRangeMax = contains(NumberField, {
    description: 'Maximum salary in dollars',
  });
  @field approvalChain = contains(ApprovalChainField);
  @field status = contains(RequisitionStatusField);
  @field targetFillDate = contains(DateField);
  @field createdDate = contains(DateField);
  @field filledDate = contains(DateField);
  @field positions = linksToMany(() => Position);

  @field displayTitle = contains(StringField, {
    computeVia: function (this: JobRequisition) {
      return this.title?.trim() || 'Unnamed Requisition';
    },
  });

  // Denormalized for fitted — prerendered fitted does not resolve
  // linksToMany, so the fitted view reads this instead of positions.length.
  @field positionTally = contains(StringField, {
    computeVia: function (this: JobRequisition) {
      let n = liveCount(this.positions);
      return n === 0 ? '' : String(n);
    },
  });

  static isolated: BaseDefComponent = class Isolated extends Component<
    typeof this
  > {
    get salaryRange(): string | undefined {
      return salaryRangeLabel(
        this.args.model?.salaryRangeMin,
        this.args.model?.salaryRangeMax,
      );
    }

    get statusColor(): StateColor {
      let colors: Record<string, StateColor> = {
        draft: {
          bg: 'color-mix(in oklch, var(--boxel-200) 20%, var(--card, var(--boxel-light)))',
          fg: 'color-mix(in oklch, var(--boxel-200) 45%, var(--card-foreground, var(--boxel-dark)))',
          ring: 'var(--boxel-200)',
        },
        approved: {
          bg: 'color-mix(in oklch, var(--boxel-highlight) 14%, var(--card, var(--boxel-light)))',
          fg: 'color-mix(in oklch, var(--boxel-highlight) 38%, var(--card-foreground, var(--boxel-dark)))',
          ring: 'var(--boxel-highlight)',
        },
        posted: {
          bg: 'color-mix(in oklch, var(--boxel-success) 14%, var(--card, var(--boxel-light)))',
          fg: 'color-mix(in oklch, var(--boxel-success) 38%, var(--card-foreground, var(--boxel-dark)))',
          ring: 'var(--boxel-success)',
        },
        filled: {
          bg: 'color-mix(in oklch, var(--boxel-success) 14%, var(--card, var(--boxel-light)))',
          fg: 'color-mix(in oklch, var(--boxel-success) 38%, var(--card-foreground, var(--boxel-dark)))',
          ring: 'var(--boxel-success)',
        },
        closed: {
          bg: 'color-mix(in oklch, var(--boxel-danger) 14%, var(--card, var(--boxel-light)))',
          fg: 'color-mix(in oklch, var(--boxel-danger) 38%, var(--card-foreground, var(--boxel-dark)))',
          ring: 'var(--boxel-danger)',
        },
      };
      return stateColorOf(colors, this.args.model?.status);
    }

    get statusPillStyle() {
      let c = this.statusColor;
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }

    <template>
      <article class='requisition-isolated'>
        <header class='header'>
          <div class='header-top'>
            <div class='header-text'>
              <h1>{{@model.displayTitle}}</h1>
              {{#if @model.department}}
                <p class='byline'>{{@model.department}}</p>
              {{/if}}
            </div>
            <span class='pill' style={{this.statusPillStyle}}>
              <span class='pill-dot'></span>{{@model.status}}
            </span>
          </div>

          {{#if this.salaryRange}}
            <div class='header-meta'>
              <span class='salary-label'>Salary Range</span>
              <span class='salary-value'>{{this.salaryRange}}</span>
            </div>
          {{/if}}
        </header>

        <div class='body'>
          {{#if @model.description}}
            <section class='section'>
              <h2 class='section-title'>Description</h2>
              <p class='description'>{{@model.description}}</p>
            </section>
          {{/if}}

          <section class='section'>
            <h2 class='section-title'>Approval Chain</h2>
            <@fields.approvalChain @format='embedded' />
          </section>

          <section class='section metadata'>
            <h2 class='section-title'>Details</h2>
            <div class='metadata-grid'>
              {{#if @model.headcount}}
                <div class='metadata-item'>
                  <span class='meta-label'>Headcount</span>
                  <span class='meta-value'>{{@model.headcount}}</span>
                </div>
              {{/if}}
              {{#if @model.targetFillDate}}
                <div class='metadata-item'>
                  <span class='meta-label'>Target Fill Date</span>
                  <span class='meta-value'>
                    <@fields.targetFillDate @format='atom' @displayContainer={{false}} />
                  </span>
                </div>
              {{/if}}
              {{#if @model.createdDate}}
                <div class='metadata-item'>
                  <span class='meta-label'>Created</span>
                  <span class='meta-value'>
                    <@fields.createdDate @format='atom' @displayContainer={{false}} />
                  </span>
                </div>
              {{/if}}
              {{#if @model.filledDate}}
                <div class='metadata-item'>
                  <span class='meta-label'>Filled</span>
                  <span class='meta-value'>
                    <@fields.filledDate @format='atom' @displayContainer={{false}} />
                  </span>
                </div>
              {{/if}}
            </div>
          </section>

          {{#if @model.positions.length}}
            <section class='section'>
              <h2 class='section-title'>Linked Positions ({{@model.positions.length}})</h2>
              <ul class='positions-list'>
                <@fields.positions @format='embedded' />
              </ul>
            </section>
          {{/if}}
        </div>
      </article>
      <style scoped>
        .requisition-isolated {
          height: 100%;
          display: flex;
          flex-direction: column;
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
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
          margin-bottom: var(--boxel-sp-sm);
        }
        .header-text {
          flex: 1;
          min-width: 0;
        }
        h1 {
          margin: 0;
          font-size: var(--boxel-font-size-xl);
          font-weight: 750;
          line-height: 1.2;
          overflow-wrap: anywhere;
        }
        .byline {
          margin: var(--boxel-sp-xs) 0 0;
          font-size: var(--boxel-font-size-sm);
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
        .header-meta {
          display: flex;
          align-items: baseline;
          gap: 0.5rem;
        }
        .salary-label {
          font-size: var(--boxel-font-size-xs);
          font-weight: 700;
          color: var(--muted-foreground, var(--boxel-450));
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .salary-value {
          font-size: var(--boxel-font-size-sm);
          font-weight: 600;
        }
        .body {
          flex: 1;
          padding: var(--boxel-sp-lg);
          min-width: 0;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-lg);
        }
        .section {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-sm);
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
          color: var(--foreground, var(--boxel-dark));
        }
        .metadata {
          padding: var(--boxel-sp-sm);
          background: var(--card, var(--boxel-light));
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--boxel-border-radius);
        }
        .metadata-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: var(--boxel-sp-sm);
        }
        .metadata-item {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }
        .meta-label {
          font-size: var(--boxel-font-size-xs);
          font-weight: 700;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .meta-value {
          font-size: var(--boxel-font-size-sm);
          font-weight: 500;
        }
        .positions-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-sm);
        }
      </style>
    </template>
  };

  static embedded: BaseDefComponent = class Embedded extends Component<
    typeof this
  > {
    get salaryRange(): string | undefined {
      return salaryRangeLabel(
        this.args.model?.salaryRangeMin,
        this.args.model?.salaryRangeMax,
        { compact: true },
      );
    }

    <template>
      <div class='requisition-embedded'>
        <div class='content'>
          <span class='title'>{{@model.displayTitle}}</span>
          {{#if @model.department}}
            <span class='department'>{{@model.department}}</span>
          {{/if}}
        </div>
        <span class='status-pill'>{{@model.status}}</span>
        {{#if @model.positions.length}}
          <span class='positions-count'>{{@model.positions.length}} positions</span>
        {{/if}}
      </div>
      <style scoped>
        .requisition-embedded {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--boxel-sp-sm);
          padding: var(--boxel-sp-sm);
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--boxel-border-radius);
          background: var(--card, var(--boxel-light));
        }
        .content {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }
        .title {
          font-weight: 600;
          font-size: var(--boxel-font-size-sm);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .department {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .status-pill {
          font-size: var(--boxel-font-size-xs);
          font-weight: 700;
          padding: 0.18em 0.5em;
          border-radius: 3px;
          background: var(--muted, var(--boxel-100));
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
          flex: none;
        }
        .positions-count {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
          flex: none;
        }
      </style>
    </template>
  };

  static fitted: BaseDefComponent = class Fitted extends Component<
    typeof this
  > {
    get salaryRange(): string | undefined {
      return salaryRangeLabel(
        this.args.model?.salaryRangeMin,
        this.args.model?.salaryRangeMax,
        { compact: true },
      );
    }

    get statusColor(): StateColor {
      return stateColorOf(REQUISITION_STATUS_COLORS, this.args.model?.status);
    }

    get statusPillStyle() {
      let c = this.statusColor;
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }

    get targetFillLabel(): string | undefined {
      let d = this.args.model?.targetFillDate;
      if (!d) {
        return undefined;
      }
      let date = new Date(d);
      if (isNaN(date.getTime())) {
        return undefined;
      }
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    }

    <template>
      <article class='fit'>
        <div class='fit-top'>
          <div class='fit-head'>
            <h3 class='fit-name'>{{@model.displayTitle}}</h3>
          </div>
          {{! The req's own lifecycle status, not the approval chain's. }}
          {{#if @model.status}}
            <span class='fit-pill' style={{this.statusPillStyle}}>
              <span class='pill-dot'></span>{{@model.status}}
            </span>
          {{/if}}
        </div>

        <div class='fit-mid'>
          {{#if @model.department}}
            <span class='fit-sub'>{{@model.department}}</span>
          {{/if}}
          {{#if this.salaryRange}}
            <span class='money'>{{this.salaryRange}}</span>
          {{/if}}
        </div>

        {{#if @model.description}}
          <p class='fit-desc'>{{@model.description}}</p>
        {{/if}}

        <dl class='fit-add'>
          {{#if this.targetFillLabel}}
            <div><dt>Target</dt><dd>{{this.targetFillLabel}}</dd></div>
          {{/if}}
          {{#if @model.approvalChain.status}}
            <div><dt>Approval</dt><dd>{{@model.approvalChain.status}}</dd></div>
          {{/if}}
          {{#if @model.positionTally}}
            <div><dt>Positions</dt><dd>{{@model.positionTally}}</dd></div>
          {{/if}}
        </dl>
      </article>
      <style scoped>
        /* Four tiers, each ADDING fields. 11px floor. Title never hidden. */
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
          display: none;
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
        }
        .money {
          font-size: calc(var(--fit-name) * 1.15);
          font-weight: 800;
          letter-spacing: -0.02em;
          font-variant-numeric: tabular-nums;
        }
        .fit-desc {
          display: none;
          margin: 0;
          font-size: var(--fit-small);
          color: var(--muted-foreground, var(--boxel-450));
          line-height: 1.45;
          -webkit-line-clamp: 3;
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

        /* TIER 2 — lifecycle pill joins above the 50px strip. */
        @container fitted-card (height > 50px) {
          .fit-pill {
            display: inline-flex;
          }
        }
        /* TIER 3 — department + salary. */
        @container fitted-card (height > 80px) {
          .fit-mid {
            display: flex;
          }
        }
        @container fitted-card (width > 240px) and (height > 50px) {
          .fit-mid {
            display: flex;
          }
        }
        /* TIER 4 — target fill date, approval state, positions tally. */
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
        /* TIER 5 — description excerpt on tall cells. */
        @container fitted-card (height >= 170px) and (width >= 170px) {
          .fit-desc {
            display: -webkit-box;
          }
        }
        /* Short strip: horizontal, single-line name; the tall salary figure
           yields to the strip and only the small department line remains. */
        @container fitted-card (height <= 80px) {
          .money {
            display: none;
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
      <span class='requisition-atom'>
        <span class='atom-title'>{{@model.displayTitle}}</span>
        <span class='atom-status'>{{@model.status}}</span>
      </span>
      <style scoped>
        .requisition-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, var(--boxel-dark));
        }
        .atom-title {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .atom-status {
          font-size: var(--boxel-font-size-xs);
          padding: 0.1em 0.3em;
          border-radius: 2px;
          background: var(--muted, var(--boxel-100));
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
          flex: none;
        }
      </style>
    </template>
  };
}
