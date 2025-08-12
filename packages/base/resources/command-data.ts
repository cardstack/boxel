import { waitForPromise } from '@ember/test-waiters';
import { tracked } from '@glimmer/tracking';

import {
  CommandContextName,
  type CommandInvocation,
  type Command,
  type FieldsOf,
  type CardInstance,
} from '@cardstack/runtime-common';

import { CommandContext } from '@cardstack/runtime-common';

import { CardDefConstructor } from '../card-api';

import { inspectContext } from '../utils/inspect-context';

import { maybe } from './maybe';

export class CommandExecutionState<CardResultType extends CardDefConstructor>
  implements CommandInvocation<CardResultType>
{
  @tracked status: 'pending' | 'success' | 'error' = 'pending';
  @tracked value: CardInstance<CardResultType> | null = null;
  @tracked error: Error | null = null;

  get isSuccess() {
    return this.status === 'success';
  }

  get isLoading() {
    return this.status === 'pending';
  }

  setLoading() {
    this.status = 'pending';
    this.value = null;
    this.error = null;
  }

  setSuccess(result: CardInstance<CardResultType>) {
    this.status = 'success';
    this.value = result;
    this.error = null;
  }

  setError(error: Error) {
    this.status = 'error';
    this.value = null;
    this.error = error;
  }
}

/**
 * Data loading abstraction for commands - provides reactive state and automatic context handling.
 *
 * @example
 * ```typescript
 * const commandResource = commandData(this, GetAllRealmMetasCommand, undefined);
 * if (commandResource.current?.isSuccess) {
 *   console.log(commandResource.current.result);
 * }
 * ```
 */
export function commandData<
  CardInputType extends CardDefConstructor | undefined,
  CardResultType extends CardDefConstructor,
>(
  parent: object,
  commandClass: new (
    context: CommandContext,
  ) => Command<CardInputType, CardResultType>,
  executeArgs: CardInputType extends CardDefConstructor
    ? Partial<FieldsOf<CardInstance<CardInputType>>>
    : undefined,
) {
  return maybe(parent, (_) => {
    const commandContext = inspectContext(parent, CommandContextName);
    if (!commandContext?.value) return;

    const command = new commandClass(commandContext.value);
    const state = new CommandExecutionState<
      CardResultType extends CardDefConstructor ? CardResultType : never
    >();
    waitForPromise(
      executeArgs === undefined
        ? command.execute()
        : command.execute(executeArgs as any),
      // TODO: Fix type. Just scope to any. execute is expecting a "never"
    )
      .then((result) => {
        state.setSuccess(result);
      })
      .catch((error) => {
        state.setError(error);
      });
    return state;
  });
}
