import {
  CardDef,
  Component,
  StringField,
  contains,
  field,
  linksTo,
  linksToMany,
} from '@cardstack/base/card-api';
import MarkdownField from '@cardstack/base/markdown';
import Tag from '@cardstack/base/tag';
import SquareCheckIcon from '@cardstack/boxel-icons/square-check';

import { statusField } from './status-field';
import PriorityField from './priority-field';
import DueDateField from './due-date-field';
import CreatedAtField from './created-at-field';
import { StatePill } from './components/state-pill';
import { User } from './user';

/**
 * The generic actionable item — the Records-layer block, not any app's
 * version of one. Composed from the layer-03 field blocks (status, priority,
 * due date, created at) instead of hand-rolling its own, which is the whole
 * bottom-up point: the previous POC Task carried a private status compound
 * with hex literals and its own five-level priority.
 *
 * Nesting is modeled as `subtasks: linksToMany(Task)` on the parent — the
 * decision-B shape: the set is bounded, the rollup ("3 of 5 done") belongs on
 * the card itself, and one editor maintains the list. There is no parentTask
 * back-pointer; two stored sources of the same fact drift.
 *
 * Domain specifics stay with the consumer: an app extends Task additively
 * (a quest link, completion criteria, a sprint) and never overrides the
 * lifecycle — a task that needs a different lifecycle is a different card.
 */
export const TaskStatusField = statusField({
  displayName: 'Task Status',
  options: [
    {
      value: 'Not Started',
      hue: 'slate',
      meaning: 'Captured but nobody has begun.',
    },
    {
      value: 'In Progress',
      hue: 'blue',
      meaning: 'Someone is actively on it.',
    },
    {
      value: 'Blocked',
      hue: 'red',
      holds: true,
      meaning: 'Cannot proceed until something outside this task clears.',
    },
    {
      value: 'Done',
      hue: 'green',
      terminal: true,
      holds: true,
      meaning: 'The person doing it says it is complete.',
    },
  ],
  transitions: {
    'Not Started': ['In Progress', 'Done'],
    'In Progress': ['Blocked', 'Done', 'Not Started'],
    Blocked: ['In Progress'],
    Done: ['In Progress'],
  },
});

function subtaskList(model: Partial<Task> | undefined): Task[] {
  return ((model?.subtasks ?? []) as Task[]).filter(Boolean);
}

function doneCount(model: Partial<Task> | undefined): number {
  return subtaskList(model).filter((t) => t.status === 'Done').length;
}

export class Task extends CardDef {
  static displayName = 'Task';
  static icon = SquareCheckIcon;

  @field title = contains(StringField);
  @field details = contains(MarkdownField);
  @field status = contains(TaskStatusField);
  @field priority = contains(PriorityField);
  @field dueDate = contains(DueDateField);
  @field createdAt = contains(CreatedAtField);
  @field assignee = linksTo(() => User, { searchable: true });
  @field tags = linksToMany(Tag);
  @field subtasks = linksToMany(() => Task);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Task) {
      return this.title?.trim()?.length ? this.title : 'Untitled task';
    },
  });

  static embedded = class Embedded extends Component<typeof Task> {
    get done() {
      return doneCount(this.args.model);
    }
    get total() {
      return subtaskList(this.args.model).length;
    }
    <template>
      <div class='task-row'>
        <span class='t-status'><@fields.status @format='atom' /></span>
        <span class='t-title'>{{@model.cardTitle}}</span>
        {{#if this.total}}
          <span class='t-subs'>{{this.done}}/{{this.total}}</span>
        {{/if}}
        <span class='t-due'>{{#if @model.dueDate}}<@fields.dueDate
              @format='atom'
            />{{else}}<span class='t-empty'>—</span>{{/if}}</span>
        <span class='t-priority'>{{#if @model.priority}}<@fields.priority
              @format='atom'
            />{{else}}<span class='t-empty'>—</span>{{/if}}</span>
      </div>
      <style scoped>
        .task-row {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          font-size: var(--boxel-font-size-sm);
        }
        .t-title {
          font-weight: 600;
          color: var(--foreground, var(--boxel-dark));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex: 1;
          min-width: 0;
        }
        .t-subs {
          font-variant-numeric: tabular-nums;
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
        }
        /* Trailing data slots stay constant-width and always render, so a
           consumer's task list column-aligns regardless of per-row gaps. */
        .t-due {
          min-width: 4.5rem;
          text-align: right;
          flex-shrink: 0;
        }
        .t-priority {
          min-width: 4rem;
          text-align: right;
          flex-shrink: 0;
        }
        .t-empty {
          color: var(--muted-foreground, var(--boxel-450));
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof Task> {
    <template>
      <span class='task-atom'>
        <@fields.status @format='atom' />
        <span class='ta-title'>{{@model.cardTitle}}</span>
      </span>
      <style scoped>
        .task-atom {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-4xs);
          font-size: var(--boxel-font-size-xs);
        }
        .ta-title {
          font-weight: 600;
          color: var(--foreground, var(--boxel-dark));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Task> {
    get done() {
      return doneCount(this.args.model);
    }
    get total() {
      return subtaskList(this.args.model).length;
    }
    <template>
      <article class='task-page'>
        <header>
          <div class='head-row'>
            <@fields.status @format='embedded' />
            {{#if @model.priority}}
              <@fields.priority @format='embedded' />
            {{/if}}
          </div>
          <h1>{{@model.cardTitle}}</h1>
          <div class='meta'>
            {{#if @model.dueDate}}
              <span class='meta-item'><@fields.dueDate
                  @format='embedded'
                /></span>
            {{/if}}
            {{#if @model.assignee}}
              <span class='meta-item'><@fields.assignee
                  @format='atom'
                /></span>
            {{/if}}
            {{#if @model.createdAt}}
              <span class='meta-item muted'>created
                <@fields.createdAt @format='atom' /></span>
            {{/if}}
          </div>
          {{#if @model.tags.length}}
            <div class='tags'><@fields.tags @format='atom' /></div>
          {{/if}}
        </header>
        {{#if @model.details}}
          <section class='panel details'><@fields.details /></section>
        {{/if}}
        <section class='panel'>
          <h2>Subtasks
            {{#if this.total}}<span class='progress'>{{this.done}}
                of
                {{this.total}}
                done</span>{{/if}}</h2>
          {{#if this.total}}
            <div class='subtask-list'><@fields.subtasks
                @format='embedded'
              /></div>
          {{else}}
            <p class='empty'>No subtasks — this task stands alone.</p>
          {{/if}}
        </section>
      </article>
      <style scoped>
        .task-page {
          max-width: 44rem;
          margin: 0 auto;
          padding: 2rem 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }
        header {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          border-bottom: 2px solid var(--foreground, var(--boxel-dark));
          padding-bottom: 1.25rem;
        }
        .head-row {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
        }
        h1 {
          margin: 0;
          font-size: 1.625rem;
          line-height: 1.15;
          font-family: var(--font-heading, inherit);
        }
        .meta {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-sm);
          flex-wrap: wrap;
          font-size: var(--boxel-font-size-sm);
        }
        .meta-item {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-4xs);
        }
        .muted {
          color: var(--muted-foreground, var(--boxel-450));
        }
        .tags {
          display: flex;
          gap: var(--boxel-sp-4xs);
          flex-wrap: wrap;
        }
        .panel {
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: 0.75rem;
          padding: 1rem 1.25rem;
          background: var(--card, var(--boxel-light));
        }
        h2 {
          margin: 0 0 0.75rem;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--muted-foreground, var(--boxel-450));
          display: flex;
          align-items: baseline;
          gap: var(--boxel-sp-xs);
        }
        .progress {
          text-transform: none;
          letter-spacing: normal;
          font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
        .subtask-list {
          display: flex;
          flex-direction: column;
        }
        .subtask-list :deep(.boxel-card-container--boundaries) {
          box-shadow: none;
          background: transparent;
        }
        .subtask-list :deep(.task-row) {
          border-top: 1px solid var(--border, var(--boxel-200));
        }
        .empty {
          margin: 0;
          color: var(--muted-foreground, var(--boxel-450));
          font-size: var(--boxel-font-size-sm);
        }
        .details :deep(p:first-child) {
          margin-top: 0;
        }
        .details :deep(p:last-child) {
          margin-bottom: 0;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Task> {
    get done() {
      return doneCount(this.args.model);
    }
    get total() {
      return subtaskList(this.args.model).length;
    }
    <template>
      <div class='fit'>
        <div class='top'>
          <@fields.status @format='atom' />
          {{#if @model.priority}}
            <span class='f-priority'><@fields.priority
                @format='atom'
              /></span>
          {{/if}}
        </div>
        <span class='f-title'>{{@model.cardTitle}}</span>
        <div class='f-meta'>
          {{#if @model.dueDate}}
            <@fields.dueDate @format='atom' />
          {{/if}}
          {{#if this.total}}
            <span class='f-subs'>{{this.done}}/{{this.total}} done</span>
          {{/if}}
        </div>
        <div class='f-extra'>
          {{#if @model.assignee}}
            <StatePill @label={{@model.assignee.name}} @chrome={{true}} />
          {{/if}}
        </div>
      </div>
      <style scoped>
        .fit {
          width: 100%;
          height: 100%;
          padding: var(--boxel-sp-xs);
          display: grid;
          grid-template-rows: auto auto minmax(0, 1fr) auto;
          gap: var(--boxel-sp-4xs);
          overflow: hidden;
        }
        .top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--boxel-sp-4xs);
        }
        .f-title {
          font-weight: 600;
          font-size: var(--boxel-font-size-sm);
          line-height: 1.25;
          color: var(--foreground, var(--boxel-dark));
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow: hidden;
        }
        .f-meta {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          font-size: var(--boxel-font-size-xs);
          align-self: start;
        }
        .f-subs {
          font-variant-numeric: tabular-nums;
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
        }
        .f-extra {
          display: flex;
          align-items: center;
          min-height: 0;
        }
        /* badge: status + one-line title only */
        @container fitted-card (width <= 150px) and (height <= 169px) {
          .f-priority,
          .f-meta,
          .f-extra {
            display: none;
          }
          .f-title {
            -webkit-line-clamp: 1;
            font-size: var(--boxel-font-size-xs);
          }
        }
        /* strip: single row, due date joins */
        @container fitted-card (aspect-ratio > 2.0) and (height <= 90px) {
          .fit {
            grid-template-rows: none;
            grid-template-columns: auto minmax(0, 1fr) auto;
            align-items: center;
          }
          .f-title {
            -webkit-line-clamp: 1;
          }
          .f-priority,
          .f-subs,
          .f-extra {
            display: none;
          }
        }
        /* card: assignee row earns its place */
        @container fitted-card (width < 400px) or (height < 170px) {
          .f-extra {
            display: none;
          }
        }
      </style>
    </template>
  };
}

export default Task;
