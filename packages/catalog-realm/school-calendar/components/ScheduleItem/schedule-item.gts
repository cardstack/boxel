import { concat } from '@ember/helper';
import {
  CardDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown';
import ClockIcon from '@cardstack/boxel-icons/clock';
import { htmlSafe } from '@ember/template';

export class ScheduleItem extends CardDef {
  static displayName = 'Schedule Item';
  static icon = ClockIcon;

  @field title = contains(StringField);
  @field dayOfWeek = contains(StringField);
  @field startTime = contains(StringField);
  @field endTime = contains(StringField);
  @field location = contains(StringField);
  @field description = contains(MarkdownField);
  @field color = contains(StringField);

  static isolated = class Isolated extends Component<typeof ScheduleItem> {
    <template>
      <div class='schedule-item-container'>
        <div
          class='schedule-header'
          style={{htmlSafe (concat 'background-color: ' @model.color)}}
        >
          <h1>{{@model.title}}</h1>
          <div class='schedule-meta'>
            <span class='day'>{{@model.dayOfWeek}}</span>
            <span class='time'>{{@model.startTime}} - {{@model.endTime}}</span>
            <span class='location'>📍 {{@model.location}}</span>
          </div>
        </div>

        <div class='schedule-content'>
          <div class='schedule-description'>
            <h2>Description</h2>
            <@fields.description />
          </div>
        </div>
      </div>
      <style scoped>
        .schedule-item-container {
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
        .schedule-header {
          padding: 24px;
          color: white;
        }
        h1 {
          margin: 0 0 16px 0;
          font-size: 28px;
        }
        .schedule-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 16px;
          font-size: 18px;
        }
        .schedule-content {
          padding: 24px;
          background-color: white;
        }
        h2 {
          font-size: 20px;
          margin-bottom: 16px;
          color: #2c3e50;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof ScheduleItem> {
    <template>
      <div class='schedule-card'>
        <div
          class='schedule-day-indicator'
          style={{htmlSafe (concat 'background-color: ' @model.color)}}
        >
          <span>{{@model.dayOfWeek}}</span>
        </div>
        <div class='schedule-details'>
          <h3>{{@model.title}}</h3>
          <div class='time-location'>
            <span class='time'>⏱️
              {{@model.startTime}}
              -
              {{@model.endTime}}</span>
            <span class='location'>📍 {{@model.location}}</span>
          </div>
        </div>
      </div>
      <style scoped>
        .schedule-card {
          display: flex;
          background-color: white;
          height: 100%;
        }
        .schedule-day-indicator {
          display: flex;
          justify-content: center;
          align-items: center;
          writing-mode: vertical-rl;
          text-orientation: mixed;
          transform: rotate(180deg);
          color: white;
          padding: 12px 8px;
          font-weight: 600;
          text-transform: uppercase;
          font-size: 14px;
        }
        .schedule-details {
          padding: 16px;
          flex-grow: 1;
        }
        h3 {
          font-size: 18px;
          margin: 0 0 8px 0;
          color: #2c3e50;
        }
        .time-location {
          display: flex;
          flex-direction: column;
          gap: 4px;
          color: #7f8c8d;
          font-size: 14px;
        }
      </style>
    </template>
  };
}
