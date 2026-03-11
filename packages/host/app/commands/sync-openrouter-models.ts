import { service } from '@ember/service';

import { SupportedMimeType } from '@cardstack/runtime-common';
import type { AtomicOperation } from '@cardstack/runtime-common/atomic-document';

import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import type CardService from '../services/card-service';
import type NetworkService from '../services/network';
import type RealmServerService from '../services/realm-server';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const BATCH_SIZE = 50;

interface OpenRouterApiModel {
  id: string;
  canonical_slug?: string;
  name?: string;
  created?: number;
  description?: string;
  context_length?: number;
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
    tokenizer?: string;
    instruct_type?: string;
  };
  pricing?: {
    prompt?: string;
    completion?: string;
    request?: string;
    image?: string;
    web_search?: string;
  };
  top_provider?: {
    is_moderated?: boolean;
    context_length?: number;
    max_completion_tokens?: number;
  };
  per_request_limits?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  } | null;
  supported_parameters?: string[];
  default_parameters?: {
    temperature?: number | null;
    top_p?: number | null;
    top_k?: number | null;
    max_tokens?: number | null;
    frequency_penalty?: number | null;
    presence_penalty?: number | null;
    repetition_penalty?: number | null;
  };
  expiration_date?: string | null;
}

function buildSlug(modelId: string): string {
  return modelId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildCardJson(model: OpenRouterApiModel) {
  return {
    data: {
      type: 'card' as const,
      attributes: {
        modelId: model.id,
        canonicalSlug: model.canonical_slug ?? null,
        name: model.name ?? null,
        created: model.created ?? null,
        cardDescription: model.description ?? null,
        contextLength: model.context_length ?? null,
        pricing: model.pricing
          ? {
              prompt: model.pricing.prompt ?? null,
              completion: model.pricing.completion ?? null,
              request: model.pricing.request ?? null,
              image: model.pricing.image ?? null,
              webSearch: model.pricing.web_search ?? null,
            }
          : null,
        architecture: model.architecture
          ? {
              modality: model.architecture.modality ?? null,
              inputModalities: model.architecture.input_modalities ?? [],
              outputModalities: model.architecture.output_modalities ?? [],
              tokenizer: model.architecture.tokenizer ?? null,
              instructType: model.architecture.instruct_type ?? null,
            }
          : null,
        topProvider: model.top_provider
          ? {
              isModerated: model.top_provider.is_moderated ?? false,
              contextLength: model.top_provider.context_length ?? null,
              maxCompletionTokens:
                model.top_provider.max_completion_tokens ?? null,
            }
          : null,
        perRequestLimits: model.per_request_limits
          ? {
              promptTokens: model.per_request_limits.prompt_tokens ?? null,
              completionTokens:
                model.per_request_limits.completion_tokens ?? null,
            }
          : null,
        supportedParameters: model.supported_parameters ?? [],
        defaultParameters: model.default_parameters
          ? {
              temperature: model.default_parameters.temperature ?? null,
              top_p: model.default_parameters.top_p ?? null,
              max_tokens: model.default_parameters.max_tokens ?? null,
              frequency_penalty:
                model.default_parameters.frequency_penalty ?? null,
              presence_penalty:
                model.default_parameters.presence_penalty ?? null,
            }
          : null,
        deprecated: false,
        lastSeenInApi: Math.floor(Date.now() / 1000),
        expirationDate: model.expiration_date ?? null,
        cardInfo: {
          name: null,
          summary: null,
          cardThumbnailURL: null,
          notes: null,
        },
      },
      meta: {
        adoptsFrom: {
          module: './openrouter-model',
          name: 'OpenRouterModel',
        },
      },
    },
  };
}

export default class SyncOpenRouterModelsCommand extends HostBaseCommand<
  typeof BaseCommandModule.RealmUrlCard,
  typeof BaseCommandModule.SyncOpenRouterModelsResult
> {
  @service declare private cardService: CardService;
  @service declare private network: NetworkService;
  @service declare private realmServer: RealmServerService;

  static actionVerb = 'Sync';
  description = 'Sync OpenRouter model data from the OpenRouter API';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    return commandModule.RealmUrlCard;
  }

  protected async run(
    input: BaseCommandModule.RealmUrlCard,
  ): Promise<BaseCommandModule.SyncOpenRouterModelsResult> {
    let commandModule = await this.loadCommandModule();
    let realmURL = input.realmUrl;
    if (!realmURL) {
      throw new Error('realmURL is required');
    }
    if (!realmURL.endsWith('/')) {
      realmURL += '/';
    }

    // Step 1: Fetch all models from OpenRouter API
    let response = await this.realmServer.requestForward({
      url: OPENROUTER_MODELS_URL,
      method: 'GET',
      requestBody: '',
      headers: {
        'Content-Type': 'application/json',
        'X-Title': 'Boxel OpenRouter Model Sync',
      },
    });

    if (!response.ok) {
      let errorBody = '';
      try {
        errorBody = await response.text();
      } catch (_e) {
        // ignore
      }
      throw new Error(
        `OpenRouter API request failed: ${response.status} ${errorBody}`,
      );
    }

    let data = await response.json();
    let apiModels: OpenRouterApiModel[] = data.data ?? [];

    // Step 2: Query existing OpenRouterModel card IDs in the realm
    let existingSlugs = await this.fetchExistingSlugs(realmURL);

    // Step 3: Build atomic operations
    let apiSlugs = new Set<string>();
    let operations: AtomicOperation[] = [];

    for (let model of apiModels) {
      let slug = buildSlug(model.id);
      apiSlugs.add(slug);
      let href = `OpenRouterModel/${slug}.json`;
      let cardJson = buildCardJson(model);
      let op: 'add' | 'update' = existingSlugs.has(slug) ? 'update' : 'add';
      operations.push({
        op,
        href,
        data: cardJson.data as AtomicOperation['data'],
      });
    }

    // Step 4: Mark deprecated models (in API last time, not in API now)
    let nowEpoch = Math.floor(Date.now() / 1000);
    for (let existingSlug of existingSlugs) {
      if (!apiSlugs.has(existingSlug)) {
        // Model no longer in API — mark deprecated
        operations.push({
          op: 'update',
          href: `OpenRouterModel/${existingSlug}.json`,
          data: {
            type: 'card',
            attributes: {
              deprecated: true,
              lastSeenInApi: nowEpoch,
            },
            meta: {
              adoptsFrom: {
                module: './openrouter-model',
                name: 'OpenRouterModel',
              },
            },
          } as AtomicOperation['data'],
        });
      }
    }

    // Step 5: Execute batches concurrently
    let errors: string[] = [];
    let batches: AtomicOperation[][] = [];
    for (let i = 0; i < operations.length; i += BATCH_SIZE) {
      batches.push(operations.slice(i, i + BATCH_SIZE));
    }

    let results = await Promise.allSettled(
      batches.map((batch) =>
        this.cardService.executeAtomicOperations(batch, new URL(realmURL)),
      ),
    );

    let processed = 0;
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'fulfilled') {
        processed += batches[i].length;
      } else {
        let reason = (results[i] as PromiseRejectedResult).reason;
        let msg = reason instanceof Error ? reason.message : String(reason);
        console.error(`Batch ${i + 1} failed:`, msg);
        errors.push(`Batch ${i + 1} (${batches[i].length} ops): ${msg}`);
      }
    }

    let status =
      errors.length > 0
        ? `Synced ${processed}/${operations.length} models with ${errors.length} batch error(s)`
        : `Successfully synced ${processed} models (${apiModels.length} from API, ${operations.length - apiModels.length} deprecated)`;

    return new commandModule.SyncOpenRouterModelsResult({
      modelsProcessed: processed,
      totalModels: apiModels.length,
      status,
      errors: errors.length > 0 ? errors.join('\n') : undefined,
    });
  }

  private async fetchExistingSlugs(realmURL: string): Promise<Set<string>> {
    let slugs = new Set<string>();
    try {
      let searchURL = `${realmURL}_search?${new URLSearchParams({
        filter: JSON.stringify({
          type: {
            module: new URL('openrouter-model', realmURL).href,
            name: 'OpenRouterModel',
          },
        }),
      })}`;

      let response = await this.network.authedFetch(searchURL, {
        headers: { Accept: SupportedMimeType.CardJson },
      });

      if (response.ok) {
        let result = await response.json();
        let cards = result?.data ?? [];
        for (let card of cards) {
          let id: string = card.id ?? '';
          // Extract slug from URL: .../OpenRouterModel/slug-name
          let match = id.match(/OpenRouterModel\/([^/]+)$/);
          if (match) {
            slugs.add(match[1]);
          }
        }
      }
    } catch (e) {
      console.warn('Could not fetch existing models, treating all as new:', e);
    }
    return slugs;
  }
}
