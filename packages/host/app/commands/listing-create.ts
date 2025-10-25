import { service } from '@ember/service';

import { isScopedCSSRequest } from 'glimmer-scoped-css';

import {
  isCardInstance,
  LooseSingleCardDocument,
  ResolvedCodeRef,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import { resolveAdoptedCodeRef } from '@cardstack/runtime-common/code-ref';

import * as CardAPI from 'https://cardstack.com/base/card-api';
import * as BaseCommandModule from 'https://cardstack.com/base/command';

import { Spec } from 'https://cardstack.com/base/spec';

import HostBaseCommand from '../lib/host-base-command';

import CreateSpecCommand from './create-specs';
import OneShotLlmRequestCommand from './one-shot-llm-request';
import SearchAndChooseCommand from './search-and-choose';

import type CardService from '../services/card-service';
import type NetworkService from '../services/network';
import type OperatorModeStateService from '../services/operator-mode-state-service';
import type RealmService from '../services/realm';
import type RealmServerService from '../services/realm-server';
import type StoreService from '../services/store';

type ListingType = 'card' | 'app' | 'skill';
const listingSubClass: Record<ListingType, string> = {
  card: 'CardListing',
  app: 'AppListing',
  skill: 'SkillListing',
};

export default class ListingCreateCommand extends HostBaseCommand<
  typeof BaseCommandModule.ListingCreateInput,
  typeof BaseCommandModule.ListingCreateResult
> {
  @service declare private store: StoreService;
  @service declare private cardService: CardService; // (kept for potential future use)
  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private network: NetworkService;
  @service declare private realm: RealmService;
  @service declare private realmServer: RealmServerService;

  static actionVerb = 'Create';
  description = 'Create a catalog listing for an example card';

  #cardAPI?: typeof CardAPI;
  private serializedCardString?: string; // serialized JSON of example card
  private adoptedCodeRef?: ResolvedCodeRef; // resolved adopted code ref for example card

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

  requireInputFields = ['openCardId'];

  private sanitizeDeps(deps: string[]) {
    return deps.filter((dep) => {
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

      // Only allow deps that belong to a realm we can read
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
    let { openCardId, targetRealm: targetRealmFromInput } = input;
    if (!openCardId) {
      throw new Error('openCardId is required');
    }
    const instance = await this.store.get<CardAPI.CardDef>(openCardId);
    if (!isCardInstance(instance)) {
      throw new Error('Instance is not a card');
    }
    const exampleCard = instance as CardAPI.CardDef;
    const targetRealm =
      targetRealmFromInput ?? exampleCard[cardAPI.realmURL]?.href;
    if (!targetRealm) {
      throw new Error('Realm not found');
    }

    // resolve adopted code ref once for downstream string patch prompts
    try {
      this.adoptedCodeRef = resolveAdoptedCodeRef(exampleCard);
    } catch {
      this.adoptedCodeRef = undefined;
    }

    // serialize once for guessListingType context
    try {
      const serialized = await this.cardService.serializeCard(exampleCard);
      this.serializedCardString = JSON.stringify(serialized?.data, null, 2);
    } catch {
      this.serializedCardString = undefined;
    }

    const listingType = await this.guessListingType(exampleCard);

    const listingDoc: LooseSingleCardDocument = {
      data: {
        type: 'card',
        relationships: {
          'examples.0': { links: { self: openCardId } },
        },
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
    const specsPromise = this.linkSpecs(listingCard, openCardId, targetRealm);
    await Promise.all([
      this.autoPatchName(listingCard),
      this.autoPatchSummary(listingCard),
      this.autoLinkExample(listingCard, exampleCard),
      this.autoLinkTag(listingCard),
      this.autoLinkCategory(listingCard),
      this.autoLinkLicense(listingCard),
      specsPromise,
    ]);
    //we don't need to call this save card
    //interact stack item does auto-saving anyway
    //await new SaveCardCommand(this.commandContext).execute({
    //   card: listing as CardAPI.CardDef,
    //   realm: targetRealm,
    //});
    const { ListingCreateResult } = commandModule;
    return new ListingCreateResult({ listing });
  }

  private async guessListingType(
    exampleCard: CardAPI.CardDef,
  ): Promise<ListingType> {
    try {
      const oneShot = new OneShotLlmRequestCommand(this.commandContext);
      const name = (exampleCard as any).name || '';
      const summary = (exampleCard as any).summary || '';
      const systemPrompt =
        'Respond ONLY with one token: card, app, or skill. No JSON, no punctuation.';
      const serializedSnippet = this.serializedCardString
        ? this.serializedCardString.slice(0, 1500)
        : '';
      const userPrompt = `ID: ${exampleCard.id || 'unknown'}\nName: ${name}\nSummary: ${summary}\n${serializedSnippet ? `Card JSON (truncated):\n\n\`\`\`json\n${serializedSnippet}\n\`\`\`` : ''}`;
      const result = await oneShot.execute({
        systemPrompt,
        userPrompt,
        llmModel: 'openai/gpt-4.1-nano',
        ...(this.adoptedCodeRef ? { codeRef: this.adoptedCodeRef } : {}),
      });
      const maybeType = parseResponseToSingleWord(result.output, true);
      if (maybeType === 'app' || maybeType === 'skill') return maybeType;
      return 'card';
    } catch {
      return 'card';
    }
  }

  private async linkSpecs(
    listing: CardAPI.CardDef,
    openCardId: string,
    targetRealm: string,
  ): Promise<Spec[]> {
    const response = await this.network.authedFetch(
      `${targetRealm}_dependencies?url=${openCardId}`,
      { headers: { Accept: SupportedMimeType.CardDependencies } },
    );
    if (!response.ok) {
      console.warn('Failed to fetch dependencies for specs');
      (listing as any).specs = [];
      return [];
    }
    const deps = (await response.json()) as string[];
    const sanitizedDeps = this.sanitizeDeps(deps ?? []);
    if (!sanitizedDeps.length) {
      (listing as any).specs = [];
      return [];
    }
    const createSpecCommand = new CreateSpecCommand(this.commandContext);
    const specResults = await Promise.all(
      sanitizedDeps.map((dep) =>
        createSpecCommand
          .execute({ module: dep, targetRealm, autoGenerateReadme: true })
          .catch((e) => {
            console.warn('Failed to create spec(s) for', dep, e);
            return undefined;
          }),
      ),
    );
    const specs: Spec[] = [];
    for (const res of specResults) {
      if (res?.specs) specs.push(...res.specs);
    }
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

  private async autoPatchName(listing: CardAPI.CardDef) {
    const name = await this.getStringPatch({
      systemPrompt:
        'You are an expert catalog curator for tech products. Produce ONLY the concise human-friendly title (3 words max) for this listing. Output just the title text—no quotes, no JSON, no punctuation beyond normal word separators, and no extra commentary.',
      userPrompt:
        'Provide a short, clear, human-friendly title (3-8 words) for this listing. Avoid quotes, punctuation except hyphens/spaces, and version numbers.',
    });
    if (name) {
      (listing as any).name = name;
    }
  }

  private async autoPatchSummary(listing: CardAPI.CardDef) {
    const summary = await this.getStringPatch({
      systemPrompt:
        "You are an expert catalog curator for tech products. Produce ONLY a one or two sentence concise README-style summary describing the listing's value and primary purpose. Output just the summary text—no quotes, no JSON, no markdown, no extra commentary.",
      userPrompt:
        'Write a concise README-style summary. Focus on what this listing (software/card/app/skill) does and its primary purpose. Avoid implementation details and marketing fluff.',
    });
    if (summary) {
      (listing as any).summary = summary;
    }
  }

  private async autoLinkExample(
    listing: CardAPI.CardDef,
    exampleCard: CardAPI.CardDef,
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

    addCard(exampleCard);

    const MAX_EXAMPLES = 4;
    if (this.adoptedCodeRef && uniqueById.size < MAX_EXAMPLES) {
      try {
        const searchAndChoose = new SearchAndChooseCommand(this.commandContext);
        const existingIds = Array.from(uniqueById.keys());
        const result = await searchAndChoose.execute({
          codeRef: this.adoptedCodeRef,
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
  }): Promise<string | undefined> {
    const { systemPrompt, userPrompt } = opts;
    const oneShot = new OneShotLlmRequestCommand(this.commandContext);
    const result = await oneShot.execute({
      systemPrompt,
      userPrompt,
      llmModel: 'openai/gpt-4.1-nano',
      ...(this.adoptedCodeRef ? { codeRef: this.adoptedCodeRef } : {}),
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
