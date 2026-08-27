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
import DateTimeField from '@cardstack/base/datetime';
import DurationField from '@cardstack/base/time/duration';
import enumField from '@cardstack/base/enum';
import NotebookPenIcon from '@cardstack/boxel-icons/notebook-pen';

import { ScoreField } from '../score-field';
import CreatedAtField from '../created-at-field';
import { QuestTask } from './quest-task';
import { Quest } from './quest';

const MoodField = enumField(StringField, {
  displayName: 'Mood',
  options: [
    { value: '😊', label: '😊 Good' },
    { value: '😐', label: '😐 Okay' },
    { value: '😫', label: '😫 Tough' },
  ],
});

/**
 * A block of time spent on a quest — the journal entry, not a timesheet row.
 * Duration and Time semantics come from the platform Duration block; the
 * 1–5 energy rating consumes the shared Score block; mood is deliberately
 * app-local (three emoji, no scale — this app never grades feelings).
 */
export class Session extends CardDef {
  static displayName = 'Session';
  static icon = NotebookPenIcon;

  @field title = contains(StringField);
  @field startedAt = contains(DateTimeField);
  @field duration = contains(DurationField);
  @field notes = contains(MarkdownField);
  @field achievements = contains(StringField, {
    description: 'What moved forward, in one line.',
  });
  @field mood = contains(MoodField);
  @field energy = contains(ScoreField);
  @field createdAt = contains(CreatedAtField);
  @field quest = linksTo(() => Quest);
  @field tasks = linksToMany(() => QuestTask);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Session) {
      return this.title?.trim()?.length ? this.title : 'Practice session';
    },
  });

  static embedded = class Embedded extends Component<typeof Session> {
    <template>
      <div class='session-row'>
        <span class='s-mood'>{{if @model.mood @model.mood '·'}}</span>
        <span class='s-main'>
          <span class='s-title'>{{@model.cardTitle}}</span>
          {{#if @model.achievements}}
            <span class='s-achievement'>{{@model.achievements}}</span>
          {{/if}}
        </span>
        <span class='s-duration'>{{#if @model.duration}}<@fields.duration
              @format='atom'
            />{{else}}—{{/if}}</span>
        <span class='s-energy'><@fields.energy @format='atom' /></span>
      </div>
      <style scoped>
        .session-row {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          font-size: var(--boxel-font-size-sm);
        }
        .s-mood {
          flex: none;
          width: 1.5rem;
          text-align: center;
        }
        .s-main {
          display: flex;
          flex-direction: column;
          gap: 1px;
          flex: 1;
          min-width: 0;
        }
        .s-title {
          font-weight: 600;
          color: var(--foreground, var(--boxel-dark));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .s-achievement {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .s-duration {
          flex: none;
          min-width: 3.5rem;
          text-align: right;
          font-variant-numeric: tabular-nums;
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .s-energy {
          flex: none;
          min-width: 2.5rem;
          text-align: right;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof Session> {
    <template>
      <span class='session-atom'>{{if @model.mood @model.mood ''}}
        {{@model.cardTitle}}</span>
      <style scoped>
        .session-atom {
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
          color: var(--foreground, var(--boxel-dark));
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Session> {
    <template>
      <article class='session-page'>
        <header>
          <p class='kind'>Session{{#if @model.quest}}
              ·
              <@fields.quest @format='atom' />{{/if}}</p>
          <h1>{{if @model.mood @model.mood ''}} {{@model.cardTitle}}</h1>
          <div class='meta'>
            {{#if @model.startedAt}}
              <span><@fields.startedAt /></span>
            {{/if}}
            {{#if @model.duration}}
              <span><@fields.duration @format='embedded' /></span>
            {{/if}}
            <span class='energy'><@fields.energy @format='embedded' /></span>
          </div>
        </header>
        {{#if @model.achievements}}
          <p class='achievement'>🏅 {{@model.achievements}}</p>
        {{/if}}
        {{#if @model.notes}}
          <section class='panel'><@fields.notes /></section>
        {{else}}
          <p class='empty'>No notes for this one — the time still counts.</p>
        {{/if}}
        {{#if @model.tasks.length}}
          <section class='panel worked'>
            <h2>Worked on</h2>
            <@fields.tasks @format='atom' />
          </section>
        {{/if}}
      </article>
      <style scoped>
        .session-page {
          max-width: 38rem;
          margin: 0 auto;
          padding: 2rem 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        header {
          border-bottom: 2px solid var(--foreground, var(--boxel-dark));
          padding-bottom: 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
        }
        .kind {
          margin: 0;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          color: var(--muted-foreground, var(--boxel-450));
        }
        h1 {
          margin: 0;
          font-size: 1.5rem;
          line-height: 1.2;
          font-family: var(--font-heading, inherit);
        }
        .meta {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-sm);
          flex-wrap: wrap;
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .achievement {
          margin: 0;
          font-weight: 600;
          color: var(--foreground, var(--boxel-dark));
        }
        .panel {
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: 0.75rem;
          padding: 1rem 1.25rem;
          background: var(--card, var(--boxel-light));
          line-height: 1.55;
        }
        .panel :deep(p:first-child) {
          margin-top: 0;
        }
        .panel :deep(p:last-child) {
          margin-bottom: 0;
        }
        .worked h2 {
          margin: 0 0 0.5rem;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .empty {
          margin: 0;
          color: var(--muted-foreground, var(--boxel-450));
          font-size: var(--boxel-font-size-sm);
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Session> {
    <template>
      <div class='fit'>
        <div class='top'>
          <span class='f-mood'>{{if @model.mood @model.mood '·'}}</span>
          <span class='f-energy'><@fields.energy @format='atom' /></span>
        </div>
        <span class='f-title'>{{@model.cardTitle}}</span>
        <span class='f-meta'>{{#if @model.duration}}<@fields.duration
              @format='atom'
            />{{/if}}</span>
      </div>
      <style scoped>
        .fit {
          width: 100%;
          height: 100%;
          padding: var(--boxel-sp-xs);
          display: grid;
          grid-template-rows: auto minmax(0, 1fr) auto;
          gap: var(--boxel-sp-4xs);
          overflow: hidden;
        }
        .top {
          display: flex;
          align-items: center;
          justify-content: space-between;
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
          align-self: end;
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
        @container fitted-card (aspect-ratio > 2.0) and (height <= 90px) {
          .fit {
            grid-template-rows: none;
            grid-template-columns: auto minmax(0, 1fr) auto;
            align-items: center;
          }
          .f-energy {
            display: none;
          }
          .f-title {
            -webkit-line-clamp: 1;
          }
          .f-meta {
            align-self: center;
          }
        }
        @container fitted-card (width <= 150px) and (height <= 169px) {
          .f-energy,
          .f-meta {
            display: none;
          }
        }
      </style>
    </template>
  };
}

export default Session;
