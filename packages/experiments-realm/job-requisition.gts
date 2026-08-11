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
import { RequisitionStatusField } from './requisition-field';
import {
  formatMoney,
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
  @field requisitionStatus = contains(RequisitionStatusField);
  @field targetFillDate = contains(DateField);
  @field createdDate = contains(DateField);
  @field filledDate = contains(DateField);
  @field positions = linksToMany(() => Position);

  @field displayTitle = contains(StringField, {
    computeVia: function (this: JobRequisition) {
      return this.title?.trim() || 'Unnamed Requisition';
    },
  });

  @field status = contains(StringField, {
    computeVia: function (this: JobRequisition) {
      return this.requisitionStatus || 'draft';
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

    <template>
      <article class='fit'>
        <div class='fit-head'>
          <h3 class='fit-title'>{{@model.displayTitle}}</h3>
          {{#if @model.department}}
            <p class='fit-department'>{{@model.department}}</p>
          {{/if}}
          {{#if this.salaryRange}}
            <span class='fit-salary'>{{this.salaryRange}}</span>
          {{/if}}
          {{#if @model.approvalChain.status}}
            <span class='fit-approval'>{{@model.approvalChain.status}}</span>
          {{/if}}
        </div>
        {{#if @model.positions.length}}
          <div class='fit-badge'>{{@model.positions.length}}</div>
        {{/if}}
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
          --fit-title: clamp(11px, 3.2cqi, 15px);
          --fit-small: clamp(9px, 2.2cqi, 11px);
        }
        .fit > * {
          min-height: 0;
          overflow: hidden;
        }
        .fit-head {
          flex: 1;
          min-width: 0;
        }
        .fit-title {
          margin: 0;
          font-size: var(--fit-title);
          font-weight: 700;
          line-height: 1.25;
          letter-spacing: -0.01em;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .fit-department {
          margin: 0.15em 0 0;
          font-size: var(--fit-small);
          color: var(--muted-foreground, var(--boxel-450));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .fit-salary {
          display: block;
          margin-top: 0.15em;
          font-size: var(--fit-small);
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .fit-approval {
          display: block;
          margin-top: 0.15em;
          font-size: var(--fit-small);
          color: var(--muted-foreground, var(--boxel-450));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .fit-badge {
          flex: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 1.5rem;
          height: 1.5rem;
          background: var(--primary, var(--boxel-highlight));
          color: var(--primary-foreground, var(--boxel-light));
          border-radius: 50%;
          font-size: var(--fit-small);
          font-weight: 700;
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
