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
import NumberField from '@cardstack/base/number';
import TextAreaField from '@cardstack/base/text-area';
import enumField from '@cardstack/base/enum';
import PlaneDepartureIcon from '@cardstack/boxel-icons/plane-departure';
import { htmlSafe } from '@ember/template';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { Button } from '@cardstack/boxel-ui/components';

import { Employee } from './employee';
import { ApprovalChainField } from './approval-chain-field';
import { ApproveChainStepCommand } from './commands/approve-chain-step-command';
import { stateColor, stateColorOf, type StateColor } from './utils/index';

export const PTO_TYPES = ['vacation', 'sick', 'personal', 'parental', 'unpaid'];

export const PTO_TYPE_LABELS: Record<string, string> = {
  vacation: 'Vacation',
  sick: 'Sick',
  personal: 'Personal',
  parental: 'Parental',
  unpaid: 'Unpaid',
};

// Colocated with PtoRequest — the same map colors the type pill in every
// format. Hues come from utils' stateColor so the fill/text pair stays inside
// the design-token system: vacation reads as the calm "planned time" blue,
// sick as amber (needs cover), personal purple, parental pink, unpaid slate
// (no accrual implication).
export const PTO_TYPE_COLORS: Record<string, StateColor> = {
  vacation: stateColor('blue'),
  sick: stateColor('amber'),
  personal: stateColor('purple'),
  parental: stateColor('pink'),
  unpaid: stateColor('slate'),
};

// The request's lifecycle mirrors its approval chain (see `status` computed):
// draft (no chain yet) → in-progress → approved | rejected. Same polarity as
// APPROVAL_DECISION_COLORS: amber undecided, green forward, red stop.
export const PTO_STATUSES = ['draft', 'in-progress', 'approved', 'rejected'];

export const PTO_STATUS_COLORS: Record<string, StateColor> = {
  draft: stateColor('slate'),
  'in-progress': stateColor('amber'),
  approved: stateColor('green'),
  rejected: stateColor('red'),
};

export const PtoTypeField = enumField(StringField, {
  options: PTO_TYPES.map((value) => ({
    value,
    label: PTO_TYPE_LABELS[value],
  })),
  displayName: 'PTO Type',
});

// Inclusive day count — a one-day absence (start === end) is 1 day, not 0.
// Undefined (not 0) when either bound is missing or the range is inverted:
// "no dates yet" is a different fact from "zero days".
function inclusiveDays(
  start?: Date | string | null,
  end?: Date | string | null,
): number | undefined {
  if (!start || !end) {
    return undefined;
  }
  let s = new Date(start);
  let e = new Date(end);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) {
    return undefined;
  }
  let days = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
  return days > 0 ? days : undefined;
}

function shortDate(value?: Date | string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  let d = new Date(value);
  if (isNaN(d.getTime())) {
    return undefined;
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// A PTO request — the fourth real consumer of ApprovalChainField (after
// Position, Offer, and JobRequisition). This card is the request/approval
// RECORD: who wants which days off, of what type, and where the sign-off
// stands. Balance math (allowance minus approved days) is deliberately an
// app-side live query over these cards, not a linksToMany on Employee.
export class PtoRequest extends CardDef {
  static displayName = 'PTO Request';
  static icon = PlaneDepartureIcon;

  @field employee = linksTo(() => Employee);
  @field ptoType = contains(PtoTypeField);
  @field startDate = contains(DateField);
  @field endDate = contains(DateField);
  @field reason = contains(TextAreaField);
  // Reused UNCHANGED from approval-chain-field.gts — same step/decision
  // model and read-only stepper as Position/Offer/JobRequisition.
  @field approvalChain = contains(ApprovalChainField);
  @field requestedDate = contains(DateField);

  @field days = contains(NumberField, {
    computeVia: function (this: PtoRequest) {
      return inclusiveDays(this.startDate, this.endDate);
    },
  });

  // Mirrors the chain, with one refinement: an EMPTY chain means the request
  // is still a draft (not yet submitted for sign-off), which is a different
  // fact from the chain's own 'not-started'.
  @field status = contains(StringField, {
    computeVia: function (this: PtoRequest) {
      if (!this.approvalChain?.steps?.length) {
        return 'draft';
      }
      return this.approvalChain.status ?? 'draft';
    },
  });

  // Denormalized for fitted — prerendered fitted does not resolve linksTo,
  // so the tile reads this own attribute instead of employee.name. Same
  // rationale as OnboardingChecklist.personName.
  @field employeeName = contains(StringField, {
    computeVia: function (this: PtoRequest) {
      return this.employee?.name ?? '';
    },
  });

  // Denormalized id-scalar for hot app-side getters — the tracker's
  // per-employee balance math runs once per employee per render, and reading
  // the `employee` linksTo there races the async link load the same way
  // Meeting.candidateId's comment explains.
  @field employeeId = contains(StringField, {
    computeVia: function (this: PtoRequest) {
      return this.employee?.id ?? '';
    },
  });

  @field title = contains(StringField, {
    computeVia: function (this: PtoRequest) {
      let name = this.employeeName?.trim() || 'Unassigned';
      let parts: string[] = [];
      if (this.ptoType) {
        parts.push(this.ptoType);
      }
      if (this.days != null) {
        parts.push(`${this.days}d`);
      }
      return parts.length ? `${name} — ${parts.join(', ')}` : name;
    },
  });

  // The operator-mode stack header renders `cardTitle`, whose base computed
  // falls back to "Untitled <type>" when cardInfo.name is unset — it never
  // consults our computed `title`. Route it through title so seeded
  // instances (cardInfo.name: null) get a real header.
  @field cardTitle = contains(StringField, {
    computeVia: function (this: PtoRequest) {
      return this.cardInfo?.name?.trim() || this.title;
    },
  });

  static isolated: BaseDefComponent = class Isolated extends Component<
    typeof this
  > {
    get typePillStyle() {
      let c = stateColorOf(PTO_TYPE_COLORS, this.args.model?.ptoType);
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }

    get statusPillStyle() {
      let c = stateColorOf(PTO_STATUS_COLORS, this.args.model?.status);
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }

    get daysLabel(): string | undefined {
      let d = this.args.model?.days;
      if (d == null) {
        return undefined;
      }
      return d === 1 ? '1 day' : `${d} days`;
    }

    // Click-to-decide for the pending chain step — the exact idiom Offer's
    // isolated view uses (see offer.gts + approval-chain-field.gts's class
    // comment for why the buttons live on the consuming card, not inside the
    // field's own template). ApproveChainStepCommand reads the card's
    // `approvalChain` field, which PtoRequest shares by name.
    @tracked approvalBusy = false;
    @tracked approvalError: string | undefined;

    get canDecideApproval(): boolean {
      return this.args.model?.approvalChain?.status === 'in-progress';
    }

    decideApprovalStep = (decision: 'approved' | 'rejected') => {
      void this.decideApprovalStepTask(decision);
    };

    private decideApprovalStepTask = async (
      decision: 'approved' | 'rejected',
    ) => {
      let model = this.args.model;
      let chain = model?.approvalChain;
      if (!model || !chain) {
        return;
      }
      let commandContext = this.args.context?.commandContext;
      if (!commandContext) {
        this.approvalError = 'Commands are unavailable in this mode';
        return;
      }
      this.approvalError = undefined;
      this.approvalBusy = true;
      try {
        await new ApproveChainStepCommand(commandContext).execute({
          target: model,
          stepIndex: chain.currentStepIndex,
          decision,
        } as any);
      } catch (error: any) {
        this.approvalError = error?.message ?? String(error);
      } finally {
        this.approvalBusy = false;
      }
    };

    <template>
      <article class='pto-isolated'>
        <header class='header'>
          <div class='header-top'>
            <div class='header-text'>
              <h1>{{if
                  @model.employeeName
                  @model.employeeName
                  'Unassigned request'
                }}</h1>
              {{#if @model.employee}}
                <p class='byline'><@fields.employee
                    @format='atom'
                    @displayContainer={{false}}
                  /></p>
              {{/if}}
            </div>
            <div class='pill-col'>
              {{#if @model.ptoType}}
                <span class='pill' style={{this.typePillStyle}}>
                  <span class='pill-dot'></span>{{@model.ptoType}}
                </span>
              {{/if}}
              {{#if @model.status}}
                <span class='pill' style={{this.statusPillStyle}}>
                  <span class='pill-dot'></span>{{@model.status}}
                </span>
              {{/if}}
            </div>
          </div>
        </header>

        <div class='body'>
          <section class='section range'>
            <h2 class='section-title'>Time off</h2>
            <div class='range-row'>
              <div class='range-dates'>
                <span class='range-date'>{{#if @model.startDate}}
                    <@fields.startDate @displayContainer={{false}} />
                  {{else}}&mdash;{{/if}}</span>
                <span class='range-arrow' aria-hidden='true'>→</span>
                <span class='range-date'>{{#if @model.endDate}}
                    <@fields.endDate @displayContainer={{false}} />
                  {{else}}&mdash;{{/if}}</span>
              </div>
              {{#if this.daysLabel}}
                <div class='range-count'>
                  <span class='money'>{{this.daysLabel}}</span>
                  <span class='money-label'>inclusive</span>
                </div>
              {{/if}}
            </div>
            {{#if @model.requestedDate}}
              <p class='requested'>Requested
                <@fields.requestedDate @displayContainer={{false}} /></p>
            {{/if}}
          </section>

          {{#if @model.reason}}
            <section class='section'>
              <h2 class='section-title'>Reason</h2>
              <p class='reason'>{{@model.reason}}</p>
            </section>
          {{/if}}

          <section class='section panel'>
            <h2 class='section-title'>Approval</h2>
            <@fields.approvalChain @format='embedded' />
            {{#if this.canDecideApproval}}
              <div class='decide-row'>
                <Button
                  type='button'
                  @kind='primary'
                  @size='small'
                  @disabled={{this.approvalBusy}}
                  {{on 'click' (fn this.decideApprovalStep 'approved')}}
                >{{if this.approvalBusy 'Saving…' 'Approve step'}}</Button>
                <Button
                  type='button'
                  @kind='secondary'
                  @size='small'
                  @disabled={{this.approvalBusy}}
                  {{on 'click' (fn this.decideApprovalStep 'rejected')}}
                >Reject</Button>
              </div>
            {{/if}}
            {{#if this.approvalError}}
              <p class='decide-error' role='alert'>{{this.approvalError}}</p>
            {{/if}}
          </section>
        </div>
      </article>
      <style scoped>
        .pto-isolated {
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
        }
        .pill-col {
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
        .range-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--boxel-sp);
          flex-wrap: wrap;
        }
        .range-dates {
          display: flex;
          align-items: baseline;
          gap: var(--boxel-sp-xs);
          font-size: var(--boxel-font-size);
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
        .range-arrow {
          color: var(--muted-foreground, var(--boxel-450));
        }
        .range-count {
          text-align: right;
        }
        .money {
          display: block;
          font-size: 1.5rem;
          font-weight: 800;
          line-height: 1.1;
          letter-spacing: -0.02em;
          font-variant-numeric: tabular-nums;
        }
        .money-label {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .requested {
          margin: 0;
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .reason {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          line-height: 1.6;
          max-width: 56ch;
        }
        .panel {
          padding: var(--boxel-sp-sm);
          background: var(--card, var(--boxel-light));
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--boxel-border-radius);
        }
        .decide-row {
          display: flex;
          gap: var(--boxel-sp-xs);
          margin-top: var(--boxel-sp-sm);
        }
        .decide-error {
          margin: var(--boxel-sp-xs) 0 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--destructive, var(--boxel-danger));
        }
      </style>
    </template>
  };

  static embedded: BaseDefComponent = class Embedded extends Component<
    typeof this
  > {
    get typePillStyle() {
      let c = stateColorOf(PTO_TYPE_COLORS, this.args.model?.ptoType);
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }

    get statusPillStyle() {
      let c = stateColorOf(PTO_STATUS_COLORS, this.args.model?.status);
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }

    get rangeLabel(): string | undefined {
      let start = shortDate(this.args.model?.startDate);
      let end = shortDate(this.args.model?.endDate);
      if (!start && !end) {
        return undefined;
      }
      let days = this.args.model?.days;
      let range = start && end ? `${start} – ${end}` : (start ?? end);
      return days != null ? `${range} · ${days}d` : range;
    }

    <template>
      <article class='pto-embedded'>
        <div class='content'>
          <span class='name'>{{if
              @model.employeeName
              @model.employeeName
              'Unassigned'
            }}</span>
          {{#if this.rangeLabel}}
            <span class='dates'>{{this.rangeLabel}}</span>
          {{/if}}
        </div>
        {{#if @model.ptoType}}
          <span class='pill' style={{this.typePillStyle}}>{{@model.ptoType}}
          </span>
        {{/if}}
        {{#if @model.status}}
          <span class='pill' style={{this.statusPillStyle}}>{{@model.status}}
          </span>
        {{/if}}
      </article>
      <style scoped>
        .pto-embedded {
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
        .dates {
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
    get typePillStyle() {
      let c = stateColorOf(PTO_TYPE_COLORS, this.args.model?.ptoType);
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }

    get statusPillStyle() {
      let c = stateColorOf(PTO_STATUS_COLORS, this.args.model?.status);
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }

    get daysLabel(): string | undefined {
      let d = this.args.model?.days;
      if (d == null) {
        return undefined;
      }
      return d === 1 ? '1 day' : `${d} days`;
    }

    get rangeLabel(): string | undefined {
      let start = shortDate(this.args.model?.startDate);
      let end = shortDate(this.args.model?.endDate);
      if (!start && !end) {
        return undefined;
      }
      return start && end ? `${start} – ${end}` : (start ?? end);
    }

    get requestedLabel(): string | undefined {
      return shortDate(this.args.model?.requestedDate);
    }

    // Attribute-only: employeeName/days/status are the request's OWN
    // denormalized/computed-scalar attributes — no linksTo read happens in
    // this prerendered format.
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
          {{#if @model.ptoType}}
            <span class='fit-pill' style={{this.typePillStyle}}>
              <span class='pill-dot'></span>{{@model.ptoType}}
            </span>
          {{/if}}
        </div>

        <div class='fit-mid'>
          {{#if this.daysLabel}}
            <span class='money'>{{this.daysLabel}}</span>
          {{/if}}
          {{#if this.rangeLabel}}
            <span class='fit-sub range'>{{this.rangeLabel}}</span>
          {{/if}}
        </div>

        <div class='fit-reason'>
          {{#if @model.reason}}
            <p class='fit-reason-text'>{{@model.reason}}</p>
          {{/if}}
          {{#if this.requestedLabel}}
            <span class='fit-sub'>Requested {{this.requestedLabel}}</span>
          {{/if}}
        </div>

        <dl class='fit-add'>
          {{#if @model.status}}
            <div><dt>Status</dt><dd>{{@model.status}}</dd></div>
          {{/if}}
          {{#if @model.approvalChain.steps.length}}
            <div><dt>Sign-offs</dt><dd>{{@model.approvalChain.currentStepIndex}}
                of
                {{@model.approvalChain.steps.length}}</dd></div>
          {{/if}}
        </dl>
      </article>
      <style scoped>
        /* Four tiers, each ADDING fields. 11px floor. Name + type never
           hidden. Tier 2 adds the day count, tier 3 the date range, tier 4
           the status/chain summary. */
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
          font-variant-numeric: tabular-nums;
        }
        .fit-sub.range {
          display: none;
        }
        .fit-reason {
          display: none;
          flex-direction: column;
          gap: 2px;
          padding-top: 0.3rem;
          border-top: 1px dashed var(--border, var(--boxel-200));
        }
        .fit-reason-text {
          margin: 0;
          font-size: var(--fit-small);
          color: var(--muted-foreground, var(--boxel-450));
          line-height: 1.45;
          display: -webkit-box;
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

        /* TIER 2 — day count joins above the 50px strip. */
        @container fitted-card (height > 50px) {
          .fit-mid {
            display: flex;
          }
        }
        /* TIER 3 — date range. */
        @container fitted-card (height > 80px) {
          .fit-sub.range {
            display: block;
          }
        }
        @container fitted-card (width > 240px) and (height > 50px) {
          .fit-sub.range {
            display: block;
          }
        }
        /* TIER 4 — status + chain progress summary. */
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
        /* TIER 5 — reason excerpt + requested date on tall cells. */
        @container fitted-card (height >= 170px) and (width >= 170px) {
          .fit-reason {
            display: flex;
          }
        }
        /* Short strip: horizontal, single-line name; the tall day-count
           figure yields to the strip. */
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
    get typePillStyle() {
      let c = stateColorOf(PTO_TYPE_COLORS, this.args.model?.ptoType);
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }

    <template>
      <span class='pto-atom'>
        <span class='atom-name'>{{if
            @model.employeeName
            @model.employeeName
            'Unassigned'
          }}</span>
        {{#if @model.ptoType}}
          <span
            class='atom-type'
            style={{this.typePillStyle}}
          >{{@model.ptoType}}</span>
        {{/if}}
      </span>
      <style scoped>
        .pto-atom {
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
        .atom-type {
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
}
