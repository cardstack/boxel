import { concat } from '@ember/helper';
import {
  CardDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown';
import DateField from 'https://cardstack.com/base/date';
import BookOpenIcon from '@cardstack/boxel-icons/book-open';
import { formatDateTime } from '@cardstack/boxel-ui/helpers';
import { AbsoluteCodeRefField } from 'https://cardstack.com/base/code-ref';

export class PolicyManual extends CardDef {
  static displayName = 'Policy Manual';
  static icon = BookOpenIcon;
  static prefersWideFormat = true;

  @field manualTitle = contains(StringField);
  @field content = contains(MarkdownField);
  @field lastUpdated = contains(DateField);
  @field version = contains(StringField);
  @field activityLogCardType = contains(AbsoluteCodeRefField);

  @field title = contains(StringField, {
    computeVia: function (this: PolicyManual) {
      try {
        return this.manualTitle ?? 'Policy Manual';
      } catch (e) {
        console.error('PolicyManual: Error computing title', e);
        return 'Policy Manual';
      }
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div class='stage'>
        <div class='manual-mat'>
          <header class='manual-header'>
            <div class='header-content'>
              <svg
                class='manual-icon'
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
              <div class='header-text'>
                <h1>{{if
                    @model.manualTitle
                    @model.manualTitle
                    'Policy & Training Manual'
                  }}</h1>
                <div class='metadata'>
                  {{#if @model.version}}
                    <span class='version'>Version {{@model.version}}</span>
                  {{/if}}
                  {{#if @model.lastUpdated}}
                    <span class='updated'>Updated
                      {{formatDateTime @model.lastUpdated size='medium'}}</span>
                  {{/if}}
                </div>
              </div>
            </div>
          </header>

          <div class='manual-content'>
            {{#if @model.content}}
              <@fields.content />
            {{else}}
              <div class='empty-content'>
                <p>This manual is ready for content. Add policies, procedures,
                  and training guidelines.</p>
              </div>
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

        .manual-mat {
          max-width: 52rem;
          width: 100%;
          background: white;
          border-radius: 0.5rem;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
          overflow-y: auto;
          max-height: 100%;
          font-family: 'Inter', system-ui, sans-serif;
        }

        .manual-header {
          background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%);
          color: white;
          padding: 2rem;
          border-radius: 0.5rem 0.5rem 0 0;
        }

        .header-content {
          display: flex;
          align-items: flex-start;
          gap: 1rem;
        }

        .manual-icon {
          width: 2.5rem;
          height: 2.5rem;
          flex-shrink: 0;
          margin-top: 0.25rem;
        }

        .header-text h1 {
          margin: 0 0 0.75rem 0;
          font-size: 1.875rem;
          font-weight: 700;
          line-height: 1.2;
        }

        .metadata {
          display: flex;
          flex-wrap: wrap;
          gap: 1rem;
          font-size: 0.875rem;
          opacity: 0.9;
        }

        .version {
          background: rgba(255, 255, 255, 0.2);
          padding: 0.25rem 0.75rem;
          border-radius: 1rem;
          font-weight: 500;
        }

        .updated {
          font-weight: 500;
        }

        .manual-content {
          padding: 2.5rem;
          line-height: 1.7;
          color: #374151;
        }

        .empty-content {
          text-align: center;
          padding: 3rem 1rem;
          color: #6b7280;
          font-style: italic;
        }

        @media (max-width: 800px) {
          .stage {
            padding: 0;
          }
          .manual-mat {
            border-radius: 0;
          }
          .manual-header {
            padding: 1.5rem;
          }
          .manual-content {
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
      <div class='policy-card'>
        <div class='policy-header'>
          <svg
            class='policy-icon'
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
          <div class='policy-info'>
            <h3>{{if
                @model.manualTitle
                @model.manualTitle
                'Policy Manual'
              }}</h3>
            {{#if @model.version}}
              <span class='policy-version'>v{{@model.version}}</span>
            {{/if}}
          </div>
        </div>

        {{#if @model.lastUpdated}}
          <div class='policy-updated'>
            Last updated:
            {{formatDateTime @model.lastUpdated size='short'}}
          </div>
        {{/if}}
      </div>

      <style scoped>
        .policy-card {
          padding: 1rem;
          border: 1px solid #e5e7eb;
          border-radius: 0.5rem;
          background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
          font-family: 'Inter', system-ui, sans-serif;
        }

        .policy-header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin-bottom: 0.5rem;
        }

        .policy-icon {
          width: 1.25rem;
          height: 1.25rem;
          color: #1e3a8a;
        }

        .policy-info h3 {
          margin: 0;
          font-size: 0.9375rem;
          font-weight: 600;
          color: #1f2937;
        }

        .policy-version {
          font-size: 0.75rem;
          background: #1e3a8a;
          color: white;
          padding: 0.125rem 0.375rem;
          border-radius: 0.25rem;
          font-weight: 500;
        }

        .policy-updated {
          font-size: 0.75rem;
          color: #6b7280;
          font-weight: 500;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <div class='fitted-container'>
        <div class='badge-format'>
          <div class='manual-badge'>📖 Manual</div>
          <div class='version-badge'>{{if
              @model.version
              (concat 'v' @model.version)
              'Draft'
            }}</div>
        </div>

        <div class='strip-format'>
          <div class='manual-title'>{{if
              @model.manualTitle
              @model.manualTitle
              'Policy Manual'
            }}</div>
          <div class='manual-meta'>{{if
              @model.version
              (concat 'Version ' @model.version)
              'Draft version'
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
              <path d='M4 19.5A2.5 2.5 0 0 1 6.5 17H20' />
              <path
                d='M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z'
              />
            </svg>
            <div class='tile-title'>{{if
                @model.manualTitle
                @model.manualTitle
                'Policy Manual'
              }}</div>
          </div>
          <div class='tile-version'>{{if
              @model.version
              (concat 'Version ' @model.version)
              'Draft version'
            }}</div>
          <div class='tile-updated'>{{if
              @model.lastUpdated
              (formatDateTime @model.lastUpdated size='short')
              'Not yet updated'
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
              <path d='M4 19.5A2.5 2.5 0 0 1 6.5 17H20' />
              <path
                d='M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z'
              />
            </svg>
            <div>
              <div class='card-title'>{{if
                  @model.manualTitle
                  @model.manualTitle
                  'Policy & Training Manual'
                }}</div>
              <div class='card-subtitle'>{{if
                  @model.version
                  (concat 'Version ' @model.version)
                  'Draft version'
                }}</div>
            </div>
          </div>
          <div class='card-meta'>
            {{#if @model.lastUpdated}}
              <div class='card-updated'>Last updated
                {{formatDateTime @model.lastUpdated size='short'}}</div>
            {{else}}
              <div class='card-status'>Ready for initial content</div>
            {{/if}}
          </div>
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
            justify-content: space-between;
          }
        }

        @container (min-width: 400px) and (min-height: 170px) {
          .card-format {
            display: flex;
            flex-direction: column;
            justify-content: space-between;
          }
        }

        .manual-badge,
        .manual-title,
        .tile-title,
        .card-title {
          font-weight: 600;
          color: #1e3a8a;
        }

        .version-badge {
          font-size: 0.6875rem;
          background: #1e3a8a;
          color: white;
          padding: 0.125rem 0.25rem;
          border-radius: 0.125rem;
          align-self: flex-start;
        }

        .manual-meta,
        .tile-version,
        .card-subtitle {
          font-size: 0.75rem;
          color: #6b7280;
          font-weight: 500;
        }

        .tile-header,
        .card-header {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .tile-icon,
        .card-icon {
          width: 1rem;
          height: 1rem;
          color: #1e3a8a;
          flex-shrink: 0;
        }

        .tile-updated,
        .card-updated,
        .card-status {
          font-size: 0.6875rem;
          color: #9ca3af;
        }
      </style>
    </template>
  };
}
