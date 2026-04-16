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
  trimExecutableExtension,
} from '@cardstack/runtime-common';
import {
  loadCardDef,
  getAncestor,
  identifyCard,
} from '@cardstack/runtime-common/code-ref';

import type * as CardAPI from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import type { Spec } from 'https://cardstack.com/base/spec';

import HostBaseCommand from '../lib/host-base-command';

import AuthedFetchCommand from './authed-fetch';
import CanReadRealmCommand from './can-read-realm';
import CreateSpecCommand from './create-specs';
import GetCatalogRealmUrlsCommand from './get-catalog-realm-urls';
import GetCardCommand from './get-card';
import GetRealmOfUrlCommand from './get-realm-of-url';
import OneShotLlmRequestCommand from './one-shot-llm-request';
import SearchAndChooseCommand from './search-and-choose';
import { SearchCardsByTypeAndTitleCommand } from './search-cards';
import StoreAddCommand from './store-add';

type ListingType = 'card' | 'skill' | 'theme' | 'field';

const BASE_CARD_API_MODULE = 'https://cardstack.com/base/card-api';
const BASE_SKILL_MODULE = 'https://cardstack.com/base/skill';

const listingSubClass: Record<ListingType, string> = {
  card: 'CardListing',
  skill: 'SkillListing',
  theme: 'ThemeListing',
  field: 'FieldListing',
};

export default class ListingCreateCommand extends HostBaseCommand<
  typeof BaseCommandModule.ListingCreateInput,
  typeof BaseCommandModule.ListingCreateResult
> {
  static actionVerb = 'Create';
  description = 'Create a catalog listing for an example card';

  private async getCatalogRealm(): Promise<string | undefined> {
    const { urls } = await new GetCatalogRealmUrlsCommand(
      this.commandContext,
    ).execute(undefined);
    return urls.find((realm: string) => realm.endsWith('/catalog/'));
  }

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { ListingCreateInput } = commandModule;
    return ListingCreateInput;
  }

  requireInputFields = ['codeRef', 'targetRealm'];

  private async sanitizeModuleList(
    modulesToCreate: Iterable<string>,
  ): Promise<string[]> {
    // Normalize to extensionless URLs before deduplication so that e.g.
    // "https://…/foo.gts" and "https://…/foo" don't produce separate entries.
    const seen = new Map<string, string>(); // normalized → original
    for (const m of modulesToCreate) {
      const normalized = trimExecutableExtension(new URL(m)).href;
      if (!seen.has(normalized)) {
        seen.set(normalized, m);
      }
    }
    let uniqueModules = Array.from(seen.values());

    const results = await Promise.all(
      uniqueModules.map(async (dep) => {
        // Exclude scoped CSS requests
        if (isScopedCSSRequest(dep)) {
          return null;
        }
        // Exclude known global/package/icon sources
        if (
          [
            'https://cardstack.com',
            'https://packages',
            'https://boxel-icons.boxel.ai',
          ].some((urlStem) => dep.startsWith(urlStem))
        ) {
          return null;
        }

        // Only allow modulesToCreate that belong to a realm we can read
        const { realmUrl } = await new GetRealmOfUrlCommand(
          this.commandContext,
        ).execute({ url: dep });
        if (!realmUrl) {
          return null;
        }
        const { canRead } = await new CanReadRealmCommand(
          this.commandContext,
        ).execute({ realmUrl });
        return canRead ? dep : null;
      }),
    );

    return results.filter((dep): dep is string => dep !== null);
  }

  protected async run(
    input: BaseCommandModule.ListingCreateInput,
  ): Promise<BaseCommandModule.ListingCreateResult> {
    let { openCardIds, codeRef, targetRealm } = input;

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
    const catalogRealm = await this.getCatalogRealm();

    let relationships: Record<string, { links: { self: string } }> = {};
    if (openCardIds && openCardIds.length > 0) {
      openCardIds.forEach((id, index) => {
        relationships[`examples.${index}`] = { links: { self: id } };
      });
    }

    const listingDoc: LooseSingleCardDocument = {
      data: {
        type: 'card',
        relationships,
        meta: {
          adoptsFrom: {
            module: `${catalogRealm}catalog-app/listing/listing`,
            name: listingSubClass[listingType],
          },
        },
      },
    };
    const listing = await new StoreAddCommand(this.commandContext).execute({
      document: listingDoc,
      realm: targetRealm,
    });

    const commandModule = await this.loadCommandModule();
    const listingCard = listing as CardAPI.CardDef;
    const firstOpenCardId = openCardIds?.[0];

    const backgroundWork = Promise.all([
      this.autoPatchName(listingCard, codeRef),
      this.autoPatchSummary(listingCard, codeRef),
      this.autoLinkTag(listingCard, codeRef),
      this.autoLinkCategory(listingCard, codeRef),
      this.autoLinkLicense(listingCard),
      this.autoLinkExample(listingCard, codeRef, openCardIds),
      this.linkSpecs(
        listingCard,
        targetRealm,
        firstOpenCardId ?? codeRef?.module,
        codeRef.module,
        codeRef,
      ),
    ]).catch((error) => {
      console.warn('Background autopatch failed:', error);
    });

    const { ListingCreateResult } = commandModule;
    const result = new ListingCreateResult({ listing });
    (result as any).backgroundWork = backgroundWork;
    return result;
  }

  private async guessListingType(
    codeRef: ResolvedCodeRef,
  ): Promise<ListingType> {
    let cardDef;
    try {
      cardDef = await loadCardDef(codeRef, {
        loader: this.loaderService.loader,
      });
    } catch {
      return 'card';
    }

    if (isFieldDef(cardDef)) {
      return 'field';
    }
    if (this.isAncestor(cardDef, BASE_CARD_API_MODULE, 'Theme')) {
      return 'theme';
    }
    if (this.isAncestor(cardDef, BASE_SKILL_MODULE, 'Skill')) {
      return 'skill';
    }
    return 'card';
  }

  private isAncestor(
    cardDef: CardAPI.BaseDefConstructor,
    targetModule: string,
    targetName: string,
  ): boolean {
    let current: CardAPI.BaseDefConstructor | undefined = cardDef;
    while (current) {
      const ref = identifyCard(current);
      if (
        ref &&
        !('type' in ref) &&
        ref.module === targetModule &&
        ref.name === targetName
      ) {
        return true;
      }
      current = getAncestor(current) ?? undefined;
    }
    return false;
  }

  private async linkSpecs(
    listing: CardAPI.CardDef,
    targetRealm: string,
    resourceUrl: string, // can be module or card instance id
    moduleUrl: string, // the module URL of the card type being listed
    codeRef: ResolvedCodeRef, // the specific export being listed
  ): Promise<Spec[]> {
    const { realmUrl: resourceRealmUrl } = await new GetRealmOfUrlCommand(
      this.commandContext,
    ).execute({ url: resourceUrl });
    const resourceRealm = resourceRealmUrl || targetRealm;
    const depUrl = `${resourceRealm}_dependencies?url=${encodeURIComponent(resourceUrl)}`;
    const { ok, body: jsonApiResponse } = await new AuthedFetchCommand(
      this.commandContext,
    ).execute({ url: depUrl, acceptHeader: SupportedMimeType.JSONAPI });

    if (!ok) {
      console.warn('Failed to fetch dependencies for specs');
      (listing as any).specs = [];
      return [];
    }

    // Collect all modules (main + dependencies). Deduplication happens in sanitizeModuleList().
    // The _dependencies endpoint excludes the queried resource itself, so we
    // explicitly include the module URL to ensure a spec is created for it.
    const modulesToCreate: string[] = [moduleUrl];

    (
      jsonApiResponse as {
        data?: Array<{
          attributes?: { dependencies?: string[] };
        }>;
      }
    ).data?.forEach((entry) => {
      if (entry.attributes?.dependencies) {
        modulesToCreate.push(...entry.attributes.dependencies);
      }
    });

    const sanitizedModules = await this.sanitizeModuleList(modulesToCreate);

    // Create specs for all unique modules
    const uniqueSpecsById = new Map<string, Spec>();

    if (sanitizedModules.length > 0) {
      const createSpecCommand = new CreateSpecCommand(this.commandContext);
      const normalizedModuleUrl = trimExecutableExtension(
        new URL(moduleUrl),
      ).href;
      const specResults = await Promise.all(
        sanitizedModules.map((module) => {
          // For the main module, use the specific codeRef (with export name) so
          // only the listed export gets a spec, not every export in the file.
          // Normalize both sides before comparing — _dependencies can return
          // URLs with executable extensions (e.g. .gts) while moduleUrl/codeRef.module
          // is often extensionless, so a bare string comparison would create
          // duplicate specs for the same source file.
          const normalizedModule = trimExecutableExtension(
            new URL(module),
          ).href;
          const input =
            normalizedModule === normalizedModuleUrl
              ? { codeRef, targetRealm, autoGenerateReadme: true }
              : { module, targetRealm, autoGenerateReadme: true };
          return createSpecCommand.execute(input).catch((e: unknown) => {
            console.warn('Failed to create spec(s) for', module, e);
            return undefined;
          });
        }),
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
    params: {
      candidateTypeCodeRef: ResolvedCodeRef;
      sourceContextCodeRef?: ResolvedCodeRef;
    },
    opts?: {
      max?: number;
      additionalSystemPrompt?: string;
    },
  ) {
    const command = new SearchAndChooseCommand(this.commandContext);
    const result = await command.execute({
      candidateTypeCodeRef: params.candidateTypeCodeRef,
      sourceContextCodeRef: params.sourceContextCodeRef,
      max: opts?.max,
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
        'You are a concise and accurate summarization system. You read a Cardstack card/field definition source file and create a concise catalog listing title. Respond ONLY with the title text—no quotes, no JSON, no markdown, and no extra commentary.',
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
        'You are a concise and accurate summarization system. You read a Cardstack card/field definition source file and write a concise spec-style summary. Output ONLY the summary text—no quotes, no JSON, no markdown, and no extra commentary.',
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
    openCardIds?: string[],
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

    if (openCardIds && openCardIds.length > 0) {
      await Promise.all(
        openCardIds.map(async (openCardId) => {
          try {
            const instance = await new GetCardCommand(
              this.commandContext,
            ).execute({ cardId: openCardId });
            if (isCardInstance(instance)) {
              addCard(instance as CardAPI.CardDef);
            } else {
              console.warn(
                'autoLinkExample: openCardId is not a card instance',
                { openCardId },
              );
            }
          } catch (error) {
            console.warn('autoLinkExample: failed to load openCardId', {
              openCardId,
              error,
            });
          }
        }),
      );
    } else {
      // If no openCardIds were provided, attempt to find any existing instance of this type.
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
            addCard(first as CardAPI.CardDef);
          }
        }
      } catch (error) {
        console.warn(
          'autoLinkExample: failed to search for an example instance',
          { codeRef, error },
        );
      }
    }

    // Only auto-fill additional examples when the user didn't explicitly choose
    const userExplicitlyChose = openCardIds && openCardIds.length > 0;
    const MAX_EXAMPLES = 4;
    if (
      !userExplicitlyChose &&
      codeRef &&
      uniqueById.size > 0 &&
      uniqueById.size < MAX_EXAMPLES
    ) {
      try {
        const existingIds = Array.from(uniqueById.keys());
        const additionalExamples = await this.chooseCards(
          {
            candidateTypeCodeRef: codeRef,
          },
          {
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
          },
        );
        for (const card of additionalExamples) {
          addCard(card as CardAPI.CardDef);
        }
      } catch (error) {
        console.warn('Failed to auto-link additional examples', {
          codeRef,
          error,
        });
      }
    }
    (listing as any).examples = Array.from(uniqueById.values());
  }

  private async autoLinkLicense(listing: CardAPI.CardDef) {
    const catalogRealm = await this.getCatalogRealm();
    const selected = await this.chooseCards({
      candidateTypeCodeRef: {
        module: `${catalogRealm}catalog-app/listing/license`,
        name: 'License',
      } as ResolvedCodeRef,
    });
    (listing as any).license = selected[0];
  }

  private async autoLinkTag(
    listing: CardAPI.CardDef,
    codeRef: ResolvedCodeRef,
  ) {
    const catalogRealm = await this.getCatalogRealm();
    const selected = await this.chooseCards(
      {
        candidateTypeCodeRef: {
          module: `${catalogRealm}catalog-app/listing/tag`,
          name: 'Tag',
        } as ResolvedCodeRef,
        sourceContextCodeRef: codeRef,
      },
      {
        max: 1,
        additionalSystemPrompt:
          'You are selecting from an existing list of catalog tags. ' +
          "Choose the single best tag that describes the card's subject matter, use case, or domain. " +
          'Prefer a specific descriptive tag over a broad organizational bucket. ' +
          'Only select ids from the provided options. ' +
          'Return [] if no tag clearly fits.',
      },
    );
    (listing as any).tags = selected;
  }

  private async autoLinkCategory(
    listing: CardAPI.CardDef,
    codeRef: ResolvedCodeRef,
  ) {
    const catalogRealm = await this.getCatalogRealm();
    const selected = await this.chooseCards(
      {
        candidateTypeCodeRef: {
          module: `${catalogRealm}catalog-app/listing/category`,
          name: 'Category',
        } as ResolvedCodeRef,
        sourceContextCodeRef: codeRef,
      },
      {
        max: 1,
        additionalSystemPrompt:
          'You are selecting from an existing list of catalog categories. ' +
          "Choose the single best high-level category that matches the card's main purpose. " +
          'Prefer broad organizing categories over keyword-style tags. ' +
          'Only select ids from the provided options. ' +
          'Return [] if no category clearly fits.',
      },
    );
    (listing as any).categories = selected;
  }

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
