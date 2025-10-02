import {
  CardDef,
  field,
  contains,
  Component,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import TextAreaField from 'https://cardstack.com/base/text-area';
import DatetimeField from 'https://cardstack.com/base/datetime';
import { GeoSearchPointField } from '../fields/geo-search-point';

import { formatDateTime, not } from '@cardstack/boxel-ui/helpers';
import { FieldContainer, BoxelInput } from '@cardstack/boxel-ui/components';

import UserIcon from '@cardstack/boxel-icons/user';
import CalendarIcon from '@cardstack/boxel-icons/calendar';
import ClockIcon from '@cardstack/boxel-icons/clock';

import { Author } from './author';
import AuthorDisplay from './components/author-display';

// Custom TextAreaField with placeholder support
class TextAreaPlaceholderField extends TextAreaField {
  static edit = class Edit extends Component<typeof this> {
    <template>
      <BoxelInput
        class='boxel-text-area'
        @value={{@model}}
        @onInput={{@set}}
        @type='textarea'
        @disabled={{not @canEdit}}
        @placeholder="What's on your mind?"
      />
    </template>
  };
}

// Default Post
class PostEdit extends Component<typeof Post> {
  <template>
    <article class='post-edit'>
      <@fields.content @format='edit' />
    </article>

    <style scoped>
      .post-edit {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
      }
    </style>
  </template>
}

class PostEmbedded extends Component<typeof Post> {
  <template>
    <article class='post-card'>
      <header class='post-header'>
        <AuthorDisplay
          @author={{@model.author}}
          @createdAt={{@model.createdAt}}
        />
      </header>

      <div class='post-content'>
        <div class='post-description'>
          {{#if @model.content}}
            <p>{{@model.content}}</p>
          {{else}}
            <p class='empty'>What's on your mind?</p>
          {{/if}}
        </div>
      </div>
    </article>

    <style scoped>
      .post-card {
        background: var(--boxel-light);
        width: 100%;
        height: 100%;
      }

      .post-header {
        padding: var(--boxel-sp-sm);
      }

      .post-content {
        color: var(--boxel-500);
        line-height: 1.5;
      }

      .post-description {
        background: var(--boxel-100);
        padding: var(--boxel-sp-sm);
        margin: var(--boxel-sp-xs) 0;
        border-left: 4px solid var(--boxel-blue);
      }

      .post-description p {
        margin: 0;
        font: var(--boxel-font);
        color: var(--boxel-700);
        white-space: pre-wrap;
        word-wrap: break-word;
      }

      .post-description p.empty {
        color: var(--boxel-400);
        font-style: italic;
      }
    </style>
  </template>
}

export class Post extends CardDef {
  static displayName = 'Post';
  static icon = UserIcon;

  @field author = linksTo(() => Author);
  @field content = contains(TextAreaPlaceholderField);
  @field createdAt = contains(DatetimeField);

  @field title = contains(StringField, {
    computeVia: function (this: Post) {
      const preview = this.content?.substring(0, 50) || 'New Post';
      return preview.length > 50 ? preview + '...' : preview;
    },
  });

  static edit = PostEdit;
  static embedded = PostEmbedded;
}

// Event Post Embedded Template
class EventPostEmbedded extends Component<typeof EventPost> {
  <template>
    <article class='event-post-card'>
      <header class='event-post-header'>
        <AuthorDisplay
          @author={{@model.author}}
          @createdAt={{@model.createdAt}}
        />
      </header>

      <div class='event-content'>
        <div class='event-details'>
          <h3 class='event-title'>{{@model.eventTitle}}</h3>
          <div class='event-date'>
            <CalendarIcon class='event-icon' />
            {{#if @model.eventDate}}
              <span>Event Date: </span>
              {{formatDateTime @model.eventDate size='medium'}}
            {{else}}
              <span>No date set</span>
            {{/if}}
          </div>

          {{#if @model.location}}
            <div class='event-location'>
              <svg
                class='location-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path d='M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z' />
                <circle cx='12' cy='10' r='3' />
              </svg>
              <span>{{@model.location.searchKey}}</span>
            </div>
          {{/if}}
        </div>

        {{#if @model.content}}
          <div class='event-description'>
            <p>{{@model.content}}</p>
          </div>
        {{/if}}
      </div>
    </article>

    <style scoped>
      .event-post-card {
        background: var(--boxel-light);
        width: 100%;
        height: 100%;
      }

      .event-post-header {
        padding: var(--boxel-sp-sm);
      }

      .event-content {
        color: var(--boxel-500);
        line-height: 1.5;
      }

      .event-details {
        background: var(--boxel-100);
        padding: var(--boxel-sp-sm);
        margin: var(--boxel-sp-xs) 0;
        border-left: 4px solid var(--boxel-blue);
      }

      .event-title {
        margin: 0 0 var(--boxel-sp-xs) 0;
        font: 600 var(--boxel-font-lg);
        color: var(--boxel-700);
      }

      .event-date {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        color: var(--boxel-blue);
        font: 500 var(--boxel-font-sm);
      }

      .event-icon {
        width: var(--boxel-icon-xs);
        height: var(--boxel-icon-xs);
      }

      .event-location {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        color: var(--boxel-400);
        font: var(--boxel-font-sm);
        margin-top: var(--boxel-sp-xs);
      }

      .location-icon {
        width: var(--boxel-icon-xs);
        height: var(--boxel-icon-xs);
      }

      .event-description {
        padding: var(--boxel-sp-sm);
      }

      .event-description p {
        margin: 0;
        color: var(--boxel-500);
      }
    </style>
  </template>
}

// Reminder Post Embedded Template
class ReminderPostEmbedded extends Component<typeof ReminderPost> {
  <template>
    <article class='reminder-post-card'>
      <header class='reminder-post-header'>
        <AuthorDisplay
          @author={{@model.author}}
          @createdAt={{@model.reminderDate}}
        />
      </header>

      <div class='reminder-content'>
        <div class='reminder-details'>
          <h3 class='reminder-title'>{{@model.reminderTitle}}</h3>
          <div class='reminder-date'>
            <ClockIcon class='reminder-icon' />
            {{#if @model.reminderDate}}
              <span>Reminder Date: </span>
              {{formatDateTime @model.reminderDate size='medium'}}
            {{else}}
              <span>No reminder date set</span>
            {{/if}}
          </div>
        </div>

        {{#if @model.content}}
          <div class='reminder-description'>
            <p>{{@model.content}}</p>
          </div>
        {{/if}}
      </div>
    </article>

    <style scoped>
      .reminder-post-card {
        background: var(--boxel-light);
        width: 100%;
        height: 100%;
      }

      .reminder-post-header {
        padding: var(--boxel-sp-sm);
      }

      .reminder-content {
        color: var(--boxel-500);
        line-height: 1.5;
      }

      .reminder-details {
        background: var(--boxel-100);
        padding: var(--boxel-sp-sm);
      }

      .reminder-title {
        margin: 0 0 var(--boxel-sp-xs) 0;
        font: 600 var(--boxel-font-lg);
        color: var(--boxel-700);
      }

      .reminder-date {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        color: var(--boxel-orange);
        font: 500 var(--boxel-font-sm);
      }

      .reminder-icon {
        width: var(--boxel-icon-xs);
        height: var(--boxel-icon-xs);
      }

      .reminder-description {
        padding: var(--boxel-sp-sm);
      }

      .reminder-description p {
        margin: 0;
        color: var(--boxel-500);
      }
    </style>
  </template>
}

// Reminder Post
class ReminderPostEdit extends Component<typeof ReminderPost> {
  <template>
    <article class='reminder-post-edit'>

      <div class='reminder-fields-row'>
        <FieldContainer
          @label='Reminder Title'
          @vertical={{true}}
          class='reminder-title-field'
        >
          <@fields.reminderTitle @format='edit' />
        </FieldContainer>
        <FieldContainer
          @label='Reminder Date'
          @vertical={{true}}
          class='reminder-date-field'
        >
          <@fields.reminderDate @format='edit' />
        </FieldContainer>
      </div>

      <@fields.content @format='edit' />
    </article>

    <style scoped>
      .reminder-post-edit {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        container-type: inline-size;
      }

      .reminder-fields-row {
        display: flex;
        gap: var(--boxel-sp);
        align-items: flex-start;
      }

      @container (max-width: 447px) {
        .reminder-fields-row {
          flex-direction: column;
        }
      }
    </style>
  </template>
}

export class ReminderPost extends Post {
  static displayName = 'Reminder Post';
  static icon = ClockIcon;

  @field reminderTitle = contains(StringField);
  @field reminderDate = contains(DatetimeField);

  static edit = ReminderPostEdit;
  static embedded = ReminderPostEmbedded;
}

// Event Post
class EventPostEdit extends Component<typeof EventPost> {
  <template>
    <article class='event-post-edit'>

      <div class='event-fields-row'>
        <FieldContainer @label='Event Title' @vertical={{true}}>
          <@fields.eventTitle @format='edit' />
        </FieldContainer>
        <FieldContainer @label='Event Date' @vertical={{true}}>
          <@fields.eventDate @format='edit' />
        </FieldContainer>
      </div>
      <FieldContainer @label='Event Location' @vertical={{true}}>
        <@fields.location @format='edit' />
        <@fields.location @format='embedded' />
      </FieldContainer>

      <@fields.content @format='edit' />
    </article>

    <style scoped>
      .event-post-edit {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
      }

      .event-fields-row {
        display: flex;
        gap: var(--boxel-sp);
        align-items: flex-start;
      }

      @container (max-width: 447px) {
        .event-fields-row {
          flex-direction: column;
        }
      }
    </style>
  </template>
}

export class EventPost extends Post {
  static displayName = 'Event Post';
  static icon = CalendarIcon;

  @field eventTitle = contains(StringField);
  @field eventDate = contains(DatetimeField);
  @field location = contains(GeoSearchPointField);

  static edit = EventPostEdit;
  static embedded = EventPostEmbedded;
}
