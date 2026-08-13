import {
  CardDef,
  Component,
  field,
  contains,
  linksTo,
  linksToMany,
  StringField,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import NumberField from '@cardstack/base/number';
import TextAreaField from '@cardstack/base/text-area';
import BooleanField from '@cardstack/base/boolean';
import enumField from '@cardstack/base/enum';
import BriefcaseBusinessIcon from '@cardstack/boxel-icons/briefcase-business';
import DollarSignIcon from '@cardstack/boxel-icons/dollar-sign';
import UsersIcon from '@cardstack/boxel-icons/users';
import Building2Icon from '@cardstack/boxel-icons/building-2';
import CalendarIcon from '@cardstack/boxel-icons/calendar';
import MapPinIcon from '@cardstack/boxel-icons/map-pin';
import BriefcaseIcon from '@cardstack/boxel-icons/briefcase';
import GraduationCapIcon from '@cardstack/boxel-icons/graduation-cap';
import { or } from '@cardstack/boxel-ui/helpers';
import { BoxelButton } from '@cardstack/boxel-ui/components';
import { htmlSafe } from '@ember/template';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { tracked } from '@glimmer/tracking';

import { Employee } from './employee';
import { Skill, SKILL_CATEGORY_COLORS } from './skill';
import { ApprovalChainField } from './approval-chain-field';
import { InterviewPlan } from './interview-plan';
import { ApproveChainStepCommand } from './commands/approve-chain-step-command';
import {
  formatMoney,
  stateColor,
  stateColorOf,
  type StateColor,
} from './utils/index';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// How long this requisition has been open. Derived from postedDate, so the
// isolated and fitted views can never report different ages.
function daysOpen(postedDate?: Date | null): number | undefined {
  if (!postedDate) {
    return undefined;
  }
  let d = new Date(postedDate);
  if (isNaN(d.getTime())) {
    return undefined;
  }
  return Math.max(0, Math.round((Date.now() - d.getTime()) / MS_PER_DAY));
}

export const POSITION_STATUSES = ['open', 'on-hold', 'filled', 'closed'];

export const EMPLOYMENT_TYPES = [
  'full-time',
  'part-time',
  'contract',
  'internship',
];

export const EXPERIENCE_LEVELS = ['entry', 'mid', 'senior', 'lead'];

// Colocated with Position — reuses the Ledger palette so a requisition's
// lifecycle reads as the front half of the same story Candidate/Employee
// tell: open leans on the same green as "screening" (active work), filled
// resolves into the "hired"/"active" forest green, closed lands on the same
// rust as "rejected" (a req that ended without a hire).
export const POSITION_STATUS_COLORS: Record<string, StateColor> = {
  open: stateColor('green'),
  'on-hold': stateColor('amber'),
  filled: stateColor('green'),
  closed: stateColor('red'),
};

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

export const PositionStatusField = enumField(StringField, {
  options: POSITION_STATUSES.map((status) => ({
    value: status,
    label: status,
  })),
  displayName: 'Position Status',
});

export const EmploymentTypeField = enumField(StringField, {
  options: EMPLOYMENT_TYPES.map((type) => ({ value: type, label: type })),
  displayName: 'Employment Type',
});

export const ExperienceLevelField = enumField(StringField, {
  options: EXPERIENCE_LEVELS.map((level) => ({ value: level, label: level })),
  displayName: 'Experience Level',
});

export class Position extends CardDef {
  static displayName = 'Position';
  static icon = BriefcaseBusinessIcon;

  @field jobTitle = contains(StringField);
  @field department = contains(StringField);
  @field requisitionCode = contains(StringField, {
    description: 'Internal requisition ID for ATS/payroll cross-reference',
  });
  @field remoteEligible = contains(BooleanField, {
    description:
      'Filterable flag, independent of the descriptive workLocation text',
  });
  @field approvalChain = contains(ApprovalChainField);
  @field interviewPlan = linksTo(() => InterviewPlan);
  @field hiringManager = linksTo(() => Employee);
  @field status = contains(PositionStatusField);
  @field postedDate = contains(DateField);
  @field targetStartDate = contains(DateField);
  @field headcount = contains(NumberField);
  @field salaryMin = contains(NumberField);
  @field salaryMax = contains(NumberField);
  @field workLocation = contains(StringField, {
    description: 'City/region, or "Remote" / "Hybrid"',
  });
  @field employmentType = contains(EmploymentTypeField);
  @field experienceLevel = contains(ExperienceLevelField);
  @field requiredSkills = linksToMany(() => Skill);
  @field jobDescription = contains(TextAreaField, {
    description: 'Job description / requirements shown to applicants',
  });

  // Denormalized for fitted — prerendered fitted does not resolve linksTo.
  @field hiringManagerName = contains(StringField, {
    computeVia: function (this: Position) {
      return this.hiringManager?.name ?? '';
    },
  });

  @field skillTally = contains(StringField, {
    computeVia: function (this: Position) {
      let n = this.requiredSkills?.length ?? 0;
      return n === 0 ? '' : String(n);
    },
  });

  @field title = contains(StringField, {
    computeVia: function (this: Position) {
      return this.jobTitle?.trim() || 'Untitled Position';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    get statusColor() {
      return stateColorOf(POSITION_STATUS_COLORS, this.args.model?.status);
    }
    get statusPillStyle() {
      return htmlSafe(
        `background: ${this.statusColor.bg}; color: ${this.statusColor.fg};`,
      );
    }
    get salaryRangeLabel() {
      return salaryRangeLabel(
        this.args.model?.salaryMin,
        this.args.model?.salaryMax,
        { compact: true },
      );
    }
    get salaryRangeLabelFull() {
      return salaryRangeLabel(
        this.args.model?.salaryMin,
        this.args.model?.salaryMax,
      );
    }
    get remoteLabel(): string {
      let v = this.args.model?.remoteEligible;
      return v == null ? '—' : v ? 'Yes' : 'No';
    }
    get headcountLabel(): string {
      let n = this.args.model?.headcount;
      if (n == null) {
        return '—';
      }
      return n === 0 ? '0 · fully staffed' : `${n} open`;
    }
    get openSeatsLabel(): string {
      let n = this.args.model?.headcount;
      if (n == null) {
        return '— open seats';
      }
      return n === 0 ? 'Fully staffed' : `${n} open seat${n === 1 ? '' : 's'}`;
    }

    skillChipStyle = (
      skill: Skill | undefined,
    ): ReturnType<typeof htmlSafe> => {
      let c = SKILL_CATEGORY_COLORS[skill?.category ?? ''] ?? {
        bg: 'var(--muted, var(--boxel-100))',
        fg: 'var(--muted-foreground, var(--boxel-450))',
      };
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    };
    get daysOpenLabel(): string | undefined {
      let d = daysOpen(this.args.model?.postedDate);
      return d == null ? undefined : `${d} days open`;
    }

    // A requisition that has been open a long time is a fact worth surfacing;
    // none of the four hand-set statuses can tell you this.
    get isStale(): boolean {
      let d = daysOpen(this.args.model?.postedDate);
      return d != null && d >= 45 && this.args.model?.status === 'open';
    }

    // The click-to-decide affordance lives here, not inside
    // ApprovalChainField's own template — see approval-chain-field.gts's
    // class comment for why. This mirrors how every other stage-changing
    // action in this app (ApproveOfferCommand, RejectCandidateCommand) is
    // invoked from the consuming card/tracker rather than from a field.
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
      <article class='position-isolated'>
        <header class='hero'>
          <div class='hero-text'>
            <h1>{{@model.title}}</h1>
            <p class='byline'>
              {{if @model.department @model.department 'No department set'}}
              {{#if @model.requisitionCode}}
                <span class='sep-dot'>&middot;</span>
                {{@model.requisitionCode}}
              {{/if}}
            </p>
            <div class='pill-row'>
              {{#if @model.status}}
                <span class='pill' style={{this.statusPillStyle}}>
                  <span class='pill-dot'></span>{{@model.status}}
                </span>
              {{/if}}
              {{#if this.isStale}}
                <span class='pill stale'>
                  <span class='pill-dot'></span>{{this.daysOpenLabel}}
                  &middot; ageing
                </span>
              {{else if this.daysOpenLabel}}
                <span class='pill neutral'>{{this.daysOpenLabel}}</span>
              {{/if}}
              {{#if @model.experienceLevel}}
                <span class='pill neutral'>{{@model.experienceLevel}}</span>
              {{/if}}
            </div>
          </div>
          <div class='hero-money'>
            <span class='money'>{{this.salaryRangeLabel}}</span>
            <span class='money-label'>{{this.openSeatsLabel}}</span>
          </div>
        </header>

        <div class='body'>
          <div class='main'>
            <h2 class='panel-title'>Role</h2>
            <dl class='facts'>
              <dt>Department</dt>
              <dd>{{if @model.department @model.department '—'}}</dd>
              <dt>Salary range</dt>
              <dd>{{this.salaryRangeLabelFull}}</dd>
              <dt>Headcount</dt>
              <dd>{{this.headcountLabel}}</dd>
              <dt>Experience</dt>
              <dd>{{if @model.experienceLevel @model.experienceLevel '—'}}</dd>
              <dt>Employment</dt>
              <dd>{{if @model.employmentType @model.employmentType '—'}}</dd>
              <dt>Location</dt>
              <dd>{{if @model.workLocation @model.workLocation '—'}}</dd>
              <dt>Remote</dt>
              <dd>{{this.remoteLabel}}</dd>
              <dt>Posted</dt>
              <dd>{{#if @model.postedDate}}<@fields.postedDate />{{#if
                    this.daysOpenLabel
                  }}<span class='dd-note'>
                      &middot;
                      {{this.daysOpenLabel}}</span>{{/if}}{{else}}&mdash;{{/if}}</dd>
              <dt>Target start</dt>
              <dd>{{#if @model.targetStartDate}}<@fields.targetStartDate
                  />{{else}}&mdash;{{/if}}</dd>
            </dl>

            <h2 class='panel-title spaced'>Required skills</h2>
            {{#if @model.requiredSkills.length}}
              <ul class='chips'>
                {{#each @fields.requiredSkills as |Skill|}}
                  <li><Skill @format='atom' @displayContainer={{false}} /></li>
                {{/each}}
              </ul>
            {{else}}
              <p class='empty'>No skills listed yet.</p>
            {{/if}}

            <h2 class='panel-title spaced'>Job description</h2>
            {{#if @model.jobDescription}}
              <p class='prose'>{{@model.jobDescription}}</p>
            {{else}}
              <p class='empty'>No job description added yet.</p>
            {{/if}}

            <h2 class='panel-title spaced'>Interview Plan</h2>
            {{#if @model.interviewPlan}}
              <@fields.interviewPlan @format='embedded' />
            {{else}}
              <p class='empty'>No interview plan yet. Running Generate
                questions from a candidate applying to this position will
                create one.</p>
            {{/if}}
          </div>

          <aside class='side'>
            <h2 class='panel-title'>Owner</h2>
            <dl class='facts stacked'>
              <dt>Hiring manager</dt>
              <dd>{{#if @model.hiringManager}}<@fields.hiringManager
                    @format='atom'
                    @displayContainer={{false}}
                  />{{else}}&mdash;{{/if}}</dd>
            </dl>

            <h2 class='panel-title spaced'>Approval Chain</h2>
            <@fields.approvalChain />
            {{#if this.canDecideApproval}}
              <div class='approval-actions'>
                <BoxelButton
                  @kind='primary'
                  @size='small'
                  @loading={{this.approvalBusy}}
                  @disabled={{this.approvalBusy}}
                  {{on 'click' (fn this.decideApprovalStep 'approved')}}
                >Approve</BoxelButton>
                <BoxelButton
                  @kind='danger'
                  @size='small'
                  @loading={{this.approvalBusy}}
                  @disabled={{this.approvalBusy}}
                  {{on 'click' (fn this.decideApprovalStep 'rejected')}}
                >Reject</BoxelButton>
              </div>
            {{/if}}
            {{#if this.approvalError}}
              <p class='approval-error' role='alert'>{{this.approvalError}}</p>
            {{/if}}

            <h2 class='panel-title spaced'>Requisition</h2>
            <dl class='facts stacked'>
              <dt>Status</dt>
              <dd>{{if @model.status @model.status '—'}}</dd>
              <dt>Open for</dt>
              <dd>{{if this.daysOpenLabel this.daysOpenLabel '—'}}</dd>
              <dt>Skills listed</dt>
              <dd>{{if @model.skillTally @model.skillTally '0'}}</dd>
            </dl>
          </aside>
        </div>
      </article>
      <style scoped>
        .position-isolated {
          container-type: inline-size;
          container-name: iso;
          height: 100%;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
          --pos-id: var(--primary, var(--boxel-highlight));
          --pos-strong: color-mix(
            in oklch,
            var(--pos-id) 45%,
            var(--foreground, var(--boxel-dark))
          );
        }
        .dd-note {
          color: var(--muted-foreground, var(--boxel-450));
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
        .pill.neutral {
          background: var(--muted, var(--boxel-100));
          color: var(--muted-foreground, var(--boxel-450));
        }
        .pill.stale {
          background: color-mix(
            in oklch,
            var(--boxel-warning) 12%,
            var(--card, var(--boxel-light))
          );
          color: color-mix(
            in oklch,
            var(--boxel-warning) 45%,
            var(--card-foreground, var(--boxel-dark))
          );
        }
        .pill-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: currentColor;
          flex: none;
        }
        .hero-money {
          flex: none;
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
        }
        .panel-title.spaced {
          margin-top: var(--boxel-sp-lg);
        }
        .prose {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          line-height: 1.65;
          max-width: 56ch;
          max-height: 16rem;
          overflow-y: auto;
        }
        .chips {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-wrap: wrap;
          gap: 0.3rem;
        }
        .chips > li {
          font-size: var(--boxel-font-size-xs);
          padding: 0.15em 0.5em;
          border-radius: 3px;
          border: 1px solid var(--border, var(--boxel-200));
          background: var(--card, var(--boxel-light));
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
          font-variant-numeric: tabular-nums;
        }
        .facts.stacked dd {
          padding-top: 0.1rem;
        }
        .empty {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .approval-actions {
          display: flex;
          gap: var(--boxel-sp-xs);
          margin-top: var(--boxel-sp-xs);
        }
        .approval-error {
          margin: var(--boxel-sp-xs) 0 0;
          font-size: var(--boxel-font-size-xs);
          color: color-mix(
            in oklch,
            var(--destructive, var(--boxel-danger)) 38%,
            var(--card-foreground, var(--boxel-dark))
          );
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
          .hero-money {
            text-align: left;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get statusStyle() {
      let c = stateColorOf(POSITION_STATUS_COLORS, this.args.model?.status);
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }
    <template>
      <div class='position-embedded'>
        <span class='pe-icon'><BriefcaseBusinessIcon
            class='pe-icon-svg'
          /></span>
        <div class='pe-main'>
          <span class='pe-title'>{{@model.title}}</span>
          {{#if @model.department}}
            <span class='pe-dept'>{{@model.department}}</span>
          {{/if}}
        </div>
        {{#if @model.status}}
          <span
            class='pe-status'
            style={{this.statusStyle}}
          >{{@model.status}}</span>
        {{/if}}
      </div>
      <style scoped>
        .position-embedded {
          display: flex;
          align-items: center;
          gap: 0.625rem;
          padding: 0.625rem 0.75rem;
          font-size: 0.8125rem;
        }
        .pe-icon {
          display: inline-flex;
          width: 28px;
          height: 28px;
          flex-shrink: 0;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          background: var(--muted, var(--boxel-100));
          color: var(--muted-foreground, var(--boxel-450));
        }
        .pe-icon-svg {
          width: 14px;
          height: 14px;
        }
        .pe-main {
          display: flex;
          flex-direction: column;
          gap: 0.0625rem;
          min-width: 0;
          flex: 1;
        }
        .pe-title {
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .pe-dept {
          font-size: 0.6875rem;
          color: var(--muted-foreground, var(--boxel-450));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .pe-status {
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 0.125rem 0.4375rem;
          border-radius: 999px;
          flex-shrink: 0;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='position-atom'>
        <BriefcaseBusinessIcon class='position-atom-icon' />
        <span class='position-atom-name'>{{@model.title}}</span>
      </span>
      <style scoped>
        .position-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, var(--boxel-dark));
        }
        .position-atom-icon {
          width: 14px;
          height: 14px;
          color: var(--muted-foreground, var(--boxel-450));
          flex-shrink: 0;
        }
        .position-atom-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    get statusColor() {
      return stateColorOf(POSITION_STATUS_COLORS, this.args.model?.status);
    }
    get statusPillStyle() {
      return htmlSafe(
        `background: ${this.statusColor.bg}; color: ${this.statusColor.fg};`,
      );
    }
    get salaryRangeLabel() {
      return salaryRangeLabel(
        this.args.model?.salaryMin,
        this.args.model?.salaryMax,
      );
    }
    get headcountLabel(): string | undefined {
      let n = this.args.model?.headcount;
      if (n == null) {
        return undefined;
      }
      return n === 0 ? 'Fully staffed' : `${n} open`;
    }
    get daysOpenLabel(): string | undefined {
      let d = daysOpen(this.args.model?.postedDate);
      return d == null ? undefined : `${d}d open`;
    }

    get isStale(): boolean {
      let d = daysOpen(this.args.model?.postedDate);
      return d != null && d >= 45 && this.args.model?.status === 'open';
    }

    <template>
      <article class='fit'>
        <div class='fit-top'>
          <div class='fit-head'>
            <h3 class='fit-name'>{{@model.title}}</h3>
            {{#if @model.department}}
              <span class='fit-eb'>{{@model.department}}{{#if
                  @model.experienceLevel
                }}
                  &middot;
                  {{@model.experienceLevel}}{{/if}}</span>
            {{/if}}
          </div>
          {{! Status pill survives every tier. }}
          {{#if @model.status}}
            <span class='fit-pill' style={{this.statusPillStyle}}>
              <span class='pill-dot'></span>{{@model.status}}
            </span>
          {{/if}}
        </div>

        <div class='fit-mid'>
          {{#if this.salaryRangeLabel}}
            <span class='money'>{{this.salaryRangeLabel}}</span>
          {{/if}}
          {{#if this.headcountLabel}}
            <span class='fit-sub'>{{this.headcountLabel}}{{#if
                @model.employmentType
              }}
                &middot;
                {{@model.employmentType}}{{/if}}</span>
          {{/if}}
        </div>

        <dl class='fit-add'>
          {{#if this.daysOpenLabel}}
            <div><dt>Open</dt><dd>{{this.daysOpenLabel}}</dd></div>
          {{/if}}
          {{#if @model.workLocation}}
            <div><dt>Where</dt><dd>{{@model.workLocation}}</dd></div>
          {{/if}}
          {{#if @model.skillTally}}
            <div><dt>Skills</dt><dd>{{@model.skillTally}}</dd></div>
          {{/if}}
          {{#if @model.hiringManagerName}}
            <div><dt>Manager</dt><dd>{{@model.hiringManagerName}}</dd></div>
          {{/if}}
        </dl>
      </article>
      <style scoped>
        /* Four tiers, each ADDING fields. 11px floor. Status never hidden. */
        .fit {
          height: 100%;
          /* Flex, not a three-row grid: with `minmax(0, 1fr)` in the middle
             a taller bottom block squeezed the middle row and clipped its
             text. Here the middle keeps its natural height and the extras
             block is pushed to the bottom by `margin-top: auto`. */
          display: flex;
          flex-direction: column;
          gap: 0.28rem;
          padding: 0.55rem 0.6rem;
          overflow: hidden;
          background: var(--card, var(--boxel-light));
          color: var(--card-foreground, var(--foreground, var(--boxel-dark)));
          font-family: var(--font-sans, var(--boxel-font-family));
          --pos-id: var(--primary, var(--boxel-highlight));
          --pos-strong: color-mix(
            in oklch,
            var(--pos-id) 45%,
            var(--foreground, var(--boxel-dark))
          );
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

        /* TIER 2 — add the secondary line. Container queries have no `or`,
           so this is reached either by height (tile) or width (strip). */
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
        /* TIER 3 — add the headline figure block. */
        @container fitted-card (height > 130px) and (width > 180px) {
          .fit-mid {
            display: flex;
          }
        }
        /* TIER 4 — width-driven extra facts. Previously absent entirely,
           which is why a 500x400 tile showed the same as a 200x140 one. */
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
        /* Short strip: horizontal, single-line name. */
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
        /* Smallest tier: secondary line goes, the status pill stays. */
        @container fitted-card (height <= 50px) {
          .fit-eb {
            display: none;
          }
        }
      </style>
    </template>
  };
}
