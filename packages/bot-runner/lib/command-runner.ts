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
  type CreatedListingPRResult,
  type BotTriggerEventContent,
} from './create-listing-pr-handler';
import type { GitHubClient } from './github';

const log = logger('bot-runner');
const CREATE_PR_CARD_COMMAND =
  '@cardstack/catalog/commands/create-pr-card/default';
const PATCH_CARD_INSTANCE_COMMAND =
  '@cardstack/boxel-host/commands/patch-card-instance/default';

export class CommandRunner {
  private createListingPRHandler: CreateListingPRHandler;

  constructor(
    private submissionBotUserId: string,
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
      let allowedCommands =
        await this.getCommandsForRegistration(registrationId);
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

      // TODO: This inline handling for 'pr-listing-create' is a workaround.
      // In the absence, user-based proxy request which allows user to register auth tokens with an external api call
      if (eventContent.type === 'pr-listing-create') {
        // The workflow card URL was created by the host and passed via the bot trigger input
        let workflowCardUrl =
          typeof input.workflowCardUrl === 'string'
            ? input.workflowCardUrl
            : null;

        // Step 1: Prepare submission files (patches existing workflow card)
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
          if (workflowCardUrl) {
            await this.patchWorkflowStatus(
              runAs,
              realmURL,
              workflowCardUrl,
              'error',
              errorMessage,
            );
          }
          throw new Error(errorMessage);
        }

        // Use the workflow card URL from input (host-created) or fall back to command result
        let cardUrlFromResult = getCardUrl(result.cardResultString);
        workflowCardUrl = workflowCardUrl ?? cardUrlFromResult;

        // Step 2: Create the GitHub PR (workflow card already in 'creating-pr' status)
        let { prResult, submissionCardUrl } = await this.createPR({
          runAs,
          eventContent,
          result,
        });

        // submissionCardUrl is the card returned by the command (the workflow card)
        // Use the workflow card URL for linking the PrCard
        let cardToLink = workflowCardUrl ?? submissionCardUrl;

        // Step 3: Create PrCard and link it to the workflow card
        if (prResult && cardToLink) {
          if (workflowCardUrl) {
            await this.patchWorkflowStatus(
              runAs,
              realmURL,
              workflowCardUrl,
              'creating-pr-card',
            );
          }

          await this.createAndLinkPrCard({
            runAs,
            realmURL,
            submissionCardUrl: cardToLink,
            prResult,
          });

          // Step 4: Mark workflow as 'ready'
          if (workflowCardUrl) {
            await this.patchWorkflowStatus(
              runAs,
              realmURL,
              workflowCardUrl,
              'ready',
            );
          }
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
    concurrencyGroup,
  }: {
    runAs: string;
    realmURL: string;
    command: string;
    commandInput: Record<string, any> | null;
    concurrencyGroup?: string;
  }): Promise<RunCommandResponse> {
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
      concurrencyGroup ? { concurrencyGroup } : undefined,
    );
    return await job.done;
  }

  private async createPR({
    runAs,
    eventContent,
    result,
  }: {
    runAs: string;
    eventContent: BotTriggerEventContent;
    result: RunCommandResponse;
  }): Promise<{
    prResult: CreatedListingPRResult | null;
    submissionCardUrl: string | null;
  }> {
    let submissionCardUrl = getSubmissionCardUrl(result.cardResultString);
    await this.createListingPRHandler.ensureCreateListingBranch(eventContent);
    await this.createListingPRHandler.addContentsToCommit(eventContent, result);
    let prResult = await this.createListingPRHandler.openCreateListingPR(
      eventContent,
      runAs,
      result,
      submissionCardUrl,
    );
    return { prResult, submissionCardUrl };
  }

  private async createAndLinkPrCard({
    runAs,
    realmURL,
    submissionCardUrl,
    prResult,
  }: {
    runAs: string;
    realmURL: string;
    submissionCardUrl: string;
    prResult: CreatedListingPRResult;
  }): Promise<void> {
    let submissionRealm = new URL('/submissions/', realmURL).href;
    let listingConcurrencyGroup = `command:${submissionRealm}:listing:${prResult.branchName}`;
    let prCardResult = await this.enqueueRunCommand({
      runAs: this.submissionBotUserId,
      realmURL: submissionRealm,
      command: CREATE_PR_CARD_COMMAND,
      concurrencyGroup: listingConcurrencyGroup,
      commandInput: {
        realm: submissionRealm,
        prNumber: prResult.prNumber,
        prUrl: prResult.prUrl,
        prTitle: prResult.prTitle,
        branchName: prResult.branchName,
        prSummary: prResult.summary ?? undefined,
        submittedBy: runAs,
      },
    });

    let prCardUrl = getCardUrl(prCardResult.cardResultString);
    await this.enqueueRunCommand({
      runAs,
      realmURL,
      command: PATCH_CARD_INSTANCE_COMMAND,
      commandInput: {
        cardId: submissionCardUrl,
        patch: {
          relationships: {
            prCard: {
              links: {
                self: prCardUrl,
              },
            },
          },
        },
      },
    });
  }

  private async patchWorkflowStatus(
    runAs: string,
    realmURL: string,
    workflowCardUrl: string,
    status: string,
    errorMessage?: string,
  ): Promise<void> {
    try {
      let patch: Record<string, any> = {
        attributes: {
          submissionStatus: status,
          ...(errorMessage ? { submissionError: errorMessage } : {}),
        },
      };
      await this.enqueueRunCommand({
        runAs,
        realmURL,
        command: PATCH_CARD_INSTANCE_COMMAND,
        commandInput: {
          cardId: workflowCardUrl,
          patch,
        },
      });
    } catch (error) {
      log.error('failed to patch workflow status', {
        workflowCardUrl,
        status,
        error,
      });
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

function getCardUrl(cardResultString?: string | null): string | null {
  if (!cardResultString || !cardResultString.trim()) {
    return null;
  }
  try {
    let parsed = JSON.parse(cardResultString);
    let id = parsed?.data?.id;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

function getSubmissionCardUrl(cardResultString?: string | null): string | null {
  return getCardUrl(cardResultString);
}
