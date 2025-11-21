import {
  CardDef,
  Component,
  contains,
  field,
  linksToMany,
  linksTo,
  realmInfo,
  realmURL,
} from 'https://cardstack.com/base/card-api';
import RealmField from 'https://cardstack.com/base/realm';
import MarkdownField from 'https://cardstack.com/base/markdown';
import NumberField from 'https://cardstack.com/base/number';
import { Skill } from 'https://cardstack.com/base/skill';
import LLMModelField from 'https://cardstack.com/base/llm-model';
import { Alert, Button, RealmIcon } from '@cardstack/boxel-ui/components';
import { copyCardURLToClipboard } from '@cardstack/boxel-ui/helpers';
import { Copy as CopyIcon } from '@cardstack/boxel-ui/icons';
import Wand from '@cardstack/boxel-icons/wand';
import Eye from '@cardstack/boxel-icons/eye';
import SourceCode from '@cardstack/boxel-icons/source-code';
import { RealmPaths, type Query } from '@cardstack/runtime-common';
const DEFAULT_LLM = 'anthropic/claude-3.5-sonnet';
import {
  BRAND_GUIDE_TEMPLATE,
  STRUCTURED_THEME_TEMPLATE,
  STYLE_REFERENCE_TEMPLATE,
  THEME_TEMPLATE,
} from './theme-templates';
import ThemeCodeRefField from '../fields/theme-code-ref';
import StatusIndicator from '../components/status-indicator';
import PaginatedCards from '../components/paginated-cards';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { task } from 'ember-concurrency';
import type { TaskInstance } from 'ember-concurrency';
import { tracked } from '@glimmer/tracking';
import GenerateThemeExampleCommand from '@cardstack/boxel-host/commands/generate-theme-example';
import PatchThemeCommand from '@cardstack/boxel-host/commands/patch-theme';
import SwitchSubmodeCommand from '@cardstack/boxel-host/commands/switch-submode';

class Isolated extends Component<typeof ThemeCreator> {
  get canGenerate() {
    return Boolean(this.args.model.realm && this.args.model.codeRef);
  }

  get isGenerateDisabled() {
    return !this.canGenerate;
  }

  get selectedRealm(): string | null {
    let realm = this.args.model.realm;
    if (typeof realm !== 'string') {
      return null;
    }
    let trimmed = realm.trim();
    return trimmed.length ? trimmed : null;
  }

  get codeRefSelection() {
    let ref = this.args.model.codeRef;
    if (ref && ref.module && ref.name) {
      return ref;
    }
    return null;
  }

  get generatedCardsRealms(): string[] {
    return this.selectedRealm ? [this.selectedRealm] : [];
  }

  get generatedCardsQuery(): Query | undefined {
    let ref = this.codeRefSelection;
    if (!ref) {
      return undefined;
    }
    return {
      filter: {
        type: {
          module: ref.module,
          name: ref.name,
        },
      },
      sort: [
        {
          by: 'createdAt',
          direction: 'desc',
        },
      ],
    };
  }

  get canShowGeneratedCards(): boolean {
    return Boolean(
      this.generatedCardsQuery && this.generatedCardsRealms.length,
    );
  }

  get generatedCardsHint(): string {
    if (!this.selectedRealm && !this.codeRefSelection) {
      return 'Select a realm and theme type to preview matching cards.';
    }
    if (!this.selectedRealm) {
      return 'Select a realm to preview cards.';
    }
    if (!this.codeRefSelection) {
      return 'Select a theme type to preview cards.';
    }
    return 'Update the selections above to preview cards.';
  }

  private moduleMatches(
    codeRef: { module?: string | URL | null } | null,
    fragment: string,
  ): boolean {
    let moduleSpecifier = codeRef?.module;
    if (!moduleSpecifier) {
      return false;
    }
    let moduleString =
      typeof moduleSpecifier === 'string'
        ? moduleSpecifier
        : moduleSpecifier.toString();
    return moduleString.includes(fragment);
  }

  get themeType():
    | 'brand-guide'
    | 'style-reference'
    | 'structured-theme'
    | 'theme'
    | null {
    let ref = this.codeRefSelection;
    if (this.moduleMatches(ref, 'base/theme')) {
      return 'theme';
    }
    if (this.moduleMatches(ref, 'brand-guide')) {
      return 'brand-guide';
    }
    if (this.moduleMatches(ref, 'style-reference')) {
      return 'style-reference';
    }
    if (this.moduleMatches(ref, 'structured-theme')) {
      return 'structured-theme';
    }
    return null;
  }

  get structuredThemeGuidancePrompt(): string {
    return [
      // 'Structured Theme guidance: produce JSON matching the template, with `cssVariables` that include :root, .dark, and an `@theme inline` mapping back to Boxel tokens.',
      // 'Keep palette, typography, spacing, radius, chart, sidebar, and shadow tokens cohesive across light/dark with OKLCH or Hex values that meet AA contrast.',
      // 'Mirror those values in `rootVariables` and `darkModeVariables` so tooling can diff tokens without parsing CSS.',
      // 'Use `var(--token, fallback)` when referencing custom properties and add remote fonts via `cssImports` as needed.',
      'Sample serialized JSON:',
      STRUCTURED_THEME_TEMPLATE,
    ].join('\n');
  }

  get styleReferenceGuidance(): string {
    return [
      // 'Style Reference guidance: keep `styleName`, `visualDNA`, and `cardInfo.description` concise, and align inspirations/wallpaper images to the intended vibe.',
      // 'Maintain cohesive light/dark palettes, typography, spacing, radius, and shadows with OKLCH or Hex values that satisfy AA contrast.',
      // 'Emit `cssVariables` with :root, .dark, and `@theme inline` mappings that match the variable maps; prefer `var(--token, fallback)` and include remote fonts in `cssImports`.',
      'Sample serialized JSON:',
      STYLE_REFERENCE_TEMPLATE,
      '',
      'Structured Theme details:',
      this.structuredThemeGuidancePrompt,
    ].join('\n');
  }

  get brandGuideGuidance(): string {
    return [
      // 'Brand Guide guidance: convey brand essence through `styleName`, `visualDNA`, and `cardInfo.description`, with inspirations and wall imagery that reinforce the system.',
      // 'Populate marks, typography, palette, and semantic colors per the template using cohesive OKLCH or Hex values that preserve AA contrast across light/dark.',
      // 'Emit `cssVariables` covering :root, .dark, and `@theme inline` mappings that mirror the variable maps; use `var(--token, fallback)` and capture fonts inside `cssImports`.',
      'Sample serialized JSON:',
      BRAND_GUIDE_TEMPLATE,
      '',
      'Style Reference details:',
      this.styleReferenceGuidance,
    ].join('\n');
  }

  get themeGuidance(): string {
    return [
      // 'Theme guidance: provide :root, .dark, and `@theme inline` blocks that map back to Boxel tokens while keeping cssImports limited to required fonts.',
      'Sample serialized JSON:',
      THEME_TEMPLATE,
    ].join('\n');
  }

  promptGuidanceFor(): string {
    switch (this.themeType) {
      case 'theme':
        return this.themeGuidance;
      case 'style-reference':
        return this.styleReferenceGuidance;
      case 'brand-guide':
        return this.brandGuideGuidance;
      case 'structured-theme':
        return this.structuredThemeGuidancePrompt;
      default:
        console.error('No prompt guidance for theme type:', this.themeType);
        return '';
    }
  }

  themePrompt(): string | null {
    switch (this.themeType) {
      case 'theme':
        return 'Generate a theme. This is a base theme card.';
      case 'brand-guide':
        return 'Generate a theme. This is a brand guide theme.';
      case 'style-reference':
        return 'Generate a theme. This is a style reference theme.';
      case 'structured-theme':
        return 'Generate a theme. This is a structured theme.';
      default:
        return null;
    }
  }

  @tracked generationRuns: Array<{
    label: string;
    instance: TaskInstance<CardDef | undefined>;
  }> = [];
  @tracked previewThemeId: string | null = null;

  previewThemeResource = this.args.context?.getCard(
    this,
    () => this.previewThemeId ?? undefined,
  );

  previewCardResource = this.args.context?.getCard(
    this,
    () => (this.args.model?.previewCard as CardDef | null | undefined)?.id,
  );

  previewTheme = (cardId?: string | null) => {
    if (!cardId) {
      return;
    }
    this.previewThemeId = cardId;
    let previewCard = this.args.model?.previewCard as
      | CardDef
      | null
      | undefined;
    if (!previewCard) {
      return;
    }
    let view = this.args.viewCard;
    if (typeof view !== 'function') {
      return;
    }
    try {
      let themeCard =
        (this.previewThemeResource?.card as CardDef | null | undefined) ?? null;
      let themeValue: CardDef | null = themeCard;
      (previewCard as any).cardInfo.theme = themeValue;
      view(previewCard, 'isolated', { stackIndex: 1 });
    } catch (error) {
      console.error('Failed to preview theme on card', error);
    }
  };

  realmInfoFor = (card?: CardDef | null) => {
    if (!card) {
      return null;
    }
    return card[realmInfo] ?? null;
  };

  realmURLFor = (card?: CardDef | null): URL | null => {
    if (!card) {
      return null;
    }
    let cardRealmURL = card[realmURL];
    if (!cardRealmURL) {
      return null;
    }
    if (cardRealmURL instanceof URL) {
      return cardRealmURL;
    }
    try {
      return new URL(cardRealmURL as unknown as string);
    } catch {
      return null;
    }
  };

  cardURLFrom = (card?: CardDef | null): string | null => {
    if (!card) {
      return null;
    }
    let cardId = card.id;
    return typeof cardId === 'string' ? cardId : null;
  };

  normalizedCardId = (card?: CardDef | null): string | null => {
    let urlString = this.cardURLFrom(card);
    if (!urlString) {
      return null;
    }
    try {
      let url = new URL(urlString);
      let realmUrl = this.realmURLFor(card);
      if (realmUrl) {
        try {
          let localPath = new RealmPaths(realmUrl).local(url);
          return localPath || '/';
        } catch {
          // fall back to default handling below
        }
      }

      let path = url.pathname.replace(/^\/+/, '');
      return path || '/';
    } catch {
      return urlString;
    }
  };

  copyCardURL = async (card?: CardDef | null) => {
    let url = this.cardURLFrom(card);
    if (!url) {
      return;
    }
    try {
      await copyCardURLToClipboard(url);
    } catch (error) {
      console.error('Failed to copy card URL', error);
    }
  };

  openCardInCodeMode = (id?: string | null) => {
    if (!id) {
      return;
    }
    let commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      return;
    }
    try {
      new SwitchSubmodeCommand(commandContext).execute({
        submode: 'code',
        codePath: id,
      });
    } catch (error) {
      console.error('Failed to open card in code mode', error);
    }
  };

  errorMessageFor = (
    instance?: TaskInstance<CardDef | undefined> | null,
  ): string => {
    let error = instance?.error;
    if (!error) {
      return 'Theme generation failed. Try again.';
    }
    if (typeof error === 'string') {
      return error;
    }
    if (error instanceof Error && error.message) {
      return error.message;
    }
    if (typeof error === 'object') {
      try {
        return JSON.stringify(error);
      } catch {
        return '[unserializable error]';
      }
    }
    return String(error);
  };

  errorMessagesFor = (
    instance?: TaskInstance<CardDef | undefined> | null,
  ): string[] => {
    return [this.errorMessageFor(instance)];
  };

  get cardPreviewErrorMessages(): string[] {
    return ['Failed to load this card preview.'];
  }

  get variantCount(): number {
    let count = Number(this.args.model.numberOfVariants);
    if (!Number.isFinite(count) || count < 1) {
      return 1;
    }
    return Math.floor(count);
  }

  get generateButtonLabel(): string {
    return this.generateThemesTask.isRunning ? 'Generating…' : 'Generate';
  }

  get isGenerateButtonDisabled(): boolean {
    return this.isGenerateDisabled || this.generateThemesTask.isRunning;
  }

  generateThemeTask = task(async () => {
    if (!this.canGenerate) {
      return;
    }
    let commandContext = this.args.context?.commandContext;
    let codeRef = this.codeRefSelection;
    let realm = this.selectedRealm;
    if (!commandContext || !codeRef || !realm) {
      console.error(
        'Theme generation requires command context, realm, and codeRef.',
      );
      return;
    }

    let userPrompt =
      typeof this.args.model.prompt === 'string'
        ? this.args.model.prompt.trim()
        : null;
    let promptSections: string[] = [];
    let intent = this.themePrompt();
    if (intent) {
      promptSections.push(`Intent:\n${intent}`);
    }
    if (userPrompt?.length) {
      promptSections.push(`User request:\n${userPrompt}`);
    }
    let guidancePrompt = this.promptGuidanceFor().trim();
    if (guidancePrompt.length) {
      promptSections.push(`Guidance:\n${guidancePrompt}`);
    }
    let combinedPrompt = promptSections.join('\n\n');
    let skillCardIds =
      Array.isArray(this.args.model.skillCards) &&
      this.args.model.skillCards.length
        ? this.args.model.skillCards
            .map((card: Skill | string | null | undefined) => {
              if (typeof card === 'string') {
                return card.trim();
              }
              let id = card?.id;
              return typeof id === 'string' ? id.trim() : null;
            })
            .filter((id): id is string => Boolean(id && id.length))
        : undefined;

    let llmModel =
      typeof this.args.model.llmModel === 'string' &&
      this.args.model.llmModel.trim().length
        ? this.args.model.llmModel.trim()
        : DEFAULT_LLM;

    let createCommand = new GenerateThemeExampleCommand(commandContext);
    let result = await createCommand.execute({
      codeRef,
      realm,
      prompt: combinedPrompt || undefined,
      llmModel,
      skillCardIds,
    });
    let created = result.createdCard;
    if (created?.id) {
      try {
        this.args.viewCard?.(new URL(created.id), 'isolated');
      } catch (error) {
        console.error('Failed to view created card', error);
      }
    }
    return created;
  });

  patchThemeTask = task(async (card: CardDef | null | string | undefined) => {
    let commandContext = this.args.context?.commandContext;
    let cardId =
      typeof card === 'string'
        ? card
        : card
        ? this.cardURLFrom(card as CardDef)
        : null;

    if (!commandContext || !cardId) {
      return;
    }

    let linkedSkills =
      Array.isArray(this.args.model.skillCards) &&
      this.args.model.skillCards.length
        ? this.args.model.skillCards
        : [];
    let linkedSkill =
      (linkedSkills.find(
        (s: Skill | string | null | undefined): s is Skill =>
          typeof s === 'object' && s !== null && 'id' in s,
      ) as Skill | undefined) ?? undefined;

    if (cardId) {
      try {
        this.args.viewCard?.(new URL(cardId), 'isolated');
      } catch (error) {
        console.error('Failed to view card', error);
      }
    }

    let patchTheme = new PatchThemeCommand(commandContext);
    await patchTheme.execute({
      cardId,
      skillCard: linkedSkill,
    });
  });

  generateThemesTask = task(async () => {
    if (!this.canGenerate) {
      return;
    }

    let runs = Array.from({ length: this.variantCount }, (_, index) => {
      let instance = this.generateThemeTask.perform();
      return {
        label: `Variant ${index + 1}`,
        instance,
      };
    });
    this.generationRuns = runs;

    let results = await Promise.allSettled(runs.map((run) => run.instance));

    if (results.some((result) => result.status === 'rejected')) {
      console.error('One or more theme generations failed.');
    }
  });

  <template>
    <section class='theme-creator'>
      <header class='theme-creator__header'>
        <h2>Describe the theme you want to create</h2>
      </header>

      <div class='theme-creator__layout'>
        <div class='theme-creator__prompt-pane theme-creator__meta-field'>
          <label class='theme-creator__label'>Prompt</label>
          <p class='theme-creator__description'>
            Instruction to AI describing the type of theme (e.g., “a bold red
            festival kit”).
          </p>
          <@fields.prompt @format='edit' />
        </div>

        <aside class='theme-creator__meta-pane'>
          <div class='theme-creator__meta-field'>
            <label class='theme-creator__label'>Realm</label>
            <p class='theme-creator__description'>
              Where the generated theme card will be installed.
            </p>
            <@fields.realm @format='edit' />
          </div>

          <div class='theme-creator__meta-field'>
            <label class='theme-creator__label'>Code reference</label>
            <p class='theme-creator__description'>
              Choose the theme type you want to generate.
            </p>
            <@fields.codeRef @format='edit' />
          </div>

          <div class='theme-creator__meta-field'>
            <label class='theme-creator__label'>LLM model</label>
            <p class='theme-creator__description'>
              Choose the model used for theme generation.
            </p>
            <@fields.llmModel @format='edit' />
          </div>

          <div class='theme-creator__meta-field'>
            <label class='theme-creator__label'>Number of variants</label>
            <p class='theme-creator__description'>
              How many different generations to produce in one run.
            </p>
            <@fields.numberOfVariants @format='edit' />
          </div>
        </aside>
      </div>

      <div class='theme-creator__actions'>
        <Button
          @kind='primary'
          disabled={{this.isGenerateButtonDisabled}}
          {{on 'click' this.generateThemesTask.perform}}
        >
          {{this.generateButtonLabel}}
        </Button>
      </div>

      {{#if this.generationRuns.length}}
        <div class='theme-creator__progress-list'>
          {{#each this.generationRuns as |run|}}
            <div class='theme-creator__progress-item'>
              <div class='theme-creator__progress-labels'>
                <div class='theme-creator__progress-id'>
                  {{#if run.instance.value.id}}
                    {{#let
                      (this.realmInfoFor run.instance.value)
                      as |runRealmInfo|
                    }}
                      {{#if runRealmInfo}}
                        <RealmIcon
                          class='theme-creator__progress-realm-icon'
                          @realmInfo={{runRealmInfo}}
                        />
                      {{/if}}
                    {{/let}}
                    <span class='theme-creator__progress-id-text'>
                      {{this.normalizedCardId run.instance.value}}
                    </span>
                    <Button
                      @kind='secondary-light'
                      @size='extra-small'
                      class='theme-creator__copy-button'
                      aria-label='Copy card URL'
                      {{on 'click' (fn this.copyCardURL run.instance.value)}}
                    >
                      <CopyIcon width='12' height='12' />
                    </Button>
                  {{else}}
                    <span class='theme-creator__progress-id-text'>
                      {{run.label}}
                    </span>
                  {{/if}}
                </div>
                <div class='theme-creator__progress-actions'>
                  {{#if run.instance.isError}}
                    <Alert @type='error' as |Alert|>
                      <Alert.Messages
                        @messages={{this.errorMessagesFor run.instance}}
                      />
                    </Alert>
                  {{/if}}
                  <span class='theme-creator__progress-status'>
                    <StatusIndicator
                      @state={{if
                        run.instance.isRunning
                        'pending'
                        (if run.instance.isSuccessful 'success' 'error')
                      }}
                    />
                  </span>
                </div>
              </div>
            </div>
          {{/each}}
        </div>
      {{/if}}

      <section class='theme-creator__generated'>
        <div class='theme-creator__section-header'>
          <h2>Existing Theme Cards</h2>
          <p class='theme-creator__description'>
            Preview ALL theme cards in this realm.
          </p>
        </div>

        {{#if this.canShowGeneratedCards}}
          <PaginatedCards
            @query={{this.generatedCardsQuery}}
            @realms={{this.generatedCardsRealms}}
            @context={{@context}}
            as |card|
          >
            <div class='theme-creator__card-wrapper'>
              {{#if card.isError}}
                <Alert @type='error' as |Alert|>
                  <Alert.Messages @messages={{this.cardPreviewErrorMessages}} />
                </Alert>
              {{/if}}
              <card.component />
              <div class='theme-creator__card-actions'>
                <div class='theme-creator__card-actions-row'>
                  <Button
                    @kind='secondary-light'
                    @size='small'
                    aria-label='Preview theme on selected card'
                    {{on 'click' (fn this.previewTheme card.url)}}
                  >
                    <Eye width='14' height='14' />
                  </Button>
                  <Button
                    @kind='secondary-light'
                    @size='small'
                    aria-label='Open in code mode'
                    {{on 'click' (fn this.openCardInCodeMode card.url)}}
                  >
                    <SourceCode width='14' height='14' />
                  </Button>
                </div>
                <div class='theme-creator__card-actions-row'>
                  <Button
                    @kind='primary'
                    @size='small'
                    aria-label='Modify theme via AI'
                    {{on 'click' (fn this.patchThemeTask.perform card.url)}}
                  >
                    <Wand width='14' height='14' />
                  </Button>
                </div>
              </div>
            </div>
          </PaginatedCards>
        {{else}}
          <p class='theme-creator__hint'>{{this.generatedCardsHint}}</p>
        {{/if}}
      </section>
    </section>

    <style scoped>
      .theme-creator {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        padding: var(--boxel-sp-xl);
        border: 1px solid var(--boxel-200);
        border-radius: var(--boxel-border-radius);
        background: var(--boxel-0);
      }

      .theme-creator__header {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }

      .theme-creator__layout {
        display: grid;
        grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
        gap: var(--boxel-sp-xl);
      }

      .theme-creator__prompt-pane {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxs);
      }

      .theme-creator__meta-pane {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-md);
      }

      .theme-creator__meta-field {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxs);
        padding: var(--boxel-sp-sm);
        border: 1px solid var(--boxel-200);
        border-radius: var(--boxel-border-radius);
      }

      .theme-creator__label {
        font-size: var(--boxel-font-size);
        font-weight: 600;
      }

      .theme-creator__description {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        color: var(--boxel-500);
      }

      .theme-creator__actions {
        display: flex;
        gap: var(--boxel-sp-sm);
        align-items: center;
      }

      .theme-creator__generated {
        margin-top: var(--boxel-sp-lg);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-md);
      }

      .theme-creator__progress-list {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
        margin-top: var(--boxel-sp-md);
      }

      .theme-creator__progress-item {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-3xs);
        padding: var(--boxel-sp-sm);
        border: 1px solid var(--boxel-200);
        border-radius: var(--boxel-border-radius);
        background: var(--boxel-0);
      }

      .theme-creator__progress-labels {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: var(--boxel-font-size-sm);
        color: var(--boxel-600);
      }

      .theme-creator__progress-id {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
      }

      .theme-creator__progress-realm-icon {
        --boxel-realm-icon-size: var(--boxel-icon-xs);
        --boxel-realm-icon-border-color: var(--boxel-300);
        --boxel-realm-icon-background-color: var(--boxel-100);
      }

      .theme-creator__progress-id-text {
        display: inline-flex;
        align-items: center;
      }

      .theme-creator__progress-status {
        font-weight: 600;
      }

      .theme-creator__progress-actions {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }

      .theme-creator__copy-button {
        --boxel-button-min-width: auto;
        --boxel-button-padding: 0 var(--boxel-sp-xxs);
        border-color: transparent;
        color: var(--boxel-700);
      }

      .theme-creator__section-header {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxs);
        margin-bottom: var(--boxel-sp-lg);
      }

      .theme-creator__section-header h2 {
        margin: 0;
      }

      .theme-creator__section-header p,
      .theme-creator__hint {
        margin: 0;
        color: var(--boxel-600);
        font-size: var(--boxel-font-size-sm);
      }

      .theme-creator__card-wrapper {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        height: 100%;
        padding: var(--boxel-sp-sm);
        border: 1px solid var(--boxel-200);
        border-radius: var(--boxel-border-radius);
      }

      .theme-creator__card-actions {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        justify-content: center;
        margin-top: auto;
      }

      .theme-creator__card-actions-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }

      .theme-creator__card-actions-row > * {
        flex: 1;
      }
    </style>
  </template>
}

export class ThemeCreator extends CardDef {
  static displayName = 'Theme Creator';

  @field prompt = contains(MarkdownField);
  @field realm = contains(RealmField);
  @field codeRef = contains(ThemeCodeRefField);
  @field skillCards = linksToMany(Skill);
  @field numberOfVariants = contains(NumberField);
  @field llmModel = contains(LLMModelField);
  @field previewCard = linksTo(CardDef);

  static isolated = Isolated;
}
