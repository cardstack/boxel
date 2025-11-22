import { tracked } from '@glimmer/tracking';
import { TrackedMap } from 'tracked-built-ins';
import { resource } from 'ember-resources';

import type {
  CommandContext,
  CommandInvocationStatus,
  LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import {
  WorkflowStep,
  type WorkflowStepInterface,
  WorkflowStepField,
} from '../card-generation/workflow-step';
import type { CardDef } from 'https://cardstack.com/base/card-api';
import {
  serializeCard,
  serializeCardResource,
} from 'https://cardstack.com/base/card-serialization';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';

export interface WorkflowRunnerInterface {
  steps: WorkflowStepInterface<any>[];

  //Step Specific
  runStep(stepId: string): Promise<CardDef | null>;
  getStepResult(stepId: string): CardDef | Error | null;
  getStepInput(
    stepId: string,
  ): Promise<CardDef | Record<string, unknown> | null>;

  //Workflow Specific
  getResult: CardDef | Error | null;
  activeStep: WorkflowStepInterface<any> | null;
  state: CommandInvocationStatus;
  run(): Promise<void>;
  reset(): void;
  save(realm: string): Promise<void>;
}

export class WorkflowRunner implements WorkflowRunnerInterface {
  private getSteps: (() => WorkflowStepField[] | undefined) | null = null;
  private onStateChangeCallback: (() => void | Promise<void>) | null = null;
  private commandContext: CommandContext | null = null;

  @tracked steps: WorkflowStepInterface<any>[] = [];
  persistedState = new TrackedMap<
    string,
    {
      input: CardDef | Record<string, unknown> | null;
      result: CardDef | Error | null;
    }
  >();

  get result(): CardDef | Error | null {
    if (this.steps.length === 0) {
      return null;
    }
    let lastStep = this.steps[this.steps.length - 1];
    if (lastStep.error) {
      return lastStep.error;
    }
    return (lastStep.value ?? null) as CardDef | null;
  }

  get activeStep(): WorkflowStepInterface<any> | null {
    return this.steps.find((step) => step.isLoading) ?? null;
  }

  get state(): CommandInvocationStatus {
    if (this.steps.some((step) => step.status === 'error')) {
      return 'error';
    } else if (this.steps.some((step) => step.isLoading)) {
      return 'pending';
    } else if (
      this.steps.length > 0 &&
      this.steps.every((step) => step.status === 'success')
    ) {
      return 'success';
    }
    return 'idle';
  }

  private configure = (
    steps: () => WorkflowStepField[] | undefined,
    commandContext: CommandContext,
    onStateChange?: () => void | Promise<void>,
  ): void => {
    this.getSteps = steps;
    this.commandContext = commandContext;
    if (onStateChange) {
      this.onStateChangeCallback = onStateChange;
    }
    let stepFields = this.getSteps?.() ?? [];
    this.steps = stepFields.map((field) => new WorkflowStep(field));
    stepFields.forEach((field, index) => {
      if (field.output !== undefined && field.output !== null) {
        let step = this.steps[index];
        // Use explicit input, or try buildArgs, or null
        let input = field.input ?? (field as any).buildArgs ?? null;
        let result = field.output;
        this.persistedState.set(step.id, {
          input,
          result,
        });
      }
    });
  };

  private resetStepExecutions(): void {
    for (let step of this.steps) {
      step.reset();
    }
  }

  reset = (): void => {
    this.resetStepExecutions();
    this.persistedState.clear();
  };

  /**
   * Save all input/output cards to the realm and persist the workflow state
   * to the card by calling the onStateChange callback.
   */
  save = async (realm: string): Promise<void> => {
    if (!this.commandContext) {
      throw new Error('Command context not configured');
    }

    let saveCommand = new SaveCardCommand(this.commandContext);

    // Save all input and output cards
    for (let [stepId, state] of this.persistedState.entries()) {
      let step = this.steps.find((s) => s.id === stepId);
      if (!step) continue;

      // Save input card if it's a CardDef instance
      if (
        state.input &&
        state.input instanceof Object &&
        'constructor' in state.input
      ) {
        try {
          let savedInput = await saveCommand.execute({
            card: state.input as any,
            realm,
          });
          // Update persisted state with saved card
          this.persistedState.set(stepId, {
            input: savedInput.card as CardDef,
            result: state.result,
          });
        } catch (err) {
          console.error(`Error saving input card for step ${stepId}:`, err);
        }
      }

      // Save output/result card if it exists and is not an error
      if (
        state.result &&
        !(state.result instanceof Error) &&
        state.result instanceof Object
      ) {
        try {
          let savedOutput = await saveCommand.execute({
            card: state.result as any,
            realm,
          });
          // Update persisted state with saved card
          let currentState = this.persistedState.get(stepId);
          this.persistedState.set(stepId, {
            input: currentState?.input ?? null,
            result: savedOutput as CardDef,
          });
        } catch (err) {
          console.error(`Error saving output card for step ${stepId}:`, err);
        }
      }
    }

    // Call onStateChange to persist to the card
    if (this.onStateChangeCallback) {
      await this.onStateChangeCallback();
    }
  };

  run = async (): Promise<void> => {
    if (!this.steps.length) {
      return;
    }

    if (!this.commandContext) {
      return;
    }

    this.resetStepExecutions();

    try {
      for (let step of this.steps) {
        await this.runStep(step.id);
      }
    } catch (error) {
      // Error is already handled in runStep
      // Just let it propagate
      throw error;
    }
  };

  getStepResult = (stepId: string): CardDef | Error | null => {
    let step = this.steps.find((s) => s.id === stepId);
    if (!step) {
      return null;
    }
    if (step.error) {
      return step.error;
    }
    return (step.value ?? null) as CardDef | null;
  };

  getStepInput = async (
    stepId: string,
  ): Promise<CardDef | Record<string, unknown> | null> => {
    // Get the persisted input for this step
    let persistedEntry = this.persistedState.get(stepId);
    return persistedEntry?.input ?? null;
  };

  get getResult() {
    return this.result;
  }

  runStep = async (stepId: string): Promise<CardDef | null> => {
    let runner = this.steps.find((step) => step.id === stepId);
    if (!runner) {
      return null;
    }

    if (!this.commandContext) {
      throw new Error('Command context not configured');
    }

    runner.reset();

    let input: CardDef | null;
    let index = this.steps.indexOf(runner);

    // Check if we have persisted input first
    let persistedEntry = this.persistedState.get(runner.id);

    if (persistedEntry?.input) {
      input = persistedEntry.input as CardDef;
    } else if (index > 0) {
      // Use previous step's output
      let previousRunner = this.steps[index - 1];
      let previousOutput = (previousRunner.value ?? null) as CardDef | null;

      // Get the step field and set the previous output on it
      let stepFields = this.getSteps?.() ?? [];
      let stepField = stepFields[index];
      if (stepField && previousOutput) {
        (stepField as any).previous = previousOutput;
      }

      // Now get input from buildArgs (which can access previous)
      input = stepField ? ((stepField as any).buildArgs ?? null) : null;
    } else {
      // First step with no persisted input - get from stepFields
      let stepFields = this.getSteps?.() ?? [];
      let stepField = stepFields[index];
      if (stepField) {
        input = stepField.input ?? (stepField as any).buildArgs ?? null;
      } else {
        input = null;
      }
    }

    try {
      let stepResult = await runner.run(input, this.commandContext);

      let normalizedResult = (stepResult ?? null) as CardDef | null;

      // Update persisted state with input and result after run completes
      this.persistedState.set(runner.id, {
        input,
        result: normalizedResult,
      });

      // Update next step's previous field with this step's output
      if (normalizedResult && index < this.steps.length - 1) {
        let stepFields = this.getSteps?.() ?? [];
        let nextStepField = stepFields[index + 1];
        if (nextStepField) {
          (nextStepField as any).previous = normalizedResult;
        }
      }

      return (stepResult ?? null) as CardDef | null;
    } catch (error) {
      let normalized =
        error instanceof Error ? error : new Error(String(error));

      // Update persisted state with error
      this.persistedState.set(runner.id, {
        input,
        result: normalized,
      });

      throw normalized;
    }
  };
}

export function workflowResource(
  parent: object,
  steps: () => WorkflowStepField[] | undefined,
  commandContext: CommandContext,
  onStateChange?: () => void | Promise<void>,
): WorkflowRunner {
  return resource(parent, () => {
    let state = new WorkflowRunner();
    // @ts-expect-error - accessing private method for initialization
    state.configure(steps, commandContext, onStateChange);
    return state;
  });
}
