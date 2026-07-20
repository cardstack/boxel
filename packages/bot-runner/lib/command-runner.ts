import {
  isBotCommandFilter,
  logger,
  param,
  query,
  userInitiatedPriority,
  type DBAdapter,
  type QueuePublisher,
  type RunCommandResponse,
} from '@cardstack/runtime-common';
import { enqueueRunCommandJob } from '@cardstack/runtime-common/jobs/run-command';
import type { BotTriggerContent as BotTriggerEventContent } from '@cardstack/base/matrix-event';

const log = logger('bot-runner');

export interface EnqueueRunCommandOptions {
  runAs: string;
  realmURL: string;
  command: string;
  commandInput: Record<string, any> | null;
  concurrencyGroup?: string;
}

export type EnqueueRunCommandFn = (
  opts: EnqueueRunCommandOptions,
) => Promise<RunCommandResponse>;

export interface BotCommandHandler {
  matches(eventContent: BotTriggerEventContent): boolean;
  handle(
    runAs: string,
    eventContent: BotTriggerEventContent,
  ): Promise<RunCommandResponse | void>;
}

export function makeEnqueueRunCommand(
  queuePublisher: QueuePublisher,
  dbAdapter: DBAdapter,
): EnqueueRunCommandFn {
  return async function enqueueRunCommand({
    runAs,
    realmURL,
    command,
    commandInput,
    concurrencyGroup,
  }) {
    let job = await enqueueRunCommandJob(
      {
        realmURL,
        realmUsername: runAs,
        runAs,
        command,
        commandInput,
        // Interactive command: a command error is a normal result to hand back
        // to the user, not a job failure.
        alertOnError: false,
      },
      queuePublisher,
      dbAdapter,
      userInitiatedPriority,
      concurrencyGroup ? { concurrencyGroup } : undefined,
    );
    return await job.done;
  };
}

export class CommandRunner {
  private enqueueRunCommand: EnqueueRunCommandFn;
  private dbAdapter: DBAdapter;
  private handlers: BotCommandHandler[];

  constructor(
    dbAdapter: DBAdapter,
    queuePublisher: QueuePublisher,
    handlers: BotCommandHandler[] = [],
  ) {
    this.dbAdapter = dbAdapter;
    this.handlers = handlers;
    this.enqueueRunCommand = makeEnqueueRunCommand(queuePublisher, dbAdapter);
  }

  async maybeEnqueueCommand(
    runAs: string,
    eventContent: BotTriggerEventContent,
    registrationId: string,
  ): Promise<void | RunCommandResponse> {
    try {
      let allowedCommands =
        await this.getCommandsForRegistration(registrationId);
      if (
        !allowedCommands.length ||
        typeof eventContent.type !== 'string' ||
        !allowedCommands.some((entry) => entry.type === eventContent.type)
      ) {
        return;
      }

      if (
        !eventContent?.input ||
        typeof eventContent.input !== 'object' ||
        Array.isArray(eventContent.input)
      ) {
        return;
      }

      let realmURL =
        typeof eventContent.realm === 'string' ? eventContent.realm : undefined;
      let commandRegistration = allowedCommands.find(
        (entry) => entry.type === eventContent.type,
      );
      let command = commandRegistration?.command?.trim();

      if (!realmURL || !command) {
        log.warn(
          'bot trigger missing required input for command (need realmURL and command)',
          { realmURL, command },
        );
        return;
      }

      let handler = this.handlers.find((h) => h.matches(eventContent));
      if (handler) {
        return await handler.handle(runAs, eventContent);
      }

      return await this.enqueueRunCommand({
        runAs,
        realmURL,
        command,
        commandInput: eventContent.input as Record<string, unknown>,
      });
    } catch (error) {
      log.error('error in maybeEnqueueCommand', {
        runAs,
        eventType: eventContent.type,
        error,
      });
      throw error;
    }
  }

  private async getCommandsForRegistration(
    registrationId: string,
  ): Promise<{ type: string; command: string }[]> {
    let rows = await query(this.dbAdapter, [
      `SELECT command_filter, command FROM bot_commands WHERE bot_id = `,
      param(registrationId),
    ]);

    let commands: { type: string; command: string }[] = [];
    for (let row of rows) {
      let filter = row.command_filter;
      if (!isBotCommandFilter(filter)) {
        continue;
      }
      if (typeof row.command !== 'string' || !row.command.trim()) {
        continue;
      }
      commands.push({ type: filter.content_type, command: row.command });
    }
    return commands;
  }
}
