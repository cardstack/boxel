import {
  isBotCommandFilter,
  logger,
  param,
  query,
  toBranchName,
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
const COLLECT_SUBMISSION_FILES_COMMAND =
  '@cardstack/catalog/commands/collect-submission-files/default';
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
        let workflowCardUrl =
          typeof input.workflowCardUrl === 'string'
            ? input.workflowCardUrl
            : null;
        let workflowCardRealm =
          typeof input.workflowCardRealm === 'string'
            ? input.workflowCardRealm
            : null;
        let listingId =
          typeof input.listingId === 'string' ? input.listingId : null;
        let listingName =
          typeof input.listingName === 'string' ? input.listingName : null;
        let roomId = typeof input.roomId === 'string' ? input.roomId : null;
        let branchName = toBranchName(roomId ?? '', listingName ?? 'Listing');

        let effectiveWorkflowRealm = workflowCardRealm ?? realmURL;
        let submissionRealm = new URL('/submissions/', realmURL).href;

        // Step 1: Collect files — runs as USER in the LISTING realm
        log.info('pr-listing-create: collecting files', {
          listingId,
          realmURL,
        });

        let filesResult = await this.enqueueRunCommand({
          runAs,
          realmURL,
          command: COLLECT_SUBMISSION_FILES_COMMAND,
          commandInput: {
            listingId,
            listingRealm: realmURL,
          },
        });

        if (filesResult.status !== 'ready') {
          let errorMessage =
            filesResult.error && filesResult.error.trim()
              ? filesResult.error
              : `collect-submission-files returned status "${filesResult.status}"`;
          log.error('pr-listing-create: collect files failed', {
            runAs,
            status: filesResult.status,
            error: filesResult.error,
          });
          throw new Error(errorMessage);
        }

        // Extract allFileContents from the result
        let allFileContents = extractFileContents(filesResult.cardResultString);
        log.info('pr-listing-create: files collected', {
          fileCount: allFileContents.length,
        });

        // Step 2: Create PrCard — runs as SUBMISSION BOT in the SUBMISSIONS realm
        log.info('pr-listing-create: creating PrCard', {
          submissionBotUserId: this.submissionBotUserId,
          submissionRealm,
          branchName,
          submittedBy: runAs,
          fileCount: allFileContents.length,
          inputPayloadSize: JSON.stringify(allFileContents).length,
        });
        let prCardResult = await this.enqueueRunCommand({
          runAs: this.submissionBotUserId,
          realmURL: submissionRealm,
          command: CREATE_PR_CARD_COMMAND,
          commandInput: {
            realm: submissionRealm,
            branchName,
            submittedBy: runAs,
            allFileContents: allFileContents,
          },
        });

        if (prCardResult.status !== 'ready') {
          let errorMessage =
            prCardResult.error && prCardResult.error.trim()
              ? prCardResult.error
              : `create-pr-card returned status "${prCardResult.status}"`;
          log.error('pr-listing-create: create-pr-card failed', {
            runAs,
            submissionBotUserId: this.submissionBotUserId,
            submissionRealm,
            branchName,
            status: prCardResult.status,
            error: prCardResult.error,
            cardResultString: prCardResult.cardResultString ?? null,
            fileCount: allFileContents.length,
            inputPayloadSize: JSON.stringify(allFileContents).length,
          });
          throw new Error(errorMessage);
        }

        let prCardUrl = getCardUrl(prCardResult.cardResultString);
        log.info('pr-listing-create: PrCard created', { prCardUrl });

        // Step 3: Create the GitHub PR using file contents from the PrCard
        await this.createListingPRHandler.ensureCreateListingBranch(
          eventContent,
        );
        await this.createListingPRHandler.addContentsToCommit(
          eventContent,
          prCardResult,
        );
        let prResult = await this.createListingPRHandler.openCreateListingPR(
          eventContent,
          runAs,
          prCardResult,
          workflowCardUrl,
        );

        log.info('pr-listing-create: PR created', {
          prNumber: prResult?.prNumber,
          prUrl: prResult?.prUrl,
        });

        // Step 3: Link PrCard to workflow card
        if (workflowCardUrl && prCardUrl) {
          await this.enqueueRunCommand({
            runAs,
            realmURL: effectiveWorkflowRealm,
            command: PATCH_CARD_INSTANCE_COMMAND,
            commandInput: {
              cardId: workflowCardUrl,
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

        return prCardResult;
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

function extractFileContents(
  cardResultString?: string | null,
): { filename: string; contents: string }[] {
  if (!cardResultString || !cardResultString.trim()) {
    return [];
  }
  try {
    let parsed = JSON.parse(cardResultString);
    let items = parsed?.data?.attributes?.allFileContents;
    if (!Array.isArray(items)) {
      return [];
    }
    return items.filter(
      (item: any) =>
        item &&
        typeof item.filename === 'string' &&
        typeof item.contents === 'string',
    );
  } catch {
    return [];
  }
}
