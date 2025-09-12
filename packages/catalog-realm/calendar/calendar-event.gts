import { concat } from '@ember/helper';
// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api'; // ¹ Core imports
import StringField from 'https://cardstack.com/base/string';
import DatetimeField from 'https://cardstack.com/base/datetime';
import NumberField from 'https://cardstack.com/base/number';
import MarkdownField from 'https://cardstack.com/base/markdown';
import { Button } from '@cardstack/boxel-ui/components'; // ² UI components
import {
  formatDateTime,
  formatDuration,
  eq,
} from '@cardstack/boxel-ui/helpers'; // ³ Helpers
import EventIcon from '@cardstack/boxel-icons/calendar-days'; // ⁴ Icon import

export class CalendarEvent extends CardDef {
  // ⁵ Calendar Event card
  static displayName = 'Calendar Event';
  static icon = EventIcon;

  @field eventTitle = contains(StringField); // ⁶ Event details
  @field eventType = contains(StringField); // study-session, assignment, exam, deadline, meeting
  @field startTime = contains(DatetimeField);
  @field endTime = contains(DatetimeField);
  @field location = contains(StringField);
  @field description = contains(MarkdownField);
  @field priority = contains(StringField); // low, medium, high, urgent
  @field isCompleted = contains(StringField); // pending, completed, cancelled
  @field duration = contains(NumberField); // minutes
  @field subject = contains(StringField);

  // ⁷ Computed title
  @field title = contains(StringField, {
    computeVia: function (this: CalendarEvent) {
      try {
        return this.eventTitle ?? 'Untitled Event';
      } catch (e) {
        console.error('CalendarEvent: Error computing title', e);
        return 'Untitled Event';
      }
    },
  });

  // ⁸ Computed duration from start/end times
  get calculatedDuration() {
    try {
      if (!this.startTime || !this.endTime) return this.duration || 0;
      const start = new Date(this.startTime);
      const end = new Date(this.endTime);
      return Math.round((end.getTime() - start.getTime()) / (1000 * 60));
    } catch (e) {
      console.error('CalendarEvent: Error calculating duration', e);
      return this.duration || 0;
    }
  }

  // ⁹ Event type styling
  get eventTypeColor() {
    switch (this.eventType) {
      case 'study-session':
        return '#3b82f6'; // blue
      case 'assignment':
        return '#f59e0b'; // yellow
      case 'exam':
        return '#dc2626'; // red
      case 'deadline':
        return '#e11d48'; // rose
      case 'meeting':
        return '#059669'; // green
      default:
        return '#6b7280'; // gray
    }
  }

  // ¹⁰ Priority styling
  get priorityColor() {
    switch (this.priority) {
      case 'urgent':
        return '#dc2626'; // red
      case 'high':
        return '#f59e0b'; // yellow
      case 'medium':
        return '#3b82f6'; // blue
      case 'low':
        return '#6b7280'; // gray
      default:
        return '#6b7280';
    }
  }

  static embedded = class Embedded extends Component<typeof CalendarEvent> {
    // ¹¹ Embedded format
    <template>
      <div class='calendar-event-card'>
        <div class='event-header'>
          <div class='event-info'>
            <h4 class='event-title'>{{if
                @model.eventTitle
                @model.eventTitle
                'Untitled Event'
              }}</h4>
            <div class='event-meta'>
              {{#if @model.eventType}}
                <span
                  class='event-type'
                  style={{concat 'color: ' @model.eventTypeColor}}
                >{{@model.eventType}}</span>
              {{/if}}
              {{#if @model.subject}}
                <span class='event-subject'>{{@model.subject}}</span>
              {{/if}}
            </div>
          </div>
          {{#if @model.priority}}
            <div
              class='priority-indicator priority-{{@model.priority}}'
              style={{concat 'background: ' @model.priorityColor}}
            ></div>
          {{/if}}
        </div>

        <div class='event-details'>
          {{#if @model.startTime}}
            <div class='event-time'>
              <svg
                class='time-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <circle cx='12' cy='12' r='10' />
                <polyline points='12,6 12,12 16,14' />
              </svg>
              <span>{{formatDateTime @model.startTime format='h:mm A'}}</span>
              {{#if @model.endTime}}
                <span class='time-separator'>-</span>
                <span>{{formatDateTime @model.endTime format='h:mm A'}}</span>
              {{/if}}
              {{#if @model.calculatedDuration}}
                <span class='duration'>({{formatDuration
                    @model.calculatedDuration
                    unit='minutes'
                    format='humanize'
                  }})</span>
              {{/if}}
            </div>
          {{/if}}

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
              <span>{{@model.location}}</span>
            </div>
          {{/if}}
        </div>

        {{#if @model.description}}
          <div class='event-description'>
            <@fields.description />
          </div>
        {{/if}}

        {{#if @model.isCompleted}}
          <div class='event-status status-{{@model.isCompleted}}'>
            {{if
              (eq @model.isCompleted 'completed')
              '✓ Completed'
              @model.isCompleted
            }}
          </div>
        {{/if}}
      </div>

      <style scoped>
        /* ¹² Event card styling */
        .calendar-event-card {
          padding: 0.75rem;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          font-size: 0.8125rem;
          margin-bottom: 0.5rem;
        }

        .event-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 0.5rem;
        }

        .event-title {
          font-size: 0.875rem;
          font-weight: 600;
          color: #1f2937;
          margin: 0 0 0.25rem 0;
          line-height: 1.2;
        }

        .event-meta {
          display: flex;
          gap: 0.5rem;
          font-size: 0.6875rem;
        }

        .event-type {
          font-weight: 500;
          text-transform: capitalize;
        }

        .event-subject {
          color: #6b7280;
        }

        .priority-indicator {
          width: 0.75rem;
          height: 0.75rem;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .event-details {
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
          margin-bottom: 0.5rem;
        }

        .event-time,
        .event-location {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.75rem;
          color: #374151;
        }

        .time-icon,
        .location-icon {
          width: 0.875rem;
          height: 0.875rem;
          color: #6b7280;
        }

        .time-separator {
          color: #6b7280;
          margin: 0 0.25rem;
        }

        .duration {
          color: #6b7280;
          font-size: 0.6875rem;
        }

        .event-description {
          font-size: 0.75rem;
          color: #374151;
          line-height: 1.4;
          margin-bottom: 0.5rem;
        }

        .event-status {
          font-size: 0.6875rem;
          font-weight: 500;
          padding: 0.25rem 0.5rem;
          border-radius: 4px;
          text-align: center;
        }

        .status-completed {
          background: #dcfce7;
          color: #166534;
        }

        .status-pending {
          background: #fef3c7;
          color: #92400e;
        }

        .status-cancelled {
          background: #fee2e2;
          color: #dc2626;
        }
      </style>
    </template>
  };
}
