import { fn } from '@ember/helper';
import { gt, or } from '@cardstack/boxel-ui/helpers';
import {
  FieldDef,
  Component,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import { ModelConfiguration } from './model-configuration';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';

export class OpenRouterPricing extends FieldDef {
  static displayName = 'OpenRouter Pricing';
  @field prompt = contains(StringField);
  @field completion = contains(StringField);
  @field request = contains(StringField);
  @field image = contains(StringField);
}

export class OpenRouterArchitecture extends FieldDef {
  static displayName = 'OpenRouter Architecture';
  @field modality = contains(StringField);
  @field inputModalities = containsMany(StringField);
  @field outputModalities = containsMany(StringField);
  @field tokenizer = contains(StringField);
  @field instructType = contains(StringField);
}

export class OpenRouterTopProvider extends FieldDef {
  static displayName = 'OpenRouter Top Provider';
  @field isModerated = contains(BooleanField);
  @field contextLength = contains(NumberField);
  @field maxCompletionTokens = contains(NumberField);
}

export class OpenRouterPerRequestLimits extends FieldDef {
  static displayName = 'OpenRouter Per-Request Limits';
  @field promptTokens = contains(NumberField);
  @field completionTokens = contains(NumberField);
}

export class OpenRouterDefaultParameters extends FieldDef {
  static displayName = 'OpenRouter Default Parameters';
  @field temperature = contains(NumberField);
  @field top_p = contains(NumberField);
  @field max_tokens = contains(NumberField); // optional at data level
  @field frequency_penalty = contains(NumberField);
  @field presence_penalty = contains(NumberField);
}

class Isolated extends Component<typeof OpenRouterModel> {
  @tracked copied = false;
  @tracked showFullDescription = false;

  copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      this.copied = true;
      setTimeout(() => {
        this.copied = false;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  toggleDescription = () => {
    this.showFullDescription = !this.showFullDescription;
  };

  formatPrice(price: string | undefined): string {
    if (!price) return '—';
    const priceNum = parseFloat(price);
    if (priceNum === 0) return 'Free';
    // Convert to dollars per million tokens
    const perMillion = priceNum * 1000000;
    return `$${perMillion.toFixed(2)}`;
  }

  formatDate(timestamp: number | undefined): string {
    if (!timestamp) return '—';
    return new Date(timestamp * 1000).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  formatNumber(num: number | undefined): string {
    if (!num) return '—';
    return num.toLocaleString('en-US');
  }

  get truncatedDescription(): string {
    if (!this.args.model.cardDescription) return '';
    const maxLength = 200;
    if (this.args.model.cardDescription.length <= maxLength)
      return this.args.model.cardDescription;
    return this.args.model.cardDescription.substring(0, maxLength) + '...';
  }

  <template>
    <article class='orm-isolated'>
      <header class='hero-header'>
        <div class='logo-header'>
          <svg
            class='openrouter-logo'
            xmlns='http://www.w3.org/2000/svg'
            viewBox='0 0 1200 400'
          >
            <title>OpenRouter</title>
            <path
              fill='currentColor'
              d='M431.4 196.2c0 11.2-2.1 20.8-6.2 28.8a45 45 0 0 1-41 25 44.8 44.8 0 0 1-41-25c-4.2-8-6.2-17.7-6.2-28.8 0-11.2 2-20.8 6.1-28.8a44.9 44.9 0 0 1 41.1-25 45 45 0 0 1 41 25c4.1 8 6.2 17.6 6.2 28.8m-15.7 0c0-8.5-1.4-15.7-4.1-21.6a30.6 30.6 0 0 0-11.3-13.3c-4.7-3-10.1-4.5-16.1-4.5a30 30 0 0 0-16.2 4.5c-4.7 3-8.4 7.5-11.2 13.3-2.7 5.9-4.1 13-4.1 21.6 0 8.5 1.4 15.7 4.1 21.5A30.7 30.7 0 0 0 368 231c4.8 3 10.2 4.6 16.2 4.6s11.4-1.5 16.1-4.6c4.8-3 8.5-7.4 11.3-13.3 2.7-5.8 4.1-13 4.1-21.5Zm34 81.8V170h15v12.7h1.3c.9-1.6 2.1-3.5 3.8-5.6a22 22 0 0 1 18.7-8.1 30.6 30.6 0 0 1 28.7 18.6c2.9 6 4.3 13.3 4.3 21.8s-1.4 15.8-4.2 21.8a33 33 0 0 1-11.7 14 30 30 0 0 1-17 4.9c-4.7 0-8.6-.8-11.6-2.4a22 22 0 0 1-7.1-5.6c-1.7-2.2-3-4.1-4-5.8h-.8V278h-15.3m15-68.7c0 5.5.7 10.3 2.3 14.5 1.6 4.2 4 7.4 7 9.7 3 2.4 6.7 3.5 11.1 3.5 4.6 0 8.4-1.2 11.5-3.6 3-2.5 5.4-5.8 7-10 1.6-4.2 2.4-8.9 2.4-14.1 0-5.2-.8-9.9-2.4-14a21.7 21.7 0 0 0-7-9.7 18 18 0 0 0-11.5-3.6c-4.4 0-8.1 1.1-11.2 3.4-3 2.3-5.3 5.5-7 9.6a40 40 0 0 0-2.3 14.3ZM572.4 250c-7.8 0-14.4-1.6-20-5-5.6-3.3-9.9-8-12.9-14s-4.5-13.2-4.5-21.3c0-8 1.5-15.1 4.5-21.3a35 35 0 0 1 12.7-14.4 38.5 38.5 0 0 1 32-3 31.3 31.3 0 0 1 19 19.2c2 5 2.9 11 2.9 18.2v5.4h-62.5v-11.5h47.5c0-4-.8-7.6-2.5-10.7a18.6 18.6 0 0 0-17.2-10c-4.3 0-8 1-11.2 3a22.3 22.3 0 0 0-10 19.2v9c0 5.2 1 9.6 2.8 13.3 1.9 3.7 4.5 6.5 7.8 8.4a23 23 0 0 0 11.7 2.9c3 0 5.6-.4 8-1.3a16.4 16.4 0 0 0 10.2-10l14.4 2.7c-1.1 4.3-3.2 8-6.2 11.2-3 3.2-6.7 5.6-11.2 7.4a41.7 41.7 0 0 1-15.3 2.6Zm66-48.2v46.7h-15.3V170H638v12.8h1c1.8-4.2 4.6-7.5 8.5-10 3.8-2.6 8.7-3.8 14.6-3.8 5.4 0 10 1.1 14 3.3 4.1 2.3 7.2 5.6 9.4 10a36 36 0 0 1 3.4 16.3v50h-15.3v-48.2a19 19 0 0 0-4.5-13.3c-3-3.3-7-4.9-12.2-4.9a19 19 0 0 0-9.4 2.3 16.4 16.4 0 0 0-6.5 6.8 21.8 21.8 0 0 0-2.4 10.6Zm72 46.7V143.8h37.3c8 0 14.8 1.4 20.2 4.2 5.4 2.8 9.4 6.7 12 11.6a35 35 0 0 1 4 17c0 6.5-1.3 12.1-4 17a27.3 27.3 0 0 1-12 11.3c-5.4 2.7-12.2 4-20.3 4h-28.2v-13.6h26.8c5.1 0 9.3-.7 12.5-2.2 3.2-1.4 5.6-3.6 7-6.4a21 21 0 0 0 2.3-10c0-4-.7-7.4-2.2-10.3a15.2 15.2 0 0 0-7.1-6.7 29.3 29.3 0 0 0-12.7-2.3h-19.9v91.2h-15.7m51.7-47.3 25.8 47.3h-18l-25.3-47.3h17.5Zm73 48.8a34.1 34.1 0 0 1-32-19.2 47 47 0 0 1-4.6-21.3c0-8.1 1.5-15.2 4.5-21.3a34.1 34.1 0 0 1 32-19.3 34.1 34.1 0 0 1 32 19.3 45 45 0 0 1 4.7 21.3 47 47 0 0 1-4.6 21.3 34.1 34.1 0 0 1-32 19.2m0-12.8c4.8 0 8.8-1.3 11.9-3.8 3.1-2.5 5.4-5.9 7-10a42 42 0 0 0 2.2-14c0-5-.7-9.5-2.2-13.8a22.8 22.8 0 0 0-7-10.1 18.2 18.2 0 0 0-11.9-3.8c-4.8 0-8.8 1.2-12 3.8-3 2.6-5.4 6-7 10.2a40.5 40.5 0 0 0-2.2 13.8c0 5 .8 9.6 2.3 13.8 1.5 4.2 3.8 7.6 7 10.1 3.1 2.5 7.1 3.8 12 3.8ZM938.6 216v-46h15.3v78.6h-15v-13.7h-.8a24.4 24.4 0 0 1-23.5 14.7 26 26 0 0 1-13.4-3.4 23 23 0 0 1-9-10 36.3 36.3 0 0 1-3.4-16.2v-50h15.3v48.1a18 18 0 0 0 4.4 12.8c3 3.2 6.9 4.8 11.6 4.8a19 19 0 0 0 15.7-8.7c1.9-2.9 2.8-6.6 2.8-11Zm72.5-46v12.3h-43V170h43m-31.4-18.8H995v74.3c0 3 .4 5.2 1.3 6.7.9 1.4 2 2.5 3.5 3 1.4.5 3 .8 4.6.8a176.6 176.6 0 0 0 5.4-.7l2.7 12.6a27.2 27.2 0 0 1-10 1.7c-4 0-7.7-.7-11.2-2.2a19.3 19.3 0 0 1-8.4-7c-2.1-3-3.2-7-3.2-11.7v-77.5Zm82.1 99c-7.7 0-14.4-1.7-20-5-5.5-3.4-9.8-8-12.8-14.1-3-6-4.6-13.2-4.6-21.3a47 47 0 0 1 4.6-21.3c3-6.1 7.2-11 12.6-14.4a38.5 38.5 0 0 1 32-3 31.3 31.3 0 0 1 19 19.2c2 5 3 11 3 18.2v5.4H1033v-11.5h47.4c0-4-.8-7.6-2.4-10.7a18.7 18.7 0 0 0-17.3-10c-4.3 0-8 1-11.2 3a22.9 22.9 0 0 0-9.9 19.2v9c0 5.2.9 9.6 2.8 13.3 1.8 3.7 4.4 6.5 7.8 8.4a23 23 0 0 0 11.7 2.9 24 24 0 0 0 7.9-1.3 16.7 16.7 0 0 0 10.2-9.9l14.4 2.6a26 26 0 0 1-6.2 11.2 30 30 0 0 1-11.2 7.4 41.6 41.6 0 0 1-15.3 2.6Zm50.7-1.6V170h14.8v12.5h.8c1.5-4.2 4-7.6 7.6-10 3.7-2.5 7.8-3.7 12.4-3.7a68 68 0 0 1 6.5.4v14.6a31.9 31.9 0 0 0-8-1 20 20 0 0 0-9.6 2.4 17.2 17.2 0 0 0-9.2 15.4v48h-15.3Z'
            />
            <g fill='currentColor' stroke='currentColor'>
              <path
                stroke-width='35.3'
                d='M46.2 200.5c5.9 0 28.6-5.1 40.3-11.8 11.8-6.6 11.8-6.6 36.1-23.9 30.8-21.8 52.5-14.5 88.2-14.5'
              />
              <path
                stroke-width='.4'
                d='M245.3 150.5 185 185.3v-69.6l60.3 34.8Z'
              />
              <path
                stroke-width='35.3'
                d='M45 200.5c5.9 0 28.6 5 40.4 11.7 11.7 6.7 11.7 6.7 36 24 30.8 21.8 52.5 14.5 88.2 14.5'
              />
              <path
                stroke-width='.4'
                d='m244.1 250.4-60.3-34.7v69.5l60.3-34.8Z'
              />
            </g>
          </svg>
        </div>

        <h1 class='hero-title'>{{if
            @model.name
            @model.name
            'OpenRouter Model'
          }}</h1>

        {{#if @model.modelId}}
          <div class='model-id-row'>
            <code class='model-id-badge'>{{@model.modelId}}</code>
            <button
              class='copy-btn-inline'
              {{on 'click' (fn this.copyToClipboard @model.modelId)}}
              type='button'
            >
              {{#if this.copied}}
                <svg
                  class='icon-sm'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <polyline points='20 6 9 17 4 12'></polyline>
                </svg>
              {{else}}
                <svg
                  class='icon-sm'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <rect x='9' y='9' width='13' height='13' rx='2' ry='2'></rect>
                  <path
                    d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'
                  ></path>
                </svg>
              {{/if}}
            </button>
          </div>
        {{/if}}

        <div class='metadata-row'>
          {{#if @model.created}}
            <span class='metadata-item'>Created
              {{this.formatDate @model.created}}</span>
            <span class='separator'>|</span>
          {{/if}}
          {{#if @model.contextLength}}
            <span class='metadata-item'>Context
              {{this.formatNumber @model.contextLength}}</span>
            <span class='separator'>|</span>
          {{/if}}
          {{#if @model.pricing.prompt}}
            <span class='metadata-item'>Input
              {{this.formatPrice @model.pricing.prompt}}/M</span>
            <span class='separator'>|</span>
          {{/if}}
          {{#if @model.pricing.completion}}
            <span class='metadata-item'>Output
              {{this.formatPrice @model.pricing.completion}}/M</span>
          {{/if}}
        </div>

        {{#if @model.cardDescription}}
          <div class='description-block'>
            <p class='description-text'>
              {{#if this.showFullDescription}}
                {{@model.cardDescription}}
              {{else}}
                {{this.truncatedDescription}}
              {{/if}}
            </p>
            {{#if (gt @model.cardDescription.length 200)}}
              <button
                class='show-more-btn'
                {{on 'click' this.toggleDescription}}
                type='button'
              >
                {{#if this.showFullDescription}}
                  Show less
                  <svg
                    class='arrow-icon up'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <polyline points='18 15 12 9 6 15'></polyline>
                  </svg>
                {{else}}
                  Show more
                  <svg
                    class='arrow-icon'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <polyline points='6 9 12 15 18 9'></polyline>
                  </svg>
                {{/if}}
              </button>
            {{/if}}
          </div>
        {{/if}}

        <nav class='tab-nav'>
          <button class='tab-link active' type='button'>Overview</button>
          <button class='tab-link' type='button'>Performance</button>
          <button class='tab-link' type='button'>Parameters</button>
        </nav>
      </header>

      <section class='content-section'>
        <h2 class='content-section-title'>Model Details</h2>

        <div class='detail-grid'>
          <div class='detail-card'>
            <div class='detail-label'>Context Window</div>
            <div class='detail-value-large'>{{this.formatNumber
                @model.contextLength
              }}</div>
          </div>

          <div class='detail-card'>
            <div class='detail-label'>Modality</div>
            <div class='detail-value-large'>{{if
                @model.architecture.modality
                @model.architecture.modality
                '—'
              }}</div>
          </div>

          <div class='detail-card'>
            <div class='detail-label'>Tokenizer</div>
            <div class='detail-value-large'>{{if
                @model.architecture.tokenizer
                @model.architecture.tokenizer
                '—'
              }}</div>
          </div>
        </div>
      </section>

      <section class='content-section'>
        <h2 class='content-section-title'>Pricing</h2>

        <div class='pricing-grid'>
          <div class='pricing-row'>
            <div class='pricing-cell'>
              <div class='pricing-label'>Input Price</div>
              <div class='pricing-value'>{{this.formatPrice
                  @model.pricing.prompt
                }}</div>
              <div class='pricing-unit'>per 1M tokens</div>
            </div>
            <div class='pricing-cell'>
              <div class='pricing-label'>Output Price</div>
              <div class='pricing-value'>{{this.formatPrice
                  @model.pricing.completion
                }}</div>
              <div class='pricing-unit'>per 1M tokens</div>
            </div>
            <div class='pricing-cell'>
              <div class='pricing-label'>Request</div>
              <div class='pricing-value'>{{this.formatPrice
                  @model.pricing.request
                }}</div>
              <div class='pricing-unit'>per request</div>
            </div>
            <div class='pricing-cell'>
              <div class='pricing-label'>Image</div>
              <div class='pricing-value'>{{this.formatPrice
                  @model.pricing.image
                }}</div>
              <div class='pricing-unit'>per image</div>
            </div>
          </div>
        </div>
      </section>

      {{#if @model.perRequestLimits}}
        <section class='content-section'>
          <h2 class='content-section-title'>Request Limits</h2>

          <div class='limits-grid'>
            {{#if @model.perRequestLimits.promptTokens}}
              <div class='limit-card'>
                <div class='limit-label'>Prompt Tokens</div>
                <div class='limit-value'>{{this.formatNumber
                    @model.perRequestLimits.promptTokens
                  }}</div>
              </div>
            {{/if}}
            {{#if @model.perRequestLimits.completionTokens}}
              <div class='limit-card'>
                <div class='limit-label'>Completion Tokens</div>
                <div class='limit-value'>{{this.formatNumber
                    @model.perRequestLimits.completionTokens
                  }}</div>
              </div>
            {{/if}}
          </div>
        </section>
      {{/if}}

      {{#if (gt @model.supportedParameters.length 0)}}
        <section class='content-section'>
          <h2 class='content-section-title'>Supported Parameters</h2>
          <div class='params-grid'>
            {{#each @model.supportedParameters as |p|}}
              <div class='param-pill'>{{p}}</div>
            {{/each}}
          </div>
        </section>
      {{/if}}

      {{#if @model.defaultParameters}}
        <section class='content-section'>
          <h2 class='content-section-title'>Default Parameters</h2>
          {{#if
            (or
              @model.defaultParameters.temperature
              @model.defaultParameters.top_p
              @model.defaultParameters.max_tokens
              @model.defaultParameters.frequency_penalty
              @model.defaultParameters.presence_penalty
            )
          }}
            <div class='params-table'>
              {{#if @model.defaultParameters.temperature}}
                <div class='param-row'>
                  <div class='param-name'>temperature</div>
                  <div
                    class='param-value'
                  >{{@model.defaultParameters.temperature}}</div>
                </div>
              {{/if}}
              {{#if @model.defaultParameters.top_p}}
                <div class='param-row'>
                  <div class='param-name'>top_p</div>
                  <div
                    class='param-value'
                  >{{@model.defaultParameters.top_p}}</div>
                </div>
              {{/if}}
              {{#if @model.defaultParameters.max_tokens}}
                <div class='param-row'>
                  <div class='param-name'>max_tokens</div>
                  <div
                    class='param-value'
                  >{{@model.defaultParameters.max_tokens}}</div>
                </div>
              {{/if}}
              {{#if @model.defaultParameters.frequency_penalty}}
                <div class='param-row'>
                  <div class='param-name'>frequency_penalty</div>
                  <div
                    class='param-value'
                  >{{@model.defaultParameters.frequency_penalty}}</div>
                </div>
              {{/if}}
              {{#if @model.defaultParameters.presence_penalty}}
                <div class='param-row'>
                  <div class='param-name'>presence_penalty</div>
                  <div
                    class='param-value'
                  >{{@model.defaultParameters.presence_penalty}}</div>
                </div>
              {{/if}}
            </div>
          {{else}}
            <div class='empty-state-inline'>
              <p>No default parameters configured for this model.</p>
            </div>
          {{/if}}
        </section>
      {{/if}}
    </article>
    <style scoped>
      /* Global Container */
      .orm-isolated {
        background: #ffffff;
        color: #374151;
        font-family:
          'Inter',
          ui-sans-serif,
          system-ui,
          -apple-system,
          sans-serif;
        max-width: 1200px;
        margin: 0 auto;
        padding: 2rem 1.5rem;
      }

      /* Hero Header */
      .hero-header {
        margin-bottom: 3rem;
      }

      .logo-header {
        margin-bottom: 1.5rem;
      }

      .openrouter-logo {
        height: 2.5rem;
        width: auto;
        color: #111827;
      }

      .hero-title {
        font-size: 2rem;
        font-weight: 700;
        color: #111827;
        margin: 0 0 0.75rem 0;
        line-height: 1.2;
      }

      .model-id-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 1rem;
      }

      .model-id-badge {
        font-family: 'SF Mono', Monaco, 'Courier New', monospace;
        font-size: 0.75rem;
        background: #f3f4f6;
        color: #374151;
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        border: 1px solid #e5e7eb;
      }

      .copy-btn-inline {
        background: transparent;
        border: none;
        cursor: pointer;
        padding: 0.25rem;
        color: #6b7280;
        transition: color 0.2s ease;
        display: flex;
        align-items: center;
      }

      .copy-btn-inline:hover {
        color: #111827;
      }

      .icon-sm {
        width: 14px;
        height: 14px;
      }

      /* Metadata Row */
      .metadata-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
        font-size: 0.875rem;
        color: #6b7280;
        margin-bottom: 1.5rem;
      }

      .metadata-item {
        white-space: nowrap;
      }

      .separator {
        color: #d1d5db;
      }

      /* Description Block */
      .description-block {
        margin-bottom: 1.5rem;
      }

      .description-text {
        font-size: 0.9375rem;
        line-height: 1.6;
        color: #374151;
        margin: 0 0 0.5rem 0;
      }

      .show-more-btn {
        background: none;
        border: none;
        color: #6467f2;
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
        padding: 0;
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        transition: color 0.2s ease;
      }

      .show-more-btn:hover {
        color: #4f46e5;
      }

      .arrow-icon {
        width: 14px;
        height: 14px;
        transition: transform 0.2s ease;
      }

      .arrow-icon.up {
        transform: rotate(180deg);
      }

      /* Tab Navigation */
      .tab-nav {
        display: flex;
        gap: 2rem;
        border-bottom: 1px solid #e5e7eb;
        margin-bottom: 2rem;
      }

      .tab-link {
        font-size: 0.9375rem;
        font-weight: 500;
        color: #6b7280;
        padding-bottom: 0.75rem;
        border-bottom: 2px solid transparent;
        cursor: pointer;
        transition: all 0.2s ease;
        text-decoration: none;
      }

      .tab-link:hover {
        color: #111827;
      }

      .tab-link.active {
        color: #111827;
        border-bottom-color: #111827;
      }

      /* Content Sections */
      .content-section {
        margin-bottom: 2.5rem;
      }

      .content-section-title {
        font-size: 1.125rem;
        font-weight: 600;
        color: #111827;
        margin: 0 0 1.25rem 0;
      }

      /* Detail Grid (3-column cards) */
      .detail-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 1rem;
      }

      .detail-card {
        background: #ffffff;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 1.25rem;
        transition: box-shadow 0.2s ease;
      }

      .detail-card:hover {
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      }

      .detail-label {
        font-size: 0.75rem;
        font-weight: 600;
        color: #6b7280;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 0.5rem;
      }

      .detail-value-large {
        font-size: 1.5rem;
        font-weight: 700;
        color: #111827;
      }

      /* Pricing Grid */
      .pricing-grid {
        background: #ffffff;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        overflow: hidden;
      }

      .pricing-row {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 1px;
        background: #e5e7eb;
      }

      .pricing-cell {
        background: #ffffff;
        padding: 1.25rem;
      }

      .pricing-label {
        font-size: 0.75rem;
        font-weight: 600;
        color: #6b7280;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 0.5rem;
      }

      .pricing-value {
        font-size: 1.5rem;
        font-weight: 700;
        color: #111827;
        margin-bottom: 0.25rem;
      }

      .pricing-unit {
        font-size: 0.75rem;
        color: #6b7280;
      }

      /* Request Limits Grid */
      .limits-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 1rem;
      }

      .limit-card {
        background: #ffffff;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        padding: 1.25rem;
        transition: box-shadow 0.2s ease;
      }

      .limit-card:hover {
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      }

      .limit-label {
        font-size: 0.75rem;
        font-weight: 600;
        color: #6b7280;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 0.5rem;
      }

      .limit-value {
        font-size: 1.5rem;
        font-weight: 700;
        color: #111827;
      }

      /* Parameters */
      .params-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
      }

      .param-pill {
        font-size: 0.75rem;
        font-weight: 500;
        background: #f3f4f6;
        color: #374151;
        padding: 0.375rem 0.75rem;
        border-radius: 4px;
        border: 1px solid #e5e7eb;
      }

      .params-table {
        background: #ffffff;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        overflow: hidden;
      }

      .param-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.875rem 1.25rem;
        border-bottom: 1px solid #e5e7eb;
      }

      .param-row:last-child {
        border-bottom: none;
      }

      .param-name {
        font-size: 0.875rem;
        font-weight: 500;
        color: #374151;
        font-family: 'SF Mono', Monaco, 'Courier New', monospace;
      }

      .param-value {
        font-size: 0.875rem;
        font-weight: 600;
        color: #111827;
      }

      /* Empty state inline */
      .empty-state-inline {
        text-align: center;
        padding: 2rem 1rem;
        color: #6b7280;
        font-size: 0.875rem;
        background: #f9fafb;
        border-radius: 8px;
        border: 1px dashed #e5e7eb;
      }

      .empty-state-inline p {
        margin: 0;
      }
    </style>
  </template>
}

export class OpenRouterModel extends ModelConfiguration {
  static displayName = 'OpenRouter Model';

  // Identification (modelId and canonicalSlug inherited from parent)
  @field name = contains(StringField); // e.g., "GPT-4"
  @field created = contains(NumberField); // epoch seconds
  @field cardDescription = contains(StringField);

  // Pricing
  @field pricing = contains(OpenRouterPricing);

  // Context length (top-level)
  @field contextLength = contains(NumberField);

  // Architecture
  @field architecture = contains(OpenRouterArchitecture);

  // Top provider info
  @field topProvider = contains(OpenRouterTopProvider);

  // Per-request limits
  @field perRequestLimits = contains(OpenRouterPerRequestLimits);

  // Supported parameters (list of strings)
  @field supportedParameters = containsMany(StringField);

  // Default parameters
  @field defaultParameters = contains(OpenRouterDefaultParameters);

  // Override inherited title to use name or modelId
  @field cardTitle = contains(StringField, {
    computeVia: function (this: OpenRouterModel) {
      return (
        this.cardInfo?.name || this.name || this.modelId || 'OpenRouter Model'
      );
    },
  });

  @field leftBadge = contains(StringField, {
    computeVia: function (this: OpenRouterModel) {
      return 'OPENROUTER';
    },
  });

  @field leftBadgeVariant = contains(StringField, {
    computeVia: function (this: OpenRouterModel) {
      return 'generic';
    },
  });

  // Minimal formats to satisfy renderer; can be styled later
  static embedded = class Embedded extends Component<typeof this> {
    formatPrice(price: string | undefined): string {
      if (!price) return '—';
      const priceNum = parseFloat(price);
      if (priceNum === 0) return 'Free';
      const perMillion = priceNum * 1000000;
      return `$${perMillion.toFixed(2)}`;
    }

    formatNumber(num: number | undefined): string {
      if (!num) return '—';
      return num.toLocaleString('en-US');
    }

    formatContext(num: number | undefined): string {
      if (!num) return '—';
      // Format as 100K, 1M, etc for readability
      if (num >= 1000000) {
        return `${(num / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
      }
      if (num >= 1000) {
        return `${(num / 1000).toFixed(0)}K`;
      }
      return num.toLocaleString('en-US');
    }

    <template>
      <div class='orm-embedded'>
        <div class='embedded-header'>
          <div class='model-type-badge'>
            <svg
              class='badge-icon'
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
            OPENROUTER MODEL
          </div>
          <h3 class='embedded-title'>{{if
              @model.name
              @model.name
              'OpenRouter Model'
            }}</h3>
          {{#if @model.modelId}}
            <div class='embedded-id'>{{@model.modelId}}</div>
          {{/if}}
        </div>

        {{#if @model.cardDescription}}
          <p class='embedded-description'>{{@model.cardDescription}}</p>
        {{/if}}

        <div class='model-stats'>
          <div class='stat-row'>
            <div class='stat-item'>
              <div class='stat-label'>Context</div>
              <div class='stat-value'>{{this.formatContext
                  @model.contextLength
                }}</div>
            </div>
            <div class='stat-item'>
              <div class='stat-label'>Modality</div>
              <div class='stat-value'>{{if
                  @model.architecture.modality
                  @model.architecture.modality
                  '—'
                }}</div>
            </div>
          </div>
          <div class='stat-row'>
            <div class='stat-item'>
              <div class='stat-label'>Input</div>
              <div class='stat-value pricing'>{{this.formatPrice
                  @model.pricing.prompt
                }}/M</div>
            </div>
            <div class='stat-item'>
              <div class='stat-label'>Output</div>
              <div class='stat-value pricing'>{{this.formatPrice
                  @model.pricing.completion
                }}/M</div>
            </div>
          </div>
        </div>
      </div>

      <style scoped>
        .orm-embedded {
          padding: 1.25rem;
          background: #ffffff;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
          font-family: 'Inter', ui-sans-serif, system-ui, sans-serif;
        }

        .embedded-header {
          margin-bottom: 1rem;
          padding-bottom: 0.75rem;
          border-bottom: 1px solid #e5e7eb;
        }

        .model-type-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #6b7280;
          margin-bottom: 0.5rem;
        }

        .badge-icon {
          width: 0.875rem;
          height: 0.875rem;
          color: #111827;
        }

        .embedded-title {
          font-size: 1.125rem;
          font-weight: 700;
          margin: 0 0 0.375rem 0;
          color: #111827;
          line-height: 1.3;
        }

        .embedded-id {
          font-family: 'SF Mono', Monaco, monospace;
          font-size: 0.6875rem;
          color: #6b7280;
        }

        .embedded-description {
          font-size: 0.875rem;
          color: #374151;
          line-height: 1.5;
          margin: 0 0 1rem 0;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .model-stats {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .stat-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.75rem;
        }

        .stat-item {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .stat-label {
          font-size: 0.6875rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #6b7280;
        }

        .stat-value {
          font-size: 0.875rem;
          font-weight: 700;
          color: #111827;
        }

        .stat-value.pricing {
          color: #16a34a;
        }
      </style>
    </template>
  };

  static isolated = Isolated;
}
