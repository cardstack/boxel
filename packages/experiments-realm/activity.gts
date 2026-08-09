import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown';
import DatetimeField from 'https://cardstack.com/base/datetime';
import enumField from 'https://cardstack.com/base/enum';
import HistoryIcon from '@cardstack/boxel-icons/history';
import NoteIcon from '@cardstack/boxel-icons/notes';
import PhoneIcon from '@cardstack/boxel-icons/phone';
import MailIcon from '@cardstack/boxel-icons/mail';
import CalendarIcon from '@cardstack/boxel-icons/calendar';
import ArrowRightIcon from '@cardstack/boxel-icons/arrow-right';
import { User } from './user';

const ActivityTypeField = enumField(StringField, {
  options: ['note', 'call', 'email', 'meeting', 'status change'],
  displayName: 'Activity Type',
});

const TYPE_ICONS: Record<string, typeof NoteIcon> = {
  note: NoteIcon,
  call: PhoneIcon,
  email: MailIcon,
  meeting: CalendarIcon,
  'status change': ArrowRightIcon,
};

export class Activity extends CardDef {
  static displayName = 'Activity';
  static icon = HistoryIcon;

  @field activityType = contains(ActivityTypeField);
  @field summary = contains(StringField);
  @field body = contains(MarkdownField);
  @field occurredAt = contains(DatetimeField);
  @field author = linksTo(User);
  @field about = linksTo(CardDef);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: Activity) {
      return this.summary?.trim()?.length
        ? this.summary
        : `Untitled ${this.constructor.displayName}`;
    },
  });

  static atom = class Atom extends Component<typeof Activity> {
    <template>
      <span class='activity-atom'>
        <HistoryIcon class='aa-icon' />
        <span class='aa-name'>{{@model.cardTitle}}</span>
      </span>
      <style scoped>
        .activity-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, #111111);
        }
        .aa-icon {
          width: 14px;
          height: 14px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .aa-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof Activity> {
    get typeIcon() {
      return TYPE_ICONS[this.args.model?.activityType ?? ''] ?? NoteIcon;
    }
    <template>
      <div class='activity-row'>
        <span class='marker'>
          <this.typeIcon class='type-icon' />
        </span>
        <div class='content'>
          <div class='head'>
            <span class='summary'>{{@model.cardTitle}}</span>
            {{#if @model.occurredAt}}
              <span class='when'><@fields.occurredAt /></span>
            {{/if}}
          </div>
          <div class='sub'>
            {{#if @model.activityType}}
              <span class='type'>{{@model.activityType}}</span>
            {{/if}}
            {{#if @model.author.name}}
              <span class='author'>· {{@model.author.name}}</span>
            {{/if}}
          </div>
        </div>
      </div>
      <style scoped>
        .activity-row {
          display: flex;
          align-items: flex-start;
          gap: 0.625rem;
          padding: 0.625rem 0.875rem;
        }
        .marker {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 26px;
          height: 26px;
          border-radius: 50%;
          background: var(--muted, #eef2f7);
          flex-shrink: 0;
          margin-top: 0.0625rem;
        }
        .type-icon {
          width: 14px;
          height: 14px;
          color: var(--muted-foreground, #6b7280);
        }
        .content {
          min-width: 0;
          flex: 1;
        }
        .head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 0.75rem;
        }
        .summary {
          font-weight: 600;
          font-size: 0.8125rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .when {
          font-size: 0.6875rem;
          color: var(--muted-foreground, #6b7280);
          white-space: nowrap;
        }
        .sub {
          font-size: 0.6875rem;
          color: var(--muted-foreground, #6b7280);
          text-transform: capitalize;
        }
        .author {
          text-transform: none;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof Activity> {
    get typeIcon() {
      return TYPE_ICONS[this.args.model?.activityType ?? ''] ?? NoteIcon;
    }
    <template>
      <div class='fitted'>
        <div class='top'>
          <this.typeIcon class='icon' />
          {{#if @model.activityType}}
            <span class='type'>{{@model.activityType}}</span>
          {{/if}}
        </div>
        <span class='summary'>{{@model.cardTitle}}</span>
        {{#if @model.occurredAt}}
          <span class='meta line-when'><@fields.occurredAt /></span>
        {{/if}}
        {{#if @model.author.name}}
          <span class='meta line-author'>by {{@model.author.name}}</span>
        {{/if}}
      </div>
      <style scoped>
        .fitted {
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 0.25rem;
          width: 100%;
          height: 100%;
          padding: 0.625rem 0.75rem;
          box-sizing: border-box;
          overflow: hidden;
          color: var(--foreground, #111111);
        }
        .top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.5rem;
        }
        .icon {
          width: 16px;
          height: 16px;
          color: var(--muted-foreground, #6b7280);
          flex-shrink: 0;
        }
        .type {
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: var(--muted-foreground, #6b7280);
          white-space: nowrap;
        }
        .summary {
          font-weight: 600;
          font-size: 0.8125rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .meta {
          font-size: 0.6875rem;
          color: var(--muted-foreground, #6b7280);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .line-when,
        .line-author {
          display: none;
        }
        @container fitted-card (min-height: 65px) {
          .line-when {
            display: block;
          }
        }
        @container fitted-card (min-height: 170px) {
          .line-author {
            display: block;
          }
        }
      </style>
    </template>
  };

  static isolated = class Isolated extends Component<typeof Activity> {
    get typeIcon() {
      return TYPE_ICONS[this.args.model?.activityType ?? ''] ?? NoteIcon;
    }
    <template>
      <article class='activity-page'>
        <header class='ah'>
          <span class='marker'><this.typeIcon class='type-icon' /></span>
          <div class='ah-id'>
            <p class='doc-kind'>{{if
                @model.activityType
                @model.activityType
                'Activity'
              }}</p>
            <h1>{{@model.cardTitle}}</h1>
            <p class='byline'>
              {{#if @model.occurredAt}}<@fields.occurredAt />{{/if}}
              {{#if @model.author.name}}· {{@model.author.name}}{{/if}}
            </p>
          </div>
        </header>
        {{#if @model.body}}
          <section class='panel'>
            <div class='body'><@fields.body /></div>
          </section>
        {{/if}}
        {{#if @model.about}}
          <section class='panel'>
            <h2>About</h2>
            <dd class='about'><@fields.about @format='atom' /></dd>
          </section>
        {{/if}}
      </article>
      <style scoped>
        .activity-page {
          max-width: 40rem;
          margin: 0 auto;
          padding: 2rem 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }
        .ah {
          display: flex;
          align-items: center;
          gap: 1rem;
          border-bottom: 2px solid var(--foreground, #111111);
          padding-bottom: 1.25rem;
        }
        .marker {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 48px;
          height: 48px;
          border-radius: 50%;
          background: var(--muted, #eef2f7);
          flex-shrink: 0;
        }
        .type-icon {
          width: 22px;
          height: 22px;
          color: var(--muted-foreground, #6b7280);
        }
        .doc-kind {
          margin: 0 0 0.125rem;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          color: var(--muted-foreground, #6b7280);
        }
        h1 {
          margin: 0;
          font-size: 1.5rem;
          line-height: 1.15;
          font-family: var(--font-heading, inherit);
        }
        .byline {
          margin: 0.25rem 0 0;
          font-size: 0.8125rem;
          color: var(--muted-foreground, #6b7280);
        }
        .panel {
          border: 1px solid var(--border, #e5e7eb);
          border-radius: 0.75rem;
          padding: 1rem 1.25rem;
          background: var(--card, #ffffff);
        }
        h2 {
          margin: 0 0 0.75rem;
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--muted-foreground, #6b7280);
        }
        .body {
          font-size: 0.875rem;
        }
        .about {
          margin: 0;
        }
      </style>
    </template>
  };
}
