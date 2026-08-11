import {
  CardDef,
  Component,
  field,
  contains,
  containsMany,
  StringField,
  type BaseDefComponent,
} from '@cardstack/base/card-api';
import TextAreaField from '@cardstack/base/text-area';
import ChecklistIcon from '@cardstack/boxel-icons/checklist';

import { DurationField } from './duration-field';

export class OnboardingTemplateTaskField extends CardDef {
  static displayName = 'Onboarding Template Task';

  @field title = contains(StringField);
  @field description = contains(TextAreaField);
  @field dueDate = contains(DurationField, {
    description: 'Due X days after hire date',
  });
  @field assigneeRole = contains(StringField, {
    description: 'e.g. "Engineering Manager", "HR"',
  });
  @field notes = contains(TextAreaField);

  static embedded: BaseDefComponent = class Embedded extends Component<
    typeof this
  > {
    <template>
      <li class='task-row'>
        <span class='task-title'>{{@model.title}}</span>
        {{#if @model.assigneeRole}}
          <span class='task-role'>{{@model.assigneeRole}}</span>
        {{/if}}
        {{#if @model.dueDate.value}}
          <span class='task-due'>Due {{@model.dueDate.value}}d</span>
        {{/if}}
      </li>
      <style scoped>
        .task-row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: var(--boxel-sp-xs);
          font-size: var(--boxel-font-size-sm);
          border-bottom: 1px solid var(--border, var(--boxel-200));
          list-style: none;
        }
        .task-row:last-child {
          border-bottom: 0;
        }
        .task-title {
          flex: 1;
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .task-role {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
        }
        .task-due {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
        }
      </style>
    </template>
  };
}

export class OnboardingTemplate extends CardDef {
  static displayName = 'Onboarding Template';
  static icon = ChecklistIcon;

  @field name = contains(StringField);
  @field description = contains(TextAreaField);
  @field tasks = containsMany(OnboardingTemplateTaskField);

  @field title = contains(StringField, {
    computeVia: function (this: OnboardingTemplate) {
      return this.name?.trim() || 'Unnamed Template';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='template-isolated'>
        <header class='header'>
          <div class='header-content'>
            <h1>{{@model.title}}</h1>
            {{#if @model.description}}
              <p class='description'>{{@model.description}}</p>
            {{/if}}
          </div>
        </header>

        <div class='body'>
          <h2 class='section-title'>Tasks ({{@model.tasks.length}})</h2>
          {{#if @model.tasks.length}}
            <ul class='task-list'>
              <@fields.tasks @format='embedded' />
            </ul>
          {{else}}
            <p class='empty'>No tasks defined yet.</p>
          {{/if}}
        </div>
      </article>
      <style scoped>
        .template-isolated {
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
        .header-content {
          max-width: 100%;
        }
        h1 {
          margin: 0;
          font-size: var(--boxel-font-size-xl);
          font-weight: 750;
          letter-spacing: -0.02em;
          line-height: 1.2;
          overflow-wrap: anywhere;
        }
        .description {
          margin: var(--boxel-sp-xs) 0 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
          line-height: 1.6;
        }
        .body {
          flex: 1;
          padding: var(--boxel-sp-lg);
          min-width: 0;
          overflow-y: auto;
        }
        .section-title {
          margin: 0 0 var(--boxel-sp-sm);
          font-size: var(--boxel-font-size-sm);
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .task-list {
          list-style: none;
          margin: 0;
          padding: 0;
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--boxel-border-radius);
          overflow: hidden;
        }
        .task-item {
          padding: 0;
        }
        .empty {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
          padding: var(--boxel-sp-sm);
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='template-embedded'>
        <span class='template-name'>{{@model.title}}</span>
        {{#if @model.tasks.length}}
          <span class='template-count'>{{@model.tasks.length}} tasks</span>
        {{/if}}
      </div>
      <style scoped>
        .template-embedded {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.625rem 0.75rem;
          font-size: 0.8125rem;
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--boxel-border-radius);
          background: var(--card, var(--boxel-light));
        }
        .template-name {
          font-weight: 600;
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .template-count {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          flex-shrink: 0;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <article class='fit'>
        <div class='fit-head'>
          <h3 class='fit-name'>{{@model.title}}</h3>
        </div>
        {{#if @model.tasks.length}}
          <div class='fit-badge'>{{@model.tasks.length}}</div>
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
          --fit-name: clamp(11px, 3.2cqi, 15px);
          --fit-small: clamp(11px, 2.6cqi, 12px);
        }
        .fit > * {
          min-height: 0;
          overflow: hidden;
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

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='template-atom'>
        <span class='template-atom-name'>{{@model.title}}</span>
      </span>
      <style scoped>
        .template-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, var(--boxel-dark));
        }
        .template-atom-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };
}
