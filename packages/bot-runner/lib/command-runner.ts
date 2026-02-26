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
import {
  CreateListingPRHandler,
  type BotTriggerEventContent,
} from './create-listing-pr-handler';
import type { GitHubClient } from './github';

const log = logger('bot-runner');

export class CommandRunner {
  private createListingPRHandler: CreateListingPRHandler;

  constructor(
    private dbAdapter: DBAdapter,
    private queuePublisher: QueuePublisher,
    githubClient: GitHubClient,
  ) {
    this.createListingPRHandler = new CreateListingPRHandler(githubClient);
  }

  async maybeEnqueueCommand(
    runAs: string,
    eventContent: BotTriggerEventContent,
    registrationId: string,
  ): Promise<void | RunCommandResponse> {
    try {
      let allowedCommands = await this.getCommandsForRegistration(registrationId);
      if (
        !allowedCommands.length ||
        typeof eventContent.type !== 'string' ||
        !allowedCommands.some((entry) => entry.type === eventContent.type)
      ) {
        return;
      }

      if (!eventContent?.input || typeof eventContent.input !== 'object') {
        return;
      }

      let input = eventContent.input as Record<string, unknown>;
      let realmURL =
        typeof eventContent.realm === 'string' ? eventContent.realm : undefined;
      let commandRegistration = allowedCommands.find(
        (entry) => entry.type === eventContent.type,
      );
      let command = commandRegistration?.command?.trim();
      let commandInput: Record<string, any> | null = input;

      if (!realmURL || !command) {
        log.warn(
          'bot trigger missing required input for command (need realmURL and command)',
          { realmURL, command },
        );
        return;
      }

      if (eventContent.type === 'pr-listing-create') {
        let job = await enqueueRunCommandJob(
          {
            realmURL,
            realmUsername: runAs,
            runAs,
            command,
            commandInput,
          },
          this.queuePublisher,
          this.dbAdapter,
          userInitiatedPriority,
        );
        let result: RunCommandResponse = await job.done;
        if (result.status !== 'ready') {
          let errorMessage =
            result.error && result.error.trim()
              ? result.error
              : `run-command returned status "${result.status}"`;
          log.error('pr-listing-create run-command did not complete', {
            runAs,
            status: result.status,
            error: result.error,
            realmURL,
            command,
          });
          throw new Error(errorMessage);
        }
        await this.createListingPRHandler.ensureCreateListingBranch(eventContent);
        await this.createListingPRHandler.addContentsToCommit(eventContent, result);
        await this.createListingPRHandler.openCreateListingPR(
          eventContent,
          runAs,
          result,
        );
        return result;
      }

      let job = await enqueueRunCommandJob(
        {
          realmURL,
          realmUsername: runAs,
          runAs,
          command,
          commandInput,
        },
        this.queuePublisher,
        this.dbAdapter,
        userInitiatedPriority,
      );
      return await job.done;
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
