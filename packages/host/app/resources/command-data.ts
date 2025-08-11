import { waitForPromise } from '@ember/test-waiters';
import { tracked } from '@glimmer/tracking';

import {
  CommandContextName,
  type CommandInvocation,
  Command,
} from '@cardstack/runtime-common';

import { CardDefConstructor } from 'https://cardstack.com/base/card-api';

import { inspectContext } from '../utils/inspect-context';

import { maybe } from './maybe';

export class CommandExecutionState<T = unknown>
  implements CommandInvocation<T>
{
  @tracked status: 'pending' | 'success' | 'error' = 'pending';
  @tracked value: T | null = null;
  @tracked error: Error | null = null;

  get isLoading() {
    return this.status === 'pending';
  }

  get isSuccess() {
    return this.status === 'success';
  }

  get isError() {
    return this.status === 'error';
  }

  get result() {
    return this.value;
  }

  setLoading() {
    this.status = 'pending';
    this.value = null;
    this.error = null;
  }

  setSuccess(result: T) {
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
  CardResultType extends CardDefConstructor | undefined,
>(
  parent: object,
  commandClass: new (context: any) => Command<CardInputType, CardResultType>,
  executeArgs: CardInputType extends CardDefConstructor
    ? Partial<InstanceType<CardInputType>>
    : undefined,
) {
  return maybe(parent, (_) => {
    const commandContext = inspectContext(parent, CommandContextName);
    if (!commandContext?.value) return;

    const command = new commandClass(commandContext.value);
    const state = new CommandExecutionState<
      CardResultType extends CardDefConstructor
        ? InstanceType<CardResultType>
        : undefined
    >();
    waitForPromise(
      command
        .execute(executeArgs)
        .then((result) => {
          state.setSuccess(result);
        })
        .catch((error) => {
          state.setError(error);
        }),
    );
    return state;
  });
}
