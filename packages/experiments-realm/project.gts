import {
  CardDef,
  Component,
  field,
  contains,
  linksTo,
  StringField,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import enumField from '@cardstack/base/enum';
import FolderKanbanIcon from '@cardstack/boxel-icons/folder-kanban';
import { or } from '@cardstack/boxel-ui/helpers';
import { htmlSafe } from '@ember/template';

import { DurationField } from './duration-field';
import { Employee } from './trt-employee';
import { Team } from './team';
import { Vendor } from './vendor';
import { stateColorOf, type StateColor } from './utils/index';

export const PROJECT_STATUSES = ['planned', 'active', 'done'];

// Harmonized with the Ledger identity: active shares the forest-green
// primary; planned/done stay in the muted stone/slate register.
export const PROJECT_STATUS_COLORS: Record<string, StateColor> = {
  planned: { bg: '#ece4d0', fg: '#5c5232', ring: '#a8976a' },
  active: { bg: '#dbe6d5', fg: '#1f2b1c', ring: '#3a4a35' },
  done: { bg: '#dbe3e6', fg: '#2f4550', ring: '#5f7a85' },
};

export const ProjectStatusField = enumField(StringField, {
  options: PROJECT_STATUSES.map((status) => ({ value: status, label: status })),
  displayName: 'Project Status',
});

export class Project extends CardDef {
  static displayName = 'Project';
  static icon = FolderKanbanIcon;

  @field name = contains(StringField);
  @field description = contains(StringField);
  @field status = contains(ProjectStatusField);
  @field lead = linksTo(() => Employee);
  @field team = linksTo(() => Team);
  @field vendor = linksTo(() => Vendor);
  @field startDate = contains(DateField);
  @field estimatedEffort = contains(DurationField);

  @field title = contains(StringField, {
    computeVia: function (this: Project) {
      return this.name?.trim() || 'Unnamed Project';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    get statusSteps() {
      let current = this.args.model?.status;
      let currentIndex = PROJECT_STATUSES.indexOf(current ?? '');
      return PROJECT_STATUSES.map((status, index) => ({
        status,
        isCurrent: index === currentIndex,
        isPast: currentIndex >= 0 && index < currentIndex,
      }));
    }

    <template>
      <article
        class='project-isolated'
      >
        <header class='project-header'>
          <p class='kicker'>Project</p>
          <h1>{{@model.title}}</h1>
        </header>
        <ol class='status-track'>
          {{#each this.statusSteps as |step|}}
            <li
              class='status-step
                {{if step.isCurrent "is-current"}}
                {{if step.isPast "is-past"}}'
            >
              <span class='status-dot'></span>
              <span class='status-label'>{{step.status}}</span>
            </li>
          {{/each}}
        </ol>
        {{#if @model.description}}
          <p class='description'>{{@model.description}}</p>
        {{/if}}
        {{#if (or @model.lead @model.team @model.vendor)}}
          <div class='team-row'>
            {{#if @model.lead}}
              <div class='team-chip'>
                <span class='chip-label'>Lead</span>
                <@fields.lead @format='atom' />
              </div>
            {{/if}}
            {{#if @model.team}}
              <div class='team-chip'>
                <span class='chip-label'>Team</span>
                <@fields.team @format='atom' />
              </div>
            {{/if}}
            {{#if @model.vendor}}
              <div class='team-chip'>
                <span class='chip-label'>Vendor</span>
                <@fields.vendor @format='atom' />
              </div>
            {{/if}}
          </div>
        {{/if}}
        <dl class='facts'>
          <div><dt>Start</dt><dd><@fields.startDate /></dd></div>
          <div><dt>Effort</dt><dd><@fields.estimatedEffort /></dd></div>
        </dl>
      </article>
      <style scoped>
        .project-isolated {
          padding: var(--boxel-sp-lg);
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
          height: 100%;
          overflow-y: auto;
          animation: project-fade-in 0.2s ease-out;
        }
        @keyframes project-fade-in {
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
          .project-isolated {
            animation: none;
          }
        }
        .kicker {
          margin: 0 0 var(--boxel-sp-5xs);
          font-size: var(--boxel-font-size-xs);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--secondary, var(--boxel-450));
        }
        h1 {
          margin: 0;
          font-family: var(--font-serif, serif);
          font-weight: 600;
          font-size: var(--boxel-font-size-lg);
        }
        .status-track {
          margin: var(--boxel-sp-lg) 0 0;
          display: flex;
          list-style: none;
          padding: 0;
        }
        .status-step {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: var(--boxel-sp-xs);
          position: relative;
        }
        .status-step:not(:first-child)::before {
          content: '';
          position: absolute;
          top: 0.4375rem;
          right: 50%;
          width: 100%;
          height: 2px;
          background: var(--border, var(--boxel-200));
          z-index: 0;
        }
        .status-step.is-past:not(:first-child)::before,
        .status-step.is-current:not(:first-child)::before {
          background: var(--primary, var(--boxel-highlight));
        }
        .status-dot {
          width: 0.9375rem;
          height: 0.9375rem;
          border-radius: 50%;
          background: var(--card, var(--boxel-light));
          border: 2px solid var(--border, var(--boxel-200));
          z-index: 1;
          transition:
            background-color 0.15s ease-out,
            border-color 0.15s ease-out;
        }
        .status-step.is-past .status-dot {
          background: var(--primary, var(--boxel-highlight));
          border-color: var(--primary, var(--boxel-highlight));
        }
        .status-step.is-current .status-dot {
          background: var(--secondary, var(--boxel-highlight));
          border-color: var(--secondary, var(--boxel-highlight));
          box-shadow: 0 0 0 0.1875rem var(--muted, var(--boxel-100));
        }
        .status-label {
          font-size: var(--boxel-font-size-xs);
          text-transform: capitalize;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .status-step.is-current .status-label {
          font-weight: 600;
          color: var(--foreground, var(--boxel-dark));
        }
        .description {
          margin-top: var(--boxel-sp-lg);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .team-row {
          margin-top: var(--boxel-sp-lg);
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-lg);
        }
        .team-chip {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
        }
        .chip-label {
          font-size: var(--boxel-font-size-xs);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .facts {
          margin-top: var(--boxel-sp-lg);
          padding-top: var(--boxel-sp);
          border-top: 1px solid var(--border, var(--boxel-200));
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
          gap: var(--boxel-sp);
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

  static embedded = class Embedded extends Component<typeof this> {
    get statusColor() {
      return stateColorOf(PROJECT_STATUS_COLORS, this.args.model?.status);
    }

    get statusPillStyle() {
      return htmlSafe(
        `background: ${this.statusColor.bg}; color: ${this.statusColor.fg};`,
      );
    }

    <template>
      <div
        class='project-embedded'
      >
        <header>
          <h3>{{@model.title}}</h3>
          {{#if @model.status}}
            <span class='status' style={{this.statusPillStyle}}>
              {{@model.status}}
            </span>
          {{/if}}
        </header>
        {{#if @model.description}}
          <p class='description'>{{@model.description}}</p>
        {{/if}}
        <dl class='facts'>
          <div><dt>Start</dt><dd><@fields.startDate /></dd></div>
          <div><dt>Effort</dt><dd><@fields.estimatedEffort /></dd></div>
          {{#if @model.lead}}
            <div><dt>Lead</dt><dd><@fields.lead @format='atom' /></dd></div>
          {{/if}}
          {{#if @model.vendor}}
            <div><dt>Vendor</dt><dd><@fields.vendor @format='atom' /></dd></div>
          {{/if}}
        </dl>
      </div>
      <style scoped>
        .project-embedded {
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
        .status {
          padding: 2px var(--boxel-sp-4xs);
          border-radius: 999px;
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
          text-transform: capitalize;
          white-space: nowrap;
        }
        .description {
          margin: var(--boxel-sp-xs) 0 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
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

  static fitted = class Fitted extends Component<typeof this> {
    get statusColor() {
      return stateColorOf(PROJECT_STATUS_COLORS, this.args.model?.status);
    }

    get iconStyle() {
      return htmlSafe(`color: ${this.statusColor.ring};`);
    }

    <template>
      <div
        class='project-fitted'
      >
        <FolderKanbanIcon
          class='project-icon'
          role='presentation'
          style={{this.iconStyle}}
        />
        <div class='info'>
          <span class='name'>{{@model.title}}</span>
          <span class='meta'>{{@model.status}}</span>
        </div>
      </div>
      <style scoped>
        .project-fitted {
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
        .project-fitted:hover {
          background: var(--muted, var(--boxel-100));
        }
        .project-icon {
          width: 1.5rem;
          height: 1.5rem;
          flex: none;
          transition: color 0.15s ease-out;
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
          text-transform: capitalize;
        }
        @container fitted-card (height <= 80px) {
          .project-fitted {
            align-items: center;
          }
        }
        @container fitted-card (height <= 40px) {
          .meta {
            display: none;
          }
        }
      </style>
    </template>
  };
}
