import { and, not } from '@cardstack/boxel-ui/helpers'; // ²⁶ Added gt helper
import {
  CardDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import { restartableTask } from 'ember-concurrency';
import { Button } from '@cardstack/boxel-ui/components';
import { on } from '@ember/modifier';
import SendRequestViaProxyCommand from '@cardstack/boxel-host/commands/send-request-via-proxy';
import WriteTextFileCommand from '@cardstack/boxel-host/commands/write-text-file';
import { type Query } from '@cardstack/runtime-common'; // ²⁸ Added query support
import {
  OpenRouterModel,
  OpenRouterPricing,
  OpenRouterArchitecture,
  OpenRouterTopProvider,
  OpenRouterPerRequestLimits,
  OpenRouterDefaultParameters,
} from './openrouter-model';
import { tracked } from '@glimmer/tracking';

class Isolated extends Component<typeof ModelUpdater> {
  @tracked isProcessing = false;
  @tracked statusMessage = '';
  @tracked errorMessage = '';
  @tracked processedCount = 0;
  @tracked totalCount = 0;
  @tracked existingModels: string[] = [];
  @tracked newModels: string[] = [];
  @tracked modelsToUpdate: string[] = [];
  @tracked isCheckingNew = false;
  @tracked modelSearchQuery = ''; // ²⁹ Search query state
  @tracked comparisonLog: string[] = []; // ³⁴ Log of comparison process

  get hasStatusMessage() {
    return new Boolean(this.statusMessage && this.statusMessage.length > 0);
  }

  private buildSlug(value: string | null | undefined): string | null {
    if (!value) {
      return null;
    }

    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private getCandidateSlugs(model: {
    id?: string;
    name?: string;
    canonical_slug?: string;
    canonicalSlug?: string;
  }): string[] {
    const ordered: string[] = [];
    const seen = new Set<string>();

    const pushSlug = (slug: string | null | undefined) => {
      if (!slug) {
        return;
      }

      const normalized = slug
        .trim()
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');

      if (!normalized) {
        return;
      }

      if (!seen.has(normalized)) {
        seen.add(normalized);
        ordered.push(normalized);
      }
    };

    const addVariants = (raw: string | null | undefined) => {
      if (!raw) {
        return;
      }

      const trimmed = raw.trim();
      if (!trimmed) {
        return;
      }

      const variants: Array<string | null> = [
        this.buildSlug(trimmed),
        trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        trimmed.replace(/[^a-zA-Z0-9]+/g, '-'),
        trimmed.toLowerCase().replace(/\//g, '-'),
        trimmed.replace(/\//g, '-'),
        trimmed.toLowerCase(),
        trimmed,
      ];

      for (const variant of variants) {
        pushSlug(variant);
      }
    };

    addVariants(model?.name);
    addVariants(model?.canonical_slug ?? (model as any)?.canonicalSlug);
    addVariants(model?.id);

    return ordered;
  }

  get modelSearchQuery_computed(): Query {
    const baseFilter: any = {
      type: {
        module: new URL('./openrouter-model', import.meta.url).href,
        name: 'OpenRouterModel',
      },
    };

    // Only add contains filter if there's a search query
    if (this.modelSearchQuery) {
      return {
        filter: {
          every: [
            baseFilter,
            {
              on: {
                module: new URL('./openrouter-model', import.meta.url).href,
                name: 'OpenRouterModel',
              },
              contains: { name: this.modelSearchQuery },
            },
          ],
        },
        sort: [
          {
            by: 'name',
            on: {
              module: new URL('./openrouter-model', import.meta.url).href,
              name: 'OpenRouterModel',
            },
            direction: 'asc',
          },
        ],
      };
    }

    // When no search query, just filter by type
    return {
      filter: baseFilter,
      sort: [
        {
          by: 'name',
          on: {
            module: new URL('./openrouter-model', import.meta.url).href,
            name: 'OpenRouterModel',
          },
          direction: 'asc',
        },
      ],
    };
  }

  get realms() {
    const realm = this.args.model.targetRealm;
    return realm ? [realm] : [];
  }

  updateModelSearch = (event: Event) => {
    const target = event.target as HTMLInputElement;
    this.modelSearchQuery = target.value;
  };

  clearModelSearch = () => {
    this.modelSearchQuery = '';
  };

  private updateModels = restartableTask(async () => {
    this.isProcessing = true;
    this.errorMessage = '';
    this.statusMessage = 'Starting update...';
    this.processedCount = 0;
    this.totalCount = 0;

    try {
      const targetRealm = this.args.model.targetRealm;
      if (!targetRealm) {
        this.errorMessage = 'Please set a target realm URL first';
        return;
      }

      this.statusMessage = 'Fetching models from OpenRouter API...';
      console.log('[DEBUG] Sending request to OpenRouter API...');
      console.log('[DEBUG] URL: https://openrouter.ai/api/v1/models');

      if (!this.args.context || !this.args.context.commandContext) {
        throw new Error('Missing command context for proxy request');
      }

      const response = await new SendRequestViaProxyCommand(
        this.args.context.commandContext,
      ).execute({
        url: 'https://openrouter.ai/api/v1/models',
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://realms-staging.stack.cards',
          'X-Title': 'Boxel OpenRouter Model Updater',
        },
      });

      console.log('[DEBUG] Response status:', response.response.status);
      console.log('[DEBUG] Response ok:', response.response.ok);

      if (!response.response.ok) {
        // Try to get response body for more details
        let errorBody = '';
        try {
          errorBody = await response.response.text();
          console.log('[DEBUG] Error response body:', errorBody);
        } catch (e) {
          console.log('[DEBUG] Could not read error response body');
        }

        throw new Error(
          `OpenRouter API request failed: ${response.response.status}${
            errorBody ? ` - ${errorBody}` : ''
          }`,
        );
      }

      const data = await response.response.json();
      const models = data.data || [];
      this.totalCount = models.length;

      this.statusMessage = `Found ${models.length} models. Processing...`;
      const errors: string[] = [];

      for (let i = 0; i < models.length; i++) {
        const apiModel = models[i];
        this.statusMessage = `Processing model ${i + 1}/${models.length}: ${
          apiModel.name || apiModel.id
        }`;
        console.debug(
          '[DEBUG] Beginning processing for model',
          apiModel.id || apiModel.name,
          `(${i + 1}/${models.length})`,
        );

        let cardPath: string | undefined;
        let finalSlug: string | undefined;

        try {
          // Create new card instance - will overwrite if exists
          const modelCard = new OpenRouterModel();

          const candidateSlugs = this.getCandidateSlugs(apiModel);
          if (!candidateSlugs.length && apiModel?.id) {
            candidateSlugs.push(apiModel.id.replace(/\//g, '-'));
          }
          if (!candidateSlugs.length) {
            candidateSlugs.push('model');
          }

          const slugToUse = candidateSlugs[0] ?? 'model';
          const workingModelCard = modelCard;

          workingModelCard.modelId = apiModel.id;
          workingModelCard.canonicalSlug = apiModel.canonical_slug;
          workingModelCard.name = apiModel.name;
          workingModelCard.created = apiModel.created;
          workingModelCard.cardDescription = apiModel.description || '';
          workingModelCard.contextLength = apiModel.context_length;

          if (apiModel.pricing) {
            const pricing = new OpenRouterPricing(this);
            pricing.prompt = String(apiModel.pricing.prompt || '0');
            pricing.completion = String(apiModel.pricing.completion || '0');
            pricing.request = String(apiModel.pricing.request || '0');
            pricing.image = String(apiModel.pricing.image || '0');
            workingModelCard.pricing = pricing;
          }

          if (apiModel.architecture) {
            const arch = new OpenRouterArchitecture(this);
            arch.modality = apiModel.architecture.modality || '';
            arch.tokenizer = apiModel.architecture.tokenizer || '';
            arch.instructType = apiModel.architecture.instruct_type || '';
            arch.inputModalities = apiModel.architecture.input_modalities || [];
            arch.outputModalities =
              apiModel.architecture.output_modalities || [];
            workingModelCard.architecture = arch;
          }

          if (apiModel.top_provider) {
            const provider = new OpenRouterTopProvider(this);
            provider.isModerated = apiModel.top_provider.is_moderated || false;
            provider.contextLength = apiModel.top_provider.context_length;
            provider.maxCompletionTokens =
              apiModel.top_provider.max_completion_tokens;
            workingModelCard.topProvider = provider;
          }

          if (apiModel.per_request_limits) {
            const limits = new OpenRouterPerRequestLimits(this);
            limits.promptTokens = apiModel.per_request_limits.prompt_tokens;
            limits.completionTokens =
              apiModel.per_request_limits.completion_tokens;
            workingModelCard.perRequestLimits = limits;
          }

          workingModelCard.supportedParameters =
            apiModel.supported_parameters || [];

          if (apiModel.default_parameters) {
            const defaults = new OpenRouterDefaultParameters(this);
            defaults.temperature = apiModel.default_parameters.temperature;
            defaults.top_p = apiModel.default_parameters.top_p;
            defaults.max_tokens = apiModel.default_parameters.max_tokens;
            defaults.frequency_penalty =
              apiModel.default_parameters.frequency_penalty;
            defaults.presence_penalty =
              apiModel.default_parameters.presence_penalty;
            workingModelCard.defaultParameters = defaults;
          }

          const realmUrl = targetRealm.endsWith('/')
            ? targetRealm
            : `${targetRealm}/`;

          finalSlug = slugToUse;

          cardPath = `OpenRouterModel/${finalSlug}.json`;

          // Build JSON structure
          const cardJson = {
            data: {
              type: 'card',
              attributes: {
                modelId: workingModelCard.modelId,
                canonicalSlug: workingModelCard.canonicalSlug,
                name: workingModelCard.name,
                created: workingModelCard.created,
                description: workingModelCard.cardDescription,
                pricing: workingModelCard.pricing
                  ? {
                      prompt: workingModelCard.pricing.prompt,
                      completion: workingModelCard.pricing.completion,
                      request: workingModelCard.pricing.request,
                      image: workingModelCard.pricing.image,
                    }
                  : null,
                contextLength: workingModelCard.contextLength,
                architecture: workingModelCard.architecture
                  ? {
                      modality: workingModelCard.architecture.modality,
                      inputModalities:
                        workingModelCard.architecture.inputModalities,
                      outputModalities:
                        workingModelCard.architecture.outputModalities,
                      tokenizer: workingModelCard.architecture.tokenizer,
                      instructType: workingModelCard.architecture.instructType,
                    }
                  : null,
                topProvider: workingModelCard.topProvider
                  ? {
                      isModerated: workingModelCard.topProvider.isModerated,
                      contextLength: workingModelCard.topProvider.contextLength,
                      maxCompletionTokens:
                        workingModelCard.topProvider.maxCompletionTokens,
                    }
                  : null,
                perRequestLimits: workingModelCard.perRequestLimits
                  ? {
                      promptTokens:
                        workingModelCard.perRequestLimits.promptTokens,
                      completionTokens:
                        workingModelCard.perRequestLimits.completionTokens,
                    }
                  : null,
                supportedParameters: workingModelCard.supportedParameters,
                defaultParameters: workingModelCard.defaultParameters
                  ? {
                      temperature:
                        workingModelCard.defaultParameters.temperature,
                      top_p: workingModelCard.defaultParameters.top_p,
                      max_tokens: workingModelCard.defaultParameters.max_tokens,
                      frequency_penalty:
                        workingModelCard.defaultParameters.frequency_penalty,
                      presence_penalty:
                        workingModelCard.defaultParameters.presence_penalty,
                    }
                  : null,
                cardInfo: {
                  title: null,
                  description: null,
                  thumbnailURL: null,
                  notes: null,
                },
              },
              meta: {
                adoptsFrom: {
                  module: '../openrouter-model',
                  name: 'OpenRouterModel',
                },
              },
            },
          };

          console.log('[DEBUG] Saving card to:', {
            realmUrl,
            cardPath,
            modelId: apiModel.id,
            modelName: apiModel.name,
            slug: finalSlug,
          });

          await new WriteTextFileCommand(
            this.args.context.commandContext,
          ).execute({
            path: cardPath,
            content: JSON.stringify(cardJson, null, 2),
            realm: realmUrl,
          });

          console.log('[DEBUG] Card saved successfully to:', cardPath);

          this.processedCount++;
        } catch (error: any) {
          const isFileExists =
            typeof error?.message === 'string' &&
            error.message.toLowerCase().includes('file already exists');

          const errorDetails = isFileExists
            ? `File already exists for ${finalSlug ?? apiModel.id}`
            : `Error processing model ${apiModel.id} ${
                cardPath ? `(${cardPath}) ` : ''
              }: ${error.message}\nStack: ${error.stack || 'No stack trace'}`;

          if (isFileExists) {
            console.error(errorDetails);
          } else {
            console.error(errorDetails);
          }

          errors.push(errorDetails);
          // Continue processing other models
        }
      }

      this.args.model.modelsProcessed = this.processedCount;
      if (errors.length) {
        this.errorMessage = errors.join('\n\n');
        this.args.model.lastUpdateStatus = `Processed ${this.processedCount} of ${this.totalCount} models with ${errors.length} errors`;
        this.statusMessage = `⚠️ Completed with errors. Processed ${this.processedCount} of ${this.totalCount} models`;
      } else {
        this.args.model.lastUpdateStatus = `Successfully processed ${this.processedCount} of ${this.totalCount} models`;
        this.statusMessage = `✓ Complete! Processed ${this.processedCount} of ${this.totalCount} models`;
      }
    } catch (error: any) {
      const errorDetails = `Error updating models: ${error.message}\nStack: ${
        error.stack || 'No stack trace'
      }`;
      console.error(errorDetails);
      this.errorMessage = errorDetails;
      this.args.model.lastUpdateStatus = `Failed: ${error.message}`;
    } finally {
      this.isProcessing = false;
    }
  });

  <template>
    <article class='model-updater'>
      <header class='header'>
        <h1>{{if @model.cardTitle @model.cardTitle 'OpenRouter Model Updater'}}</h1>
        <p class='subtitle'>Fetch and update OpenRouter model data</p>
      </header>

      <section class='actions'>

        <Button
          @kind='primary'
          @disabled={{this.updateModels.isRunning}}
          {{on 'click' this.updateModels.perform}}
        >
          {{if
            this.updateModels.isRunning
            'Updating Models...'
            'Update All Models'
          }}
        </Button>
      </section>

      {{#if this.updateModels.isRunning}}
        <section class='progress'>
          <div class='progress-text'>{{this.statusMessage}}</div>
          {{#if this.totalCount}}
            <div class='progress-bar'>
              <progress
                class='progress-meter'
                value={{this.processedCount}}
                max={{this.totalCount}}
              ></progress>
            </div>
            <div class='progress-count'>{{this.processedCount}}
              /
              {{this.totalCount}}</div>
          {{/if}}
        </section>
      {{/if}}

      {{#if this.errorMessage}}
        <section class='error'>
          <svg
            class='error-icon'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2'
          >
            <circle cx='12' cy='12' r='10' />
            <line x1='12' y1='8' x2='12' y2='12' />
            <line x1='12' y1='16' x2='12.01' y2='16' />
          </svg>
          <pre class='error-details'>{{this.errorMessage}}</pre>
        </section>
      {{/if}}

      {{#if (and (not this.updateModels.isRunning) this.hasStatusMessage)}}
        <section class='success'>
          <svg
            class='success-icon'
            viewBox='0 0 24 24'
            fill='none'
            stroke='currentColor'
            stroke-width='2'
          >
            <path d='M22 11.08V12a10 10 0 1 1-5.93-9.14' />
            <polyline points='22 4 12 14.01 9 11.01' />
          </svg>
          {{this.statusMessage}}
        </section>
      {{/if}}

      {{#if @model.lastUpdateStatus}}
        <section class='last-update'>
          <h3>Last Update</h3>
          <div class='status'>{{@model.lastUpdateStatus}}</div>
          {{#if @model.modelsProcessed}}
            <div class='count'>Models processed:
              {{@model.modelsProcessed}}</div>
          {{/if}}
        </section>
      {{/if}}
    </article>

    <style scoped>
      .model-updater {
        background: var(--background);
        color: var(--foreground);
        padding: clamp(1rem, 4vw, 2rem);
        max-width: 800px;
        margin: 0 auto;
        font-family: var(--font-sans);
      }

      .header {
        margin-bottom: 2rem;
        padding-bottom: 1rem;
        border-bottom: 2px solid var(--border);
      }

      .header h1 {
        margin: 0 0 0.5rem 0;
        font-size: 1.5rem;
        font-weight: 700;
      }

      .subtitle {
        margin: 0;
        color: var(--muted-foreground);
        font-size: 0.875rem;
      }

      .version {
        margin-top: 0.25rem;
        font-size: 0.75rem;
        color: var(--muted-foreground);
        font-weight: 500;
        font-family: monospace;
      }

      .config {
        margin-bottom: 1.5rem;
      }

      .field {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .field label {
        font-weight: 600;
        font-size: 0.875rem;
      }

      .actions {
        margin-bottom: 1.5rem;
        display: flex;
        gap: 0.75rem;
        flex-wrap: wrap;
      }

      .model-summary {
        padding: 1.5rem;
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        margin-bottom: 1.5rem;
      }

      .model-summary h3 {
        margin: 0 0 1rem 0;
        font-size: 1rem;
        font-weight: 600;
      }

      .summary-cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 1rem;
      }

      .summary-card {
        padding: 1.5rem;
        background: var(--background);
        border: 2px solid var(--border);
        border-radius: var(--radius);
        text-align: center;
      }

      .summary-card.new {
        border-color: var(--primary);
        background: color-mix(in lab, var(--primary) 5%, var(--background));
      }

      .summary-card.existing {
        border-color: color-mix(in lab, var(--primary) 50%, var(--muted));
        background: color-mix(in lab, var(--muted) 20%, var(--background));
      }

      .summary-icon {
        font-size: 2rem;
        margin-bottom: 0.5rem;
      }

      .summary-count {
        font-size: 2.5rem;
        font-weight: 700;
        color: var(--primary);
        font-family: var(--font-mono);
        line-height: 1;
        margin-bottom: 0.5rem;
      }

      .summary-label {
        font-size: 0.875rem;
        font-weight: 600;
        margin-bottom: 0.25rem;
      }

      .summary-note {
        font-size: 0.75rem;
        color: var(--muted-foreground);
        line-height: 1.3;
      }

      .comparison-log {
        margin-top: 1.5rem;
        padding-top: 1rem;
        border-top: 1px solid var(--border);
      }

      .comparison-log h4 {
        margin: 0 0 0.75rem 0;
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--muted-foreground);
      }

      .log-content {
        max-height: 300px;
        overflow-y: auto;
        background: var(--background);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 0.75rem;
        font-family: var(--font-mono);
        font-size: 0.75rem;
        line-height: 1.5;
      }

      .log-entry {
        padding: 0.125rem 0;
        color: var(--foreground);
      }

      .log-content::-webkit-scrollbar {
        width: 8px;
      }

      .log-content::-webkit-scrollbar-track {
        background: var(--muted);
        border-radius: 4px;
      }

      .log-content::-webkit-scrollbar-thumb {
        background: var(--border);
        border-radius: 4px;
      }

      .log-content::-webkit-scrollbar-thumb:hover {
        background: var(--primary);
      }

      .progress {
        padding: 1rem;
        background: var(--muted);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        margin-bottom: 1rem;
      }

      .progress-text {
        font-size: 0.875rem;
        color: var(--foreground);
        margin-bottom: 0.75rem;
      }

      .progress-bar {
        width: 100%;
        margin-bottom: 0.5rem;
      }

      .progress-meter {
        width: 100%;
        height: 8px;
        appearance: none;
        border: none;
        background: var(--border);
        border-radius: 4px;
        overflow: hidden;
      }

      .progress-meter::-webkit-progress-bar {
        background: var(--border);
        border-radius: 4px;
      }

      .progress-meter::-webkit-progress-value {
        background: var(--primary);
        border-radius: 4px;
      }

      .progress-meter::-moz-progress-bar {
        background: var(--primary);
        border-radius: 4px;
      }

      .progress-count {
        font-size: 0.75rem;
        color: var(--muted-foreground);
        text-align: right;
      }

      .error {
        padding: 1rem;
        background: var(--destructive);
        color: var(--destructive-foreground);
        border-radius: var(--radius);
        display: flex;
        align-items: flex-start;
        gap: 0.75rem;
        margin-bottom: 1rem;
      }

      .error-icon {
        width: 1.25rem;
        height: 1.25rem;
        flex-shrink: 0;
        margin-top: 0.25rem;
      }

      .error-details {
        margin: 0;
        font-family: monospace;
        font-size: 0.75rem;
        white-space: pre-wrap;
        word-break: break-word;
        flex: 1;
      }

      .success {
        padding: 1rem;
        background: color-mix(in lab, var(--primary) 15%, var(--background));
        color: var(--foreground);
        border: 1px solid var(--primary);
        border-radius: var(--radius);
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 1rem;
      }

      .success-icon {
        width: 1.25rem;
        height: 1.25rem;
        flex-shrink: 0;
        color: var(--primary);
      }

      .last-update {
        padding: 1rem;
        background: var(--card);
        border: 1px solid var(--border);
        border-radius: var(--radius);
      }

      .last-update h3 {
        margin: 0 0 0.5rem 0;
        font-size: 0.875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--muted-foreground);
      }

      .status {
        font-size: 0.875rem;
        margin-bottom: 0.5rem;
      }

      .count {
        font-size: 0.75rem;
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export class ModelUpdater extends CardDef {
  static displayName = 'OpenRouter Model Updater';

  @field targetRealm = contains(StringField, {
    description: 'Realm URL where OpenRouter models will be saved ',
    computeVia: function (this: ModelUpdater) {
      return (this as any).id
        ? new URL((this as any).id).origin +
            new URL((this as any).id).pathname
              .split('/')
              .slice(0, -2)
              .join('/') +
            '/'
        : '';
    },
  });

  @field modelsProcessed = contains(NumberField, {
    description: 'Number of models processed in last update',
  });

  @field lastUpdateStatus = contains(StringField, {
    description: 'Status of the last update operation',
  });

  @field cardTitle = contains(StringField, {
    computeVia: function (this: ModelUpdater) {
      return this.cardInfo?.name || 'OpenRouter Model Updater';
    },
  });
  static isolated = Isolated;
}
