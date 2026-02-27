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

const SAVE_SUBMISSION_JOB_TIMEOUT_SEC = 300;
const SAVE_SUBMISSION_PUPPETEER_TIMEOUT_MS = 280_000;

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
        let result = await this.enqueueRunCommand({
          runAs,
          realmURL,
          command,
          commandInput,
        });
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

        // Fire-and-forget: persist the SubmissionCard to the realm with a
        // longer timeout so the large allFileContents payload does not hit the
        // 30-second Puppeteer limit that applies to create-submission.
        let roomId =
          typeof input.roomId === 'string' ? input.roomId : undefined;
        let listingId =
          typeof input.listingId === 'string' ? input.listingId : undefined;
        if (roomId && listingId) {
          void this.enqueueRunCommand({
            runAs,
            realmURL,
            command:
              '@cardstack/boxel-host/commands/save-submission/default',
            commandInput: { realm: realmURL, roomId, listingId },
            jobTimeoutSec: SAVE_SUBMISSION_JOB_TIMEOUT_SEC,
            puppeteerTimeoutMs: SAVE_SUBMISSION_PUPPETEER_TIMEOUT_MS,
          }).catch((err) =>
            log.error('save-submission job failed', {
              runAs,
              realmURL,
              error: err,
            }),
          );
        } else {
          log.warn(
            'skipping save-submission: missing roomId or listingId in event input',
            { runAs, realmURL },
          );
        }

        return result;
      }

      return await this.enqueueRunCommand({
        runAs,
        realmURL,
        command,
        commandInput,
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

  private async enqueueRunCommand({
    runAs,
    realmURL,
    command,
    commandInput,
    jobTimeoutSec,
    puppeteerTimeoutMs,
  }: {
    runAs: string;
    realmURL: string;
    command: string;
    commandInput: Record<string, any> | null;
    jobTimeoutSec?: number;
    puppeteerTimeoutMs?: number;
  }): Promise<RunCommandResponse> {
    let args: Parameters<typeof enqueueRunCommandJob>[0] = {
      realmURL,
      realmUsername: runAs,
      runAs,
      command,
      commandInput,
      puppeteerTimeoutMs: puppeteerTimeoutMs ?? null,
    };
    let job = await enqueueRunCommandJob(
      args,
      this.queuePublisher,
      this.dbAdapter,
      userInitiatedPriority,
      jobTimeoutSec,
    );
    return await job.done;
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
