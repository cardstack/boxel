import { service } from '@ember/service';

import { isScopedCSSRequest } from 'glimmer-scoped-css';

import type {
  LooseSingleCardDocument,
  ResolvedCodeRef,
} from '@cardstack/runtime-common';
import {
  isCardInstance,
  SupportedMimeType,
  isFieldDef,
  isResolvedCodeRef,
} from '@cardstack/runtime-common';
import { loadCardDef } from '@cardstack/runtime-common/code-ref';

import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import type { Spec } from 'https://cardstack.com/base/spec';

import HostBaseCommand from '../lib/host-base-command';

import CreateSpecCommand from './create-specs';
import OneShotLlmRequestCommand from './one-shot-llm-request';
import SearchAndChooseCommand from './search-and-choose';
import { SearchCardsByTypeAndTitleCommand } from './search-cards';

import type CardService from '../services/card-service';
import type NetworkService from '../services/network';
import type OperatorModeStateService from '../services/operator-mode-state-service';
import type RealmService from '../services/realm';
import type RealmServerService from '../services/realm-server';
import type StoreService from '../services/store';

type ListingType = 'card' | 'app' | 'skill' | 'theme' | 'field';
const listingSubClass: Record<ListingType, string> = {
  card: 'CardListing',
  app: 'AppListing',
  skill: 'SkillListing',
  theme: 'ThemeListing',
  field: 'FieldListing',
};

export default class ListingCreateCommand extends HostBaseCommand<
  typeof BaseCommandModule.ListingCreateInput,
  typeof BaseCommandModule.ListingCreateResult
> {
  @service declare private store: StoreService;
  @service declare private cardService: CardService;
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private network: NetworkService;
  @service declare private realm: RealmService;
  @service declare private realmServer: RealmServerService;

  static actionVerb = 'Create';
  description = 'Create a catalog listing for an example card';

  #cardAPI?: typeof CardAPI;

  async loadCardAPI() {
    if (!this.#cardAPI) {
      this.#cardAPI = await this.loaderService.loader.import<typeof CardAPI>(
        'https://cardstack.com/base/card-api',
      );
    }
    return this.#cardAPI;
  }

  get catalogRealm() {
    return this.realmServer.catalogRealmURLs.find((realm) =>
      realm.endsWith('/catalog/'),
    );
  }

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { ListingCreateInput } = commandModule;
    return ListingCreateInput;
  }

  requireInputFields = ['codeRef', 'targetRealm'];

  private sanitizeModuleList(modulesToCreate: Iterable<string>) {
    let uniqueModules = Array.from(new Set(modulesToCreate));
    return uniqueModules.filter((dep) => {
      // Exclude scoped CSS requests
      if (isScopedCSSRequest(dep)) {
        return false;
      }
      // Exclude known global/package/icon sources
      if (
        [
          'https://cardstack.com',
          'https://packages',
          'https://boxel-icons.boxel.ai',
        ].some((urlStem) => dep.startsWith(urlStem))
      ) {
        return false;
      }

      // Only allow modulesToCreate that belong to a realm we can read
      const url = new URL(dep);
      const realmURL = this.realm.realmOfURL(url);
      if (!realmURL) {
        return false;
      }
      return this.realm.canRead(realmURL.href);
    });
  }

  protected async run(
    input: BaseCommandModule.ListingCreateInput,
  ): Promise<BaseCommandModule.ListingCreateResult> {
    const cardAPI = await this.loadCardAPI();
    let { openCardId, codeRef, targetRealm } = input;

    if (!codeRef) {
      throw new Error('codeRef is required');
    }
    if (!isResolvedCodeRef(codeRef)) {
      throw new Error('codeRef must be a ResolvedCodeRef with module and name');
    }
    if (!targetRealm) {
      throw new Error('Target Realm is required');
    }

    let listingType = await this.guessListingType(codeRef);

    const listingDoc: LooseSingleCardDocument = {
      data: {
        type: 'card',
        relationships: openCardId
          ? {
              'examples.0': { links: { self: openCardId } },
            }
          : {},
        meta: {
          adoptsFrom: {
            module: `${this.catalogRealm}catalog-app/listing/listing`,
            name: listingSubClass[listingType],
          },
        },
      },
    };
    const listing = await this.store.add(listingDoc, { realm: targetRealm });
    // Always use the transient symbol-based localId; ignore any persisted id at this stage
    const listingId = (listing as any)[(cardAPI as any).localId];
    if (!listingId) {
      throw new Error('Failed to create listing card (no localId)');
    }
    await this.operatorModeStateService.openCardInInteractMode(listingId);

    const commandModule = await this.loadCommandModule();
    const listingCard = listing as CardAPI.CardDef; // ensure correct type
    const specsPromise = this.linkSpecs(
      listingCard,
      targetRealm,
      openCardId ?? codeRef?.module,
    );

    const promises = [
      this.autoPatchName(listingCard, codeRef),
      this.autoPatchSummary(listingCard, codeRef),
      this.autoLinkTag(listingCard),
      this.autoLinkCategory(listingCard),
      this.autoLinkLicense(listingCard),
      this.autoLinkExample(listingCard, codeRef, openCardId),
      specsPromise,
    ];

    await Promise.all(promises);
    const { ListingCreateResult } = commandModule;
    return new ListingCreateResult({ listing });
  }

  private async guessListingType(
    codeRef: ResolvedCodeRef,
  ): Promise<ListingType> {
    if (this.isTheme(codeRef)) {
      return 'theme';
    }
    if (await this.isFieldCodeRef(codeRef)) {
      return 'field';
    }
    try {
      const oneShot = new OneShotLlmRequestCommand(this.commandContext);
      const systemPrompt =
        'Respond ONLY with one token: card, app, skill, or theme. No JSON, no punctuation.';
      const userPrompt = 'What is the listingType?';
      const result = await oneShot.execute({
        codeRef,
        systemPrompt,
        userPrompt,
        llmModel: 'openai/gpt-4.1-nano',
      });
      const maybeType = parseResponseToSingleWord(result.output, true);
      if (
        maybeType === 'app' ||
        maybeType === 'skill' ||
        maybeType === 'theme'
      ) {
        return maybeType;
      }
      return 'card';
    } catch {
      return 'card';
    }
  }

  private isTheme(codeRef: ResolvedCodeRef): boolean {
    const codeRefModule = codeRef?.module?.toLowerCase();
    const codeRefName = codeRef?.name?.toLowerCase();
    const knownBaseModules = [
      'https://cardstack.com/base/structured-theme',
      'https://cardstack.com/base/style-reference',
      'https://cardstack.com/base/brand-guide',
    ];
    if (
      codeRefModule &&
      knownBaseModules.some((base) => codeRefModule.includes(base))
    ) {
      return true;
    }
    if (codeRefName) {
      const normalizedName = codeRefName
        .split('')
        .filter((char) => char !== '-' && char !== '_' && char !== ' ')
        .join('');
      if (
        ['theme', 'structuredtheme', 'stylereference', 'brandguide'].includes(
          normalizedName,
        )
      ) {
        return true;
      }
    }
    return false;
  }

  private async isFieldCodeRef(codeRef: ResolvedCodeRef): Promise<boolean> {
    try {
      const cardDef = await loadCardDef(codeRef, {
        loader: this.loaderService.loader,
      });
      return isFieldDef(cardDef);
    } catch {
      return false;
    }
  }

  private async linkSpecs(
    listing: CardAPI.CardDef,
    targetRealm: string,
    resourceUrl: string, // can be module or card instance id
  ): Promise<Spec[]> {
    const url = `${targetRealm}_dependencies?url=${encodeURIComponent(resourceUrl)}`;
    const response = await this.network.authedFetch(url, {
      headers: { Accept: SupportedMimeType.JSONAPI },
    });

    if (!response.ok) {
      console.warn('Failed to fetch dependencies for specs');
      (listing as any).specs = [];
      return [];
    }

    const jsonApiResponse = (await response.json()) as {
      data?: Array<{
        type: string;
        id: string;
        attributes?: {
          dependencies?: string[];
        };
      }>;
    };

    // Collect all modules (main + dependencies). Deduplication happens in sanitizeModuleList().
    const modulesToCreate: string[] = [];

    jsonApiResponse.data?.forEach((entry) => {
      if (entry.attributes?.dependencies) {
        modulesToCreate.push(...entry.attributes.dependencies);
      }
    });

    const sanitizedModules = this.sanitizeModuleList(modulesToCreate);

    // Create specs for all unique modules
    const uniqueSpecsById = new Map<string, Spec>();

    if (sanitizedModules.length > 0) {
      const createSpecCommand = new CreateSpecCommand(this.commandContext);
      const specResults = await Promise.all(
        sanitizedModules.map((module) =>
          createSpecCommand
            .execute({ module, targetRealm, autoGenerateReadme: true })
            .catch((e) => {
              console.warn('Failed to create spec(s) for', module, e);
              return undefined;
            }),
        ),
      );

      specResults.forEach((result) => {
        result?.specs?.forEach((spec) => {
          if (spec?.id) {
            uniqueSpecsById.set(spec.id, spec);
          }
        });
      });
    }

    const specs = Array.from(uniqueSpecsById.values());
    (listing as any).specs = specs;
    return specs;
  }

  // --- Linking helpers now use SearchAndChooseCommand ---
  private async chooseCards(
    codeRef: ResolvedCodeRef,
    opts?: { max?: number; additionalSystemPrompt?: string },
  ) {
    const command = new SearchAndChooseCommand(this.commandContext);
    const result = await command.execute({
      codeRef,
      max: opts?.max ?? 2,
      additionalSystemPrompt: opts?.additionalSystemPrompt,
    });
    return result.selectedCards ?? [];
  }

  private async autoPatchName(
    listing: CardAPI.CardDef,
    codeRef: ResolvedCodeRef,
  ) {
    const name = await this.getStringPatch({
      codeRef,
      systemPrompt:
        'You are an expert catalog curator. You read a Cardstack card/field definition source file and create a concise catalog listing title. Respond ONLY with the title text—no quotes, no JSON, no markdown, and no extra commentary.',
      userPrompt: [
        `Generate a catalog listing title for the definition referenced by:`,
        `- module: ${codeRef.module}`,
        `- exportName: ${codeRef.name}`,
        `Use ONLY the attached module source shown below (the file content).`,
        `Focus on the export named "${codeRef.name}" (ignore other exports).`,
      ].join('\n'),
    });
    if (name) {
      (listing as any).name = name;
    }
  }

  private async autoPatchSummary(
    listing: CardAPI.CardDef,
    codeRef: ResolvedCodeRef,
  ) {
    const summary = await this.getStringPatch({
      codeRef,
      systemPrompt:
        'You are an expert catalog curator. You read a Cardstack card/field definition source file and write a concise spec-style summary. Output ONLY the summary text—no quotes, no JSON, no markdown, and no extra commentary.',
      userPrompt: [
        `Generate a README-style catalog listing summary for the definition referenced by:`,
        `- module: ${codeRef.module}`,
        `- exportName: ${codeRef.name}`,
        `Use ONLY the attached module source shown below (the file content).`,
        `Focus on the export named "${codeRef.name}" (ignore other exports).`,
        `Focus on what this listing (app/card/field/skill/theme) does and its primary purpose. Avoid implementation details and marketing fluff.`,
      ].join('\n'),
    });
    if (summary) {
      (listing as any).summary = summary;
    }
  }

  private async autoLinkExample(
    listing: CardAPI.CardDef,
    codeRef: ResolvedCodeRef,
    openCardId?: string,
  ) {
    const existingExamples = Array.isArray((listing as any).examples)
      ? ((listing as any).examples as CardAPI.CardDef[])
      : [];
    const uniqueById = new Map<string, CardAPI.CardDef>();
    const addCard = (card?: CardAPI.CardDef) => {
      if (!card || typeof card.id !== 'string') {
        return;
      }
      if (uniqueById.has(card.id)) {
        return;
      }
      uniqueById.set(card.id, card);
    };

    for (const existing of existingExamples) {
      addCard(existing);
    }

    let exampleCard: CardAPI.CardDef | undefined;
    if (openCardId) {
      try {
        const instance = await this.store.get<CardAPI.CardDef>(openCardId);
        if (isCardInstance(instance)) {
          exampleCard = instance as CardAPI.CardDef;
        } else {
          console.warn('autoLinkExample: openCardId is not a card instance', {
            openCardId,
          });
        }
      } catch (error) {
        console.warn('autoLinkExample: failed to load openCardId', {
          openCardId,
          error,
        });
      }
    }

    // If no openCardId was provided, attempt to find any existing instance of this type.
    if (!exampleCard) {
      try {
        const search = new SearchCardsByTypeAndTitleCommand(
          this.commandContext,
        );
        const result = await search.execute({ type: codeRef });
        const instances = (result as any)?.instances as unknown;
        if (Array.isArray(instances)) {
          const first = instances.find(
            (c: any) => c && typeof c.id === 'string' && isCardInstance(c),
          );
          if (first) {
            exampleCard = first as CardAPI.CardDef;
          }
        }
      } catch (error) {
        console.warn(
          'autoLinkExample: failed to search for an example instance',
          { codeRef, error },
        );
      }
    }

    addCard(exampleCard);

    const MAX_EXAMPLES = 4;
    if (codeRef && exampleCard && uniqueById.size < MAX_EXAMPLES) {
      try {
        const searchAndChoose = new SearchAndChooseCommand(this.commandContext);
        const existingIds = Array.from(uniqueById.keys());
        const result = await searchAndChoose.execute({
          codeRef,
          max: Math.max(1, MAX_EXAMPLES - existingIds.length),
          additionalSystemPrompt: [
            'Prefer examples that showcase common or high-impact use cases.',
            existingIds.length
              ? `Do not include any id already linked: ${existingIds.join(', ')}.`
              : '',
            'Return [] if nothing relevant is found.',
          ]
            .filter(Boolean)
            .join(' '),
        });
        for (const card of result.selectedCards ?? []) {
          addCard(card as CardAPI.CardDef);
        }
      } catch (error) {
        console.warn('Failed to auto-link additional examples', {
          sourceCardId: exampleCard.id,
          error,
        });
      }
    }
    (listing as any).examples = Array.from(uniqueById.values());
  }

  private async autoLinkLicense(listing: CardAPI.CardDef) {
    const selected = await this.chooseCards(
      {
        module: `${this.catalogRealm}catalog-app/listing/license`,
        name: 'License',
      } as ResolvedCodeRef,
      { max: 1 },
    );
    (listing as any).license = selected[0];
  }

  private async autoLinkTag(listing: CardAPI.CardDef) {
    const selected = await this.chooseCards(
      {
        module: `${this.catalogRealm}catalog-app/listing/tag`,
        name: 'Tag',
      } as ResolvedCodeRef,
      {
        max: 2,
        additionalSystemPrompt:
          'RULE: Never select or return any id that contains the substring "stub" (case-insensitive). If all contain stub return [].',
      },
    );
    (listing as any).tags = selected;
  }

  private async autoLinkCategory(listing: CardAPI.CardDef) {
    const selected = await this.chooseCards(
      {
        module: `${this.catalogRealm}catalog-app/listing/category`,
        name: 'Category',
      } as ResolvedCodeRef,
      { max: 2 },
    );
    (listing as any).categories = selected;
  }

  // Removed bespoke AI selection/parsing helpers in favor of SearchAndChooseCommand

  private async getStringPatch(opts: {
    systemPrompt: string;
    userPrompt: string;
    codeRef?: ResolvedCodeRef;
  }): Promise<string | undefined> {
    const { systemPrompt, userPrompt, codeRef } = opts;
    const oneShot = new OneShotLlmRequestCommand(this.commandContext);
    const result = await oneShot.execute({
      ...(codeRef ? { codeRef } : {}),
      systemPrompt,
      userPrompt,
      llmModel: 'openai/gpt-4.1-nano',
    });
    if (!result.output) return undefined;
    // We don't strictly need the key now; keep signature for compatibility.
    return parseResponseToString(result.output);
  }
}

// Parse an AI response into a concise string (e.g. title/summary first line)
// - Strips markdown code fences
// - If JSON with a single string property, returns that value
// - Falls back to first non-empty line
// - Truncates to maxLength
function parseResponseToString(
  response?: string,
  maxLength: number = 1000,
): string | undefined {
  if (!response) return undefined;
  let text = response.trim();
  if (!text) return undefined;
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === 'string') {
        return parsed.slice(0, maxLength);
      }
      if (Array.isArray(parsed)) {
        const first = parsed.find((v) => typeof v === 'string');
        if (first) return first.slice(0, maxLength);
        return undefined;
      }
      if (parsed && typeof parsed === 'object') {
        for (const v of Object.values(parsed as any)) {
          if (typeof v === 'string' && v.trim()) {
            return v.trim().slice(0, maxLength);
          }
        }
        return undefined;
      }
    } catch {
      // ignore parse errors and fall through
    }
  }
  const firstLine = text.split(/\s*\n\s*/)[0];
  if (!firstLine) return undefined;
  return firstLine.slice(0, maxLength);
}

function parseResponseToSingleWord(
  response?: string,
  lowerCase: boolean = false,
): string | undefined {
  const str = parseResponseToString(response, 50)?.trim();
  if (!str) return undefined;
  let token = str.split(/\s+/)[0].replace(/[^A-Za-z0-9_-]/g, '');
  if (!token) return undefined;
  if (lowerCase) token = token.toLowerCase();
  return token;
}
