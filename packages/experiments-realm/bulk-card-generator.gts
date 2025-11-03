import {
  CardDef,
  Component,
  contains,
  field,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import StringField from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown';
import RealmField from 'https://cardstack.com/base/realm';
import CodeRefField from 'https://cardstack.com/base/code-ref';
import {
  Button,
  FieldContainer,
  GridContainer,
} from '@cardstack/boxel-ui/components';
import { not } from '@cardstack/boxel-ui/helpers';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import GenerateCardsBulkCommand from '@cardstack/boxel-host/commands/generate-cards-bulk';
import {
  codeRefWithAbsoluteURL,
  type ResolvedCodeRef,
  type Query,
} from '@cardstack/runtime-common';

export class BulkCardGenerator extends CardDef {
  static displayName = 'Bulk Card Generator';

  @field targetRealmUrl = contains(RealmField);
  @field codeRef = contains(CodeRefField);
  @field count = contains(NumberField);
  @field localDir = contains(StringField);
  @field llmModel = contains(StringField);
  @field prompt = contains(MarkdownField);
}

class BulkCardGeneratorIsolated extends Component<typeof BulkCardGenerator> {
  @tracked isGenerating = false;
  @tracked progressStep:
    | 'idle'
    | 'requesting-payload'
    | 'writing-cards'
    | 'completed'
    | 'error' = 'idle';
  @tracked errorMessage: string | null = null;
  @tracked generatedCardIds: string[] = [];
  @tracked private totalResults = 0;
  @tracked private currentPage = 0;
  private readonly pageSize = 12;
  private previousQueryKey: string | undefined;

  get codeRef() {
    return this.args.model.codeRef;
  }

  get countValue() {
    return this.args.model.count ?? 0;
  }

  get localDirValue() {
    return this.args.model.localDir?.trim() ?? '';
  }

  get recentRealms(): string[] {
    let realm = this.args.model.targetRealmUrl;
    return realm ? [realm] : [];
  }

  get recentCardsQuery(): Query | undefined {
    let resolvedRef = this.resolveCodeRefForPrompt();
    if (!resolvedRef) {
      this.previousQueryKey = undefined;
      return undefined;
    }
    let realm = this.args.model.targetRealmUrl ?? '';
    let key = `${resolvedRef.module}#${resolvedRef.name ?? 'default'}|${realm}`;
    if (this.previousQueryKey !== key) {
      this.previousQueryKey = key;
      this.currentPage = 0;
      this.totalResults = 0;
    }
    const query: Query = {
      filter: {
        type: resolvedRef,
      },
      sort: [
        {
          by: 'createdAt',
          direction: 'desc',
        },
      ],
      page: {
        number: this.currentPage,
        size: this.pageSize,
      },
    };
    return query;
  }

  get totalPages(): number {
    return this.totalResults > 0
      ? Math.ceil(this.totalResults / this.pageSize)
      : 0;
  }

  get maxPageIndex(): number {
    return this.totalPages > 0 ? this.totalPages - 1 : 0;
  }

  get hasNextPage(): boolean {
    return this.currentPage < this.maxPageIndex;
  }

  get hasPreviousPage(): boolean {
    return this.currentPage > 0;
  }

  get hasPagination(): boolean {
    return this.totalResults > 0;
  }

  get currentPageDisplay(): number {
    return this.hasPagination ? this.currentPage + 1 : 0;
  }

  get statusMessage() {
    if (this.errorMessage) {
      return this.errorMessage;
    }
    if (this.isGenerating) {
      return this.progressStatusMessage;
    }
    if (this.generatedCardIds.length > 0) {
      return `Generated ${this.generatedCardIds.length} cards.`;
    }
    return 'Provide a code ref, count, and optional prompt, then click Generate.';
  }

  get progressStatusMessage() {
    switch (this.progressStep) {
      case 'requesting-payload':
        return 'Requesting bulk payload from AI...';
      case 'writing-cards':
        return 'Creating cards via atomic addMany...';
      case 'completed':
        return 'Generation complete!';
      case 'error':
        return 'Generation failed.';
      default:
        return 'Queued for generation...';
    }
  }

  get statusClass() {
    let classes = ['status-message'];
    if (this.errorMessage) {
      classes.push('status-message--error');
    } else if (this.generatedCardIds.length > 0) {
      classes.push('status-message--success');
    }
    return classes.join(' ');
  }

  isGeneratedCard = (cardId: unknown): boolean => {
    if (typeof cardId !== 'string') {
      return false;
    }
    let normalizedCardId = this.normalizeCardId(cardId);
    return this.generatedCardIds.some(
      (generatedId) =>
        typeof generatedId === 'string' &&
        this.normalizeCardId(generatedId) === normalizedCardId,
    );
  };

  private normalizeCardId(id: string): string {
    return id.endsWith('.json') ? id.slice(0, -5) : id;
  }

  get canGenerate() {
    if (this.isGenerating) {
      return false;
    }
    if (!this.args.model.targetRealmUrl) {
      return false;
    }
    if (!this.codeRef?.module) {
      return false;
    }
    if (!this.localDirValue) {
      return false;
    }
    if (this.countValue <= 0) {
      return false;
    }
    return true;
  }

  get disabledReason() {
    if (this.isGenerating) {
      return 'Generation in progress...';
    }
    if (!this.args.model.targetRealmUrl) {
      return 'Target realm is required.';
    }
    if (!this.codeRef?.module) {
      return 'Provide the code ref for the card definition.';
    }
    if (!this.localDirValue) {
      return 'Provide a directory name for generated cards.';
    }
    if (this.countValue <= 0) {
      return 'Count must be greater than zero.';
    }
    return null;
  }

  @action
  async generateBulk(event?: Event) {
    event?.preventDefault();
    if (!this.canGenerate) {
      return;
    }

    let commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      this.errorMessage =
        'Command context is not available. Open this card inside the host app.';
      return;
    }

    if (!this.codeRef) {
      this.errorMessage = 'Provide a card definition before generating.';
      return;
    }

    this.isGenerating = true;
    this.errorMessage = null;
    this.progressStep = 'requesting-payload';
    this.generatedCardIds = [];

    try {
      const command = new GenerateCardsBulkCommand(commandContext);
      const localDir = this.localDirValue;
      const prompt = this.composePrompt(this.args.model.prompt);

      const result = await command.execute({
        codeRef: this.codeRef,
        count: this.countValue,
        targetRealm: this.args.model.targetRealmUrl,
        ...(prompt ? { prompt } : {}),
        llmModel: this.args.model.llmModel,
        localDir,
      });

      this.progressStep = 'writing-cards';
      const cards = result.cards ?? [];
      this.generatedCardIds = cards
        .map((card) => card.id)
        .filter((id): id is string => typeof id === 'string');

      this.progressStep = 'completed';
    } catch (error) {
      this.errorMessage =
        error instanceof Error
          ? error.message
          : 'An unexpected error occurred during generation.';
      this.progressStep = 'error';
    } finally {
      this.isGenerating = false;
    }
  }

  private resolveCodeRefForPrompt(): ResolvedCodeRef | undefined {
    const ref = this.codeRef;
    if (!ref) {
      return undefined;
    }
    try {
      return codeRefWithAbsoluteURL(
        ref,
        this.args.model.targetRealmUrl
          ? new URL(this.args.model.targetRealmUrl)
          : undefined,
      ) as ResolvedCodeRef;
    } catch {
      return undefined;
    }
  }

  private composePrompt(userPrompt: string | undefined): string | undefined {
    const trimmedPrompt = userPrompt?.trim();
    return trimmedPrompt?.length ? trimmedPrompt : undefined;
  }

  @action private captureMeta(meta: any) {
    let total = Number(meta?.page?.total ?? 0);
    if (!Number.isFinite(total) || total < 0) {
      total = 0;
    }
    this.totalResults = total;
    if (this.currentPage > this.maxPageIndex) {
      this.currentPage = Math.max(0, this.maxPageIndex);
    }
    return undefined;
  }

  @action private goToPreviousPage() {
    if (this.hasPreviousPage) {
      this.currentPage -= 1;
    }
  }

  @action private goToNextPage() {
    if (this.hasNextPage) {
      this.currentPage += 1;
    }
  }

  <template>
    <article class='bulk-card-generator'>
      <GridContainer class='bulk-card-generator__form'>
        <FieldContainer @label='Target Realm'>
          <@fields.targetRealmUrl />
        </FieldContainer>
        <FieldContainer @label='Card Definition (code ref)'>
          <@fields.codeRef />
        </FieldContainer>
        <FieldContainer @label='Count'>
          <@fields.count />
        </FieldContainer>
        <FieldContainer @label='Directory Name (localDir)'>
          <@fields.localDir />
        </FieldContainer>
        <FieldContainer @label='LLM Model (optional)'>
          <@fields.llmModel />
        </FieldContainer>
        <FieldContainer @label='Prompt (optional details)'>
          <@fields.prompt />
        </FieldContainer>
      </GridContainer>
      {{#let this.recentCardsQuery as |recentQuery|}}
        {{#if recentQuery}}
          {{#if this.recentRealms.length}}
            <section class='bulk-card-generator__recent'>
              <div class='bulk-card-generator__section-header'>
                <h2>Recent cards in target realm</h2>
                <p>Newest instances of the selected card definition, sorted by
                  created date.</p>
                <p>Newly generated cards are highlighted.</p>
              </div>
              <@context.prerenderedCardSearchComponent
                @query={{recentQuery}}
                @format='embedded'
                @realms={{this.recentRealms}}
                @isLive={{true}}
              >
                <:loading><p class='bulk-card-generator__loading'>Loading recent
                    cards…</p></:loading>
                <:response as |cards|>
                  {{#if cards.length}}
                    <div class='bulk-card-generator__recent-grid'>
                      {{#each cards key='url' as |card|}}
                        <card.component
                          class={{if
                            (this.isGeneratedCard card.url)
                            'bulk-card-generator__recent-card bulk-card-generator__recent-card--new'
                            'bulk-card-generator__recent-card'
                          }}
                        />
                      {{/each}}
                    </div>
                  {{else}}
                    <p class='bulk-card-generator__empty'>No recent cards found.</p>
                  {{/if}}
                </:response>
                <:meta as |meta|>
                  {{this.captureMeta meta}}
                  {{#if this.hasPagination}}
                    <div class='bulk-card-generator__pagination'>
                      <Button
                        @kind='secondary'
                        @size='extra-small'
                        @disabled={{not this.hasPreviousPage}}
                        {{on 'click' this.goToPreviousPage}}
                      >
                        Previous
                      </Button>
                      <span class='bulk-card-generator__pagination-page'>
                        Page
                        {{this.currentPageDisplay}}
                        of
                        {{this.totalPages}}
                      </span>
                      <Button
                        @kind='secondary'
                        @size='extra-small'
                        @disabled={{not this.hasNextPage}}
                        {{on 'click' this.goToNextPage}}
                      >
                        Next
                      </Button>
                    </div>
                  {{/if}}
                </:meta>
              </@context.prerenderedCardSearchComponent>
            </section>
          {{/if}}
        {{/if}}
      {{/let}}

      <p class={{this.statusClass}}>
        {{this.statusMessage}}
      </p>

      <Button
        data-test-bulk-generate-button
        @disabled={{not this.canGenerate}}
        {{on 'click' this.generateBulk}}
      >
        {{if this.isGenerating 'Generating…' 'Generate'}}
      </Button>

      {{#if this.generatedCardIds.length}}
        <section class='bulk-card-generator__results'>
          <h2>Generated Card IDs</h2>
          <ul>
            {{#each this.generatedCardIds as |id|}}
              <li>{{id}}</li>
            {{/each}}
          </ul>
        </section>
      {{/if}}
    </article>

    <style scoped>
      .bulk-card-generator {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xl);
        padding: var(--boxel-sp-xl);
        background: var(--boxel-50);
        border-radius: var(--boxel-border-radius);
      }
      .bulk-card-generator__form {
        gap: var(--boxel-sp-lg);
      }
      .bulk-card-generator__section-header {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        margin-bottom: var(--boxel-sp-md);
      }
      .bulk-card-generator__section-header h2 {
        margin: 0;
        font-size: var(--boxel-font-size);
        font-weight: 600;
      }
      .bulk-card-generator__section-header p {
        margin: 0;
        color: var(--boxel-600);
        font-size: var(--boxel-font-size-sm);
      }
      .bulk-card-generator__recent {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-md);
      }
      .bulk-card-generator__recent-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: var(--boxel-sp-md);
      }
      .bulk-card-generator__recent-new {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
      }
      .bulk-card-generator__recent-new h3 {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        color: var(--boxel-700);
      }
      .bulk-card-generator__recent-card {
        height: 100%;
      }
      .bulk-card-generator__recent-card--new {
        outline: 2px solid var(--boxel-success);
        outline-offset: 2px;
      }
      .bulk-card-generator__loading,
      .bulk-card-generator__empty {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        color: var(--boxel-600);
      }
      .bulk-card-generator__results ul {
        margin: 0;
        padding-left: var(--boxel-sp-lg);
      }
      .status-message {
        margin: 0;
        font-size: var(--boxel-font-size);
      }
      .status-message--error {
        color: var(--boxel-danger);
      }
      .status-message--success {
        color: var(--boxel-success);
      }
    </style>
  </template>
}

BulkCardGenerator.isolated = BulkCardGeneratorIsolated;
