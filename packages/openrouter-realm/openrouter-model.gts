import { fn } from '@ember/helper';
import { gt, or } from '@cardstack/boxel-ui/helpers';
import {
  CardDef,
  FieldDef,
  Component,
  field,
  contains,
  containsMany,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';
import BooleanField from '@cardstack/base/boolean';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';

// --- Compound field types ---

export class OpenRouterPricing extends FieldDef {
  static displayName = 'OpenRouter Pricing';
  @field prompt = contains(StringField);
  @field completion = contains(StringField);
  @field request = contains(StringField);
  @field image = contains(StringField);
  @field webSearch = contains(StringField);
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
  @field max_tokens = contains(NumberField);
  @field frequency_penalty = contains(NumberField);
  @field presence_penalty = contains(NumberField);
}

// --- Format helpers ---

function formatPrice(price: string | undefined): string {
  if (!price) return '\u2014';
  const priceNum = parseFloat(price);
  if (priceNum === 0) return 'Free';
  const perMillion = priceNum * 1000000;
  if (perMillion < 0.01) return '<$0.01';
  return `$${perMillion.toFixed(2)}`;
}

function formatDate(timestamp: number | undefined): string {
  if (timestamp == null) return '\u2014';
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatNumber(num: number | undefined): string {
  if (num == null) return '\u2014';
  return num.toLocaleString('en-US');
}

function formatContext(num: number | undefined): string {
  if (num == null) return '\u2014';
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(0)}K`;
  }
  return num.toLocaleString('en-US');
}

function formatWebSearchPrice(price: string | undefined): string {
  if (!price) return '\u2014';
  const priceNum = parseFloat(price);
  if (priceNum === 0) return 'Free';
  const perThousand = priceNum * 1000;
  return `$${perThousand.toFixed(2)}`;
}

// --- Isolated format ---

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

  get truncatedDescription(): string {
    if (!this.args.model.cardDescription) return '';
    const maxLength = 200;
    if (this.args.model.cardDescription.length <= maxLength)
      return this.args.model.cardDescription;
    return this.args.model.cardDescription.substring(0, maxLength) + '...';
  }

  get hasWebSearch(): boolean {
    return !!this.args.model.pricing?.webSearch &&
      parseFloat(this.args.model.pricing.webSearch) > 0;
  }

  <template>
    <article class='orm-isolated'>
      <header class='hero'>
        <div class='type-badge'>
          <svg class='type-badge-icon' width='512' height='512' viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg' fill='currentColor' stroke='currentColor'>
            <g><path d='M3 248.945C18 248.945 76 236 106 219C136 202 136 202 198 158C276.497 102.293 332 120.945 423 120.945' stroke-width='90' /><path d='M511 121.5L357.25 210.268L357.25 32.7324L511 121.5Z' /><path d='M0 249C15 249 73 261.945 103 278.945C133 295.945 133 295.945 195 339.945C273.497 395.652 329 377 420 377' stroke-width='90' /><path d='M508 376.445L354.25 287.678L354.25 465.213L508 376.445Z' /></g>
          </svg>
          OPENROUTER MODEL
        </div>

        <h1 class='hero-title'>{{if @model.name @model.name 'OpenRouter Model'}}</h1>

        {{#if @model.modelId}}
          <div class='model-id-row'>
            <code class='model-id-badge'>{{@model.modelId}}</code>
            <button class='copy-btn' {{on 'click' (fn this.copyToClipboard @model.modelId)}} type='button'>
              {{#if this.copied}}
                <svg class='icon-sm' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><polyline points='20 6 9 17 4 12'></polyline></svg>
              {{else}}
                <svg class='icon-sm' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><rect x='9' y='9' width='13' height='13' rx='2' ry='2'></rect><path d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'></path></svg>
              {{/if}}
            </button>
          </div>
        {{/if}}

        <div class='stats-strip'>
          {{#if @model.created}}
            <span class='stat-item'>{{formatDate @model.created}}</span>
            <span class='stat-sep'>&middot;</span>
          {{/if}}
          {{#if @model.contextLength}}
            <span class='stat-item'>{{formatNumber @model.contextLength}} context</span>
            <span class='stat-sep'>&middot;</span>
          {{/if}}
          {{#if @model.pricing.prompt}}
            <span class='stat-item stat-pricing'>{{formatPrice @model.pricing.prompt}}/M input</span>
          {{/if}}
          {{#if @model.pricing.completion}}
            <span class='stat-sep'>&middot;</span>
            <span class='stat-item stat-pricing'>{{formatPrice @model.pricing.completion}}/M output</span>
          {{/if}}
          {{#if this.hasWebSearch}}
            <span class='stat-sep'>&middot;</span>
            <span class='stat-item stat-pricing'>{{formatWebSearchPrice @model.pricing.webSearch}}/K web search</span>
          {{/if}}
        </div>

        {{#if (or @model.architecture.inputModalities.length @model.architecture.outputModalities.length)}}
          <div class='modality-row'>
            {{#if (gt @model.architecture.inputModalities.length 0)}}
              <span class='modality-label'>Input:</span>
              {{#each @model.architecture.inputModalities as |m|}}
                <span class='modality-pill'>{{m}}</span>
              {{/each}}
            {{/if}}
            {{#if (gt @model.architecture.outputModalities.length 0)}}
              <span class='modality-label modality-output'>Output:</span>
              {{#each @model.architecture.outputModalities as |m|}}
                <span class='modality-pill modality-pill-output'>{{m}}</span>
              {{/each}}
            {{/if}}
          </div>
        {{/if}}

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
              <button class='show-more-btn' {{on 'click' this.toggleDescription}} type='button'>
                {{if this.showFullDescription 'Show less' 'Show more'}}
              </button>
            {{/if}}
          </div>
        {{/if}}
      </header>

      <section class='section'>
        <h2 class='section-title'>Model Details</h2>
        <div class='detail-grid'>
          <div class='detail-card'>
            <div class='detail-label'>Context Window</div>
            <div class='detail-value'>{{formatNumber @model.contextLength}}</div>
          </div>
          <div class='detail-card'>
            <div class='detail-label'>Modality</div>
            <div class='detail-value'>{{if @model.architecture.modality @model.architecture.modality '\u2014'}}</div>
          </div>
          <div class='detail-card'>
            <div class='detail-label'>Tokenizer</div>
            <div class='detail-value'>{{if @model.architecture.tokenizer @model.architecture.tokenizer '\u2014'}}</div>
          </div>
        </div>
      </section>

      <section class='section'>
        <h2 class='section-title'>Pricing</h2>
        <div class='pricing-grid'>
          <div class='pricing-cell'>
            <div class='pricing-label'>Input</div>
            <div class='pricing-value'>{{formatPrice @model.pricing.prompt}}</div>
            <div class='pricing-unit'>per 1M tokens</div>
          </div>
          <div class='pricing-cell'>
            <div class='pricing-label'>Output</div>
            <div class='pricing-value'>{{formatPrice @model.pricing.completion}}</div>
            <div class='pricing-unit'>per 1M tokens</div>
          </div>
          <div class='pricing-cell'>
            <div class='pricing-label'>Request</div>
            <div class='pricing-value'>{{formatPrice @model.pricing.request}}</div>
            <div class='pricing-unit'>per request</div>
          </div>
          {{#if this.hasWebSearch}}
            <div class='pricing-cell'>
              <div class='pricing-label'>Web Search</div>
              <div class='pricing-value'>{{formatWebSearchPrice @model.pricing.webSearch}}</div>
              <div class='pricing-unit'>per 1K searches</div>
            </div>
          {{else}}
            <div class='pricing-cell'>
              <div class='pricing-label'>Image</div>
              <div class='pricing-value'>{{formatPrice @model.pricing.image}}</div>
              <div class='pricing-unit'>per image</div>
            </div>
          {{/if}}
        </div>
      </section>

      {{#if @model.topProvider}}
        <section class='section'>
          <h2 class='section-title'>Provider Limits</h2>
          <div class='detail-grid'>
            {{#if @model.topProvider.contextLength}}
              <div class='detail-card'>
                <div class='detail-label'>Max Input Tokens</div>
                <div class='detail-value'>{{formatNumber @model.topProvider.contextLength}}</div>
              </div>
            {{/if}}
            {{#if @model.topProvider.maxCompletionTokens}}
              <div class='detail-card'>
                <div class='detail-label'>Max Output Tokens</div>
                <div class='detail-value'>{{formatNumber @model.topProvider.maxCompletionTokens}}</div>
              </div>
            {{/if}}
            <div class='detail-card'>
              <div class='detail-label'>Moderated</div>
              <div class='detail-value'>{{if @model.topProvider.isModerated 'Yes' 'No'}}</div>
            </div>
          </div>
        </section>
      {{/if}}

      {{#if (gt @model.supportedParameters.length 0)}}
        <section class='section'>
          <h2 class='section-title'>Supported Parameters</h2>
          <div class='params-grid'>
            {{#each @model.supportedParameters as |p|}}
              <span class='param-pill'>{{p}}</span>
            {{/each}}
          </div>
        </section>
      {{/if}}

      {{#if @model.defaultParameters}}
        {{#if (or @model.defaultParameters.temperature @model.defaultParameters.top_p @model.defaultParameters.max_tokens @model.defaultParameters.frequency_penalty @model.defaultParameters.presence_penalty)}}
          <section class='section'>
            <h2 class='section-title'>Default Parameters</h2>
            <div class='params-table'>
              {{#if @model.defaultParameters.temperature}}
                <div class='param-row'><div class='param-name'>temperature</div><div class='param-val'>{{@model.defaultParameters.temperature}}</div></div>
              {{/if}}
              {{#if @model.defaultParameters.top_p}}
                <div class='param-row'><div class='param-name'>top_p</div><div class='param-val'>{{@model.defaultParameters.top_p}}</div></div>
              {{/if}}
              {{#if @model.defaultParameters.max_tokens}}
                <div class='param-row'><div class='param-name'>max_tokens</div><div class='param-val'>{{@model.defaultParameters.max_tokens}}</div></div>
              {{/if}}
              {{#if @model.defaultParameters.frequency_penalty}}
                <div class='param-row'><div class='param-name'>frequency_penalty</div><div class='param-val'>{{@model.defaultParameters.frequency_penalty}}</div></div>
              {{/if}}
              {{#if @model.defaultParameters.presence_penalty}}
                <div class='param-row'><div class='param-name'>presence_penalty</div><div class='param-val'>{{@model.defaultParameters.presence_penalty}}</div></div>
              {{/if}}
            </div>
          </section>
        {{/if}}
      {{/if}}
    </article>

    <style scoped>
      .orm-isolated {
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

      .model-id-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        margin-bottom: var(--boxel-sp-sm);
      }

      .model-id-badge {
        font-family: var(--boxel-monospace-font-family);
        font-size: var(--boxel-font-size-xs);
        background: var(--boxel-100, #f8f7fa);
        color: var(--boxel-500, #5a586a);
        padding: var(--boxel-sp-6xs) var(--boxel-sp-xxs);
        border-radius: var(--boxel-border-radius-xs);
        border: 1px solid var(--boxel-200, #e8e8e8);
      }

      .copy-btn {
        background: transparent;
        border: none;
        cursor: pointer;
        padding: var(--boxel-sp-6xs);
        color: var(--boxel-400, #afafb7);
        display: flex;
        align-items: center;
        transition: color 0.15s;
      }
      .copy-btn:hover { color: var(--boxel-dark); }

      .icon-sm { width: 14px; height: 14px; }

      /* Stats strip */
      .stats-strip {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        flex-wrap: wrap;
        font-size: var(--boxel-font-size-sm);
        color: var(--boxel-400, #afafb7);
        margin-bottom: var(--boxel-sp-sm);
      }
      .stat-item { white-space: nowrap; }
      .stat-pricing { color: var(--boxel-dark-green, #00ac3d); font-weight: 600; }
      .stat-sep { color: var(--boxel-300, #d1d1d1); }

      /* Modality pills */
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
      .modality-output { margin-left: var(--boxel-sp-xxs); }
      .modality-pill {
        font-size: var(--boxel-font-size-2xs);
        font-weight: 600;
        background: var(--boxel-100);
        color: var(--boxel-500);
        padding: 2px var(--boxel-sp-xxs);
        border-radius: var(--boxel-border-radius-xs);
        border: 1px solid var(--boxel-200);
      }
      .modality-pill-output {
        background: var(--boxel-100);
        border-color: var(--boxel-200);
      }

      /* Description */
      .description-block { margin-bottom: var(--boxel-sp-sm); }
      .description-text {
        font-size: var(--boxel-font-size-sm);
        line-height: 1.6;
        color: var(--boxel-500);
        margin: 0 0 var(--boxel-sp-xxs) 0;
      }
      .show-more-btn {
        background: none;
        border: none;
        color: var(--boxel-purple, #6638ff);
        font-size: var(--boxel-font-size-sm);
        font-weight: 500;
        cursor: pointer;
        padding: 0;
      }
      .show-more-btn:hover { text-decoration: underline; }

      /* Sections */
      .section { margin-bottom: var(--boxel-sp-xl); }
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

      /* Pricing grid */
      .pricing-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 1px;
        background: var(--boxel-200);
        border: 1px solid var(--boxel-200);
        border-radius: var(--boxel-border-radius-sm);
        overflow: hidden;
      }
      .pricing-cell {
        background: var(--boxel-light);
        padding: var(--boxel-sp-sm);
      }
      .pricing-label {
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        color: var(--boxel-400);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: var(--boxel-sp-6xs);
      }
      .pricing-value {
        font-size: var(--boxel-font-size-lg);
        font-weight: 700;
        color: var(--boxel-dark);
        margin-bottom: 2px;
      }
      .pricing-unit {
        font-size: var(--boxel-font-size-xs);
        color: var(--boxel-400);
      }

      /* Parameters */
      .params-grid {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xxs);
      }
      .param-pill {
        font-size: var(--boxel-font-size-xs);
        font-weight: 500;
        background: var(--boxel-100);
        color: var(--boxel-500);
        padding: var(--boxel-sp-6xs) var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius-xs);
        border: 1px solid var(--boxel-200);
        font-family: var(--boxel-monospace-font-family);
      }

      .params-table {
        border: 1px solid var(--boxel-200);
        border-radius: var(--boxel-border-radius-sm);
        overflow: hidden;
      }
      .param-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border-bottom: 1px solid var(--boxel-200);
      }
      .param-row:last-child { border-bottom: none; }
      .param-name {
        font-size: var(--boxel-font-size-sm);
        font-weight: 500;
        color: var(--boxel-500);
        font-family: var(--boxel-monospace-font-family);
      }
      .param-val {
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
        color: var(--boxel-dark);
      }
    </style>
  </template>
}

// --- Embedded format ---

class Embedded extends Component<typeof OpenRouterModel> {
  <template>
    <div class='orm-embedded'>
      <div class='embedded-header'>
        <div class='type-badge'>
          <svg class='badge-icon' width='512' height='512' viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg' fill='currentColor' stroke='currentColor'>
            <g><path d='M3 248.945C18 248.945 76 236 106 219C136 202 136 202 198 158C276.497 102.293 332 120.945 423 120.945' stroke-width='90' /><path d='M511 121.5L357.25 210.268L357.25 32.7324L511 121.5Z' /><path d='M0 249C15 249 73 261.945 103 278.945C133 295.945 133 295.945 195 339.945C273.497 395.652 329 377 420 377' stroke-width='90' /><path d='M508 376.445L354.25 287.678L354.25 465.213L508 376.445Z' /></g>
          </svg>
          OPENROUTER MODEL
        </div>
        <h3 class='embedded-title'>{{if @model.name @model.name 'OpenRouter Model'}}</h3>
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
            <div class='stat-value'>{{formatContext @model.contextLength}}</div>
          </div>
          <div class='stat-item'>
            <div class='stat-label'>Modality</div>
            <div class='stat-value'>{{if @model.architecture.modality @model.architecture.modality '\u2014'}}</div>
          </div>
        </div>
        <div class='stat-row'>
          <div class='stat-item'>
            <div class='stat-label'>Input</div>
            <div class='stat-value pricing'>{{formatPrice @model.pricing.prompt}}/M</div>
          </div>
          <div class='stat-item'>
            <div class='stat-label'>Output</div>
            <div class='stat-value pricing'>{{formatPrice @model.pricing.completion}}/M</div>
          </div>
        </div>
      </div>
    </div>

    <style scoped>
      .orm-embedded {
        padding: var(--boxel-sp-sm);
        background: var(--boxel-light, #ffffff);
        border: 1px solid var(--boxel-200, #e8e8e8);
        border-radius: var(--boxel-border-radius-sm);
        font-family: var(--boxel-font-family);
      }
      .embedded-header {
        margin-bottom: var(--boxel-sp-xs);
        padding-bottom: var(--boxel-sp-xxs);
        border-bottom: 1px solid var(--boxel-200);
      }
      .type-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--boxel-400);
        margin-bottom: var(--boxel-sp-xxs);
      }
      .badge-icon { width: 14px; height: 14px; color: var(--boxel-dark); }
      .embedded-title {
        font-size: var(--boxel-font-size);
        font-weight: 700;
        margin: 0 0 4px 0;
        color: var(--boxel-dark);
        line-height: 1.3;
      }
      .embedded-id {
        font-family: var(--boxel-monospace-font-family);
        font-size: var(--boxel-font-size-2xs);
        color: var(--boxel-400);
      }
      .embedded-description {
        font-size: var(--boxel-font-size-sm);
        color: var(--boxel-500);
        line-height: 1.5;
        margin: 0 0 var(--boxel-sp-xs) 0;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .model-stats {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxs);
      }
      .stat-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--boxel-sp-xxs);
      }
      .stat-item {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .stat-label {
        font-size: var(--boxel-font-size-2xs);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--boxel-400);
      }
      .stat-value {
        font-size: var(--boxel-font-size-sm);
        font-weight: 700;
        color: var(--boxel-dark);
      }
      .stat-value.pricing { color: var(--boxel-dark-green, #00ac3d); }
    </style>
  </template>
}

// --- Fitted format ---

class Fitted extends Component<typeof OpenRouterModel> {
  <template>
    <div class='fitted-container'>
      {{! Badge format: tiny icon only }}
      <div class='badge-format'>
        <svg class='badge-logo' width='512' height='512' viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg' fill='currentColor' stroke='currentColor'>
          <g><path d='M3 248.945C18 248.945 76 236 106 219C136 202 136 202 198 158C276.497 102.293 332 120.945 423 120.945' stroke-width='90' /><path d='M511 121.5L357.25 210.268L357.25 32.7324L511 121.5Z' /><path d='M0 249C15 249 73 261.945 103 278.945C133 295.945 133 295.945 195 339.945C273.497 395.652 329 377 420 377' stroke-width='90' /><path d='M508 376.445L354.25 287.678L354.25 465.213L508 376.445Z' /></g>
        </svg>
      </div>

      {{! Strip format: single row }}
      <div class='strip-format'>
        <div class='strip-content'>
          <div class='strip-title'>{{if @model.name @model.name (if @model.cardTitle @model.cardTitle 'Model')}}</div>
          <div class='strip-meta'>
            <svg class='strip-icon' width='512' height='512' viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg' fill='currentColor' stroke='currentColor'>
              <g><path d='M3 248.945C18 248.945 76 236 106 219C136 202 136 202 198 158C276.497 102.293 332 120.945 423 120.945' stroke-width='90' /><path d='M511 121.5L357.25 210.268L357.25 32.7324L511 121.5Z' /><path d='M0 249C15 249 73 261.945 103 278.945C133 295.945 133 295.945 195 339.945C273.497 395.652 329 377 420 377' stroke-width='90' /><path d='M508 376.445L354.25 287.678L354.25 465.213L508 376.445Z' /></g>
            </svg>
            {{#if @model.modelId}}
              <span class='strip-id'>{{@model.modelId}}</span>
            {{/if}}
            <span class='strip-sep'>&middot;</span>
            <span class='strip-ctx'>{{formatContext @model.contextLength}}</span>
            {{#if @model.pricing.prompt}}
              <span class='strip-sep'>&middot;</span>
              <span class='strip-price'>{{formatPrice @model.pricing.prompt}}/{{formatPrice @model.pricing.completion}}</span>
            {{/if}}
          </div>
        </div>
      </div>

      {{! Tile format: compact card }}
      <div class='tile-format'>
        <h4 class='tile-title'>{{if @model.name @model.name (if @model.cardTitle @model.cardTitle 'Model')}}</h4>
        {{#if @model.modelId}}
          <div class='tile-id'>{{@model.modelId}}</div>
        {{/if}}
        <div class='tile-footer'>
          <svg class='tile-icon' width='512' height='512' viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg' fill='currentColor' stroke='currentColor'>
            <g><path d='M3 248.945C18 248.945 76 236 106 219C136 202 136 202 198 158C276.497 102.293 332 120.945 423 120.945' stroke-width='90' /><path d='M511 121.5L357.25 210.268L357.25 32.7324L511 121.5Z' /><path d='M0 249C15 249 73 261.945 103 278.945C133 295.945 133 295.945 195 339.945C273.497 395.652 329 377 420 377' stroke-width='90' /><path d='M508 376.445L354.25 287.678L354.25 465.213L508 376.445Z' /></g>
          </svg>
          {{#if @model.contextLength}}
            <span class='tile-stat'>{{formatContext @model.contextLength}} context</span>
          {{/if}}
          {{#if @model.pricing.prompt}}
            <span class='tile-sep'>&middot;</span>
            <span class='tile-price'>{{formatPrice @model.pricing.prompt}}/M in</span>
          {{/if}}
          {{#if @model.pricing.completion}}
            <span class='tile-sep'>&middot;</span>
            <span class='tile-price'>{{formatPrice @model.pricing.completion}}/M out</span>
          {{/if}}
        </div>
      </div>

      {{! Card format: wider card with description }}
      <div class='card-format'>
        <div class='card-header'>
          <div class='card-meta'>
            <svg class='card-icon' width='512' height='512' viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg' fill='currentColor' stroke='currentColor'>
              <g><path d='M3 248.945C18 248.945 76 236 106 219C136 202 136 202 198 158C276.497 102.293 332 120.945 423 120.945' stroke-width='90' /><path d='M511 121.5L357.25 210.268L357.25 32.7324L511 121.5Z' /><path d='M0 249C15 249 73 261.945 103 278.945C133 295.945 133 295.945 195 339.945C273.497 395.652 329 377 420 377' stroke-width='90' /><path d='M508 376.445L354.25 287.678L354.25 465.213L508 376.445Z' /></g>
            </svg>
            <span class='card-type'>OPENROUTER MODEL</span>
          </div>
          <h4 class='card-title'>{{if @model.name @model.name (if @model.cardTitle @model.cardTitle 'Model')}}</h4>
          {{#if @model.modelId}}
            <div class='card-id'>{{@model.modelId}}</div>
          {{/if}}
        </div>
        {{#if @model.cardDescription}}
          <p class='card-desc'>{{@model.cardDescription}}</p>
        {{/if}}
        <div class='card-footer'>
          {{#if @model.contextLength}}
            <span class='footer-stat'>{{formatContext @model.contextLength}} context</span>
          {{/if}}
          {{#if @model.pricing.prompt}}
            <span class='footer-sep'>&middot;</span>
            <span class='footer-price'>{{formatPrice @model.pricing.prompt}}/M in</span>
          {{/if}}
          {{#if @model.pricing.completion}}
            <span class='footer-sep'>&middot;</span>
            <span class='footer-price'>{{formatPrice @model.pricing.completion}}/M out</span>
          {{/if}}
        </div>
      </div>
    </div>

    <style scoped>
      .fitted-container {
        width: 100%;
        height: 100%;
        background: var(--boxel-light, #ffffff);
        overflow: hidden;
        position: relative;
        font-family: var(--boxel-font-family);
      }

      /* Hide non-default formats */
      .badge-format, .tile-format, .card-format {
        display: none;
        width: 100%;
        height: 100%;
        box-sizing: border-box;
      }

      /* Strip is the default visible format */
      .strip-format {
        display: flex;
        align-items: center;
        padding: var(--boxel-sp-xxs) var(--boxel-sp-xs);
        width: 100%;
        height: 100%;
        box-sizing: border-box;
      }

      /* Badge (<=150px, <170px) */
      @container (max-width: 150px) and (max-height: 169px) {
        .strip-format { display: none; }
        .badge-format {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: var(--boxel-sp-xxs);
        }
      }
      .badge-logo {
        width: clamp(1.5rem, 60%, 3rem);
        height: clamp(1.5rem, 60%, 3rem);
        color: var(--boxel-dark);
      }

      /* Tile (< 400px, >= 170px) — hide strip, show tile */
      @container (max-width: 399px) and (min-height: 170px) {
        .strip-format { display: none; }
      }

      /* Card (>= 400px, >= 170px) — hide strip, show card */
      @container (min-width: 400px) and (min-height: 170px) {
        .strip-format { display: none; }
      }
      .strip-content {
        display: flex;
        flex-direction: column;
        gap: 2px;
        width: 100%;
        min-width: 0;
      }
      .strip-title {
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
        color: var(--boxel-dark);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .strip-meta {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 10px;
        color: var(--boxel-400);
        min-width: 0;
      }
      .strip-icon { width: 12px; height: 12px; color: var(--boxel-400); flex-shrink: 0; }
      .strip-id {
        font-family: var(--boxel-monospace-font-family);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
      }
      .strip-sep { color: var(--boxel-300); }
      .strip-ctx { font-weight: 600; color: var(--boxel-500); flex-shrink: 0; }
      .strip-price { color: var(--boxel-dark-green, #00ac3d); font-weight: 600; flex-shrink: 0; }

      /* Tile (<400px, >=170px) */
      @container (max-width: 399px) and (min-height: 170px) {
        .tile-format {
          display: flex;
          flex-direction: column;
          padding: clamp(var(--boxel-sp-xxs), 3%, var(--boxel-sp-xs));
          gap: var(--boxel-sp-xxs);
        }
      }
      .tile-title {
        font-size: clamp(var(--boxel-font-size-sm), 4%, var(--boxel-font-size));
        font-weight: 700;
        margin: 0;
        color: var(--boxel-dark);
        line-height: 1.2;
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }
      .tile-id {
        font-family: var(--boxel-monospace-font-family);
        font-size: 10px;
        color: var(--boxel-400);
        word-break: break-all;
      }
      .tile-footer {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-top: auto;
        padding-top: var(--boxel-sp-xxs);
        border-top: 1px solid var(--boxel-200);
        flex-wrap: wrap;
      }
      .tile-icon { width: 14px; height: 14px; color: var(--boxel-400); flex-shrink: 0; }
      .tile-stat { font-size: var(--boxel-font-size-2xs); font-weight: 600; color: var(--boxel-500); }
      .tile-sep { color: var(--boxel-300); font-size: 10px; }
      .tile-price { font-size: var(--boxel-font-size-2xs); font-weight: 600; color: var(--boxel-dark-green, #00ac3d); }

      /* Card (>=400px, >=170px) */
      @container (min-width: 400px) and (min-height: 170px) {
        .card-format {
          display: flex;
          flex-direction: column;
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          gap: var(--boxel-sp-xxs);
        }
      }
      .card-header { display: flex; flex-direction: column; gap: 4px; }
      .card-meta { display: flex; align-items: center; gap: 4px; }
      .card-icon { width: 16px; height: 16px; color: var(--boxel-dark); }
      .card-type {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--boxel-400);
      }
      .card-title {
        font-size: var(--boxel-font-size);
        font-weight: 700;
        margin: 0;
        color: var(--boxel-dark);
        line-height: 1.3;
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }
      .card-id {
        font-family: var(--boxel-monospace-font-family);
        font-size: var(--boxel-font-size-2xs);
        color: var(--boxel-400);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .card-desc {
        font-size: var(--boxel-font-size-sm);
        color: var(--boxel-500);
        line-height: 1.4;
        margin: 0;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .card-footer {
        margin-top: auto;
        padding-top: var(--boxel-sp-xxs);
        border-top: 1px solid var(--boxel-200);
        display: flex;
        gap: var(--boxel-sp-xxs);
        flex-wrap: wrap;
        align-items: center;
      }
      .footer-stat { font-size: var(--boxel-font-size-xs); font-weight: 600; color: var(--boxel-500); }
      .footer-sep { color: var(--boxel-300); font-size: var(--boxel-font-size-xs); }
      .footer-price { font-size: var(--boxel-font-size-xs); font-weight: 600; color: var(--boxel-dark-green, #00ac3d); }
    </style>
  </template>
}

// --- Card definition ---

export class OpenRouterModel extends CardDef {
  static displayName = 'OpenRouter Model';

  @field modelId = contains(StringField, {
    description: 'The OpenRouter model identifier (e.g. openai/gpt-5.4-pro)',
  });
  @field canonicalSlug = contains(StringField);
  @field name = contains(StringField);
  @field created = contains(NumberField);
  @field cardDescription = contains(StringField);
  @field contextLength = contains(NumberField);

  @field pricing = contains(OpenRouterPricing);
  @field architecture = contains(OpenRouterArchitecture);
  @field topProvider = contains(OpenRouterTopProvider);
  @field perRequestLimits = contains(OpenRouterPerRequestLimits);
  @field supportedParameters = containsMany(StringField);
  @field defaultParameters = contains(OpenRouterDefaultParameters);

  @field deprecated = contains(BooleanField, {
    description: 'Whether this model has been removed from the OpenRouter API',
  });
  @field lastSeenInApi = contains(NumberField, {
    description: 'Epoch seconds when this model was last seen in the API response',
  });
  @field expirationDate = contains(StringField, {
    description: 'ISO date when this model will be deactivated (nullable)',
  });

  @field toolsSupported = contains(BooleanField, {
    computeVia: function (this: OpenRouterModel) {
      return this.supportedParameters?.includes('tools') ?? false;
    },
  });

  @field inputModalities = containsMany(StringField, {
    computeVia: function (this: OpenRouterModel) {
      return this.architecture?.inputModalities ?? [];
    },
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: OpenRouterModel) {
      return (
        this.cardInfo?.name || this.name || this.modelId || 'OpenRouter Model'
      );
    },
  });

  static isolated = Isolated;
  static embedded = Embedded;
  static fitted = Fitted;
}
