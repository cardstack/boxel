import { concat } from '@ember/helper';
import {
  CardDef,
  Component,
  field,
  contains,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import DatetimeField from 'https://cardstack.com/base/datetime';
import MarkdownField from 'https://cardstack.com/base/markdown';
import BooleanField from 'https://cardstack.com/base/boolean';
import { EventRsvp } from './event-rsvp';
import EventIcon from '@cardstack/boxel-icons/calendar-plus';
import { dayjsFormat } from '@cardstack/boxel-ui/helpers';
import { htmlSafe } from '@ember/template';

export class CalendarEvent extends CardDef {
  static displayName = 'Calendar Event';
  static icon = EventIcon;

  @field title = contains(StringField);
  @field startDateTime = contains(DatetimeField);
  @field endDateTime = contains(DatetimeField);
  @field description = contains(MarkdownField);
  @field location = contains(StringField);
  @field isAllDay = contains(BooleanField);
  @field requiresRsvp = contains(BooleanField);
  @field rsvp = linksTo(EventRsvp);

  static isolated = class Isolated extends Component<typeof CalendarEvent> {
    <template>
      <div class='event-container'>
        <div
          class='event-header'
          style={{htmlSafe
            (concat
              'background-color: ' (if @model.isAllDay '#3498db' '#9b59b6')
            )
          }}
        >
          <h1>{{@model.title}}</h1>
          <div class='event-meta'>
            <div class='event-time'>
              {{#if @model.isAllDay}}
                <span class='all-day-badge'>All Day</span>
                {{dayjsFormat @model.startDateTime 'MMM D, YYYY'}}
              {{else}}
                {{dayjsFormat @model.startDateTime 'MMM D, YYYY • h:mm A'}}
                -
                {{dayjsFormat @model.endDateTime 'h:mm A'}}
              {{/if}}
            </div>
            <div class='event-location'>
              <span>📍 {{@model.location}}</span>
            </div>
          </div>
        </div>

        <div class='event-content'>
          <div class='event-description'>
            <h2>About This Event</h2>
            <@fields.description />
          </div>

          {{#if @model.requiresRsvp}}
            <div class='event-rsvp'>
              <h2>RSVP</h2>
              {{#if @model.rsvp}}
                <@fields.rsvp @format='embedded' />
              {{else}}
                <p>RSVP information is not available for this event.</p>
              {{/if}}
            </div>
          {{/if}}
        </div>
      </div>
      <style scoped>
        .event-container {
          font-family:
            system-ui,
            -apple-system,
            BlinkMacSystemFont,
            sans-serif;
          max-width: 800px;
          margin: 0 auto;
          border-radius: 8px;
          overflow: hidden;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }
        .event-header {
          padding: 24px;
          color: white;
        }
        h1 {
          margin: 0 0 16px 0;
          font-size: 28px;
        }
        .event-meta {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 16px;
        }
        .event-time {
          font-size: 18px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .all-day-badge {
          background-color: rgba(255, 255, 255, 0.3);
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 14px;
          margin-right: 8px;
        }
        .event-location {
          font-size: 16px;
        }
        .event-content {
          padding: 24px;
          background-color: white;
        }
        .event-description,
        .event-rsvp {
          margin-bottom: 32px;
        }
        h2 {
          font-size: 20px;
          margin-bottom: 16px;
          color: #2c3e50;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof CalendarEvent> {
    <template>
      <div class='event-card'>
        <div
          class='event-date'
          style={{htmlSafe
            (concat
              'background-color: ' (if @model.isAllDay '#3498db' '#9b59b6')
            )
          }}
        >
          <div class='month'>{{dayjsFormat @model.startDateTime 'MMM'}}</div>
          <div class='day'>{{dayjsFormat @model.startDateTime 'DD'}}</div>
        </div>
        <div class='event-details'>
          <h3>{{@model.title}}</h3>
          <div class='event-time-location'>
            {{#if @model.isAllDay}}
              <span class='time'>All Day</span>
            {{else}}
              <span class='time'>{{dayjsFormat @model.startDateTime 'h:mm A'}}
                -
                {{dayjsFormat @model.endDateTime 'h:mm A'}}</span>
            {{/if}}
            <span class='location'>📍 {{@model.location}}</span>
          </div>
          {{#if @model.requiresRsvp}}
            <span class='rsvp-badge'>Requires RSVP</span>
          {{/if}}
        </div>
      </div>
      <style scoped>
        .event-card {
          display: flex;
          background-color: white;
          height: 100%;
        }
        .event-date {
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          color: white;
          padding: 12px;
          min-width: 70px;
          text-align: center;
        }
        .month {
          font-size: 14px;
          font-weight: 500;
          text-transform: uppercase;
        }
        .day {
          font-size: 24px;
          font-weight: bold;
        }
        .event-details {
          padding: 16px;
          display: flex;
          flex-direction: column;
          flex-grow: 1;
        }
        h3 {
          font-size: 18px;
          margin: 0 0 8px 0;
          color: #2c3e50;
        }
        .event-time-location {
          font-size: 14px;
          display: flex;
          flex-direction: column;
          color: #7f8c8d;
          gap: 4px;
          margin-bottom: 8px;
        }
        .rsvp-badge {
          align-self: flex-start;
          background-color: #e74c3c;
          color: white;
          font-size: 12px;
          padding: 3px 8px;
          border-radius: 4px;
          margin-top: auto;
        }
      </style>
    </template>
  };
}
