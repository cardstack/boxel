import {
  CardDef,
  Component,
  contains,
  field,
  realmInfo,
  realmURL,
} from 'https://cardstack.com/base/card-api';
import RealmField from 'https://cardstack.com/base/realm';
import MarkdownField from 'https://cardstack.com/base/markdown';
import NumberField from 'https://cardstack.com/base/number';
import { Button, RealmIcon } from '@cardstack/boxel-ui/components';
import { copyCardURLToClipboard } from '@cardstack/boxel-ui/helpers';
import StatusIndicator from './components/status-indicator';
import { Copy as CopyIcon } from '@cardstack/boxel-ui/icons';
import Wand from '@cardstack/boxel-icons/wand';
import { type Query } from '@cardstack/runtime-common';
import ThemeCodeRefField from './fields/theme-code-ref';
import PaginatedCards from './components/paginated-cards';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import {
  AskAiForCardJsonCommand,
  CreateExampleCardCommand,
} from '@cardstack/boxel-host/commands/generate-example-cards';
import { task } from 'ember-concurrency';
import type { TaskInstance } from 'ember-concurrency';
import { tracked } from '@glimmer/tracking';

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

  @tracked generationRuns: Array<{
    label: string;
    instance: TaskInstance<CardDef | undefined>;
  }> = [];

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
      let path = url.pathname;
      let realmUrl = this.realmURLFor(card);
      if (realmUrl) {
        let realmPath = realmUrl.pathname.replace(/\/+$/, '');
        if (
          realmPath &&
          path.startsWith(realmPath) &&
          (path.length === realmPath.length ||
            path.charAt(realmPath.length) === '/')
        ) {
          path = path.slice(realmPath.length);
        }
      }
      let normalizedPath = path.replace(/^\/+/, '');
      if (!normalizedPath) {
        normalizedPath = '/';
      }
      return normalizedPath;
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

    let prompt =
      typeof this.args.model.prompt === 'string'
        ? this.args.model.prompt.trim()
        : null;

    let askCommand = new AskAiForCardJsonCommand(commandContext);
    let payloadResult = await askCommand.execute({
      codeRef,
      realm,
      prompt: prompt ?? undefined,
    });

    let createCommand = new CreateExampleCardCommand(commandContext);
    let result = await createCommand.execute({
      codeRef,
      realm,
      payload: payloadResult.payload,
    });

    //returning id. Maybe we want to return card?
    return result.createdCard;
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
              <card.component />
              <div class='theme-creator__card-actions'>
                <Button @kind='secondary-light' @size='small'>
                  <Wand width='14' height='14' />
                </Button>
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
        align-items: center;
        gap: var(--boxel-sp-xs);
        justify-content: center;
        margin-top: auto;
      }
    </style>
  </template>
}

export class ThemeCreator extends CardDef {
  static displayName = 'Theme Creator';

  @field prompt = contains(MarkdownField);
  @field realm = contains(RealmField);
  @field codeRef = contains(ThemeCodeRefField);
  @field numberOfVariants = contains(NumberField);

  static isolated = Isolated;
}
