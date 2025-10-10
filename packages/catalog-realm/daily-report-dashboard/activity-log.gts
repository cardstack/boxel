// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api'; // ¹ Core imports
import StringField from 'https://cardstack.com/base/string';
import DatetimeField from 'https://cardstack.com/base/datetime';
import TextAreaField from 'https://cardstack.com/base/text-area';
import ClockIcon from '@cardstack/boxel-icons/clock'; // ² Activity icon
import { formatDateTime } from '@cardstack/boxel-ui/helpers'; // ³ Formatting helpers

export class ActivityLog extends CardDef {
  // ⁴ Activity log definition
  static displayName = 'Activity Log';
  static icon = ClockIcon;

  @field timestamp = contains(DatetimeField); // ⁵ Auto-timestamp when logging
  @field activity = contains(TextAreaField); // ⁶ Freeform activity description

  // ⁷ Compute title from timestamp for easy identification
  @field title = contains(StringField, {
    computeVia: function (this: ActivityLog) {
      try {
        if (!this.timestamp) return 'Activity Log Entry';
        const date = new Date(this.timestamp);
        return `Activity - ${date.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        })}`;
      } catch (e) {
        console.error('ActivityLog: Error computing title', e);
        return 'Activity Log Entry';
      }
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    // ⁸ Detailed view
    <template>
      <div class='log-entry'>
        <div class='timestamp-header'>
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
          <h2>{{if
              @model.timestamp
              (formatDateTime @model.timestamp size='medium')
              'No timestamp'
            }}</h2>
        </div>

        <div class='activity-content'>
          {{#if @model.activity}}
            <div class='activity-text'>{{@model.activity}}</div>
          {{else}}
            <div class='empty-state'>No activity recorded yet. Click to add
              details.</div>
          {{/if}}
        </div>
      </div>

      <style scoped>
        /* ⁹ Timestamp-focused styling */
        .log-entry {
          max-width: 42rem;
          padding: 1.5rem;
          font-family: 'Inter', system-ui, sans-serif;
        }

        .timestamp-header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin-bottom: 1rem;
          padding-bottom: 0.75rem;
          border-bottom: 2px solid #e5e7eb;
        }

        .time-icon {
          width: 1.5rem;
          height: 1.5rem;
          color: #3b82f6;
        }

        .timestamp-header h2 {
          margin: 0;
          font-size: 1.25rem;
          font-weight: 600;
          color: #1f2937;
        }

        .activity-content {
          background: #f9fafb;
          border-radius: 0.5rem;
          padding: 1rem;
          border-left: 4px solid #3b82f6;
        }

        .activity-text {
          white-space: pre-wrap;
          line-height: 1.6;
          color: #374151;
          font-size: 0.9375rem;
        }

        .empty-state {
          color: #6b7280;
          font-style: italic;
          text-align: center;
          padding: 1rem 0;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    // ¹⁰ Compact view
    <template>
      <div class='log-card'>
        <div class='log-time'>
          {{if
            @model.timestamp
            (formatDateTime @model.timestamp size='tiny')
            'No time'
          }}
        </div>
        <div class='log-preview'>
          {{#if @model.activity}}
            {{@model.activity}}
          {{else}}
            <span class='no-activity'>No activity recorded</span>
          {{/if}}
        </div>
      </div>

      <style scoped>
        .log-card {
          padding: 0.75rem;
          border: 1px solid #e5e7eb;
          border-radius: 0.375rem;
          background: white;
          font-family: 'Inter', system-ui, sans-serif;
        }

        .log-time {
          font-size: 0.75rem;
          font-weight: 600;
          color: #3b82f6;
          margin-bottom: 0.375rem;
        }

        .log-preview {
          font-size: 0.8125rem;
          line-height: 1.4;
          color: #374151;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .no-activity {
          color: #9ca3af;
          font-style: italic;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    // ¹¹ Grid format
    <template>
      <div class='fitted-container'>
        <div class='badge-format'>
          <div class='time-badge'>{{if
              @model.timestamp
              (formatDateTime @model.timestamp size='tiny')
              'No time'
            }}</div>
          <div class='activity-snippet'>{{if
              @model.activity
              @model.activity
              'No activity'
            }}</div>
        </div>

        <div class='strip-format'>
          <div class='strip-time'>{{if
              @model.timestamp
              (formatDateTime @model.timestamp size='short')
              'No timestamp'
            }}</div>
          <div class='strip-activity'>{{if
              @model.activity
              @model.activity
              'No activity recorded'
            }}</div>
        </div>

        <div class='tile-format'>
          <div class='tile-header'>
            <svg
              class='tile-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <circle cx='12' cy='12' r='10' />
              <polyline points='12,6 12,12 16,14' />
            </svg>
            <div class='tile-time'>{{if
                @model.timestamp
                (formatDateTime @model.timestamp size='short')
                'No time'
              }}</div>
          </div>
          <div class='tile-content'>{{if
              @model.activity
              @model.activity
              'No activity logged'
            }}</div>
        </div>

        <div class='card-format'>
          <div class='card-header'>
            <svg
              class='card-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <circle cx='12' cy='12' r='10' />
              <polyline points='12,6 12,12 16,14' />
            </svg>
            <div>
              <div class='card-title'>Activity Log</div>
              <div class='card-time'>{{if
                  @model.timestamp
                  (formatDateTime @model.timestamp size='medium')
                  'No timestamp'
                }}</div>
            </div>
          </div>
          <div class='card-content'>{{if
              @model.activity
              @model.activity
              'No activity recorded yet'
            }}</div>
        </div>
      </div>

      <style scoped>
        .fitted-container {
          container-type: size;
          width: 100%;
          height: 100%;
          font-family: 'Inter', system-ui, sans-serif;
        }

        .badge-format,
        .strip-format,
        .tile-format,
        .card-format {
          display: none;
          width: 100%;
          height: 100%;
          padding: clamp(0.1875rem, 2%, 0.5rem);
          box-sizing: border-box;
        }

        @container (max-width: 150px) and (max-height: 169px) {
          .badge-format {
            display: flex;
            flex-direction: column;
          }
        }

        @container (min-width: 151px) and (max-height: 169px) {
          .strip-format {
            display: flex;
            flex-direction: column;
            gap: 0.25rem;
          }
        }

        @container (max-width: 399px) and (min-height: 170px) {
          .tile-format {
            display: flex;
            flex-direction: column;
          }
        }

        @container (min-width: 400px) and (min-height: 170px) {
          .card-format {
            display: flex;
            flex-direction: column;
          }
        }

        .time-badge,
        .strip-time,
        .tile-time,
        .card-time {
          font-size: 0.75rem;
          font-weight: 600;
          color: #3b82f6;
        }

        .activity-snippet,
        .strip-activity {
          font-size: 0.6875rem;
          color: #374151;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .tile-header,
        .card-header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
        }

        .tile-icon,
        .card-icon {
          width: 1rem;
          height: 1rem;
          color: #3b82f6;
          flex-shrink: 0;
        }

        .tile-content,
        .card-content {
          font-size: 0.8125rem;
          line-height: 1.4;
          color: #374151;
          overflow: hidden;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 3;
        }

        .card-title {
          font-weight: 600;
          font-size: 0.875rem;
          color: #1f2937;
        }
      </style>
    </template>
  };
}
