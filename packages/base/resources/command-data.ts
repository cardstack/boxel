import { tracked } from '@glimmer/tracking';

import {
  type CommandInvocation,
  type Command,
  type CardInstance,
} from '@cardstack/runtime-common';

import { CommandContext } from '@cardstack/runtime-common';

import { CardContext, CardDefConstructor } from '../card-api';

import { resource } from 'ember-resources';

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

export function commandData<CardResultType extends CardDefConstructor>(
  parent: { args: { context?: CardContext | undefined } },
  commandClass: new (
    context: CommandContext,
  ) => Command<undefined, CardResultType>,
): CommandExecutionState<CardResultType>;
export function commandData<
  CardInputType extends CardDefConstructor,
  CardResultType extends CardDefConstructor,
>(
  parent: { args: { context?: CardContext | undefined } },
  commandClass: new (
    context: CommandContext,
  ) => Command<CardInputType, CardResultType>,
  executeArgs: () => Parameters<
    Command<CardInputType, CardResultType>['execute']
  >[0],
): CommandExecutionState<CardResultType>;
export function commandData<
  CardInputType extends CardDefConstructor | undefined,
  CardResultType extends CardDefConstructor,
>(
  parent: { args: { context?: CardContext | undefined } },
  commandClass: new (
    context: CommandContext,
  ) => Command<CardInputType, CardResultType>,
  executeArgs?: () => Parameters<
    Command<CardInputType, CardResultType>['execute']
  >[0],
): CommandExecutionState<CardResultType> {
  return resource(parent, () => {
    const state = new CommandExecutionState<
      CardResultType extends CardDefConstructor ? CardResultType : never
    >();
    let commandContext = parent.args.context?.commandContext;
    if (!commandContext) {
      //TODO: maybe strengthen type by saying commandContext is always there
      state.setError(new Error('no context'));
      return state;
    }

    const command = new commandClass(commandContext);

    state.setLoading();
    (executeArgs ? command.execute(executeArgs()) : command.execute())
      .then((result) => {
        state.setSuccess(result);
      })
      .catch((error) => {
        state.setError(error);
      });
    return state;
  });
}
