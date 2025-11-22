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
import {
  Button,
  FieldContainer,
  GridContainer,
} from '@cardstack/boxel-ui/components';
import NotificationBubble from '../components/notification-bubble';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { task } from 'ember-concurrency';

import { WorkflowStepField } from './workflow-step-field';

import {
  codeRefWithAbsoluteURL,
  specRef,
  type CommandContext,
  type CommandInvocationStatus,
  type Query,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import {
  SearchCardsByQueryInput,
  SearchCardsResult,
  CreateSpecsInput,
  CreateSpecsResult,
  GenerateReadmeSpecInput,
  GenerateReadmeSpecResult,
} from 'https://cardstack.com/base/command';

import { workflowResource } from '../resources/workflow-runner';
import AccordionWorkflow from '../components/accordion-workflow';
import WorkflowProgress from '../components/workflow-progress';

class FindSpecWorkflowStepField extends WorkflowStepField {
  @field input = linksTo(SearchCardsByQueryInput);
  @field output = linksTo(SearchCardsResult);

  @field buildArgs = linksTo(SearchCardsByQueryInput, {
    computeVia: function (this: FindSpecWorkflowStepField) {
      // If input is already set, use it
      if (this.input) {
        return this.input;
      }

      // Generate default query from codeRef and targetRealm
      let ref = this.codeRef;
      if (!ref?.module) {
        return null;
      }

      let resolvedRef: ResolvedCodeRef;
      try {
        resolvedRef = codeRefWithAbsoluteURL(
          ref,
          this.targetRealm ? new URL(this.targetRealm) : undefined,
        ) as ResolvedCodeRef;
      } catch {
        return null;
      }

      let query: Query = {
        filter: {
          on: specRef,
          eq: {
            ref: resolvedRef,
          },
        },
        page: {
          number: 0,
          size: 5,
        },
      };

      return new SearchCardsByQueryInput({ query });
    },
  });
}

class CreateSpecWorkflowStepField extends WorkflowStepField {
  @field input = linksTo(CreateSpecsInput);
  @field output = linksTo(CreateSpecsResult);
  @field previous = linksTo(SearchCardsResult); // Previous step output

  @field buildArgs = linksTo(CreateSpecsInput, {
    computeVia: function (this: CreateSpecWorkflowStepField) {
      if (this.input) {
        return this.input;
      }

      let ref = this.codeRef;
      if (!ref?.module) {
        return null;
      }

      let codeRef: ResolvedCodeRef;
      let targetRealm = 'http://localhost:4201/experiments/';
      try {
        codeRef = codeRefWithAbsoluteURL(
          ref,
          new URL(targetRealm),
        ) as ResolvedCodeRef;
      } catch {
        return null;
      }

      return new CreateSpecsInput({
        codeRef,
        module: codeRef.module,
        targetRealm,
        autoGenerateReadme: false,
      });
    },
  });
}

class GenerateReadmeWorkflowStepField extends WorkflowStepField {
  @field input = linksTo(GenerateReadmeSpecInput);
  @field output = linksTo(GenerateReadmeSpecResult);
  @field previous = linksTo(CreateSpecsResult);

  @field buildArgs = linksTo(GenerateReadmeSpecInput, {
    computeVia: function (this: GenerateReadmeWorkflowStepField) {
      if (this.input) {
        return this.input;
      }

      // Get spec from previous step output
      let spec = this.previous?.specs?.[0] ?? null;
      if (!spec) {
        return null;
      }

      return new GenerateReadmeSpecInput({ spec });
    },
  });
}

function createDefaultWorkflowStepFields(
  codeRef: any,
  targetRealm: string | null,
): WorkflowStepField[] {
  let findSpec = new FindSpecWorkflowStepField({
    stepId: 'find-spec',
    label: 'Search for Existing Specs',
    description: 'Search for an existing spec that matches the code reference.',
    commandRef: {
      module: '@cardstack/boxel-host/commands/search-cards',
      name: 'SearchCardsByQueryCommand',
    },
    format: 'isolated',
  });
  findSpec.codeRef = codeRef;
  findSpec.targetRealm = targetRealm ?? '';

  let createSpec = new CreateSpecWorkflowStepField({
    stepId: 'create-spec',
    label: 'Create spec if missing',
    description:
      'Create the spec in the selected realm when one is not already present.',
    commandRef: {
      module: '@cardstack/boxel-host/commands/create-specs',
      name: 'default',
    },
    format: 'isolated',
  });
  createSpec.codeRef = codeRef;
  createSpec.targetRealm = targetRealm ?? '';

  let generateReadme = new GenerateReadmeWorkflowStepField({
    stepId: 'generate-readme',
    label: 'Generate README',
    description: 'Produce documentation for the located or newly created spec.',
    commandRef: {
      module: '@cardstack/boxel-host/commands/generate-readme-spec',
      name: 'default',
    },
    format: 'isolated',
  });

  return [findSpec, createSpec, generateReadme];
}

class SpecCreatorIsolated extends Component<typeof SpecCreator> {
  @tracked isRunning = false;
  @tracked errorMessage: string | null = null;
  @tracked openStepId: string | null = null;

  // Called by the workflow runner whenever its internal state changes.
  // This maps persisted per-step input/result data from the runner back
  // onto the `WorkflowStepField` instances stored on the SpecCreator card
  // so the UI and persisted card state reflect the latest run.
  onStateChange = async (): Promise<void> => {
    try {
      // Create WorkflowStepField instances from the workflow runner's steps
      let stepFields = [];

      for (let step of this.workflowState.steps) {
        // Get input from the workflow runner
        let input = await this.workflowState.getStepInput(step.id);

        // Get result from the workflow runner
        let result = this.workflowState.getStepResult(step.id);

        let stepField = new WorkflowStepField({
          stepId: step.id,
          label: step.label,
          description: step.description,
          commandRef: step.commandRef,
          format: step.format?.toString() ?? null,
          input: input ?? null,
          output: result instanceof Error ? null : result ?? null,
          codeRef: step.field.codeRef,
          targetRealm: step.field.targetRealm,
        });

        stepFields.push(stepField);
      }

      // Assign the created step fields to the model
      (this.args.model as any).steps = stepFields;
    } catch (err) {
      // Defensive: don't let callback exceptions break the runner; surface message
      // to the user in the UI.
      this.errorMessage = err instanceof Error ? err.message : String(err);
    }
  };

  workflowState = workflowResource(
    this,
    () => this.stepDefinitions,
    this.commandContext!,
    this.onStateChange,
  );

  get targetRealm(): string | null {
    let value = this.args.model.targetRealmUrl;
    if (!value) {
      return null;
    }
    let trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }

  get commandContext(): CommandContext | null {
    return (
      (this.args.context?.commandContext as CommandContext | undefined) ?? null
    );
  }

  get canGenerate(): boolean {
    if (this.isRunning) {
      return false;
    }
    if (!this.targetRealm) {
      return false;
    }
    let ref = this.args.model.codeRef;
    if (!ref?.module || !ref?.name) {
      return false;
    }
    return true;
  }

  get isGenerateDisabled(): boolean {
    return !this.canGenerate;
  }

  get hasWorkflowRun(): boolean {
    return this.workflowState.result != null;
  }

  get canSaveWorkflow(): boolean {
    return this.workflowState.steps.some((step) => step.value != null);
  }

  get statusMessage(): string {
    if (this.errorMessage) {
      return this.errorMessage;
    }

    let workflowState = this.workflowState.state;

    if (workflowState === 'pending') {
      return 'Running workflow…';
    }

    if (workflowState === 'success') {
      return 'Workflow completed successfully!';
    }

    if (workflowState === 'error') {
      // Try to get error message from workflow result or active step
      let result = this.workflowState.result;
      if (result instanceof Error) {
        return `Workflow failed: ${result.message}`;
      }

      // Check if any step has an error
      for (let step of this.workflowState.steps) {
        if (step.error) {
          return `Step "${step.label}" failed: ${step.error.message}`;
        }
      }

      return 'Workflow encountered an error';
    }

    return 'Choose a definition and realm, then generate a spec.';
  }

  get statusType(): CommandInvocationStatus {
    if (this.errorMessage) {
      return 'error';
    }
    return this.workflowState.state;
  }

  openAccordion = (stepId: string | null): void => {
    this.openStepId = stepId;
  };

  private get stepDefinitions(): WorkflowStepField[] {
    let storedSteps =
      (this.args.model.steps as WorkflowStepField[] | undefined) ?? [];

    if (storedSteps.length) {
      // Update stored steps with current context
      for (let step of storedSteps) {
        if (
          step instanceof FindSpecWorkflowStepField ||
          step instanceof CreateSpecWorkflowStepField
        ) {
          if (this.args.model.codeRef) {
            step.codeRef = this.args.model.codeRef;
          }
          step.targetRealm = this.targetRealm ?? '';
        }
        if (step instanceof GenerateReadmeWorkflowStepField) {
          // Get previous step output for chaining
          let prevStepIndex = storedSteps.indexOf(step) - 1;
          if (prevStepIndex >= 0) {
            step.previous = storedSteps[prevStepIndex].output as any;
          }
        }
      }
      return storedSteps;
    }

    return createDefaultWorkflowStepFields(
      this.args.model.codeRef,
      this.targetRealm,
    );
  }

  startWorkflow = async (event?: Event): Promise<void> => {
    event?.preventDefault();
    if (!this.canGenerate) {
      this.errorMessage =
        'Provide both a target realm and a code reference before generating the spec.';
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
    <article class='spec-creator'>
      <GridContainer class='spec-creator__form'>
        <FieldContainer @label='Target Realm'>
          <@fields.targetRealmUrl />
        </FieldContainer>
        <FieldContainer @label='Card or Field Reference'>
          <@fields.codeRef />
        </FieldContainer>
      </GridContainer>

      <NotificationBubble
        @type={{this.statusType}}
        @message={{this.statusMessage}}
      />

      <WorkflowProgress @steps={{this.workflowState.steps}} />

      <div class='spec-creator__actions'>
        <Button
          @kind='primary'
          data-test-generate-spec-button
          @disabled={{this.isGenerateDisabled}}
          {{on 'click' this.startWorkflow}}
        >
          {{if
            this.isRunning
            'Running…'
            (if this.hasWorkflowRun 'Re-run Workflow' 'Run Workflow')
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
        @onRunStep={{this.runWorkflowStep}}
        @openStepId={{this.openStepId}}
        @onOpenAccordion={{this.openAccordion}}
      />
    </article>

    <style scoped>
      .spec-creator {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        padding: var(--boxel-sp-xl);
      }

      .spec-creator__form {
        display: grid;
        gap: var(--boxel-sp-md);
      }

      .spec-creator__actions {
        display: flex;
        gap: var(--boxel-sp);
        align-items: center;
      }
    </style>
  </template>
}

export class SpecCreator extends CardDef {
  static displayName = 'Spec Creator';

  @field targetRealmUrl = contains(RealmField);
  @field codeRef = contains(CodeRefField);
  @field steps = containsMany(WorkflowStepField);

  static isolated = SpecCreatorIsolated;
}
