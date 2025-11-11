import {
  CardDef,
  Component,
  contains,
  containsMany,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import RealmField from 'https://cardstack.com/base/realm';
import CodeRefField from 'https://cardstack.com/base/code-ref';
import MarkdownField from 'https://cardstack.com/base/markdown';
import StringField from 'https://cardstack.com/base/string';
import {
  Button,
  FieldContainer,
  GridContainer,
} from '@cardstack/boxel-ui/components';
import PaginatedCards from '../components/paginated-cards';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { task } from 'ember-concurrency';

import {
  codeRefWithAbsoluteURL,
  type CommandContext,
  type Query,
  type ResolvedCodeRef,
  type CommandInvocationStatus,
} from '@cardstack/runtime-common';

import { ModelConfiguration } from 'https://cardstack.com/base/system-card';
import {
  GenerateExamplePayloadResult,
  CreateExampleCardInput,
  CreateInstanceResult,
  AskAiForCardJsonInput,
} from 'https://cardstack.com/base/command';
import AccordionWorkflow from '../components/accordion-workflow';
import WorkflowProgress from '../components/workflow-progress';
import NotificationBubble from '../components/notification-bubble';
import {
  workflowResource,
  type WorkflowRunner,
} from '../resources/workflow-runner';
import { WorkflowStepField } from './workflow-step-field';

class AskAiForCardJsonWorkflowStepField extends WorkflowStepField {
  @field input = linksTo(AskAiForCardJsonInput);
  @field output = linksTo(GenerateExamplePayloadResult);
  @field localDir = contains(StringField);
  @field llmModelId = contains(StringField);
  @field prompt = contains(MarkdownField);
  @field exampleCard = linksTo(() => CardDef);
  @field buildArgs = linksTo(AskAiForCardJsonInput, {
    computeVia: function (this: AskAiForCardJsonWorkflowStepField) {
      if (this.input) {
        return this.input;
      }
      if (!this.codeRef?.module || !this.targetRealm) {
        return null;
      }

      let attrs: Record<string, unknown> = {
        codeRef: this.codeRef,
        realm: this.targetRealm,
      };

      if (this.exampleCard) {
        attrs.exampleCard = this.exampleCard;
      }

      if (this.prompt) {
        attrs.prompt = this.prompt;
      }

      if (this.llmModelId) {
        attrs.llmModel = this.llmModelId;
      }

      return new AskAiForCardJsonInput(attrs);
    },
  });
}

class WriteCardWorkflowStepField extends WorkflowStepField {
  @field previous = linksTo(GenerateExamplePayloadResult);
  @field input = linksTo(CreateExampleCardInput);
  @field output = linksTo(CreateInstanceResult);
  @field localDir = contains(StringField);
  @field buildArgs = linksTo(CreateExampleCardInput, {
    computeVia: function (this: WriteCardWorkflowStepField) {
      if (this.input) {
        return this.input;
      }
      let payloadResult = this.previous;
      if (!payloadResult || !payloadResult.payload) {
        return null;
      }
      if (!this.codeRef?.module || !this.targetRealm) {
        return null;
      }
      let serializedPayload =
        typeof payloadResult.rawOutput === 'string' &&
        payloadResult.rawOutput.trim().length > 0
          ? payloadResult.rawOutput
          : null;
      let inputCard = new CreateExampleCardInput({
        codeRef: this.codeRef,
        realm: this.targetRealm,
        payload: payloadResult.payload,
        serializedPayload: serializedPayload ?? undefined,
      });
      (inputCard as any).localDir = this.localDir ?? null;
      return inputCard;
    },
  });
}

function createDefaultWorkflowStepFields(
  codeRef: any,
  targetRealm: string | null,
  localDir: string | null,
  llmModelId: string | null,
  prompt: string | null,
  exampleCard: CardDef | null,
): WorkflowStepField[] {
  let requestPayload = new AskAiForCardJsonWorkflowStepField({
    stepId: 'ask-ai-for-payload',
    label: 'Fetch sample payload',
    description: 'Ask the AI model to propose example data.',
    commandRef: {
      module: '@cardstack/boxel-host/commands/generate-example-cards',
      name: 'AskAiForCardJsonCommand',
    },
    format: 'isolated',
    codeRef: codeRef,
    targetRealm: targetRealm,
    localDir: localDir,
    llmModelId: llmModelId,
    prompt: prompt,
    exampleCard: exampleCard,
  });

  let writeCard = new WriteCardWorkflowStepField({
    stepId: 'writing-card',
    label: 'Writing Card',
    description: 'Inspect the new card saved to the selected realm.',
    commandRef: {
      module: '@cardstack/boxel-host/commands/generate-example-cards',
      name: 'CreateExampleCardCommand',
    },
    format: 'isolated',
    codeRef: codeRef,
    targetRealm: targetRealm,
    localDir: localDir,
  });

  return [requestPayload, writeCard];
}

class CardCreatorIsolated extends Component<typeof CardCreator> {
  @tracked isRunning = false;
  @tracked errorMessage: string | null = null;
  @tracked openStepId: string | null = null;

  onStateChange = async (): Promise<void> => {
    try {
      let stepFields = await Promise.all(
        this.workflowState.steps.map(async (step) => {
          let input = await this.workflowState.getStepInput(step.id);
          let result = this.workflowState.getStepResult(step.id);

          return new WorkflowStepField({
            stepId: step.id,
            label: step.label,
            description: step.description,
            commandRef: step.commandRef,
            format: step.format?.toString() ?? null,
            input: input ?? null,
            output: result instanceof Error ? null : result ?? null,
          });
        }),
      );

      (this.args.model as any).steps = stepFields;
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : String(err);
    }
  };

  workflowState: WorkflowRunner = workflowResource(
    this,
    () => this.stepDefinitions,
    this.commandContext!,
    this.onStateChange,
  );

  get codeRef() {
    return this.args.model.codeRef ?? null;
  }

  get localDirValue() {
    return this.args.model.localDir?.trim() ?? '';
  }

  get promptValue() {
    return this.args.model.prompt?.trim() ?? '';
  }

  get exampleCard() {
    return this.args.model.exampleCard;
  }

  get targetRealm() {
    let realm = this.args.model.targetRealmUrl;
    if (!realm) {
      return null;
    }
    let trimmed = realm.trim();
    return trimmed.length ? trimmed : null;
  }

  get hasCodeRefSelection(): boolean {
    let ref = this.codeRef;
    return Boolean(ref?.module && ref?.name);
  }

  get existingCardsRealms(): string[] {
    return this.targetRealm ? [this.targetRealm] : [];
  }

  get existingCardsQuery(): Query | undefined {
    let ref = this.resolveCodeRef();
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

  get canShowExistingCards(): boolean {
    return Boolean(this.existingCardsQuery && this.existingCardsRealms.length);
  }

  get existingCardsHint(): string {
    if (!this.targetRealm && !this.hasCodeRefSelection) {
      return 'Enter a target realm and card definition to preview existing cards.';
    }
    if (!this.targetRealm) {
      return 'Enter a target realm to preview existing cards.';
    }
    if (!this.hasCodeRefSelection) {
      return 'Select a card definition to preview existing cards.';
    }
    return 'Update the inputs above to preview matching cards.';
  }

  get commandContext(): CommandContext | null {
    return (
      (this.args.context?.commandContext as CommandContext | undefined) ?? null
    );
  }

  private get stepDefinitions(): WorkflowStepField[] {
    let storedSteps =
      (this.args.model.steps as WorkflowStepField[] | undefined) ?? [];

    let steps = storedSteps.length
      ? storedSteps
      : createDefaultWorkflowStepFields(
          this.codeRef,
          this.targetRealm,
          this.localDirValue,
          this.args.model.llmModel?.modelId ?? null,
          this.composePrompt() ?? null,
          this.exampleCard,
        );

    return steps;
  }

  private buildWorkflowStepContext() {
    return {
      codeRef: this.codeRef ?? null,
      targetRealm: this.targetRealm ?? null,
      localDir: this.localDirValue || null,
      llmModelId: this.args.model.llmModel?.modelId ?? null,
      prompt: this.composePrompt() ?? null,
      exampleCard: this.exampleCard ?? null,
    };
  }

  get statusMessage(): string {
    if (this.errorMessage) {
      return this.errorMessage;
    }
    switch (this.workflowState.state) {
      case 'pending': {
        let activeId = this.workflowState.activeStep?.id;
        if (activeId === 'requesting-payload') {
          return 'Requesting example data from AI...';
        }
        if (activeId === 'writing-card') {
          return 'Saving the generated card...';
        }
        return 'Running workflow…';
      }
      case 'success':
        return 'Generation complete!';
      case 'error':
        return 'Generation failed.';
      default:
        return 'Provide inputs and click Generate to create a new card.';
    }
  }

  get statusClass(): string {
    let classes = ['status-message'];
    if (this.errorMessage) {
      classes.push('status-message--error');
    } else if (this.workflowState.state === 'success') {
      classes.push('status-message--success');
    }
    return classes.join(' ');
  }

  get statusType(): CommandInvocationStatus {
    if (this.errorMessage) {
      return 'error';
    }
    return this.workflowState.state;
  }

  get canGenerate(): boolean {
    if (this.isRunning) {
      return false;
    }
    if (!this.targetRealm) {
      return false;
    }
    if (!this.codeRef?.module) {
      return false;
    }
    if (!this.localDirValue) {
      return false;
    }
    return true;
  }

  get canSaveWorkflow(): boolean {
    return this.workflowState.steps.some((step) => step.value != null);
  }

  get isGenerateDisabled(): boolean {
    return !this.canGenerate;
  }

  get disabledReason(): string | null {
    if (this.isRunning) {
      return 'Generation in progress...';
    }
    if (!this.targetRealm) {
      return 'Target realm is required.';
    }
    if (!this.codeRef?.module) {
      return 'Provide the code ref for the card definition.';
    }
    if (!this.localDirValue) {
      return 'Provide a directory name for the generated card.';
    }
    return null;
  }

  private resolveCodeRef = (): ResolvedCodeRef | undefined => {
    let ref = this.codeRef;
    if (!ref) {
      return undefined;
    }
    try {
      return codeRefWithAbsoluteURL(
        ref,
        this.targetRealm ? new URL(this.targetRealm) : undefined,
      ) as ResolvedCodeRef;
    } catch {
      return undefined;
    }
  };

  private composePrompt = (): string | undefined => {
    let userPrompt = this.promptValue;
    return userPrompt.length ? userPrompt : undefined;
  };

  openAccordion = (stepId: string | null): void => {
    this.openStepId = stepId;
  };

  startWorkflow = async (event?: Event): Promise<void> => {
    event?.preventDefault();
    if (!this.canGenerate) {
      return;
    }

    if (!this.commandContext) {
      this.errorMessage =
        'Command context is not available. Open this card inside the host app.';
      return;
    }

    this.isRunning = true;
    this.errorMessage = null;

    try {
      await this.workflowState.run();
      let steps = this.workflowState.steps;
      let lastStep = steps.length ? steps[steps.length - 1] : null;
      this.openAccordion(lastStep?.id ?? null);
    } catch (error) {
      console.error('Error starting workflow:', error);
      this.errorMessage =
        error instanceof Error ? error.message : 'Failed to start workflow';
      this.isRunning = false;
    } finally {
      this.isRunning = false;
    }
  };

  runWorkflowStep = async (stepId: string): Promise<void> => {
    if (!this.commandContext) {
      this.errorMessage =
        'Command context is not available. Open this card inside the host app.';
      return;
    }

    this.errorMessage = null;

    try {
      this.openAccordion(stepId);
      await this.workflowState.runStep(stepId);
    } catch (error) {
      let message =
        error instanceof Error ? error.message : 'Failed to run workflow step.';
      this.errorMessage = message;
    }
  };

  resetWorkflow = (): void => {
    this.workflowState.reset();
    this.errorMessage = null;
    this.openAccordion(null);
  };

  saveWorkflowTask = task(async () => {
    if (!this.targetRealm) {
      this.errorMessage = 'Target realm is required to save workflow.';
      return;
    }

    this.errorMessage = null;

    try {
      await this.workflowState.save(this.targetRealm);
    } catch (error) {
      let message =
        error instanceof Error ? error.message : 'Failed to save workflow.';
      this.errorMessage = message;
    }
  });

  <template>
    <article class='card-creator'>
      <GridContainer class='card-creator__form'>
        <FieldContainer @label='Target Realm'>
          <@fields.targetRealmUrl />
        </FieldContainer>
        <FieldContainer @label='Card Definition (code ref)'>
          <@fields.codeRef />
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
        <FieldContainer @label='Reference Example (optional)'>
          <@fields.exampleCard />
        </FieldContainer>
      </GridContainer>

      <NotificationBubble
        @type={{this.statusType}}
        @message={{this.statusMessage}}
      />

      <WorkflowProgress @steps={{this.workflowState.steps}} />

      <div class='card-creator__actions'>
        <Button
          @kind='primary'
          data-test-generate-card-button
          @disabled={{this.isGenerateDisabled}}
          {{on 'click' this.startWorkflow}}
        >
          {{if
            this.isRunning
            'Generating…'
            (if this.workflowState.result 'Re-run Workflow' 'Generate Card')
          }}
        </Button>

        {{#if this.canSaveWorkflow}}
          <Button
            @kind='secondary'
            @loading={{this.saveWorkflowTask.isRunning}}
            @disabled={{this.saveWorkflowTask.isRunning}}
            {{on 'click' this.saveWorkflowTask.perform}}
          >
            {{if this.saveWorkflowTask.isRunning 'Saving…' 'Save'}}
          </Button>
          <Button @kind='secondary-light' {{on 'click' this.resetWorkflow}}>
            Reset
          </Button>
        {{/if}}
      </div>

      <AccordionWorkflow
        @steps={{this.workflowState.steps}}
        @openStepId={{this.openStepId}}
        @onOpenAccordion={{this.openAccordion}}
        @onRunStep={{this.runWorkflowStep}}
      />

      <section class='card-creator__existing'>
        <div class='card-creator__section-header'>
          <h2>Existing cards</h2>
          <p>Preview cards of this type in the selected realm.</p>
        </div>

        {{#if this.canShowExistingCards}}
          <PaginatedCards
            @query={{this.existingCardsQuery}}
            @realms={{this.existingCardsRealms}}
            @context={{@context}}
          />
        {{else}}
          <p class='card-creator__hint'>{{this.existingCardsHint}}</p>
        {{/if}}
      </section>

    </article>

    <style scoped>
      .card-creator {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xl);
        padding: var(--boxel-sp-xl);
        background: var(--boxel-50);
        border-radius: var(--boxel-border-radius);
      }
      .card-creator__form {
        gap: var(--boxel-sp-lg);
      }
      .card-creator__actions {
        display: flex;
        gap: var(--boxel-sp);
        align-items: center;
      }
      .card-creator__section-header {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        margin-bottom: var(--boxel-sp-lg);
      }
      .card-creator__section-header h2 {
        margin: 0;
        font-size: var(--boxel-font-size);
        font-weight: 600;
      }
      .card-creator__section-header p {
        margin: 0;
        color: var(--boxel-600);
        font-size: var(--boxel-font-size-sm);
      }
      .card-creator__existing {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-md);
      }
      .card-creator__hint {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        color: var(--boxel-600);
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

export class CardCreator extends CardDef {
  static displayName = 'Card Creator';

  @field targetRealmUrl = contains(RealmField);
  @field codeRef = contains(CodeRefField);
  @field localDir = contains(StringField);
  @field llmModel = linksTo(ModelConfiguration);
  @field prompt = contains(MarkdownField);
  @field exampleCard = linksTo(() => CardDef);
  @field steps = containsMany(WorkflowStepField);

  static isolated = CardCreatorIsolated;
}
