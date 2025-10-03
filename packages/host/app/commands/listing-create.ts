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
import { SearchCardsByTypeAndTitleCommand } from './search-cards';

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
    await Promise.all([
      this.autoPatchName(listingCard),
      this.autoPatchSummary(listingCard),
      this.autoLinkTag(listingCard),
      this.autoLinkCategory(listingCard),
      this.autoLinkLicense(listingCard),
      this.linkSpecs(listingCard, openCardId, targetRealm),
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
  ) {
    const response = await this.network.authedFetch(
      `${targetRealm}_dependencies?url=${openCardId}`,
      { headers: { Accept: SupportedMimeType.CardDependencies } },
    );
    if (!response.ok) {
      console.warn('Failed to fetch dependencies for specs');
      return;
    }
    const deps = (await response.json()) as string[];
    const sanitizedDeps = this.sanitizeDeps(deps ?? []);
    if (!sanitizedDeps.length) return;
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
  }

  private async askAiCardToLink(
    searchTypeCodeRef: ResolvedCodeRef,
    additionalSystemPrompt?: string,
  ): Promise<any[]> {
    const search = new SearchCardsByTypeAndTitleCommand(this.commandContext);
    const result = await search.execute({ type: searchTypeCodeRef });
    const instances = result.instances ?? [];
    const summariesString = this.instancesToPromptString(instances);
    const oneShot = new OneShotLlmRequestCommand(this.commandContext);
    let baseSystemPrompt = `You are an expert catalog curator. Select the most relevant 1 or 2 ids that represent ${searchTypeCodeRef.name} (maximum 2) from the provided list. Output ONLY a JSON array of 1 or 2 id strings. No commentary.`;
    if (additionalSystemPrompt && additionalSystemPrompt.trim()) {
      baseSystemPrompt += `\n\n${additionalSystemPrompt.trim()}`;
    }
    const userPrompt = `Options (id :: title):\n${summariesString}\n\nRules:\n- Return a JSON array with 1 or 2 ids (max 2).\n- No duplicates.\n- Only use ids from the list.\nOutput examples: ["idA"] or ["idA","idB"].`;
    const r = await oneShot.execute({
      systemPrompt: baseSystemPrompt,
      userPrompt,
      llmModel: 'openai/gpt-5-nano',
      ...(this.adoptedCodeRef ? { codeRef: this.adoptedCodeRef } : {}),
    });
    // If adoptedCodeRef exists, re-run with code context for potential refinement (optional simple approach)
    if (!r.output) return [];
    return this.parseLinkingOutput(r.output, instances);
  }

  private parseLinkingOutput(output: string, instances: any[]): any[] {
    const selectedIds: string[] = this.parseIdsFromOutput(output);
    const normalized = selectedIds.filter(Boolean);
    const matched = new Set();
    for (let inst of instances) {
      const instId = (inst as any)?.id;
      if (!instId) continue;
      if (normalized.some((sel) => instId === sel || instId.includes(sel))) {
        matched.add(inst);
      }
    }
    return Array.from(matched);
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
  private async autoLinkLicense(listing: CardAPI.CardDef) {
    const instances = await this.askAiCardToLink({
      module: `${this.catalogRealm}catalog-app/listing/license`,
      name: 'License',
    } as ResolvedCodeRef);
    (listing as any).license = instances[0];
  }
  private async autoLinkTag(listing: CardAPI.CardDef) {
    const instances = await this.askAiCardToLink(
      {
        module: `${this.catalogRealm}catalog-app/listing/tag`,
        name: 'Tag',
      } as ResolvedCodeRef,
      // Additional hard rule: never select ids that contain 'stub'
      'RULE: Never select or any id that contains the substring "stub" (case-insensitive). 
    );
    (listing as any).tags = instances;
  }
  private async autoLinkCategory(listing: CardAPI.CardDef) {
    const instances = await this.askAiCardToLink({
      module: `${this.catalogRealm}catalog-app/listing/category`,
      name: 'Category',
    } as ResolvedCodeRef);
    (listing as any).categories = instances;
  }

  private parseIdsFromOutput(output: string): string[] {
    if (!output)
      throw new Error('Expected JSON array of ids, got empty output');
    let text = output.trim();
    if (text.startsWith('```')) {
      text = text
        .replace(/^```[a-zA-Z0-9-*]*\n?/, '')
        .replace(/```$/, '')
        .trim();
    }
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error('Output is not a JSON array');
      for (const v of parsed) {
        if (typeof v !== 'string') throw new Error('All ids must be strings');
      }
      return parsed as string[];
    } catch {
      throw new Error(
        'Failed to parse ids: expected a JSON array of strings. Original output: ' +
          output,
      );
    }
  }

  private instancesToPromptString(instances: any[]): string {
    if (!Array.isArray(instances)) return '';
    return instances
      .filter((c) => c && c.id)
      .map((c) => `${c.id} :: ${c.title || ''}`.trim())
      .join('\n');
  }

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
  maxLength: number = 200,
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
