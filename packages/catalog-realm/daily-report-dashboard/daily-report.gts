import {
  CardDef,
  field,
  contains,
  linksTo,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import DateField from 'https://cardstack.com/base/date';
import MarkdownField from 'https://cardstack.com/base/markdown';
import CalendarIcon from '@cardstack/boxel-icons/calendar';
import { formatDateTime } from '@cardstack/boxel-ui/helpers';
import { PolicyManual } from './policy-manual';

export class DailyReport extends CardDef {
  static displayName = 'Daily Report';
  static icon = CalendarIcon;
  static prefersWideFormat = true;

  @field reportDate = contains(DateField);
  @field summary = contains(MarkdownField);
  @field recommendations = contains(MarkdownField);
  @field policyManual = linksTo(PolicyManual);

  @field title = contains(StringField, {
    computeVia: function (this: DailyReport) {
      try {
        if (!this.reportDate) return 'Daily Report';
        const date = new Date(this.reportDate);
        return `Daily Report - ${date.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })}`;
      } catch (e) {
        console.error('DailyReport: Error computing title', e);
        return 'Daily Report';
      }
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div class='stage'>
        <div class='report-mat'>
          <header class='report-header'>
            <div class='header-content'>
              <svg
                class='report-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <rect x='3' y='4' width='18' height='18' rx='2' ry='2' />
                <line x1='16' y1='2' x2='16' y2='6' />
                <line x1='8' y1='2' x2='8' y2='6' />
                <line x1='3' y1='10' x2='21' y2='10' />
              </svg>
              <div class='header-text'>
                <h1>Daily Report</h1>
                <div class='report-date'>
                  {{if
                    @model.reportDate
                    (formatDateTime @model.reportDate size='long')
                    'Date not set'
                  }}
                </div>
              </div>
            </div>
          </header>

          <div class='report-content'>
            <section class='summary-section'>
              <h2>
                <svg
                  class='section-icon'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <path
                    d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'
                  />
                  <polyline points='14,2 14,8 20,8' />
                  <line x1='16' y1='13' x2='8' y2='13' />
                  <line x1='16' y1='17' x2='8' y2='17' />
                  <polyline points='10,9 9,9 8,9' />
                </svg>
                Daily Summary
              </h2>
              {{#if @model.summary}}
                <div class='markdown-content'>
                  <@fields.summary />
                </div>
              {{else}}
                <div class='empty-section'>
                  <p>No summary recorded for this day. Add details about
                    activities, accomplishments, and challenges.</p>
                </div>
              {{/if}}
            </section>

            <section class='recommendations-section'>
              <h2>
                <svg
                  class='section-icon'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <path
                    d='M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'
                  />
                </svg>
                Recommendations for Tomorrow
              </h2>
              {{#if @model.recommendations}}
                <div class='markdown-content'>
                  <@fields.recommendations />
                </div>
              {{else}}
                <div class='empty-section'>
                  <p>No recommendations yet. Consider areas for improvement
                    based on today's activities and policy guidelines.</p>
                </div>
              {{/if}}
            </section>

            {{#if @fields.policyManual}}
              <section class='policy-section'>
                <h2>
                  <svg
                    class='section-icon'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <path d='M4 19.5A2.5 2.5 0 0 1 6.5 17H20' />
                    <path
                      d='M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z'
                    />
                  </svg>
                  Referenced Policy Manual
                </h2>
                <div class='policy-reference'>
                  <@fields.policyManual @format='embedded' />
                </div>
              </section>
            {{/if}}
          </div>
        </div>
      </div>

      <style scoped>
        .stage {
          width: 100%;
          height: 100%;
          display: flex;
          justify-content: center;
          padding: 1rem;
          background: #f8fafc;
        }

        .report-mat {
          max-width: 52rem;
          width: 100%;
          background: white;
          border-radius: 0.5rem;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
          overflow-y: auto;
          max-height: 100%;
          font-family: 'Inter', system-ui, sans-serif;
        }

        .report-header {
          background: linear-gradient(135deg, #059669 0%, #10b981 100%);
          color: white;
          padding: 2rem;
          border-radius: 0.5rem 0.5rem 0 0;
        }

        .header-content {
          display: flex;
          align-items: flex-start;
          gap: 1rem;
        }

        .report-icon {
          width: 2.5rem;
          height: 2.5rem;
          flex-shrink: 0;
          margin-top: 0.25rem;
        }

        .header-text h1 {
          margin: 0 0 0.5rem 0;
          font-size: 1.875rem;
          font-weight: 700;
          line-height: 1.2;
        }

        .report-date {
          font-size: 1rem;
          font-weight: 500;
          opacity: 0.9;
        }

        .report-content {
          padding: 2.5rem;
        }

        .summary-section,
        .recommendations-section,
        .policy-section {
          margin-bottom: 2.5rem;
        }

        .summary-section:last-child,
        .recommendations-section:last-child,
        .policy-section:last-child {
          margin-bottom: 0;
        }

        .summary-section h2,
        .recommendations-section h2,
        .policy-section h2 {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin: 0 0 1.25rem 0;
          font-size: 1.25rem;
          font-weight: 600;
          color: #1f2937;
          border-bottom: 2px solid #e5e7eb;
          padding-bottom: 0.75rem;
        }

        .section-icon {
          width: 1.25rem;
          height: 1.25rem;
          color: #059669;
        }

        .markdown-content {
          line-height: 1.7;
          color: #374151;
        }

        .empty-section {
          background: #f9fafb;
          border: 1px solid #e5e7eb;
          border-radius: 0.375rem;
          padding: 1.5rem;
          text-align: center;
          color: #6b7280;
          font-style: italic;
        }

        .policy-reference {
          background: #f8fafc;
          border-radius: 0.5rem;
          padding: 1rem;
        }

        @media (max-width: 800px) {
          .stage {
            padding: 0;
          }
          .report-mat {
            border-radius: 0;
          }
          .report-header {
            padding: 1.5rem;
          }
          .report-content {
            padding: 1.5rem;
          }
          .header-text h1 {
            font-size: 1.5rem;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='report-card'>
        <div class='report-header'>
          <svg
            class='report-icon'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2'
          >
            <rect x='3' y='4' width='18' height='18' rx='2' ry='2' />
            <line x1='16' y1='2' x2='16' y2='6' />
            <line x1='8' y1='2' x2='8' y2='6' />
            <line x1='3' y1='10' x2='21' y2='10' />
          </svg>
          <div class='report-info'>
            <h3>Daily Report</h3>
            <div class='report-date'>
              {{if
                @model.reportDate
                (formatDateTime @model.reportDate size='short')
                'No date'
              }}
            </div>
          </div>
        </div>

        <div class='report-preview'>
          {{#if @model.summary}}
            <div class='summary-preview'>{{@model.summary}}</div>
          {{else}}
            <div class='no-summary'>No summary recorded</div>
          {{/if}}
        </div>
      </div>

      <style scoped>
        .report-card {
          padding: 1rem;
          border: 1px solid #e5e7eb;
          border-radius: 0.5rem;
          background: linear-gradient(135deg, #ecfdf5 0%, #f0fdf4 100%);
          font-family: 'Inter', system-ui, sans-serif;
        }

        .report-header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin-bottom: 0.75rem;
        }

        .report-icon {
          width: 1.25rem;
          height: 1.25rem;
          color: #059669;
        }

        .report-info h3 {
          margin: 0;
          font-size: 0.9375rem;
          font-weight: 600;
          color: #1f2937;
        }

        .report-date {
          font-size: 0.75rem;
          color: #059669;
          font-weight: 500;
        }

        .summary-preview {
          font-size: 0.8125rem;
          line-height: 1.4;
          color: #374151;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .no-summary {
          font-size: 0.8125rem;
          color: #9ca3af;
          font-style: italic;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <div class='fitted-container'>
        <div class='badge-format'>
          <div class='date-badge'>{{if
              @model.reportDate
              (formatDateTime @model.reportDate size='tiny')
              'No date'
            }}</div>
          <div class='report-type'>📊 Report</div>
        </div>

        <div class='strip-format'>
          <div class='report-title'>Daily Report</div>
          <div class='report-meta'>{{if
              @model.reportDate
              (formatDateTime @model.reportDate size='short')
              'No date set'
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
              <rect x='3' y='4' width='18' height='18' rx='2' ry='2' />
              <line x1='16' y1='2' x2='16' y2='6' />
              <line x1='8' y1='2' x2='8' y2='6' />
              <line x1='3' y1='10' x2='21' y2='10' />
            </svg>
            <div class='tile-date'>{{if
                @model.reportDate
                (formatDateTime @model.reportDate size='short')
                'No date'
              }}</div>
          </div>
          <div class='tile-content'>{{if
              @model.summary
              @model.summary
              'No summary recorded'
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
              <rect x='3' y='4' width='18' height='18' rx='2' ry='2' />
              <line x1='16' y1='2' x2='16' y2='6' />
              <line x1='8' y1='2' x2='8' y2='6' />
              <line x1='3' y1='10' x2='21' y2='10' />
            </svg>
            <div>
              <div class='card-title'>Daily Report</div>
              <div class='card-date'>{{if
                  @model.reportDate
                  (formatDateTime @model.reportDate size='medium')
                  'No date set'
                }}</div>
            </div>
          </div>
          <div class='card-content'>{{if
              @model.summary
              @model.summary
              'No daily summary recorded yet'
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
            justify-content: space-between;
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

        .date-badge,
        .tile-date,
        .card-date {
          font-weight: 600;
          color: #059669;
        }

        .report-type {
          font-size: 0.6875rem;
          background: #059669;
          color: white;
          padding: 0.125rem 0.25rem;
          border-radius: 0.125rem;
          align-self: flex-start;
        }

        .report-title,
        .card-title {
          font-weight: 600;
          color: #1f2937;
        }

        .report-meta {
          font-size: 0.75rem;
          color: #6b7280;
          font-weight: 500;
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
          color: #059669;
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
      </style>
    </template>
  };
}
