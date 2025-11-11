import type {
  CardInstance,
  Command,
  CommandContext,
  CommandInvocation,
  Format,
  CommandInvocationStatus,
} from '@cardstack/runtime-common';
import type { CardDefConstructor } from 'https://cardstack.com/base/card-api';
import { CommandExecutionState } from 'https://cardstack.com/base/resources/command-data';
import type { WorkflowStepField } from './workflow-step-field';

export { WorkflowStepField } from './workflow-step-field';

export interface WorkflowStepInterface<
  CardResultType extends CardDefConstructor,
> extends CommandInvocation<CardResultType> {
  id: string;
  label: string;
  description: string;
  format: Format | undefined;
  commandRef: any;
  field: WorkflowStepField;
  state: CommandInvocationStatus;
  reset(): void;
  run(
    input: any,
    commandContext: CommandContext,
  ): Promise<CardInstance<CardResultType> | null>;
}

export class WorkflowStep<
  CardInputType extends CardDefConstructor | undefined,
  CardResultType extends CardDefConstructor,
> {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly format: Format | undefined;
  readonly commandRef: any; // CodeRef for the command
  readonly field: WorkflowStepField; // Reference to the original field

  readonly execution: CommandExecutionState<CardResultType>;

  constructor(config: WorkflowStepField) {
    this.id = config.stepId ?? 'unknown';
    this.label = config.label ?? '';
    this.description = config.description ?? '';
    this.format = this.parseFormat(config.format);
    this.commandRef = config.commandRef;
    this.field = config; // Store reference to the field
    this.execution = new CommandExecutionState<CardResultType>();
    this.hydrateFromPersisted(
      config.input,
      config.output as CardInstance<CardResultType> | Error | null,
    );
  }

  private parseFormat(
    formatString: string | undefined | null,
  ): Format | undefined {
    if (!formatString) return undefined;
    const validFormats = ['isolated', 'embedded', 'atom', 'fitted', 'edit'];
    return validFormats.includes(formatString)
      ? (formatString as Format)
      : undefined;
  }

  get value(): CardInstance<CardResultType> | null {
    return this.execution.value;
  }

  hydrateFromPersisted(
    _input: any,
    output: CardInstance<CardResultType> | Error | null,
  ): void {
    if (output instanceof Error) {
      this.execution.setError(output);
    } else if (output) {
      this.execution.setSuccess(output);
    } else {
      this.execution.reset();
    }
  }

  get error(): Error | null {
    return this.execution.error;
  }

  get status(): CommandInvocationStatus {
    return this.execution.status;
  }

  get state(): CommandInvocationStatus {
    return this.execution.status;
  }

  get isSuccess(): boolean {
    return this.execution.isSuccess;
  }

  get isLoading(): boolean {
    return this.execution.isLoading;
  }

  reset(): void {
    this.execution.reset();
  }

  private async resolveCommand(
    commandContext: CommandContext,
  ): Promise<Command<CardInputType, CardResultType>> {
    if (!this.commandRef?.module || !this.commandRef?.name) {
      throw new Error(
        `Invalid command reference for step ${this.id}. Command ref: ${JSON.stringify(this.commandRef)}`,
      );
    }

    try {
      // Dynamically import the command module
      let module = await (import.meta as any).loader.import(
        this.commandRef.module,
      );
      let CommandClass = module[this.commandRef.name];

      if (!CommandClass) {
        throw new Error(
          `Command ${this.commandRef.name} not found in module ${this.commandRef.module}`,
        );
      }

      return new CommandClass(commandContext);
    } catch (err) {
      throw new Error(
        `Failed to load command ${this.commandRef.name} from ${this.commandRef.module}: ${err}`,
      );
    }
  }

  async createInput(
    commandContext: CommandContext,
  ): Promise<CardInstance<CardInputType> | null> {
    let command = await this.resolveCommand(commandContext);

    // Check if the command has a getInputType method
    if (
      'getInputType' in command &&
      typeof command.getInputType === 'function'
    ) {
      try {
        let InputType = await command.getInputType();
        if (InputType) {
          let input = new InputType() as CardInstance<CardInputType>;
          return input;
        }
      } catch (err) {
        console.error('Error getting input type:', err);
      }
    }

    return null;
  }

  async run(
    input: any,
    commandContext: CommandContext,
  ): Promise<CardInstance<CardResultType> | null> {
    this.execution.reset();

    try {
      if (!input) {
        throw new Error('No input provided for step');
      }

      let command = await this.resolveCommand(commandContext);

      this.execution.setLoading();
      let result = await command.execute(input);
      this.execution.setSuccess(result);
      return result;
    } catch (err) {
      let error = err instanceof Error ? err : new Error(String(err));
      this.execution.setError(error);
      throw error;
    }
  }
}
