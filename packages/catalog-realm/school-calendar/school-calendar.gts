import {
  CardDef,
  Component,
  field,
  contains,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import DateField from 'https://cardstack.com/base/date';
import { CalendarEvent } from './components/calendar-event';
import { ScheduleItem } from './components/schedule-item';
import CalendarIcon from '@cardstack/boxel-icons/calendar';
import { dayjsFormat } from '@cardstack/boxel-ui/helpers';

export class SchoolCalendar extends CardDef {
  static displayName = 'School Calendar';
  static icon = CalendarIcon;

  @field title = contains(StringField);
  @field schoolYearStart = contains(DateField);
  @field schoolYearEnd = contains(DateField);
  @field description = contains(StringField);
  @field events = linksToMany(CalendarEvent);
  @field scheduleItems = linksToMany(ScheduleItem);

  static isolated = class Isolated extends Component<typeof SchoolCalendar> {
    <template>
      <div class='calendar-container'>
        <div class='calendar-header'>
          <h1>{{@model.title}}</h1>
          <div class='school-year'>
            <span>School Year:
              {{dayjsFormat @model.schoolYearStart 'MMMM D, YYYY'}}
              -
              {{dayjsFormat @model.schoolYearEnd 'MMMM D, YYYY'}}</span>
          </div>
          <p class='description'>{{@model.description}}</p>
        </div>

        <div class='calendar-section'>
          <h2>Upcoming Events</h2>
          <div class='events-list'>
            {{#if @model.events}}
              <@fields.events @format='embedded' />
            {{else}}
              <p class='no-events'>No upcoming events</p>
            {{/if}}
          </div>
        </div>

        <div class='calendar-section'>
          <h2>Weekly Schedule</h2>
          <div class='schedule-list'>
            {{#if @model.scheduleItems}}
              <@fields.scheduleItems @format='embedded' />
            {{else}}
              <p class='no-schedule'>No schedule items available</p>
            {{/if}}
          </div>
        </div>
      </div>
      <style scoped>
        .calendar-container {
          font-family:
            system-ui,
            -apple-system,
            BlinkMacSystemFont,
            sans-serif;
          padding: 24px;
          max-width: 1200px;
          margin: 0 auto;
        }
        .calendar-header {
          margin-bottom: 32px;
          text-align: center;
          border-bottom: 1px solid #eaeaea;
          padding-bottom: 16px;
        }
        h1 {
          font-size: 32px;
          margin-bottom: 8px;
          color: #2c3e50;
        }
        .school-year {
          font-size: 18px;
          color: #7f8c8d;
          margin-bottom: 16px;
        }
        .description {
          font-size: 16px;
          color: #34495e;
          line-height: 1.5;
        }
        .calendar-section {
          margin-bottom: 40px;
        }
        h2 {
          font-size: 24px;
          margin-bottom: 16px;
          color: #2c3e50;
          border-bottom: 2px solid #3498db;
          padding-bottom: 8px;
          display: inline-block;
        }
        .no-events,
        .no-schedule {
          grid-column: 1 / -1;
          text-align: center;
          padding: 24px;
          background: #f9f9f9;
          border-radius: 8px;
          color: #7f8c8d;
        }
      </style>
    </template>
  };
}
