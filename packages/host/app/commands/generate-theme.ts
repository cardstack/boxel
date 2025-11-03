import { service } from '@ember/service';

import {
  isCardInstance,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';

import * as CardAPI from 'https://cardstack.com/base/card-api';
import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import OneShotLlmRequestCommand from './one-shot-llm-request';

import type OperatorModeStateService from '../services/operator-mode-state-service';
import type RealmService from '../services/realm';
import type RealmServerService from '../services/realm-server';
import type StoreService from '../services/store';

type ThemeType = 'style-reference' | 'structured-theme' | 'brand-guide';

interface GenerationContext {
  styleName: string;
  visualDNA?: string | null;
  inspirations: string[];
  themeType: ThemeType;
}

const THEME_TYPE_DEFINITIONS: Record<
  ThemeType,
  { module: string; name: string }
> = {
  'style-reference': {
    module: 'https://cardstack.com/base/style-reference',
    name: 'default',
  },
  'structured-theme': {
    module: 'https://cardstack.com/base/structured-theme',
    name: 'default',
  },
  'brand-guide': {
    module: 'https://cardstack.com/base/brand-guide',
    name: 'default',
  },
};

/**
 * Plan (v1)
 * - Accept core theme metadata (styleName plus optional inspirations/visual DNA/themeType).
 * - Generate attributes for the requested theme card via LLM, tailored per themeType.
 * - Persist a single card (StyleReference, StructuredTheme, or BrandGuide) into the requested realm.
 * - Return the created card and open it in interact mode for immediate editing.
 *
 * Future ideas:
 * - Allow chained generation (e.g. create both structured theme + brand guide).
 * - Support dry-run responses without writing to a realm.
 * - Provide optional asset bundling (e.g. wallpaper uploads, token diffs).
 */
export default class GenerateThemeCommand extends HostBaseCommand<
  typeof BaseCommandModule.GenerateThemeInput,
  typeof BaseCommandModule.GenerateThemeResult
> {
  @service declare private store: StoreService;
  @service declare private realm: RealmService;
  @service declare private realmServer: RealmServerService;
  @service declare private operatorModeStateService: OperatorModeStateService;

  static actionVerb = 'Generate';
  description =
    'Generate a theme card (Style Reference, Structured Theme, or Brand Guide).';

  requireInputFields = ['styleName'];

  #cardAPI?: typeof CardAPI;

  async getInputType() {
    const commandModule = await this.loadCommandModule();
    const { GenerateThemeInput } = commandModule;
    return GenerateThemeInput;
  }

  private async loadCardAPI() {
    if (!this.#cardAPI) {
      this.#cardAPI = await this.loaderService.loader.import<typeof CardAPI>(
        'https://cardstack.com/base/card-api',
      );
    }
    return this.#cardAPI;
  }

  private get catalogRealm() {
    return this.realmServer.catalogRealmURLs.find((realmURL) =>
      realmURL.endsWith('/catalog/'),
    );
  }

  protected async run(
    input: BaseCommandModule.GenerateThemeInput,
  ): Promise<BaseCommandModule.GenerateThemeResult> {
    const cardAPI = await this.loadCardAPI();

    const styleName = this.ensureString((input as any).styleName);
    if (!styleName) {
      throw new Error('`styleName` is required.');
    }

    const themeType = this.parseThemeType(
      this.ensureString((input as any).themeType),
    );

    const targetRealm =
      this.ensureString((input as any).targetRealm) ||
      this.catalogRealm ||
      this.realm.defaultWritableRealm?.path;
    if (!targetRealm) {
      throw new Error('Could not resolve a target realm for the theme card.');
    }

    const visualDNA = this.ensureString((input as any).visualDNA) ?? undefined;
    const inspirations =
      this.ensureStringArray((input as any).inspirations) ?? [];
    const existingNames =
      this.ensureStringArray((input as any).existingStyles) ?? [];
    const slugOverride = this.ensureString((input as any).slug);
    const llmModel = this.ensureString((input as any).llmModel) ?? undefined;

    const context: GenerationContext = {
      styleName,
      visualDNA,
      inspirations,
      themeType,
    };

    const generatedAttributes = await this.generateAttributesFromLlm(
      context,
      existingNames,
      llmModel,
    );

    const slug = slugOverride ?? this.slugify(styleName);
    const cardId = this.resolveCatalogURL(
      targetRealm,
      `${this.themeDirectory(themeType)}/${slug}`,
    );

    await this.ensureIdAvailable(cardId);

    const doc = this.buildThemeCardDoc(cardId, themeType, generatedAttributes);
    const themeCard = await this.store.add<CardDef>(doc, {
      realm: targetRealm,
      doNotWaitForPersist: true,
    });
    if (!isCardInstance(themeCard)) {
      throw new Error('Failed to create the theme card.');
    }

    const localId = themeCard[cardAPI.localId] || themeCard.id;
    if (localId) {
      await this.operatorModeStateService.openCardInInteractMode(localId);
    }

    const commandModule = await this.loadCommandModule();
    const { GenerateThemeResult } = commandModule;
    return new GenerateThemeResult({ themeCard });
  }

  private parseThemeType(raw: string | null): ThemeType {
    const normalized = raw?.toLowerCase().trim();
    if (
      normalized === 'structured-theme' ||
      normalized === 'brand-guide' ||
      normalized === 'style-reference'
    ) {
      return normalized;
    }
    return 'style-reference';
  }

  private themeDirectory(themeType: ThemeType): string {
    switch (themeType) {
      case 'structured-theme':
        return 'StructuredTheme';
      case 'brand-guide':
        return 'BrandGuide';
      default:
        return 'StyleReference';
    }
  }

  private async ensureIdAvailable(cardId: string) {
    try {
      await this.store.get(cardId);
      throw new Error(
        `A card already exists at ${cardId}. Choose a different style name or override the slug.`,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        /404|not found/i.test(error.message || '')
      ) {
        return;
      }
      if (error instanceof Error) {
        throw error;
      }
    }
  }

  private async generateAttributesFromLlm(
    context: GenerationContext,
    existingNames: string[],
    llmModel?: string,
  ): Promise<Record<string, unknown>> {
    const oneShot = new OneShotLlmRequestCommand(this.commandContext);

    const systemPrompt = this.buildSystemPrompt(context.themeType);
    const userPrompt = this.buildUserPrompt(context, existingNames);

    const result = await oneShot.execute({
      systemPrompt,
      userPrompt,
      llmModel: llmModel || 'anthropic/claude-3-5-sonnet',
    });
    const rawOutput =
      (Array.isArray(result.output)
        ? result.output.join('\n')
        : result.output) ?? '';
    const parsed = this.parseJson(rawOutput);
    if (!parsed) {
      throw new Error('The language model did not return valid JSON.');
    }
    return this.normalizeAttributes(parsed, context);
  }

  private buildSystemPrompt(themeType: ThemeType) {
    const baseRules = `You are Boxel's design systems assistant.
You must return JSON representing the attributes for a ${themeType.replace('-', ' ')} card.

Rules:
- Respond with valid JSON only (no markdown fences or commentary).
- Use lowercase hex or OKLCH color values for CSS tokens.
- Provide at least 3 wallpaper/hero image URLs sized for hero backgrounds (Unsplash or similar licenses).
- Provide at least one Google Fonts CSS import.
- Keep typography values realistic (font sizes with px, line-heights as unitless or rem, tracking as em where appropriate).
- Ensure the JSON matches the expected fields for the target card type.`;

    if (themeType === 'brand-guide') {
      return `${baseRules}
- Include brandColorPalette entries (name + hex value).
- Provide functionalPalette, typography, spacing, cornerRadius, and markUsage blocks.
- Populate cssVariables if they can be derived from provided palettes.`;
    }

    if (themeType === 'structured-theme') {
      return `${baseRules}
- Provide rootVariables and darkModeVariables with complete token coverage (background, foreground, primary, etc.).
- Include cssImports when fonts are referenced.
- Populate cardInfo (title, description, notes, thumbnailURL).`;
    }

    return `${baseRules}
- Include inspirations, visualDNA, wallpaperImages, cssImports, cardInfo, rootVariables, and darkModeVariables.`;
  }

  private buildUserPrompt(
    context: GenerationContext,
    existingNames: string[],
  ): string {
    const inspirationText = context.inspirations.length
      ? context.inspirations.join(', ')
      : 'None provided (propose 3 reference sources).';
    const visualDNA =
      context.visualDNA ??
      'No visual DNA provided. Propose a concise 1-2 sentence description that captures the core aesthetic.';
    const existing = existingNames.length ? existingNames.join(', ') : 'None';

    return `Theme Type: ${context.themeType}
Theme Name: ${context.styleName}
Visual DNA: ${visualDNA}
Inspirations: ${inspirationText}
Existing Theme Names (avoid duplicates): ${existing}

Return JSON containing the attributes for the requested theme card. Do not wrap the response in "data" or include relationships.`;
  }

  private parseJson(output: string): unknown {
    const text = this.stripCodeFences(output).trim();
    if (!text) {
      return undefined;
    }
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  }

  private stripCodeFences(text: string): string {
    if (text.startsWith('```')) {
      return text.replace(/^```[a-zA-Z0-9-]*\n?/, '').replace(/```$/, '');
    }
    return text;
  }

  private normalizeAttributes(
    raw: unknown,
    context: GenerationContext,
  ): Record<string, unknown> {
    const record =
      raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const attributes = (record.attributes as Record<string, unknown>) ?? {
      ...record,
    };

    if (!this.ensureString(attributes.styleName)) {
      attributes.styleName = context.styleName;
    }

    if (context.visualDNA && !this.ensureString(attributes.visualDNA)) {
      attributes.visualDNA = context.visualDNA;
    }

    if (
      context.inspirations.length &&
      !this.ensureStringArray(attributes.inspirations)
    ) {
      attributes.inspirations = context.inspirations;
    }

    this.ensureCardInfo(attributes, context.styleName);

    return attributes;
  }

  private ensureCardInfo(
    attributes: Record<string, unknown>,
    styleName: string,
  ) {
    const cardInfo =
      (attributes.cardInfo as Record<string, unknown>) ??
      (attributes.cardInfo = {});
    if (!this.ensureString(cardInfo.title)) {
      cardInfo.title = styleName;
    }
    if (!this.ensureString(cardInfo.description)) {
      cardInfo.description = `Auto-generated theme for ${styleName}.`;
    }
  }

  private buildThemeCardDoc(
    cardId: string,
    themeType: ThemeType,
    attributes: Record<string, unknown>,
  ): LooseSingleCardDocument {
    return {
      data: {
        id: cardId,
        type: 'card',
        meta: {
          adoptsFrom: THEME_TYPE_DEFINITIONS[themeType],
        },
        attributes,
      },
    };
  }

  private resolveCatalogURL(realm: string, path: string): string {
    return new URL(path, realm.endsWith('/') ? realm : `${realm}/`).href;
  }

  private ensureString(value: unknown): string | null {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length ? trimmed : null;
    }
    return null;
  }

  private ensureStringArray(value: unknown): string[] | null {
    if (!value) {
      return null;
    }
    if (Array.isArray(value)) {
      const arr = value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean);
      return arr.length ? arr : null;
    }
    if (typeof value === 'string') {
      const arr = value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean);
      return arr.length ? arr : null;
    }
    return null;
  }

  private slugify(value: string) {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/--+/g, '-');
  }
}
