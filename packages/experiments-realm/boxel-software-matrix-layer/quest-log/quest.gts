import {
  CardDef,
  Component,
  StringField,
  contains,
  field,
  linksToMany,
} from '@cardstack/base/card-api';
import MarkdownField from '@cardstack/base/markdown';
import PercentageField from '@cardstack/base/percentage';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import CompassIcon from '@cardstack/boxel-icons/compass';
import { BoxelButton, ProgressBar } from '@cardstack/boxel-ui/components';

import { statusField } from '../status-field';
import RecordStatusField from '../record-status-field';
import CreatedAtField from '../created-at-field';
import UpdatedAtField from '../updated-at-field';
import { Tree, type TreeNode } from '../components/tree';
import RecommendCommand from '../recommend';
import ArchiveRecordCommand from '../archive-record';
import RestoreRecordCommand from '../restore-record';
import type { Task } from '../task';
import { QuestTask } from './quest-task';
import { Badge } from './badge';

/**
 * Domain lifecycle only — the quest's own journey. Paused is a first-class,
 * non-judgmental state (hobbies meander); existence lifecycle (archiving)
 * is the separate Record Status axis, exactly as the blocks split them.
 */
export const QuestStatusField = statusField({
  displayName: 'Quest Status',
  options: [
    { value: 'Active', hue: 'teal', meaning: 'Currently pursuing.' },
    {
      value: 'Paused',
      hue: 'slate',
      holds: true,
      meaning: 'On hold — a rest, not a failure.',
    },
    {
      value: 'Completed',
      hue: 'green',
      terminal: true,
      holds: true,
      meaning: 'The owner calls it done.',
    },
  ],
  transitions: {
    Active: ['Paused', 'Completed'],
    Paused: ['Active', 'Completed'],
    Completed: ['Active'],
  },
});

function taskNode(task: Task): TreeNode<Task> {
  return {
    item: task,
    children: ((task.subtasks ?? []) as Task[]).filter(Boolean).map(taskNode),
  };
}

interface Suggestion {
  title?: string;
  reason?: string;
}

export class Quest extends CardDef {
  static displayName = 'Quest';
  static icon = CompassIcon;
  static prefersWideFormat = true;

  @field title = contains(StringField);
  @field description = contains(MarkdownField);
  @field category = contains(StringField, {
    description: '"Music", "Collecting", "Reading"…',
  });
  @field icon = contains(StringField, { description: 'An emoji, e.g. 🎸.' });
  @field status = contains(QuestStatusField);
  @field recordStatus = contains(RecordStatusField);
  @field createdAt = contains(CreatedAtField);
  @field updatedAt = contains(UpdatedAtField);
  @field tasks = linksToMany(() => QuestTask);
  @field badges = linksToMany(() => Badge);

  @field progress = contains(PercentageField, {
    computeVia: function (this: Quest) {
      let tasks = ((this.tasks ?? []) as Task[]).filter(Boolean);
      if (!tasks.length) {
        return 0;
      }
      let done = tasks.filter((t) => t.status === 'Done').length;
      return Math.round((done / tasks.length) * 100);
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Quest) {
      return this.title?.trim()?.length ? this.title : 'Untitled quest';
    },
  });

  static embedded = class Embedded extends Component<typeof Quest> {
    <template>
      <div class='quest-row'>
        <span class='q-icon'>{{if @model.icon @model.icon '🧭'}}</span>
        <span class='q-main'>
          <span class='q-title'>{{@model.cardTitle}}</span>
          <span class='q-category'>{{@model.category}}</span>
        </span>
        <span class='q-progress'>{{progressLabel @model.progress}}</span>
        <span class='q-status'><@fields.status @format='atom' /></span>
      </div>
      <style scoped>
        .quest-row {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          font-size: var(--boxel-font-size-sm);
        }
        .q-icon {
          flex: none;
          width: 1.75rem;
          text-align: center;
          font-size: 1.125rem;
        }
        .q-main {
          display: flex;
          flex-direction: column;
          gap: 1px;
          flex: 1;
          min-width: 0;
        }
        .q-title {
          font-weight: 600;
          color: var(--foreground, var(--boxel-dark));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .q-category {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .q-progress {
          flex: none;
          min-width: 3rem;
          text-align: right;
          font-variant-numeric: tabular-nums;
          font-weight: 600;
        }
        .q-status {
          flex: none;
          min-width: 5rem;
          text-align: right;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof Quest> {
    <template>
      <span class='quest-atom'>{{if @model.icon @model.icon '🧭'}}
        {{@model.cardTitle}}</span>
      <style scoped>
        .quest-atom {
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
          color: var(--foreground, var(--boxel-dark));
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Quest> {
    @tracked suggestions: Suggestion[] = [];
    @tracked suggesting = false;
    @tracked suggestError: string | undefined;
    @tracked lifecycleBusy = false;

    private get commandContext() {
      return (this.args as any).context?.commandContext;
    }

    get roots(): TreeNode<Task>[] {
      return ((this.args.model?.tasks ?? []) as Task[])
        .filter(Boolean)
        .map(taskNode);
    }

    get doneCount() {
      return ((this.args.model?.tasks ?? []) as Task[])
        .filter(Boolean)
        .filter((t) => t.status === 'Done').length;
    }

    get taskCount() {
      return ((this.args.model?.tasks ?? []) as Task[]).filter(Boolean).length;
    }

    get isArchived() {
      return this.args.model?.recordStatus === 'Archived';
    }

    // Base PercentageField renders nothing for an explicit 0, so the label
    // comes from the raw value — 0% is a fact, not an absence.
    get progressLabel() {
      return `${this.args.model?.progress ?? 0}%`;
    }

    openTask = (task: Task) => {
      (this.args as any).viewCard?.(task, 'isolated');
    };

    suggest = async () => {
      let model = this.args.model;
      if (!this.commandContext || !model) {
        return;
      }
      this.suggesting = true;
      this.suggestError = undefined;
      try {
        let tasks = ((model.tasks ?? []) as Task[]).filter(Boolean);
        let result = await new RecommendCommand(this.commandContext).execute({
          goal: `${model.title ?? 'this pursuit'} — ${model.category ?? 'a hobby'}`,
          context: JSON.stringify({
            done: tasks
              .filter((t) => t.status === 'Done')
              .map((t) => t.title),
            inProgress: tasks
              .filter((t) => t.status === 'In Progress')
              .map((t) => t.title),
            notStarted: tasks
              .filter((t) => t.status === 'Not Started')
              .map((t) => t.title),
          }),
          count: 3,
        } as any);
        this.suggestions = JSON.parse(
          (result as any)?.suggestions ?? '[]',
        ) as Suggestion[];
      } catch (e: any) {
        this.suggestError = e?.message ?? 'Suggestion failed';
      } finally {
        this.suggesting = false;
      }
    };

    archive = async () => {
      if (!this.commandContext || !this.args.model) {
        return;
      }
      this.lifecycleBusy = true;
      try {
        await new ArchiveRecordCommand(this.commandContext).execute({
          card: this.args.model,
        } as any);
      } finally {
        this.lifecycleBusy = false;
      }
    };

    restore = async () => {
      if (!this.commandContext || !this.args.model) {
        return;
      }
      this.lifecycleBusy = true;
      try {
        await new RestoreRecordCommand(this.commandContext).execute({
          card: this.args.model,
        } as any);
      } finally {
        this.lifecycleBusy = false;
      }
    };

    <template>
      <article class='quest-page {{if this.isArchived "archived"}}'>
        {{#if this.isArchived}}
          <div class='archive-banner'>
            <span>This quest is archived — kept, not deleted.</span>
            {{#if this.commandContext}}
              <BoxelButton
                @kind='secondary-light'
                @size='small'
                @loading={{this.lifecycleBusy}}
                {{on 'click' this.restore}}
              >Bring it back</BoxelButton>
            {{/if}}
          </div>
        {{/if}}
        <header class='hero'>
          <span class='medallion'>{{if @model.icon @model.icon '🧭'}}</span>
          <div class='hero-main'>
            <p class='category'>{{if @model.category @model.category 'Quest'}}</p>
            <h1>{{@model.cardTitle}}</h1>
            <div class='hero-meta'>
              <@fields.status @format='embedded' />
              <span class='counts'>{{this.doneCount}}
                of
                {{this.taskCount}}
                tasks done</span>
              {{#if @model.createdAt}}
                <span class='muted'>started
                  <@fields.createdAt @format='atom' /></span>
              {{/if}}
              {{#if @model.updatedAt}}
                <span class='muted'>updated
                  <@fields.updatedAt @format='atom' /></span>
              {{/if}}
            </div>
            <div class='progress-line'>
              <ProgressBar
                @value={{if @model.progress @model.progress 0}}
                @max={{100}}
              />
              <span class='progress-label'>{{this.progressLabel}}</span>
            </div>
          </div>
          {{#if this.commandContext}}
            {{#unless this.isArchived}}
              <BoxelButton
                @kind='secondary-light'
                @size='small'
                @loading={{this.lifecycleBusy}}
                {{on 'click' this.archive}}
              >Archive</BoxelButton>
            {{/unless}}
          {{/if}}
        </header>

        {{#if @model.description}}
          <section class='panel story'><@fields.description /></section>
        {{/if}}

        <div class='columns'>
          <section class='panel tasks'>
            <h2>The path</h2>
            <Tree
              @roots={{this.roots}}
              @emptyMessage='No tasks yet — the first step is naming one.'
            >
              <:row as |task meta|>
                <button
                  type='button'
                  class='row-open'
                  {{on 'click' (fn this.openTask task)}}
                >
                  <span
                    class='row-title {{if (taskDone task) "done"}}'
                  >{{task.cardTitle}}</span>
                  {{#if meta.hasChildren}}
                    <span class='row-count'>{{meta.descendantCount}}
                      steps</span>
                  {{/if}}
                  <span class='row-status'>{{task.status}}</span>
                </button>
              </:row>
            </Tree>
            {{#if this.commandContext}}
              <div class='suggest'>
                <BoxelButton
                  @kind='secondary-light'
                  @size='small'
                  @loading={{this.suggesting}}
                  {{on 'click' this.suggest}}
                >What should I try next?</BoxelButton>
                {{#if this.suggestError}}
                  <p class='suggest-error'>{{this.suggestError}}</p>
                {{/if}}
                {{#if this.suggestions.length}}
                  <ul class='suggestions'>
                    {{#each this.suggestions as |s|}}
                      <li>
                        <span class='sg-title'>{{s.title}}</span>
                        <span class='sg-reason'>{{s.reason}}</span>
                      </li>
                    {{/each}}
                  </ul>
                {{/if}}
              </div>
            {{/if}}
          </section>

          <section class='panel badges'>
            <h2>Badges</h2>
            {{#if @model.badges.length}}
              <div class='badge-list'><@fields.badges
                  @format='embedded'
                /></div>
            {{else}}
              <p class='empty'>None claimed yet — you decide when one is
                earned.</p>
            {{/if}}
          </section>
        </div>
      </article>
      <style scoped>
        .quest-page {
          max-width: 56rem;
          margin: 0 auto;
          padding: 2rem 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }
        .quest-page.archived {
          opacity: 0.92;
        }
        .archive-banner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--boxel-sp-sm);
          border: 1px dashed var(--border, var(--boxel-200));
          border-radius: 0.75rem;
          padding: 0.625rem 1rem;
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
          background: var(--muted, var(--boxel-100));
        }
        .hero {
          display: flex;
          align-items: flex-start;
          gap: 1.25rem;
          border-bottom: 2px solid var(--foreground, var(--boxel-dark));
          padding-bottom: 1.25rem;
        }
        .medallion {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 4.5rem;
          height: 4.5rem;
          border-radius: 50%;
          font-size: 2rem;
          flex: none;
          background: color-mix(
            in oklch,
            var(--primary, var(--boxel-warning)) 16%,
            var(--card, var(--boxel-light))
          );
          box-shadow: inset 0 0 0 2px var(--primary, var(--boxel-warning));
        }
        .hero-main {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
        }
        .category {
          margin: 0;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          color: var(--muted-foreground, var(--boxel-450));
        }
        h1 {
          margin: 0;
          font-size: 2rem;
          line-height: 1.1;
          font-family: var(--font-heading, inherit);
        }
        .hero-meta {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-sm);
          flex-wrap: wrap;
          font-size: var(--boxel-font-size-sm);
        }
        .counts {
          font-variant-numeric: tabular-nums;
          font-weight: 600;
        }
        .muted {
          color: var(--muted-foreground, var(--boxel-450));
        }
        .progress-line {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-sm);
          margin-top: 0.25rem;
          --boxel-progress-bar-fill-color: var(
            --primary,
            var(--boxel-warning)
          );
        }
        .progress-line > :first-child {
          flex: 1;
        }
        .progress-label {
          font-variant-numeric: tabular-nums;
          font-weight: 700;
          min-width: 3rem;
          text-align: right;
        }
        .columns {
          display: grid;
          grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
          gap: 1.25rem;
        }
        @container (width < 620px) {
          .columns {
            grid-template-columns: minmax(0, 1fr);
          }
        }
        .panel {
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: 0.75rem;
          padding: 1rem 1.25rem;
          background: var(--card, var(--boxel-light));
        }
        .story {
          line-height: 1.55;
        }
        .story :deep(p:first-child) {
          margin-top: 0;
        }
        .story :deep(p:last-child) {
          margin-bottom: 0;
        }
        h2 {
          margin: 0 0 0.75rem;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .row-open {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-4xs);
          flex: 1;
          min-width: 0;
          border: none;
          background: none;
          padding: 0;
          cursor: pointer;
          text-align: left;
          color: inherit;
          font-family: inherit;
        }
        .row-open:hover .row-title {
          text-decoration: underline;
        }
        .row-open:hover .row-title.done {
          text-decoration: line-through underline;
        }
        .row-title {
          font-weight: 600;
          font-size: var(--boxel-font-size-sm);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          flex: 1;
          min-width: 0;
        }
        .row-title.done {
          color: var(--muted-foreground, var(--boxel-450));
          text-decoration: line-through;
          text-decoration-color: color-mix(
            in oklch,
            var(--boxel-success) 55%,
            transparent
          );
        }
        .row-count {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          margin-right: var(--boxel-sp-xs);
          font-variant-numeric: tabular-nums;
        }
        .row-status {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
        }
        .suggest {
          margin-top: 0.75rem;
          border-top: 1px dashed var(--border, var(--boxel-200));
          padding-top: 0.75rem;
        }
        .suggest-error {
          margin: 0.5rem 0 0;
          font-size: var(--boxel-font-size-xs);
          color: var(--boxel-danger);
        }
        .suggestions {
          margin: 0.75rem 0 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .suggestions li {
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 1px;
          border: 1px solid var(--border, var(--boxel-200));
          border-left: 3px solid var(--primary, var(--boxel-warning));
          border-radius: 0.5rem;
          padding: 0.5rem 0.75rem;
        }
        .sg-title {
          font-weight: 600;
          font-size: var(--boxel-font-size-sm);
        }
        .sg-reason {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .badge-list {
          display: flex;
          flex-direction: column;
        }
        .badge-list :deep(.boxel-card-container--boundaries) {
          box-shadow: none;
          background: transparent;
        }
        .empty {
          margin: 0;
          color: var(--muted-foreground, var(--boxel-450));
          font-size: var(--boxel-font-size-sm);
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Quest> {
    <template>
      <div class='fit'>
        <div class='top'>
          <span class='f-icon'>{{if @model.icon @model.icon '🧭'}}</span>
          <@fields.status @format='atom' />
        </div>
        <span class='f-title'>{{@model.cardTitle}}</span>
        <span class='f-meta'>{{if @model.category @model.category 'Quest'}}</span>
        <div class='f-progress'>
          <span class='f-bar'><span
              class='f-fill'
              style={{progressWidth @model.progress}}
            ></span></span>
          <span class='f-pct'>{{progressLabel @model.progress}}</span>
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
        .f-icon {
          font-size: 1.25rem;
        }
        .f-meta {
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--muted-foreground, var(--boxel-450));
          align-self: start;
        }
        .f-title {
          font-weight: 600;
          font-size: var(--boxel-font-size-sm);
          line-height: 1.25;
          font-family: var(--font-heading, inherit);
          color: var(--foreground, var(--boxel-dark));
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          overflow: hidden;
        }
        .f-progress {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-4xs);
          align-self: end;
        }
        .f-bar {
          flex: 1;
          height: 0.375rem;
          border-radius: 999px;
          background: var(--muted, var(--boxel-100));
          overflow: hidden;
        }
        .f-fill {
          display: block;
          height: 100%;
          border-radius: 999px;
          background: var(--primary, var(--boxel-warning));
        }
        .f-pct {
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
          font-variant-numeric: tabular-nums;
          min-width: 2.25rem;
          text-align: right;
        }
        @container fitted-card (width <= 150px) and (height <= 169px) {
          .f-progress,
          .f-meta {
            display: none;
          }
          .f-title {
            -webkit-line-clamp: 1;
            font-size: var(--boxel-font-size-xs);
          }
        }
        @container fitted-card (aspect-ratio > 2.0) and (height <= 90px) {
          .fit {
            grid-template-rows: none;
            grid-template-columns: auto minmax(0, 1fr) auto;
            align-items: center;
          }
          .f-title {
            -webkit-line-clamp: 1;
          }
          .f-meta {
            display: none;
          }
          .f-progress {
            align-self: center;
            min-width: 5rem;
          }
        }
      </style>
    </template>
  };
}

function taskDone(task: Task): boolean {
  return task?.status === 'Done';
}

function progressWidth(progress: number | null | undefined) {
  let pct = Math.min(Math.max(progress ?? 0, 0), 100);
  return htmlSafe(`width: ${pct}%;`);
}

// Base PercentageField's formats hide an explicit 0 — for progress, 0% is
// information, so the label always renders from the raw value.
function progressLabel(progress: number | null | undefined): string {
  return `${progress ?? 0}%`;
}

export default Quest;
