import {
  CardDef,
  FieldDef,
  Component,
  field,
  contains,
  containsMany,
  linksTo,
  StringField,
  type BaseDefComponent,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import TextAreaField from '@cardstack/base/text-area';
import enumField from '@cardstack/base/enum';
import ChecklistIcon from '@cardstack/boxel-icons/checklist';
import { htmlSafe } from '@ember/template';
import { eq } from '@cardstack/boxel-ui/helpers';

import { Employee } from './employee';
import { Contractor } from './contractor';
import { OnboardingTemplate } from './onboarding-template';
import { DurationField } from './duration-field';
import {
  stateColor,
  stateColorOf,
  type StateColor,
} from './utils/index';

export const ONBOARDING_CHECKLIST_STATUSES = [
  'not-started',
  'in-progress',
  'complete',
];

export const ONBOARDING_CHECKLIST_STATUS_LABELS: Record<string, string> = {
  'not-started': 'Not Started',
  'in-progress': 'In Progress',
  'complete': 'Complete',
};

export const ONBOARDING_CHECKLIST_STATUS_COLORS: Record<string, StateColor> = {
  'not-started': stateColor('slate'),
  'in-progress': stateColor('amber'),
  'complete': stateColor('green'),
};

export const OnboardingChecklistStatusField = enumField(StringField, {
  options: ONBOARDING_CHECKLIST_STATUSES.map((status) => ({
    value: status,
    label: ONBOARDING_CHECKLIST_STATUS_LABELS[status],
  })),
  displayName: 'Onboarding Checklist Status',
});

// One task in an OnboardingChecklist — tracking completion state for a
// templated task instance. The dueDate is COMPUTED from the template's
// duration offset + checklist.createdDate, not stored.
export class OnboardingChecklistTaskField extends FieldDef {
  static displayName = 'Onboarding Checklist Task';

  @field title = contains(StringField);
  @field dueDate = contains(DateField, {
    description:
      'Computed from template task offset + checklist creation date',
    computeVia: function (this: OnboardingChecklistTaskField) {
      // This will be computed by the containing checklist when rendering
      return undefined;
    },
  });
  @field assignee = linksTo(() => Employee);
  @field status = contains(enumField(StringField, {
    options: [
      { value: 'pending', label: 'Pending' },
      { value: 'complete', label: 'Complete' },
    ],
    displayName: 'Task Status',
  }));
  @field completedDate = contains(DateField);
  @field notes = contains(TextAreaField);

  static embedded: BaseDefComponent = class Embedded extends Component<
    typeof this
  > {
    get statusColor() {
      let colors: Record<string, StateColor> = {
        pending: stateColor('amber'),
        complete: stateColor('green'),
      };
      return stateColorOf(colors, this.args.model?.status);
    }

    get statusPillStyle() {
      let c = this.statusColor;
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }

    <template>
      <div class='task-card'>
        <div class='task-top'>
          <span class='task-title'>{{@model.title}}</span>
          {{#if @model.status}}
            <span class='pill' style={{this.statusPillStyle}}>
              <span class='pill-dot'></span>{{@model.status}}
            </span>
          {{/if}}
        </div>
        {{#if @model.assignee}}
          <div class='task-meta'>
            <span class='meta-label'>Assigned to:</span>
            <@fields.assignee @format='atom' @displayContainer={{false}} />
          </div>
        {{/if}}
        {{#if @model.dueDate}}
          <div class='task-meta'>
            <span class='meta-label'>Due:</span>
            <@fields.dueDate @format='atom' @displayContainer={{false}} />
          </div>
        {{/if}}
        {{#if @model.notes}}
          <p class='task-notes'>{{@model.notes}}</p>
        {{/if}}
      </div>
      <style scoped>
        .task-card {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          padding: var(--boxel-sp-sm);
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--boxel-border-radius);
          background: var(--card, var(--boxel-light));
        }
        .task-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--boxel-sp-xs);
        }
        .task-title {
          font-weight: 600;
          font-size: var(--boxel-font-size-sm);
          flex: 1;
          min-width: 0;
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
        .task-meta {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: var(--boxel-font-size-xs);
        }
        .meta-label {
          color: var(--muted-foreground, var(--boxel-450));
          font-weight: 600;
          flex: none;
        }
        .task-notes {
          margin: 0;
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          line-height: 1.5;
        }
      </style>
    </template>
  };
}

// Instance of an onboarding checklist — tracks completion status for tasks
// from a template, linked to either an Employee or Contractor.
export class OnboardingChecklist extends CardDef {
  static displayName = 'Onboarding Checklist';
  static icon = ChecklistIcon;

  @field employee = linksTo(() => Employee);
  @field contractor = linksTo(() => Contractor);
  @field template = linksTo(() => OnboardingTemplate);
  @field tasks = containsMany(OnboardingChecklistTaskField);
  @field status = contains(OnboardingChecklistStatusField, {
    computeVia: function (this: OnboardingChecklist) {
      let taskList = this.tasks ?? [];
      let completedCount = taskList.filter(
        (t) => t && t.status === 'complete',
      ).length;
      if (taskList.length === 0) {
        return 'not-started';
      }
      if (completedCount === taskList.length) {
        return 'complete';
      }
      return 'in-progress';
    },
  });
  @field createdDate = contains(DateField);
  @field completedDate = contains(DateField);

  // Denormalized for fitted — prerendered fitted does not resolve linksTo,
  // so the fitted view reads this instead of walking employee/contractor.
  // (computeVia runs at index time, when the links ARE loaded.)
  @field personName = contains(StringField, {
    computeVia: function (this: OnboardingChecklist) {
      return this.employee?.name ?? this.contractor?.name ?? '';
    },
  });

  @field title = contains(StringField, {
    computeVia: function (this: OnboardingChecklist) {
      let person = this.employee || this.contractor;
      if (person) {
        return `${person.name}'s Onboarding`;
      }
      if (this.createdDate) {
        let date = new Date(this.createdDate);
        let formatted = date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        });
        return `Team Onboarding — Started ${formatted}`;
      }
      return 'Unnamed Onboarding';
    },
  });

  static isolated: BaseDefComponent = class Isolated extends Component<
    typeof this
  > {
    get personName() {
      return this.args.model?.employee?.name ||
        this.args.model?.contractor?.name ||
        'Unknown';
    }

    get statusColor() {
      return stateColorOf(
        ONBOARDING_CHECKLIST_STATUS_COLORS,
        this.args.model?.status,
      );
    }

    get statusPillStyle() {
      let c = this.statusColor;
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }

    get completionPercentage(): string {
      let tasks = this.args.model?.tasks ?? [];
      if (tasks.length === 0) return '0%';
      let completed = tasks.filter((t) => t && t.status === 'complete').length;
      return `${Math.round((completed / tasks.length) * 100)}%`;
    }

    get progressBarStyle() {
      return htmlSafe(`width: ${this.completionPercentage}`);
    }

    get completedTaskCount(): number {
      let tasks = this.args.model?.tasks ?? [];
      return tasks.filter((t) => t && t.status === 'complete').length;
    }

    <template>
      <article class='checklist-isolated'>
        <header class='header'>
          <div class='header-top'>
            {{#if @model.employee}}
              <div class='avatar'>
                {{#if @model.employee.photo.resolvedUrl}}
                  <img
                    src={{@model.employee.photo.resolvedUrl}}
                    alt='{{this.personName}}'
                  />
                {{else}}
                  <span class='avatar-text'>{{@model.employee.initials}}</span>
                {{/if}}
              </div>
            {{else if @model.contractor}}
              <div class='avatar'>
                {{#if @model.contractor.photo.resolvedUrl}}
                  <img
                    src={{@model.contractor.photo.resolvedUrl}}
                    alt='{{this.personName}}'
                  />
                {{else}}
                  <span class='avatar-text'>{{@model.contractor.initials}}</span>
                {{/if}}
              </div>
            {{/if}}
            <div class='header-text'>
              <h1>{{this.personName}}</h1>
              <span class='pill' style={{this.statusPillStyle}}>
                <span class='pill-dot'></span>{{@model.status}}
              </span>
            </div>
          </div>
        </header>

        <div class='body'>
          {{#if @model.tasks.length}}
            <div class='progress-section'>
              <div class='progress-top'>
                <span class='progress-label'>Progress</span>
                <span class='progress-value'>{{this.completionPercentage}}</span>
              </div>
              <div class='progress-bar-bg'>
                <div
                  class='progress-bar'
                  style={{this.progressBarStyle}}
                ></div>
              </div>
              <span class='progress-count'>
                {{this.completedTaskCount}}
                of {{@model.tasks.length}} tasks complete
              </span>
            </div>

            <div class='tasks-section'>
              <h2 class='section-title'>Tasks</h2>
              <ul class='tasks-list'>
                <@fields.tasks @format='embedded' />
              </ul>
            </div>
          {{else}}
            <p class='empty'>No tasks in this checklist.</p>
          {{/if}}
        </div>
      </article>
      <style scoped>
        .checklist-isolated {
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
          gap: var(--boxel-sp-sm);
        }
        .avatar {
          width: 3rem;
          height: 3rem;
          border-radius: 50%;
          overflow: hidden;
          background: var(--muted, var(--boxel-100));
          display: flex;
          align-items: center;
          justify-content: center;
          flex: none;
          font-size: var(--boxel-font-size-lg);
          font-weight: 700;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .avatar-text {
          color: var(--muted-foreground, var(--boxel-450));
        }
        .header-text {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        h1 {
          margin: 0;
          font-size: var(--boxel-font-size-xl);
          font-weight: 750;
          line-height: 1.2;
          overflow-wrap: anywhere;
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
          width: fit-content;
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
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-lg);
        }
        .progress-section {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          padding: var(--boxel-sp-sm);
          background: var(--card, var(--boxel-light));
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--boxel-border-radius);
        }
        .progress-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .progress-label {
          font-size: var(--boxel-font-size-sm);
          font-weight: 600;
        }
        .progress-value {
          font-size: var(--boxel-font-size-sm);
          font-weight: 700;
          color: var(--primary, var(--boxel-highlight));
        }
        .progress-bar-bg {
          width: 100%;
          height: 8px;
          background: var(--muted, var(--boxel-100));
          border-radius: 4px;
          overflow: hidden;
        }
        .progress-bar {
          height: 100%;
          background: var(--primary, var(--boxel-highlight));
          border-radius: 4px;
          transition: width 0.3s ease;
        }
        .progress-count {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .tasks-section {
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
        .tasks-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-sm);
        }
        .empty {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
          text-align: center;
          padding: var(--boxel-sp-lg);
        }
      </style>
    </template>
  };

  static embedded: BaseDefComponent = class Embedded extends Component<
    typeof this
  > {
    get personName() {
      return this.args.model?.employee?.name ||
        this.args.model?.contractor?.name ||
        'Unknown';
    }

    get completionPercentage(): number {
      let tasks = this.args.model?.tasks ?? [];
      if (tasks.length === 0) return 0;
      let completed = tasks.filter((t) => t && t.status === 'complete').length;
      return Math.round((completed / tasks.length) * 100);
    }

    get progressBarStyle() {
      return htmlSafe(`width: ${this.completionPercentage}%`);
    }

    <template>
      <div class='checklist-embedded'>
        {{#if @model.employee}}
          <div class='avatar'>
            {{#if @model.employee.photo.resolvedUrl}}
              <img
                src={{@model.employee.photo.resolvedUrl}}
                alt='{{this.personName}}'
              />
            {{else}}
              <span class='avatar-text'>{{@model.employee.initials}}</span>
            {{/if}}
          </div>
        {{else if @model.contractor}}
          <div class='avatar'>
            {{#if @model.contractor.photo.resolvedUrl}}
              <img
                src={{@model.contractor.photo.resolvedUrl}}
                alt='{{this.personName}}'
              />
            {{else}}
              <span class='avatar-text'>{{@model.contractor.initials}}</span>
            {{/if}}
          </div>
        {{/if}}
        <div class='content'>
          <span class='person-name'>{{this.personName}}</span>
          <div class='progress'>
            <div class='progress-bar-bg'>
              <div
                class='progress-bar'
                style={{this.progressBarStyle}}
              ></div>
            </div>
            <span class='progress-text'>{{this.completionPercentage}}%</span>
          </div>
        </div>
      </div>
      <style scoped>
        .checklist-embedded {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-sm);
          padding: var(--boxel-sp-sm);
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--boxel-border-radius);
          background: var(--card, var(--boxel-light));
        }
        .avatar {
          width: 2rem;
          height: 2rem;
          border-radius: 50%;
          overflow: hidden;
          background: var(--muted, var(--boxel-100));
          display: flex;
          align-items: center;
          justify-content: center;
          flex: none;
          font-size: var(--boxel-font-size-sm);
          font-weight: 700;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .avatar-text {
          color: var(--muted-foreground, var(--boxel-450));
        }
        .content {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }
        .person-name {
          font-weight: 600;
          font-size: var(--boxel-font-size-sm);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .progress {
          display: flex;
          align-items: center;
          gap: 0.3rem;
        }
        .progress-bar-bg {
          flex: 1;
          height: 6px;
          background: var(--muted, var(--boxel-100));
          border-radius: 3px;
          overflow: hidden;
        }
        .progress-bar {
          height: 100%;
          background: var(--primary, var(--boxel-highlight));
          border-radius: 3px;
        }
        .progress-text {
          font-size: var(--boxel-font-size-xs);
          font-weight: 700;
          color: var(--muted-foreground, var(--boxel-450));
          flex: none;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static fitted: BaseDefComponent = class Fitted extends Component<
    typeof this
  > {
    // Reads the denormalized personName own-attribute — prerendered fitted
    // does not resolve linksTo, so walking employee/contractor here would
    // always render "Unknown".
    get personName() {
      return this.args.model?.personName || 'Onboarding';
    }

    get statusColor() {
      return stateColorOf(
        ONBOARDING_CHECKLIST_STATUS_COLORS,
        this.args.model?.status,
      );
    }

    get statusPillStyle() {
      let c = this.statusColor;
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }

    // tasks is containsMany — its data lives on the instance itself, so it
    // is safe to read in prerendered fitted (unlike linksTo/linksToMany).
    get completedTaskCount(): number {
      let tasks = this.args.model?.tasks ?? [];
      return tasks.filter((t) => t && t.status === 'complete').length;
    }

    get completionPercentage(): number {
      let tasks = this.args.model?.tasks ?? [];
      if (tasks.length === 0) return 0;
      return Math.round((this.completedTaskCount / tasks.length) * 100);
    }

    get progressBarStyle() {
      return htmlSafe(`width: ${this.completionPercentage}%`);
    }

    <template>
      <article class='fit'>
        <div class='fit-top'>
          <div class='fit-head'>
            <h3 class='fit-name'>{{this.personName}}</h3>
          </div>
          <span class='fit-pct'>{{this.completionPercentage}}%</span>
          {{#if @model.status}}
            <span class='fit-pill' style={{this.statusPillStyle}}>
              <span class='pill-dot'></span>{{@model.status}}
            </span>
          {{/if}}
        </div>

        <div class='fit-mid'>
          <span class='fit-sub'>{{this.completedTaskCount}}
            of
            {{@model.tasks.length}}
            tasks complete</span>
        </div>

        <div class='fit-add'>
          <div class='bar-bg'>
            <div class='bar' style={{this.progressBarStyle}}></div>
          </div>
        </div>
      </article>
      <style scoped>
        /* Four tiers, each ADDING content. 11px floor. Percent never hidden. */
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
        .fit-pct {
          flex: none;
          font-size: var(--fit-name);
          font-weight: 800;
          letter-spacing: -0.02em;
          font-variant-numeric: tabular-nums;
          color: var(--primary, var(--boxel-highlight));
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
        .fit-add {
          display: none;
          margin-top: auto;
          padding-top: 0.3rem;
        }
        /* Same bar style the embedded format uses. */
        .bar-bg {
          width: 100%;
          height: 6px;
          background: var(--muted, var(--boxel-100));
          border-radius: 3px;
          overflow: hidden;
        }
        .bar {
          height: 100%;
          background: var(--primary, var(--boxel-highlight));
          border-radius: 3px;
        }

        /* TIER 2 — status pill joins above the 50px strip. */
        @container fitted-card (height > 50px) {
          .fit-pill {
            display: inline-flex;
          }
        }
        /* TIER 3 — task tally line. */
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
        /* TIER 4 — progress bar pinned to the bottom edge. */
        @container fitted-card (height > 130px) and (width >= 170px) {
          .fit-add {
            display: block;
          }
        }
        /* Short strip: horizontal, single-line name. */
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

  static atom: BaseDefComponent = class Atom extends Component<
    typeof this
  > {
    get personName() {
      return this.args.model?.employee?.name ||
        this.args.model?.contractor?.name ||
        'Unknown';
    }

    get statusColor() {
      return stateColorOf(
        ONBOARDING_CHECKLIST_STATUS_COLORS,
        this.args.model?.status,
      );
    }

    get statusPillStyle() {
      let c = this.statusColor;
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }

    <template>
      <span class='checklist-atom'>
        <span class='atom-name'>{{this.personName}}</span>
        <span class='pill' style={{this.statusPillStyle}}>
          <span class='pill-dot'></span>{{@model.status}}
        </span>
      </span>
      <style scoped>
        .checklist-atom {
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
        .pill {
          display: inline-flex;
          align-items: center;
          gap: 0.2rem;
          font-size: var(--boxel-font-size-xs);
          font-weight: 700;
          padding: 0.1em 0.4em;
          border-radius: 2px;
          white-space: nowrap;
          flex: none;
        }
        .pill-dot {
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: currentColor;
          flex: none;
        }
      </style>
    </template>
  };
}
