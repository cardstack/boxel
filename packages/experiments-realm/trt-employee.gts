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

import { PersonBase } from './person-base';
import { DurationField } from './duration-field';
import { daysBetween, stateColorOf, type StateColor } from './utils/index';

export const EMPLOYEE_STATUSES = ['onboarding', 'active', 'offboarded'];

// Colocated with Employee — the same map colors the status pill here, the
// avatar ring on Employee/OrgTree, and reuses the "active" green elsewhere.
// Harmonized with the Ledger identity: onboarding = brass (the "just signed"
// seal color), active = forest green (the primary, "permanent record" color),
// offboarded = stone (a deliberate muted color, not a blank fallthrough).
export const EMPLOYEE_STATUS_COLORS: Record<string, StateColor> = {
  onboarding: { bg: '#f3e2c2', fg: '#6b4a12', ring: '#a9773a' },
  active: { bg: '#dbe6d5', fg: '#1f2b1c', ring: '#3a4a35' },
  offboarded: { bg: '#e8e2d3', fg: '#6b5f3f', ring: '#9c8f66' },
};

export const EmployeeStatusField = enumField(StringField, {
  options: EMPLOYEE_STATUSES.map((status) => ({
    value: status,
    label: status,
  })),
  displayName: 'Employee Status',
});

export class Employee extends PersonBase {
  static displayName = 'Employee';
  static icon = BriefcaseIcon;

  @field role = contains(StringField);
  @field department = contains(StringField);
  @field startDate = contains(DateField);
  @field status = contains(EmployeeStatusField);
  @field salary = contains(NumberField);
  @field manager = linksTo(() => Employee);

  @field tenure = contains(DurationField, {
    computeVia: function (this: Employee) {
      let days = daysBetween(this.startDate);
      if (days == null) {
        return undefined;
      }
      return new DurationField({ value: days, unit: 'days' });
    },
  });

  @field title = contains(StringField, {
    computeVia: function (this: Employee) {
      return this.name?.trim() || 'Unnamed Employee';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    get statusColor() {
      return stateColorOf(EMPLOYEE_STATUS_COLORS, this.args.model?.status);
    }

    get avatarRingStyle() {
      return htmlSafe(
        `box-shadow: 0 0 0 0.1875rem var(--background, var(--boxel-light)), 0 0 0 0.3125rem ${this.statusColor.ring};`,
      );
    }

    get statusPillStyle() {
      return htmlSafe(
        `background: ${this.statusColor.bg}; color: ${this.statusColor.fg};`,
      );
    }

    <template>
      <article
        class='employee-isolated'
      >
        <header class='employee-header'>
          {{#if @model.photoUrl}}
            <img
              class='avatar'
              src={{@model.photoUrl}}
              alt=''
              style={{this.avatarRingStyle}}
            />
          {{else}}
            <span
              class='avatar initials'
              style={{this.avatarRingStyle}}
            >{{@model.initials}}</span>
          {{/if}}
          <div>
            <h1>{{@model.title}}</h1>
            <p class='role'>{{@model.role}}
              {{#if @model.department}}· {{@model.department}}{{/if}}</p>
          </div>
          {{#if @model.status}}
            <span class='status' style={{this.statusPillStyle}}>
              {{@model.status}}
            </span>
          {{/if}}
        </header>
        <dl class='employee-facts'>
          <div><dt>Start date</dt><dd><@fields.startDate /></dd></div>
          <div><dt>Tenure</dt><dd><@fields.tenure /></dd></div>
          <div><dt>Email</dt><dd>{{@model.email}}</dd></div>
          <div><dt>Phone</dt><dd>{{@model.phone}}</dd></div>
          <div><dt>Manager</dt><dd><@fields.manager @format='atom' /></dd></div>
        </dl>
      </article>
      <style scoped>
        .employee-isolated {
          padding: var(--boxel-sp-lg);
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
          height: 100%;
          overflow-y: auto;
          animation: employee-fade-in 0.2s ease-out;
        }
        @keyframes employee-fade-in {
          from {
            opacity: 0;
            transform: translateY(0.25rem);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .employee-isolated {
            animation: none;
          }
        }
        .employee-header {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp);
        }
        .employee-header h1 {
          margin: 0;
          font-family: var(--font-serif, serif);
          font-weight: 600;
          font-size: var(--boxel-font-size-lg);
        }
        .role {
          margin: var(--boxel-sp-5xs) 0 0;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .avatar {
          width: 4rem;
          height: 4rem;
          border-radius: 50%;
          flex: none;
          object-fit: cover;
          transition: box-shadow 0.15s ease-out;
        }
        .initials {
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: var(--font-serif, serif);
          font-weight: 600;
          font-size: var(--boxel-font-size);
          line-height: 1;
          color: var(--primary-foreground, var(--boxel-light));
          background: var(--primary, var(--boxel-highlight));
        }
        .status {
          margin-left: auto;
          padding: var(--boxel-sp-5xs) var(--boxel-sp-xs);
          border-radius: 999px;
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
          text-transform: capitalize;
        }
        .employee-facts {
          margin-top: var(--boxel-sp-lg);
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: var(--boxel-sp);
        }
        .employee-facts > div {
          min-width: 0;
        }
        .employee-facts dt {
          font-size: var(--boxel-font-size-xs);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .employee-facts dd {
          margin: var(--boxel-sp-5xs) 0 0;
          font-size: var(--boxel-font-size-sm);
          overflow-wrap: anywhere;
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
      <div
        class='employee-fitted'
      >
        <div class='fitted-top'>
          {{#if @model.photoUrl}}
            <img
              class='avatar'
              src={{@model.photoUrl}}
              alt=''
              style={{this.avatarRingStyle}}
            />
          {{else}}
            <span
              class='avatar initials'
              style={{this.avatarRingStyle}}
            >{{@model.initials}}</span>
          {{/if}}
          <div class='info'>
            <span class='name'>{{@model.title}}</span>
            <span class='meta'>{{@model.role}}</span>
            <span class='meta dept'>{{@model.department}}</span>
          </div>
        </div>
        <div class='fitted-footer'>
          {{#if this.startYear}}
            <span class='tenure'>Since {{this.startYear}}</span>
          {{/if}}
          {{#if @model.status}}
            <span class='status-pill' style={{this.statusPillStyle}}>
              {{@model.status}}
            </span>
          {{/if}}
        </div>
      </div>
      <style scoped>
        .employee-fitted {
          display: flex;
          align-items: flex-start;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-xs);
          height: 100%;
          overflow: hidden;
          background: var(--card, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
          transition: background-color 0.15s ease-out;
        }
        .employee-fitted:hover {
          background: var(--muted, var(--boxel-100));
        }
        .fitted-top {
          display: flex;
          align-items: flex-start;
          gap: var(--boxel-sp-xs);
          min-width: 0;
        }
        .fitted-footer {
          display: none;
        }
        .avatar {
          width: 2rem;
          height: 2rem;
          border-radius: 50%;
          flex: none;
          object-fit: cover;
          transition: box-shadow 0.15s ease-out;
        }
        .initials {
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: var(--font-serif, serif);
          font-weight: 600;
          font-size: var(--boxel-font-size-xs);
          line-height: 1;
          color: var(--primary-foreground, var(--boxel-light));
          background: var(--primary, var(--boxel-highlight));
        }
        .info {
          display: flex;
          flex-direction: column;
          gap: 1px;
          min-width: 0;
        }
        .name {
          font-size: var(--boxel-font-size-sm);
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .meta {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .tenure {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .status-pill {
          padding: 1px var(--boxel-sp-4xs);
          border-radius: 999px;
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
          text-transform: capitalize;
          flex: none;
        }
        @container fitted-card (height <= 80px) {
          .employee-fitted {
            align-items: center;
          }
          .fitted-top {
            align-items: center;
          }
          .dept {
            display: none;
          }
        }
        @container fitted-card (height <= 40px) {
          .avatar {
            width: 1.25rem;
            height: 1.25rem;
          }
          .meta {
            display: none;
          }
        }
        /* Portrait tile — the Directory grid's tall (~14rem) cards. */
        @container fitted-card (height > 140px) and (width > 130px) {
          .employee-fitted {
            flex-direction: column;
            align-items: center;
            justify-content: flex-start;
            text-align: center;
            padding: var(--boxel-sp);
            gap: var(--boxel-sp-xs);
          }
          .fitted-top {
            flex-direction: column;
            align-items: center;
            text-align: center;
            gap: var(--boxel-sp-4xs);
          }
          .avatar {
            width: 3rem;
            height: 3rem;
          }
          .initials {
            font-size: var(--boxel-font-size);
          }
          .info {
            align-items: center;
          }
          .name {
            white-space: normal;
            overflow-wrap: anywhere;
          }
          .fitted-footer {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: var(--boxel-sp-xs);
            margin-top: auto;
            padding-top: var(--boxel-sp-xs);
            border-top: 1px solid var(--border, var(--boxel-200));
            width: 100%;
          }
        }
      </style>
    </template>
  };
}
