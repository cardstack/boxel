import { eq } from '@cardstack/boxel-ui/helpers';
import { ModelConfiguration as BaseModelConfiguration } from 'https://cardstack.com/base/system-card';
import {
  field,
  contains,
  containsMany,
  linksTo,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';
import enumField from 'https://cardstack.com/base/enum';
import { OpenRouterModel } from '@cardstack/openrouter/openrouter-model';

const PurposeField = enumField(StringField, {
  options: [
    { value: '', label: '(No specific purpose)' },
    { value: 'code', label: 'Code' },
    { value: 'design', label: 'Design' },
    { value: 'debug', label: 'Debug' },
    { value: 'chat', label: 'Chat' },
  ],
});

const TRAILING_ZERO_DECIMAL_RE = new RegExp('\\.0$');

export class ModelConfiguration extends BaseModelConfiguration {
  static displayName = 'Model Configuration';

  @field openRouterModel = linksTo(OpenRouterModel);

  @field purpose = contains(PurposeField);

  @field contextLength = contains(NumberField, {
    computeVia: function (this: ModelConfiguration) {
      try {
        return this.openRouterModel?.contextLength ?? null;
      } catch (e) {
        return null;
      }
    },
  });

  @field canonicalSlug = contains(StringField, {
    computeVia: function (this: ModelConfiguration) {
      try {
        return this.openRouterModel?.canonicalSlug ?? null;
      } catch (e) {
        return null;
      }
    },
  });

  @field name = contains(StringField, {
    computeVia: function (this: ModelConfiguration) {
      try {
        return this.openRouterModel?.name ?? null;
      } catch (e) {
        return null;
      }
    },
  });

  @field modelId = contains(StringField, {
    computeVia: function (this: ModelConfiguration) {
      try {
        return this.openRouterModel?.modelId ?? null;
      } catch (e) {
        return null;
      }
    },
  });

  @field toolsSupported = contains(BooleanField, {
    computeVia: function (this: ModelConfiguration) {
      try {
        return this.openRouterModel?.toolsSupported ?? false;
      } catch (e) {
        return false;
      }
    },
  });

  @field inputModalities = containsMany(StringField, {
    computeVia: function (this: ModelConfiguration) {
      try {
        return this.openRouterModel?.inputModalities ?? [];
      } catch (e) {
        return [];
      }
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: ModelConfiguration) {
      let fullModelName = '';
      let modelName = '';

      try {
        fullModelName = this.openRouterModel?.name ?? '';
        if (fullModelName) {
          const parts = fullModelName.split(':');
          if (parts.length > 1) {
            modelName = parts[1].trim();
          } else {
            modelName = fullModelName.trim();
          }
        }
      } catch (e) {
        fullModelName = '';
      }

      const hasRoleSpecificPurpose = this.purpose && this.purpose !== '';

      if (hasRoleSpecificPurpose) {
        const purposeEmojis: { [key: string]: string } = {
          code: '\u{1F4BB}',
          design: '\u{1F3A8}',
          debug: '\u{1F527}',
          chat: '\u{1F4AC}',
        };
        const emoji = purposeEmojis[this.purpose] || '\u{1F4AC}';
        const purposeLabel =
          this.purpose.charAt(0).toUpperCase() + this.purpose.slice(1);
        const purposeSegment = emoji + ' ' + purposeLabel + '\u30FB';
        const modelSegment = modelName || fullModelName || 'Model';
        const thinkingSuffix = this.reasoningEffort ? '\u30FBThinking' : '';
        const autoTitle = purposeSegment + modelSegment + thinkingSuffix;
        return this.cardInfo?.name || autoTitle;
      }

      if (fullModelName) {
        const thinkingSuffix = this.reasoningEffort ? '\u30FBThinking' : '';
        const autoTitle = '\u2713 ' + fullModelName + thinkingSuffix;
        return this.cardInfo?.name || autoTitle;
      }

      return (
        this.cardInfo?.name ||
        this.modelId ||
        'Model Configuration'
      );
    },
  });

  @field leftBadge = contains(StringField, {
    computeVia: function (this: ModelConfiguration) {
      if (this.purpose && this.purpose !== '') {
        return this.purpose.toUpperCase();
      }
      if (this.openRouterModel) {
        return 'RECOMMENDED';
      }
      return '';
    },
  });

  @field leftBadgeVariant = contains(StringField, {
    computeVia: function (this: ModelConfiguration) {
      if (this.purpose && this.purpose !== '') {
        return 'purpose';
      }
      if (this.openRouterModel) {
        return 'recommended-badge';
      }
      return '';
    },
  });

  @field rightBadge = contains(StringField, {
    computeVia: function (this: ModelConfiguration) {
      if (!this.openRouterModel) {
        return '';
      }
      if (this.reasoningEffort) {
        return '\u{1F4A1}';
      }
      return '\u26A1';
    },
  });

  @field rightBadgeVariant = contains(StringField, {
    computeVia: function (this: ModelConfiguration) {
      if (!this.openRouterModel) {
        return '';
      }
      return 'recommended';
    },
  });

}

function formatContext(num: number | undefined): string {
  if (num == null) return '\u2014';
  if (num >= 1000000) {
    let val = (num / 1000000).toFixed(1).replace(TRAILING_ZERO_DECIMAL_RE, '');
    return val + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(0) + 'K';
  }
  return num.toLocaleString('en-US');
}

const PURPOSE_LABELS: Record<string, string> = {
  code: 'Code Generation',
  design: 'Design',
  debug: 'Debugging',
  chat: 'Chat / General',
};

const REASONING_EFFORT_LABELS: Record<string, string> = {
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
};

class ModelConfigurationIsolated extends Component<typeof ModelConfiguration> {
  get purposeLabel(): string {
    return PURPOSE_LABELS[this.args.model.purpose ?? ''] ?? '';
  }

  get reasoningEffortLabel(): string {
    return REASONING_EFFORT_LABELS[this.args.model.reasoningEffort ?? ''] ?? 'Not Specified';
  }

  <template>
    <article class='mc-isolated'>
      <header class='hero'>
        <div class='type-badge'>
          <svg class='type-badge-icon' width='512' height='512' viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg' fill='currentColor' stroke='currentColor'>
            <g><path d='M3 248.945C18 248.945 76 236 106 219C136 202 136 202 198 158C276.497 102.293 332 120.945 423 120.945' stroke-width='90' /><path d='M511 121.5L357.25 210.268L357.25 32.7324L511 121.5Z' /><path d='M0 249C15 249 73 261.945 103 278.945C133 295.945 133 295.945 195 339.945C273.497 395.652 329 377 420 377' stroke-width='90' /><path d='M508 376.445L354.25 287.678L354.25 465.213L508 376.445Z' /></g>
          </svg>
          MODEL CONFIGURATION
        </div>

        <h1 class='hero-title'>{{if @model.cardTitle @model.cardTitle 'Model Configuration'}}</h1>

        {{#if @model.modelId}}
          <code class='model-id-badge'>{{@model.modelId}}</code>
        {{/if}}

        <div class='hero-stats'>
          {{#if @model.contextLength}}
            <span class='stat-item'>{{formatContext @model.contextLength}} context</span>
          {{/if}}
          {{#if @model.toolsSupported}}
            <span class='stat-sep'>&middot;</span>
            <span class='stat-item'>Tools supported</span>
          {{/if}}
        </div>

        {{#if @model.inputModalities.length}}
          <div class='modality-row'>
            <span class='modality-label'>Input modalities:</span>
            {{#each @model.inputModalities as |modality|}}
              <span class='modality-pill'>{{modality}}</span>
            {{/each}}
          </div>
        {{/if}}

        <div class='hero-badges'>
          {{#if @model.leftBadge}}
            <span class='hero-badge {{@model.leftBadgeVariant}}'>{{@model.leftBadge}}</span>
          {{/if}}
          {{#if @model.rightBadge}}
            <span class='hero-badge {{@model.rightBadgeVariant}}'>
              {{#if (eq @model.rightBadgeVariant 'recommended')}}
                <svg class='badge-check-icon' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='3'><polyline points='20 6 9 17 4 12'></polyline></svg>
              {{/if}}
              {{@model.rightBadge}}
            </span>
          {{/if}}
        </div>
      </header>

      <section class='section'>
        <h2 class='section-title'>Configuration</h2>
        <div class='detail-grid'>
          {{#if this.purposeLabel}}
            <div class='detail-card'>
              <div class='detail-label'>Purpose</div>
              <div class='detail-value'>{{this.purposeLabel}}</div>
            </div>
          {{/if}}
          <div class='detail-card'>
            <div class='detail-label'>Reasoning Effort</div>
            <div class='detail-value'>{{this.reasoningEffortLabel}}</div>
          </div>
        </div>
      </section>

      {{#if @model.openRouterModel}}
        <section class='section'>
          <h2 class='section-title'>Linked OpenRouter Model</h2>
          <div class='linked-model'>
            <@fields.openRouterModel />
          </div>
        </section>
      {{/if}}
    </article>

    <style scoped>
      .mc-isolated {
        background: var(--boxel-light, #ffffff);
        color: var(--boxel-dark, #374151);
        font-family: var(--boxel-font-family);
        max-width: 960px;
        margin: 0 auto;
        padding: var(--boxel-sp-xl) var(--boxel-sp-lg);
      }

      /* Hero */
      .hero {
        margin-bottom: var(--boxel-sp-xl);
        padding-bottom: var(--boxel-sp-lg);
        border-bottom: 1px solid var(--boxel-200, #e8e8e8);
      }

      .type-badge {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-5xs);
        font-size: var(--boxel-font-size-xs);
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--boxel-400, #afafb7);
        margin-bottom: var(--boxel-sp-xs);
      }

      .type-badge-icon {
        width: 1rem;
        height: 1rem;
        color: var(--boxel-dark, #272330);
      }

      .hero-title {
        font-size: var(--boxel-font-size-xl);
        font-weight: 700;
        color: var(--boxel-dark, #272330);
        margin: 0 0 var(--boxel-sp-xxs) 0;
        line-height: 1.2;
      }

      .model-id-badge {
        display: inline-block;
        font-family: var(--boxel-monospace-font-family);
        font-size: var(--boxel-font-size-xs);
        background: var(--boxel-100, #f8f7fa);
        color: var(--boxel-500, #5a586a);
        padding: var(--boxel-sp-6xs) var(--boxel-sp-xxs);
        border-radius: var(--boxel-border-radius-xs);
        border: 1px solid var(--boxel-200, #e8e8e8);
        margin-bottom: var(--boxel-sp-sm);
      }

      .hero-stats {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        flex-wrap: wrap;
        font-size: var(--boxel-font-size-sm);
        color: var(--boxel-400, #afafb7);
        margin-bottom: var(--boxel-sp-sm);
      }

      .stat-item {
        white-space: nowrap;
      }

      .stat-sep {
        color: var(--boxel-300, #d1d1d1);
      }

      .modality-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-5xs);
        flex-wrap: wrap;
        margin-bottom: var(--boxel-sp-sm);
      }

      .modality-label {
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        color: var(--boxel-400);
      }

      .modality-pill {
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        background: var(--boxel-100);
        color: var(--boxel-500);
        padding: 2px var(--boxel-sp-xxs);
        border-radius: var(--boxel-border-radius-xs);
        border: 1px solid var(--boxel-200);
      }

      .hero-badges {
        display: flex;
        gap: var(--boxel-sp-xxs);
        flex-wrap: wrap;
        margin-top: var(--boxel-sp-xs);
      }

      .hero-badge {
        font-size: 0.6875rem;
        font-weight: 700;
        padding: var(--boxel-sp-5xs) var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius-xs);
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-5xs);
      }

      .hero-badge.purpose {
        background: #6467f2;
        color: #ffffff;
      }

      .hero-badge.recommended-badge {
        background: #bbf7d0;
        color: #065f46;
      }

      .hero-badge.recommended {
        background: #d1fae5;
        color: #065f46;
      }

      .badge-check-icon {
        width: 0.875rem;
        height: 0.875rem;
        flex-shrink: 0;
      }

      /* Sections */
      .section {
        margin-bottom: var(--boxel-sp-xl);
      }

      .section-title {
        font-size: var(--boxel-font-size);
        font-weight: 700;
        color: var(--boxel-dark);
        margin: 0 0 var(--boxel-sp-sm) 0;
      }

      /* Detail grid */
      .detail-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: var(--boxel-sp-xs);
      }

      .detail-card {
        background: var(--boxel-light);
        border: 1px solid var(--boxel-200);
        border-radius: var(--boxel-border-radius-sm);
        padding: var(--boxel-sp-sm);
      }

      .detail-label {
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        color: var(--boxel-400);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: var(--boxel-sp-6xs);
      }

      .detail-value {
        font-size: var(--boxel-font-size-lg);
        font-weight: 700;
        color: var(--boxel-dark);
      }

      /* Linked model */
      .linked-model {
        border: 1px solid var(--boxel-200);
        border-radius: var(--boxel-border-radius-sm);
        overflow: hidden;
        height: 250px;
      }
    </style>
  </template>
}

class ModelConfigurationFitted extends Component<typeof ModelConfiguration> {
    get leftBadgeTitle(): string {
      let variant = this.args.model.leftBadgeVariant;
      if (variant === 'purpose') {
        return 'Assigned purpose for this model configuration';
      }
      if (variant === 'recommended-badge') {
        return 'Linked to a verified OpenRouter model';
      }
      return '';
    }

    get rightBadgeTitle(): string {
      if (this.args.model.reasoningEffort) {
        return 'Reasoning enabled — uses extended thinking';
      }
      if (this.args.model.openRouterModel) {
        return 'Verified — linked to OpenRouter model';
      }
      return '';
    }

    formatContext(num: number | undefined): string {
      if (!num) return '\u2014';
      if (num >= 1000000) {
        return (
          (num / 1000000).toFixed(1).replace(TRAILING_ZERO_DECIMAL_RE, '') +
          'M'
        );
      }
      if (num >= 1000) {
        return (num / 1000).toFixed(0) + 'K';
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
                <div class='strip-badge {{@model.leftBadgeVariant}}' title={{this.leftBadgeTitle}}>
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
                <div class='strip-badge {{@model.rightBadgeVariant}}' title={{this.rightBadgeTitle}}>
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
                <div class='tile-badge {{@model.leftBadgeVariant}}' title={{this.leftBadgeTitle}}>
                  {{@model.leftBadge}}
                </div>
              {{/if}}
            </div>
            <div class='tile-badges-right'>
              {{#if @model.rightBadge}}
                <div class='tile-badge {{@model.rightBadgeVariant}}' title={{this.rightBadgeTitle}}>
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
                <div class='card-badge {{@model.leftBadgeVariant}}' title={{this.leftBadgeTitle}}>
                  {{@model.leftBadge}}
                </div>
              {{/if}}
              {{#if @model.rightBadge}}
                <div class='card-badge {{@model.rightBadgeVariant}}' title={{this.rightBadgeTitle}}>
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

        .strip-badge.recommended-badge,
        .tile-badge.recommended-badge,
        .card-badge.recommended-badge {
          background: #bbf7d0;
          color: #065f46;
          padding: 0.25rem 0.5rem;
        }

        .badge-icon {
          width: 0.875rem;
          height: 0.875rem;
          flex-shrink: 0;
        }

        /* Hide non-default formats */
        .badge-format,
        .tile-format,
        .card-format {
          display: none;
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          font-family: 'Inter', ui-sans-serif, system-ui, sans-serif;
        }

        /* Strip is the default visible format */
        .strip-format {
          display: flex;
          align-items: center;
          padding: 0.5rem 0.75rem;
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          font-family: 'Inter', ui-sans-serif, system-ui, sans-serif;
        }

        /* Badge format (≤150px width, <170px height) */
        @container (max-width: 150px) and (max-height: 169px) {
          .strip-format { display: none; }
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

        /* Hide strip when tile/card should show */
        @container (max-width: 399px) and (min-height: 170px) {
          .strip-format { display: none; }
        }
        @container (min-width: 400px) and (min-height: 170px) {
          .strip-format { display: none; }
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
}

ModelConfiguration.isolated = ModelConfigurationIsolated;
ModelConfiguration.fitted = ModelConfigurationFitted;
