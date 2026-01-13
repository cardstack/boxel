import { eq } from '@cardstack/boxel-ui/helpers';
import { ModelConfiguration as BaseModelConfiguration } from 'https://cardstack.com/base/system-card'; // ¹ Import base ModelConfiguration
import {
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';

export class ModelConfiguration extends BaseModelConfiguration {
  static displayName = 'Model Configuration';

  @field contextLength = contains(NumberField, {
    description:
      'The maximum context length (in tokens) supported by the model',
  });
  @field canonicalSlug = contains(StringField, {
    description: 'Canonical slug identifier for the model',
  });

  @field name = contains(StringField, {
    description: 'Display name of the model',
  });

  @field leftBadge = contains(StringField, {
    computeVia: function (this: ModelConfiguration) {
      return ''; // Default: no badge
    },
  });

  @field rightBadge = contains(StringField, {
    computeVia: function (this: ModelConfiguration) {
      return ''; // Default: no badge
    },
  });

  @field leftBadgeVariant = contains(StringField, {
    computeVia: function (this: ModelConfiguration) {
      return ''; // Default: no variant
    },
  });

  @field rightBadgeVariant = contains(StringField, {
    computeVia: function (this: ModelConfiguration) {
      return ''; // Default: no variant
    },
  });

  // Override inherited title to respect cardInfo.name
  @field cardTitle = contains(StringField, {
    computeVia: function (this: ModelConfiguration) {
      return (
        this.cardInfo?.name ||
        this.name ||
        this.modelId ||
        'Model Configuration'
      );
    },
  });

  static fitted = class Fitted extends Component<typeof this> {
    formatContext(num: number | undefined): string {
      if (!num) return '—';
      if (num >= 1000000) {
        return `${(num / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
      }
      if (num >= 1000) {
        return `${(num / 1000).toFixed(0)}K`;
      }
      return num.toLocaleString('en-US');
    }

    <template>
      <div class='fitted-container'>
        {{! Badge format (≤150px width, <170px height) }}
        <div class='badge-format'>
          <svg
            class='badge-logo'
            width='512'
            height='512'
            viewBox='0 0 512 512'
            xmlns='http://www.w3.org/2000/svg'
            fill='currentColor'
            stroke='currentColor'
          >
            <g clip-path='url(#clip0_205_3)'>
              <path
                d='M3 248.945C18 248.945 76 236 106 219C136 202 136 202 198 158C276.497 102.293 332 120.945 423 120.945'
                stroke-width='90'
              />
              <path d='M511 121.5L357.25 210.268L357.25 32.7324L511 121.5Z' />
              <path
                d='M0 249C15 249 73 261.945 103 278.945C133 295.945 133 295.945 195 339.945C273.497 395.652 329 377 420 377'
                stroke-width='90'
              />
              <path
                d='M508 376.445L354.25 287.678L354.25 465.213L508 376.445Z'
              />
            </g>
          </svg>
        </div>

        {{! Strip format (>150px width, <170px height) }}
        <div class='strip-format'>
          <div class='strip-content'>
            <div class='strip-row'>
              {{#if @model.leftBadge}}
                <div class='strip-badge {{@model.leftBadgeVariant}}'>
                  {{@model.leftBadge}}
                </div>
              {{/if}}
              <div class='strip-main'>
                <div class='strip-title'>{{if
                    @model.name
                    @model.name
                    (if @model.cardTitle @model.cardTitle 'Model')
                  }}</div>
              </div>
              <div class='strip-spacer'></div>
              {{#if @model.rightBadge}}
                <div class='strip-badge {{@model.rightBadgeVariant}}'>
                  {{#if (eq @model.rightBadgeVariant 'recommended')}}
                    <svg
                      class='badge-icon'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='3'
                    >
                      <polyline points='20 6 9 17 4 12'></polyline>
                    </svg>
                  {{/if}}
                  {{@model.rightBadge}}
                </div>
              {{/if}}
            </div>
            <div class='strip-meta'>
              <svg
                class='strip-icon'
                width='512'
                height='512'
                viewBox='0 0 512 512'
                xmlns='http://www.w3.org/2000/svg'
                fill='currentColor'
                stroke='currentColor'
              >
                <g clip-path='url(#clip0_205_3)'>
                  <path
                    d='M3 248.945C18 248.945 76 236 106 219C136 202 136 202 198 158C276.497 102.293 332 120.945 423 120.945'
                    stroke-width='90'
                  />
                  <path
                    d='M511 121.5L357.25 210.268L357.25 32.7324L511 121.5Z'
                  />
                  <path
                    d='M0 249C15 249 73 261.945 103 278.945C133 295.945 133 295.945 195 339.945C273.497 395.652 329 377 420 377'
                    stroke-width='90'
                  />
                  <path
                    d='M508 376.445L354.25 287.678L354.25 465.213L508 376.445Z'
                  />
                </g>
              </svg>
              {{#if @model.modelId}}
                <span class='strip-id'>{{@model.modelId}}</span>
              {{/if}}
              <div class='strip-context'>{{this.formatContext
                  @model.contextLength
                }}</div>
            </div>
          </div>
        </div>

        {{! Tile format (<400px width, ≥170px height) }}
        <div class='tile-format'>
          <div class='tile-header'>
            <div class='tile-badges'>
              {{#if @model.leftBadge}}
                <div class='tile-badge {{@model.leftBadgeVariant}}'>
                  {{@model.leftBadge}}
                </div>
              {{/if}}
            </div>
            <div class='tile-badges-right'>
              {{#if @model.rightBadge}}
                <div class='tile-badge {{@model.rightBadgeVariant}}'>
                  {{#if (eq @model.rightBadgeVariant 'recommended')}}
                    <svg
                      class='badge-icon'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='3'
                    >
                      <polyline points='20 6 9 17 4 12'></polyline>
                    </svg>
                  {{/if}}
                  {{@model.rightBadge}}
                </div>
              {{/if}}
            </div>
          </div>
          <h4 class='tile-title'>{{if
              @model.name
              @model.name
              (if @model.cardTitle @model.cardTitle 'Model')
            }}</h4>
          {{#if @model.modelId}}
            <div class='tile-id'>{{@model.modelId}}</div>
          {{/if}}
          <div class='tile-footer'>
            <svg
              class='tile-footer-icon'
              width='512'
              height='512'
              viewBox='0 0 512 512'
              xmlns='http://www.w3.org/2000/svg'
              fill='currentColor'
              stroke='currentColor'
            >
              <g clip-path='url(#clip0_205_3)'>
                <path
                  d='M3 248.945C18 248.945 76 236 106 219C136 202 136 202 198 158C276.497 102.293 332 120.945 423 120.945'
                  stroke-width='90'
                />
                <path d='M511 121.5L357.25 210.268L357.25 32.7324L511 121.5Z' />
                <path
                  d='M0 249C15 249 73 261.945 103 278.945C133 295.945 133 295.945 195 339.945C273.497 395.652 329 377 420 377'
                  stroke-width='90'
                />
                <path
                  d='M508 376.445L354.25 287.678L354.25 465.213L508 376.445Z'
                />
              </g>
            </svg>
            {{#if @model.contextLength}}
              <span class='tile-stat'>{{this.formatContext
                  @model.contextLength
                }}
                context</span>
            {{/if}}
          </div>
        </div>

        {{! Card format (≥400px width, ≥170px height) }}
        <div class='card-format'>
          <div class='card-header'>
            <div class='card-meta'>
              <svg
                class='card-icon'
                width='512'
                height='512'
                viewBox='0 0 512 512'
                xmlns='http://www.w3.org/2000/svg'
                fill='currentColor'
                stroke='currentColor'
              >
                <g clip-path='url(#clip0_205_3)'>
                  <path
                    d='M3 248.945C18 248.945 76 236 106 219C136 202 136 202 198 158C276.497 102.293 332 120.945 423 120.945'
                    stroke-width='90'
                  />
                  <path
                    d='M511 121.5L357.25 210.268L357.25 32.7324L511 121.5Z'
                  />
                  <path
                    d='M0 249C15 249 73 261.945 103 278.945C133 295.945 133 295.945 195 339.945C273.497 395.652 329 377 420 377'
                    stroke-width='90'
                  />
                  <path
                    d='M508 376.445L354.25 287.678L354.25 465.213L508 376.445Z'
                  />
                </g>
              </svg>
              <span class='card-type'>MODEL</span>
            </div>
            <div class='card-badges'>
              {{#if @model.leftBadge}}
                <div class='card-badge {{@model.leftBadgeVariant}}'>
                  {{@model.leftBadge}}
                </div>
              {{/if}}
              {{#if @model.rightBadge}}
                <div class='card-badge {{@model.rightBadgeVariant}}'>
                  {{#if (eq @model.rightBadgeVariant 'recommended')}}
                    <svg
                      class='badge-icon'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='3'
                    >
                      <polyline points='20 6 9 17 4 12'></polyline>
                    </svg>
                  {{/if}}
                  {{@model.rightBadge}}
                </div>
              {{/if}}
            </div>
            <h4 class='card-title'>{{if
                @model.name
                @model.name
                (if @model.cardTitle @model.cardTitle 'Model')
              }}</h4>
            {{#if @model.modelId}}
              <div class='card-id'>{{@model.modelId}}</div>
            {{/if}}
          </div>
          <div class='card-footer'>
            {{#if @model.contextLength}}
              <span class='footer-stat'>{{this.formatContext
                  @model.contextLength
                }}
                context</span>
            {{/if}}
          </div>
        </div>
      </div>

      <style scoped>
        .fitted-container {
          container-type: size;
          width: 100%;
          height: 100%;
          background: #ffffff;
          overflow: hidden;
          position: relative;
        }

        /* Badge styles (inline, same layer) */
        .strip-badge,
        .tile-badge,
        .card-badge {
          font-size: 0.625rem;
          font-weight: 700;
          padding: 0.25rem 0.5rem;
          border-radius: 4px;
          line-height: 1;
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          flex-shrink: 0;
        }

        /* Badge variants */
        .strip-badge.generic,
        .tile-badge.generic,
        .card-badge.generic {
          background: #f3f4f6;
          color: #6b7280;
        }

        .strip-badge.purpose,
        .tile-badge.purpose,
        .card-badge.purpose {
          background: #6467f2;
          color: #ffffff;
        }

        .strip-badge.recommended,
        .tile-badge.recommended,
        .card-badge.recommended {
          background: #d1fae5; /* soft green */
          color: #065f46; /* deep green text */
          padding: 0.25rem;
        }

        /* NEW: recommended-badge variant (used by RecommendedModel leftBadgeVariant) */
        .strip-badge.recommended-badge,
        .tile-badge.recommended-badge,
        .card-badge.recommended-badge {
          background: #bbf7d0; /* slightly brighter green */
          color: #065f46; /* readable deep green */
          padding: 0.25rem 0.5rem;
        }

        .badge-icon {
          width: 0.875rem;
          height: 0.875rem;
          flex-shrink: 0;
        }

        /* Hide all formats by default */
        .badge-format,
        .strip-format,
        .tile-format,
        .card-format {
          display: none;
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          font-family: 'Inter', ui-sans-serif, system-ui, sans-serif;
        }

        /* Badge format (≤150px width, <170px height) */
        @container (max-width: 150px) and (max-height: 169px) {
          .badge-format {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0.5rem;
          }
        }

        .badge-logo {
          width: clamp(1.5rem, 60%, 3rem);
          height: clamp(1.5rem, 60%, 3rem);
          color: #111827;
        }

        /* Strip format (>150px width, <170px height) */
        @container (min-width: 151px) and (max-height: 169px) {
          .strip-format {
            display: flex;
            align-items: center;
            padding: 0.5rem 0.75rem;
          }
        }

        .strip-content {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          width: 100%;
        }

        .strip-row {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          width: 100%;
        }

        .strip-main {
          display: flex;
          align-items: center;
          min-width: 0;
          flex: 1 1 70%;
        }

        .strip-spacer {
          flex: 1;
        }

        .strip-title {
          font-size: 0.875rem;
          font-weight: 600;
          color: #111827;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .strip-meta {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.625rem;
          color: #9ca3af;
        }

        .strip-icon {
          width: 1rem;
          height: 1rem;
          color: #9ca3af;
          flex-shrink: 0;
        }

        .strip-id {
          font-family: 'SF Mono', Monaco, monospace;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          min-width: 0;
          flex: 1;
        }

        .strip-context {
          font-size: 0.6875rem;
          font-weight: 600;
          color: #6b7280;
          flex-shrink: 0;
          margin-left: auto;
        }

        /* Tile format (<400px width, ≥170px height) */
        @container (max-width: 399px) and (min-height: 170px) {
          .tile-format {
            display: flex;
            flex-direction: column;
            padding: clamp(0.5rem, 3%, 0.875rem);
            gap: 0.5rem;
          }
        }

        .tile-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 0.5rem;
        }

        .tile-badges {
          display: flex;
          gap: 0.375rem;
        }

        .tile-badges-right {
          display: flex;
          gap: 0.375rem;
          margin-left: auto;
        }

        .tile-title {
          font-size: clamp(0.875rem, 4%, 1rem);
          font-weight: 700;
          margin: 0;
          color: #111827;
          line-height: 1.2;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }

        .tile-id {
          font-family: 'SF Mono', Monaco, monospace;
          font-size: 0.625rem;
          color: #6b7280;
          line-height: 1.4;
          word-break: break-all;
        }

        .tile-footer {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          margin-top: auto;
          padding-top: 0.5rem;
          border-top: 1px solid #e5e7eb;
        }

        .tile-footer-icon {
          width: 0.875rem;
          height: 0.875rem;
          color: #9ca3af;
          flex-shrink: 0;
        }

        .tile-stat {
          font-size: 0.6875rem;
          font-weight: 600;
          color: #6b7280;
        }

        /* Card format (≥400px width, ≥170px height) */
        @container (min-width: 400px) and (min-height: 170px) {
          .card-format {
            display: flex;
            flex-direction: column;
            padding: clamp(0.75rem, 3%, 1rem);
            gap: 0.75rem;
          }
        }

        .card-header {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .card-meta {
          display: flex;
          align-items: center;
          gap: 0.375rem;
        }

        .card-badges {
          display: flex;
          gap: 0.375rem;
          flex-wrap: wrap;
          margin-top: 0.5rem;
        }

        .card-icon {
          width: 1.125rem;
          height: 1.125rem;
          color: #111827;
        }

        .card-type {
          font-size: 0.625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #6b7280;
        }

        .card-title {
          font-size: 1.125rem;
          font-weight: 700;
          margin: 0;
          color: #111827;
          line-height: 1.3;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }

        .card-id {
          font-family: 'SF Mono', Monaco, monospace;
          font-size: 0.6875rem;
          color: #6b7280;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .card-footer {
          margin-top: auto;
          padding-top: 0.75rem;
          border-top: 1px solid #e5e7eb;
          display: flex;
          gap: 0.75rem;
          flex-wrap: wrap;
        }

        .footer-stat {
          font-size: 0.75rem;
          font-weight: 600;
          color: #6b7280;
        }
      </style>
    </template>
  };
}
