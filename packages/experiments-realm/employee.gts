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
import BriefcaseIcon from '@cardstack/boxel-icons/briefcase';
import { htmlSafe } from '@ember/template';
import { eq } from '@cardstack/boxel-ui/helpers';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { tracked } from '@glimmer/tracking';

import { PersonBase } from './person-base';
import { DurationField } from './duration-field';
import {
  daysBetween,
  normalizedDuration,
  stateColor,
  stateColorOf,
  type StateColor,
} from './utils/index';

export const EMPLOYEE_STATUSES = ['onboarding', 'active', 'offboarded'];

// Mirrors Position's EMPLOYMENT_TYPES — kept as a separate local copy rather
// than importing from position.gts, since position.gts imports Employee and
// that would create a circular module dependency.
export const EMPLOYEE_EMPLOYMENT_TYPES = [
  'full-time',
  'part-time',
  'contract',
  'internship',
];

export const ONBOARDING_STATUSES = ['not-started', 'in-progress', 'complete'];

// Colocated with Employee — the same map colors the status pill here, the
// avatar ring on Employee/OrgTree, and reuses the "active" green elsewhere.
// Harmonized with the Ledger identity: onboarding = brass (the "just signed"
// seal color), active = forest green (the primary, "permanent record" color),
// offboarded = stone (a deliberate muted color, not a blank fallthrough).
export const EMPLOYEE_STATUS_COLORS: Record<string, StateColor> = {
  onboarding: stateColor('orange'),
  active: stateColor('green'),
  offboarded: stateColor('amber'),
};

export const EmployeeStatusField = enumField(StringField, {
  options: EMPLOYEE_STATUSES.map((status) => ({
    value: status,
    label: status,
  })),
  displayName: 'Employee Status',
});

export const EmployeeEmploymentTypeField = enumField(StringField, {
  options: EMPLOYEE_EMPLOYMENT_TYPES.map((type) => ({
    value: type,
    label: type,
  })),
  displayName: 'Employment Type',
});

export const OnboardingStatusField = enumField(StringField, {
  options: ONBOARDING_STATUSES.map((status) => ({
    value: status,
    label: status,
  })),
  displayName: 'Onboarding Status',
});

export class Employee extends PersonBase {
  static displayName = 'Employee';
  static icon = BriefcaseIcon;

  @field role = contains(StringField);
  @field department = contains(StringField);
  @field startDate = contains(DateField);
  @field status = contains(EmployeeStatusField);
  @field employmentType = contains(EmployeeEmploymentTypeField);
  @field terminationDate = contains(DateField);
  @field ptoBalance = contains(NumberField, {
    description: 'Remaining PTO balance, in days',
  });
  @field onboardingStatus = contains(OnboardingStatusField);
  @field salary = contains(NumberField);
  @field manager = linksTo(() => Employee);
  @field weeklyInterviewCapacityHours = contains(NumberField, {
    description:
      'Hours of interviewing this person can take per week before the Dashboard flags them as overloaded',
  });

  // Denormalized for fitted — prerendered fitted does not resolve linksTo.
  @field managerName = contains(StringField, {
    computeVia: function (this: Employee) {
      return this.manager?.name ?? '';
    },
  });

  @field tenure = contains(DurationField, {
    computeVia: function (this: Employee) {
      let days = daysBetween(this.startDate);
      // Normalize the unit by magnitude: a multi-year tenure reads as years,
      // not as a four-digit day count.
      let norm = normalizedDuration(days);
      if (!norm) {
        return undefined;
      }
      return new DurationField({ value: norm.value, unit: norm.unit });
    },
  });

  @field title = contains(StringField, {
    computeVia: function (this: Employee) {
      return this.name?.trim() || 'Unnamed Employee';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    @tracked selectedTab: 'overview' | 'team' = 'overview';

    setTab = (tab: 'overview' | 'team') => {
      this.selectedTab = tab;
    };

    get statusColor() {
      return stateColorOf(EMPLOYEE_STATUS_COLORS, this.args.model?.status);
    }

    get monogramStyle() {
      return htmlSafe(
        `background: ${this.statusColor.bg}; color: ${this.statusColor.fg};`,
      );
    }

    get statusPillStyle() {
      return htmlSafe(
        `background: ${this.statusColor.bg}; color: ${this.statusColor.fg};`,
      );
    }

    get ptoBalanceLabel(): string {
      let n = this.args.model?.ptoBalance;
      if (n == null) {
        return '—';
      }
      return n === 0 ? '0 days · exhausted' : `${n} days`;
    }

    get capacityLabel(): string | undefined {
      let h = this.args.model?.weeklyInterviewCapacityHours;
      return typeof h === 'number'
        ? `${h} h/week interview capacity`
        : undefined;
    }

    <template>
      <article class='employee-isolated'>
        <header class='hero'>
          {{#if @model.photo.resolvedUrl}}
            <img
              class='avatar avatar-photo'
              style={{this.monogramStyle}}
              src={{@model.photo.resolvedUrl}}
              alt=''
            />
          {{else}}
            <span
              class='avatar'
              style={{this.monogramStyle}}
            >{{@model.initials}}</span>
          {{/if}}
          <div class='hero-text'>
            <h1>{{@model.title}}</h1>
            <p class='byline'>
              {{if @model.role @model.role 'Role not recorded'}}
              {{#if @model.department}}
                <span class='sep-dot'>&middot;</span>
                {{@model.department}}
              {{/if}}
            </p>
            <div class='pill-row'>
              {{#if @model.status}}
                <span class='pill' style={{this.statusPillStyle}}>
                  <span class='pill-dot'></span>{{@model.status}}
                </span>
              {{/if}}
              {{#if @model.employmentType}}
                <span class='pill neutral'>{{@model.employmentType}}</span>
              {{/if}}
              {{#if @model.tenure.label}}
                <span class='pill neutral'>{{@model.tenure.label}}
                  in role</span>
              {{/if}}
            </div>
          </div>
          {{#if @model.tenure.label}}
            <div class='hero-money'>
              <span class='money'>{{@model.tenure.label}}</span>
              <span class='money-label'>tenure</span>
            </div>
          {{/if}}
        </header>

        <div class='body'>
          <div class='main'>
            <h2 class='panel-title'>Employment</h2>
            <dl class='facts'>
              <dt>Role</dt>
              <dd>{{if @model.role @model.role '—'}}</dd>
              <dt>Department</dt>
              <dd>{{if @model.department @model.department '—'}}</dd>
              <dt>Started</dt>
              <dd>{{#if @model.startDate}}<@fields.startDate
                  />{{else}}&mdash;{{/if}}</dd>
              <dt>Tenure</dt>
              <dd>{{#if
                  @model.tenure.label
                }}{{@model.tenure.label}}{{else}}&mdash;{{/if}}</dd>
              <dt>Employment</dt>
              <dd>{{if @model.employmentType @model.employmentType '—'}}</dd>
              <dt>PTO balance</dt>
              <dd>{{this.ptoBalanceLabel}}</dd>
              <dt>Onboarding</dt>
              <dd>{{if
                  @model.onboardingStatus
                  @model.onboardingStatus
                  '—'
                }}</dd>
              {{#if (eq @model.status 'offboarded')}}
                <dt>Left on</dt>
                <dd>{{#if @model.terminationDate}}<@fields.terminationDate
                    />{{else}}&mdash;{{/if}}</dd>
              {{/if}}
            </dl>
          </div>

          <aside class='side'>
            <h2 class='panel-title'>Org position</h2>
            <dl class='facts stacked'>
              <dt>Reports to</dt>
              <dd>{{#if @model.manager}}<@fields.manager
                    @format='atom'
                    @displayContainer={{false}}
                  />{{else}}&mdash; top of the org{{/if}}</dd>
              <dt>Status</dt>
              <dd>{{if @model.status @model.status '—'}}</dd>
            </dl>

            {{#if this.capacityLabel}}
              <h2 class='panel-title spaced'>Interviewing</h2>
              <p class='side-note'>{{this.capacityLabel}}. The Dashboard flags
                this person once booked hours pass that ceiling.</p>
            {{/if}}
          </aside>
        </div>
      </article>
      <style scoped>
        .employee-isolated {
          container-type: inline-size;
          container-name: iso;
          height: 100%;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
          --emp-id: var(--primary, var(--boxel-highlight));
          --emp-strong: color-mix(
            in oklch,
            var(--emp-id) 45%,
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
          background: var(--emp-strong);
          color: var(--background, var(--boxel-light));
        }
        .avatar-photo {
          object-fit: cover;
        }
        .side-note {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          line-height: 1.6;
          color: var(--muted-foreground, var(--boxel-450));
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
      let c = stateColorOf(EMPLOYEE_STATUS_COLORS, this.args.model?.status);
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }
    <template>
      <div class='employee-embedded'>
        {{#if @model.photo.resolvedUrl}}
          <img class='ee-avatar' src={{@model.photo.resolvedUrl}} alt='' />
        {{else}}
          <span class='ee-avatar ee-initials'>{{@model.initials}}</span>
        {{/if}}
        <div class='ee-main'>
          <span class='ee-name'>{{if @model.name @model.name 'Unnamed'}}</span>
          <span class='ee-role'>
            {{if @model.role @model.role '—'}}{{#if @model.department}}
              ·
              {{@model.department}}{{/if}}
          </span>
        </div>
        {{#if @model.status}}
          <span
            class='ee-status'
            style={{this.statusStyle}}
          >{{@model.status}}</span>
        {{/if}}
      </div>
      <style scoped>
        .employee-embedded {
          display: flex;
          align-items: center;
          gap: 0.625rem;
          padding: 0.625rem 0.75rem;
          font-size: 0.8125rem;
        }
        .ee-avatar {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          object-fit: cover;
          flex-shrink: 0;
        }
        .ee-initials {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: var(--muted, var(--boxel-100));
          color: var(--muted-foreground, var(--boxel-450));
          font-size: 0.6875rem;
          font-weight: 700;
        }
        .ee-main {
          display: flex;
          flex-direction: column;
          gap: 0.0625rem;
          min-width: 0;
          flex: 1;
        }
        .ee-name {
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ee-role {
          font-size: 0.6875rem;
          color: var(--muted-foreground, var(--boxel-450));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ee-status {
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
      <span class='employee-atom'>
        <BriefcaseIcon class='employee-atom-icon' />
        <span class='employee-atom-name'>{{@model.title}}</span>
      </span>
      <style scoped>
        .employee-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, var(--boxel-dark));
        }
        .employee-atom-icon {
          width: 14px;
          height: 14px;
          color: var(--muted-foreground, var(--boxel-450));
          flex-shrink: 0;
        }
        .employee-atom-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    get statusColor() {
      return stateColorOf(EMPLOYEE_STATUS_COLORS, this.args.model?.status);
    }

    get avatarRingStyle() {
      return htmlSafe(
        `box-shadow: 0 0 0 0.125rem var(--background, var(--boxel-light)), 0 0 0 0.1875rem ${this.statusColor.ring};`,
      );
    }

    get statusPillStyle() {
      return htmlSafe(
        `background: ${this.statusColor.bg}; color: ${this.statusColor.fg};`,
      );
    }

    get startYear(): string | undefined {
      let date = this.args.model?.startDate;
      if (!date) {
        return undefined;
      }
      return new Date(date).getFullYear().toString();
    }

    <template>
      <article class='fit'>
        <div class='fit-top'>
          {{#if @model.photo.resolvedUrl}}
            <img
              class='avatar avatar-photo'
              style={{this.avatarRingStyle}}
              src={{@model.photo.resolvedUrl}}
              alt=''
            />
          {{else}}
            <span
              class='avatar'
              style={{this.avatarRingStyle}}
            >{{@model.initials}}</span>
          {{/if}}
          <div class='fit-head'>
            <h3 class='fit-name'>{{@model.title}}</h3>
            {{#if @model.role}}
              <span class='fit-eb'>{{@model.role}}{{#if @model.department}}
                  &middot;
                  {{@model.department}}{{/if}}</span>
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
          {{#if @model.tenure.label}}
            <span class='money'>{{@model.tenure.label}}</span>
          {{/if}}
          {{#if this.startYear}}
            <span class='fit-sub'>since
              {{this.startYear}}{{#if @model.employmentType}}
                &middot;
                {{@model.employmentType}}{{/if}}</span>
          {{/if}}
        </div>

        <dl class='fit-add'>
          {{#if @model.managerName}}
            <div><dt>Reports to</dt><dd>{{@model.managerName}}</dd></div>
          {{/if}}
          {{#if @model.department}}
            <div><dt>Dept</dt><dd>{{@model.department}}</dd></div>
          {{/if}}
          {{#if @model.onboardingStatus}}
            <div><dt>Onboard</dt><dd>{{@model.onboardingStatus}}</dd></div>
          {{/if}}
          {{#if @model.employmentType}}
            <div><dt>Type</dt><dd>{{@model.employmentType}}</dd></div>
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
          --emp-id: var(--primary, var(--boxel-highlight));
          --emp-strong: color-mix(
            in oklch,
            var(--emp-id) 45%,
            var(--foreground, var(--boxel-dark))
          );
          --fit-name: clamp(11px, 3.2cqi, 15px);
          --fit-small: clamp(11px, 2.6cqi, 12px);
        }
        /* Same solid-fill treatment as every other card's fitted avatar.
           Status used to be encoded as a coloured ring here, which made this
           one card look unlike its siblings for information the status pill
           already carries in words. */
        .avatar {
          flex: none;
          width: 1.6rem;
          height: 1.6rem;
          border-radius: 50%;
          display: grid;
          place-items: center;
          font-size: var(--fit-small);
          font-weight: 700;
          background: var(--emp-strong);
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
          /* The photo avatar's ring (box-shadow, painted outside its own
             box) was being clipped along its top edge by the inherited
             `.fit > * { overflow: hidden }` rule — the ring bled above
             this row's flex-start-aligned top edge with no padding to
             absorb it, reading as a cropped circle. */
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
