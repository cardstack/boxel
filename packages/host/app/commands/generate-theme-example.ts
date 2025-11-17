import { service } from '@ember/service';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

import { skillCardURL } from '../lib/utils';

import {
  buildAttachedFileURLs,
  buildExamplePrompt,
  ONE_SHOT_SYSTEM_PROMPT,
  parseExamplePayloadFromOutput,
} from './example-card-helpers';
import { createExampleInstanceFromPayload } from './generate-example-cards';
import OneShotLlmRequestCommand from './one-shot-llm-request';

import type RealmService from '../services/realm';
import type StoreService from '../services/store';

export default class GenerateThemeExampleCommand extends HostBaseCommand<
  typeof BaseCommandModule.GenerateThemeExampleInput,
  typeof BaseCommandModule.CreateInstanceResult
> {
  @service declare private store: StoreService;
  @service declare private realm: RealmService;

  static actionVerb = 'Create Theme Example';

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { GenerateThemeExampleInput } = commandModule;
    return GenerateThemeExampleInput;
  }

  protected async run(
    input: BaseCommandModule.GenerateThemeExampleInput,
  ): Promise<BaseCommandModule.CreateInstanceResult> {
    if (!input.codeRef) {
      throw new Error('codeRef is required to create a card');
    }
    const realm = input.realm || this.realm.defaultWritableRealm?.path;
    if (!realm) {
      throw new Error('realm is required to create a card');
    }

    // Build the prompt and attachments for the LLM
    const promptSections = [buildExamplePrompt(1, input.codeRef)];
    if (input.prompt && input.prompt.trim().length) {
      promptSections.push(input.prompt.trim());
    }
    let guidance = this.guidanceForCodeRef(input.codeRef);
    if (guidance) {
      promptSections.push(guidance);
    }
    const userPrompt = promptSections.join('\n\n');
    const llmModel = input.llmModel || 'anthropic/claude-3-haiku';
    const attachedFileURLs = input.codeRef.module
      ? buildAttachedFileURLs(input.codeRef.module)
      : [];
    const skillCardIds = Array.from(
      new Set(
        [
          skillCardURL('theme-design'),
          ...(Array.isArray(input.skillCardIds) ? input.skillCardIds : []),
        ].filter(Boolean),
      ),
    );

    const oneShot = new OneShotLlmRequestCommand(this.commandContext);
    const llmResult = await oneShot.execute({
      codeRef: input.codeRef,
      systemPrompt: ONE_SHOT_SYSTEM_PROMPT,
      userPrompt,
      llmModel,
      attachedFileURLs: attachedFileURLs.length ? attachedFileURLs : undefined,
      skillCardIds,
    });

    const { payload: examplePayload } = parseExamplePayloadFromOutput(
      llmResult.output,
    );
    if (!examplePayload) {
      throw new Error('LLM did not return a valid JSON example payload');
    }

    const createdCard = await createExampleInstanceFromPayload({
      codeRef: input.codeRef,
      examplePayload: examplePayload as Record<string, unknown>,
      realm,
      store: this.store,
      defaultRealm: this.realm.defaultWritableRealm?.path,
      localDir: input.localDir ?? null,
    });

    if (!createdCard) {
      throw new Error('Failed to create theme example card');
    }

    let commandModule = await this.loadCommandModule();
    const { CreateInstanceResult } = commandModule;
    return new CreateInstanceResult({
      createdCard: createdCard as CardDef,
    });
  }

  private guidanceForCodeRef(codeRef: { module?: string | URL | null } | null) {
    let moduleString = codeRef?.module?.toString() ?? '';
    if (moduleString.includes('style-reference')) {
      return this.styleReferenceGuidance();
    }
    if (moduleString.includes('brand-guide')) {
      return this.brandGuideGuidance();
    }
    if (moduleString.includes('structured-theme')) {
      return this.structuredThemeGuidance();
    }
    return null;
  }

  private structuredThemeGuidance(): string {
    return [
      'Structured Theme guidance: emit cssVariables with :root, .dark, and an `@theme inline` mapping back to Boxel tokens.',
      'Keep palette, typography, spacing, radius, chart, sidebar, and shadow tokens cohesive across light/dark with OKLCH or Hex values that meet AA contrast.',
      'Mirror values in `rootVariables` and `darkModeVariables`; use `var(--token, fallback)` and include remote fonts in `cssImports`.',
    ].join('\n');
  }

  private styleReferenceGuidance(): string {
    return [
      'Style Reference guidance: describe the vibe via `styleName`, `visualDNA`, inspirations, wallpapers, and card metadata while carrying structured theme tokens.',
      'Maintain cohesive light/dark palettes, typography, spacing, radius, and shadows with OKLCH or Hex values that satisfy AA contrast.',
      'Emit `cssVariables` with :root, .dark, and `@theme inline` mappings that match variable maps; prefer `var(--token, fallback)` and include remote fonts in `cssImports`.',
    ].join('\n');
  }

  private brandGuideGuidance(): string {
    return [
      'Brand Guide guidance: convey brand essence via `styleName`, `visualDNA`, inspirations, wall imagery, and marks/typography/palettes.',
      'Populate marks, typography, palette, and semantic colors with cohesive OKLCH or Hex values that preserve AA contrast across light/dark.',
      'Emit `cssVariables` covering :root, .dark, and `@theme inline` mappings; use `var(--token, fallback)` and capture fonts inside `cssImports`.',
    ].join('\n');
  }
}
