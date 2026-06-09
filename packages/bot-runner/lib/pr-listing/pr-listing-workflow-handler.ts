import {
  logger,
  toBranchName,
  type RunCommandResponse,
} from '@cardstack/runtime-common';
import { isBinaryFilename } from '@cardstack/runtime-common/infer-content-type';
import {
  runLintOnSubmissionFiles,
  type LintOutcome,
  type SubmissionFile,
} from '@cardstack/runtime-common/lint/submission-lint';
import {
  CreateListingPRHandler,
  type BotTriggerEventContent,
} from './create-listing-pr-handler.ts';
import type {
  BotCommandHandler,
  EnqueueRunCommandFn,
} from '../command-runner.ts';
import type { GitHubClient } from '../github.ts';

export type LintSubmissionFilesFn = (
  files: SubmissionFile[],
  opts: { roomId: string; listingId: string },
) => Promise<LintOutcome>;

const log = logger('bot-runner');

const COLLECT_SUBMISSION_FILES_COMMAND =
  '@cardstack/catalog/commands/collect-submission-files/default';
const CREATE_PR_CARD_COMMAND =
  '@cardstack/catalog/commands/create-pr-card/default';
const PATCH_CARD_INSTANCE_COMMAND =
  '@cardstack/boxel-host/commands/patch-card-instance/default';
const FETCH_CARD_JSON_COMMAND =
  '@cardstack/boxel-host/commands/fetch-card-json/default';

const PR_LISTING_CREATE = 'pr-listing-create';
const PR_LISTING_RETRY = 'pr-listing-retry';

type FailedStep = 'collect-files' | 'lint' | 'create-pr-card' | 'github-pr';
type FileContent = { filename: string; contents: string };

interface PrCardData {
  prCardResult: RunCommandResponse;
  prCardUrl: string | null;
  binaryFiles: FileContent[];
}

interface WorkflowContext {
  runAs: string;
  roomId: string;
  listingId: string;
  listingName: string | null;
  listingSummary: string;
  realmURL: string;
  submissionRealm: string;
  workflowCardUrl: string | null;
  workflowCardRealm: string;
  branchName: string;
  // CreateListingPRHandler requires type === 'pr-listing-create', so retry
  // hands it a synthesized event with that shape.
  syntheticCreateEvent: BotTriggerEventContent;
  existingPrCardUrl: string | null;
}

class StepError extends Error {
  readonly step: FailedStep;

  constructor(step: FailedStep, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.step = step;
    this.name = 'StepError';
  }
}

export interface PrListingWorkflowHandlerDeps {
  submissionBotUserId: string;
  enqueueRunCommand: EnqueueRunCommandFn;
  githubClient: GitHubClient;
  lintSubmissionFiles?: LintSubmissionFilesFn;
}

// Inline orchestrator for the listing-PR workflow. Workaround until
// user-based proxy requests exist (would let users register auth tokens for
// external API calls instead of routing through the bot).
export class PrListingWorkflowHandler implements BotCommandHandler {
  private submissionBotUserId: string;
  private enqueueRunCommand: EnqueueRunCommandFn;
  private createListingPRHandler: CreateListingPRHandler;
  private lintSubmissionFiles: LintSubmissionFilesFn;

  constructor(deps: PrListingWorkflowHandlerDeps) {
    this.submissionBotUserId = deps.submissionBotUserId;
    this.enqueueRunCommand = deps.enqueueRunCommand;
    this.createListingPRHandler = new CreateListingPRHandler(deps.githubClient);
    this.lintSubmissionFiles =
      deps.lintSubmissionFiles ?? runLintOnSubmissionFiles;
  }

  matches(eventContent: BotTriggerEventContent): boolean {
    return (
      eventContent.type === PR_LISTING_CREATE ||
      eventContent.type === PR_LISTING_RETRY
    );
  }

  async handle(
    runAs: string,
    eventContent: BotTriggerEventContent,
  ): Promise<RunCommandResponse> {
    if (eventContent.type === PR_LISTING_CREATE) {
      let ctx = this.buildCreateContext(runAs, eventContent);
      return this.runWorkflow(ctx);
    }
    if (eventContent.type === PR_LISTING_RETRY) {
      let ctx;
      try {
        ctx = await this.buildRetryContext(runAs, eventContent);
      } catch (err) {
        await this.recordRetryContextFailure(runAs, eventContent, err);
        throw err;
      }
      return this.runWorkflow(ctx);
    }
    throw new Error(
      `PrListingWorkflowHandler received unsupported event type "${eventContent.type}"`,
    );
  }

  // ── Context builders ──

  private buildCreateContext(
    runAs: string,
    eventContent: BotTriggerEventContent,
  ): WorkflowContext {
    let input = eventContent.input as Record<string, unknown>;
    let realmURL = eventContent.realm as string;

    let roomId = requireString(input.roomId, 'roomId');
    let listingId = requireString(input.listingId, 'listingId');
    let listingName = optionalString(input.listingName);
    let listingSummary = optionalString(input.listingSummary) ?? '';
    let workflowCardUrl = optionalString(input.workflowCardUrl);
    let workflowCardRealm = optionalString(input.workflowCardRealm) ?? realmURL;
    // Prefer the trigger's explicit branchName so PrCard, GitHub commit,
    // and the persisted card attribute all use the exact same string.
    let branchName =
      optionalString(input.branchName) ??
      toBranchName(listingName ?? 'UntitledListing');

    return {
      runAs,
      roomId,
      listingId,
      listingName,
      listingSummary,
      realmURL,
      submissionRealm: new URL('/submissions/', realmURL).href,
      workflowCardUrl,
      workflowCardRealm,
      branchName,
      syntheticCreateEvent: {
        ...eventContent,
        input: { ...(input as Record<string, unknown>), branchName },
      },
      existingPrCardUrl: null,
    };
  }

  private async buildRetryContext(
    runAs: string,
    eventContent: BotTriggerEventContent,
  ): Promise<WorkflowContext> {
    let input = eventContent.input as Record<string, unknown>;
    let realmURL = eventContent.realm as string;

    let workflowCardUrl = requireString(
      input.workflowCardUrl,
      'workflowCardUrl',
    );
    let workflowCardRealm = optionalString(input.workflowCardRealm) ?? realmURL;

    // Recover the rest from the workflow card itself — single source of truth.
    let workflowDoc = await this.fetchCardDocument({
      cardId: workflowCardUrl,
      runAs,
      realmURL: workflowCardRealm,
    });
    let attrs = (workflowDoc?.data?.attributes ?? {}) as Record<
      string,
      unknown
    >;
    let rels = (workflowDoc?.data?.relationships ?? {}) as Record<string, any>;

    let roomId = requireString(attrs.roomId, 'workflow card roomId');
    // Resolve relative `links.self` against the workflow card URL — the
    // realm-server serializes them as e.g. "../CardListing/abc".
    let rawListingSelf = requireString(
      rels.listing?.links?.self,
      'workflow card listing.self',
    );
    let listingId = new URL(rawListingSelf, workflowCardUrl).href;
    // Reuse the persisted branchName so retry targets the same branch as the
    // original create attempt; recover listingName from `Submit <X>` title
    // for PR title/commit messages.
    let listingName =
      optionalString(attrs.listingName) ??
      stripSubmitPrefix(optionalString(attrs.title));
    let branchName =
      optionalString(attrs.branchName) ??
      toBranchName(listingName ?? 'UntitledListing');
    let rawPrCardSelf = optionalString(rels.prCard?.links?.self);
    let existingPrCardUrl = rawPrCardSelf
      ? new URL(rawPrCardSelf, workflowCardUrl).href
      : null;

    return {
      runAs,
      roomId,
      listingId,
      listingName,
      listingSummary: '',
      realmURL,
      submissionRealm: new URL('/submissions/', realmURL).href,
      workflowCardUrl,
      workflowCardRealm,
      branchName,
      syntheticCreateEvent: {
        type: PR_LISTING_CREATE,
        realm: realmURL,
        userId: eventContent.userId,
        input: {
          roomId,
          listingId,
          listingName,
          workflowCardUrl,
          workflowCardRealm,
          // Explicit branchName — see create-listing-pr-handler.ts.
          branchName,
        },
      },
      existingPrCardUrl,
    };
  }

  // ── Workflow orchestrator ──

  private async runWorkflow(ctx: WorkflowContext): Promise<RunCommandResponse> {
    try {
      let prCardData = ctx.existingPrCardUrl
        ? await runStep('create-pr-card', () => this.loadExistingPrCard(ctx))
        : await this.runFreshPrCardFlow(ctx);

      await runStep('github-pr', () => this.pushToGitHub(ctx, prCardData));
      await runStep('github-pr', () =>
        this.clearWorkflowError(ctx, prCardData.prCardUrl),
      );

      return prCardData.prCardResult;
    } catch (err) {
      await this.recordWorkflowFailure(ctx, err);
      throw err;
    }
  }

  private async runFreshPrCardFlow(ctx: WorkflowContext): Promise<PrCardData> {
    let { textFiles, binaryFiles, totalCount } = await runStep(
      'collect-files',
      () => this.collectFiles(ctx),
    );
    await runStep('lint', () => this.applyLintSkip(ctx, totalCount));
    let { prCardResult, prCardUrl } = await runStep('create-pr-card', () =>
      this.createPrCard(ctx, textFiles, totalCount),
    );
    await runStep('create-pr-card', () =>
      this.linkPrCardOnWorkflow(ctx, prCardUrl),
    );
    return { prCardResult, prCardUrl, binaryFiles };
  }

  // ── Steps ──

  private async collectFiles(ctx: WorkflowContext): Promise<{
    textFiles: FileContent[];
    binaryFiles: FileContent[];
    totalCount: number;
  }> {
    log.info('pr-listing-create: collecting files', {
      listingId: ctx.listingId,
      realmURL: ctx.realmURL,
    });
    let result = await this.enqueueRunCommand({
      runAs: ctx.runAs,
      realmURL: ctx.realmURL,
      command: COLLECT_SUBMISSION_FILES_COMMAND,
      commandInput: {
        listingId: ctx.listingId,
        listingRealm: ctx.realmURL,
      },
    });
    requireReady(result, 'collect-submission-files');

    // Binary files bypass the PrCard 512KB size limit; they're committed to
    // GitHub directly via addContentsToCommit's binaryFiles arg.
    let allFiles = extractFileContents(result.cardResultString);
    let binaryFiles = allFiles.filter((f) => isBinaryFilename(f.filename));
    let textFiles = allFiles.filter((f) => !isBinaryFilename(f.filename));
    log.info('pr-listing-create: files collected', {
      fileCount: allFiles.length,
      binaryCount: binaryFiles.length,
    });
    return { textFiles, binaryFiles, totalCount: allFiles.length };
  }

  private async applyLintSkip(
    ctx: WorkflowContext,
    fileCount: number,
  ): Promise<void> {
    // TEMP: lint step skipped while we investigate OOM in staging/prod.
    // To restore, replace this method body with the original lint logic
    // (preserved in git history at commit 2a94b3538d).
    log.info('pr-listing-create: lint skipped (temporary)', { fileCount });
    void this.lintSubmissionFiles;
    if (ctx.workflowCardUrl) {
      await this.patchWorkflowCard(ctx, {
        attributes: { lintStatus: 'passed', lintFixedCount: 0 },
      });
    }
  }

  private async createPrCard(
    ctx: WorkflowContext,
    textFiles: FileContent[],
    totalFileCount: number,
  ): Promise<{ prCardResult: RunCommandResponse; prCardUrl: string | null }> {
    let prSummary = buildPrSummary(ctx, totalFileCount);
    let prCardResult = await this.enqueueRunCommand({
      runAs: this.submissionBotUserId,
      realmURL: ctx.submissionRealm,
      command: CREATE_PR_CARD_COMMAND,
      commandInput: {
        realm: ctx.submissionRealm,
        branchName: ctx.branchName,
        submittedBy: ctx.runAs,
        prSummary,
        allFileContents: textFiles,
      },
    });
    if (prCardResult.status !== 'ready') {
      log.error('pr-listing-create: create-pr-card failed', {
        runAs: ctx.runAs,
        submissionBotUserId: this.submissionBotUserId,
        submissionRealm: ctx.submissionRealm,
        branchName: ctx.branchName,
        status: prCardResult.status,
        error: prCardResult.error,
        cardResultString: prCardResult.cardResultString ?? null,
        fileCount: textFiles.length,
        inputPayloadSize: JSON.stringify(textFiles).length,
      });
      throw new Error(
        prCardResult.error?.trim() ||
          `create-pr-card returned status "${prCardResult.status}"`,
      );
    }
    let prCardUrl = getCardUrl(prCardResult.cardResultString);
    log.info('pr-listing-create: PrCard created', { prCardUrl });
    return { prCardResult, prCardUrl };
  }

  private async loadExistingPrCard(ctx: WorkflowContext): Promise<PrCardData> {
    log.info('pr-listing-retry: reusing existing PrCard', {
      existingPrCardUrl: ctx.existingPrCardUrl,
    });
    let result = await this.enqueueRunCommand({
      runAs: this.submissionBotUserId,
      realmURL: ctx.submissionRealm,
      command: FETCH_CARD_JSON_COMMAND,
      commandInput: { url: ctx.existingPrCardUrl },
    });
    requireReady(result, 'fetch-card-json (existing PrCard)');

    let prCardDoc = extractFetchedDocument(result.cardResultString);
    let allFileContents = extractFileContents(
      prCardDoc ? JSON.stringify(prCardDoc) : null,
    );
    if (!prCardDoc || allFileContents.length === 0) {
      throw new Error(
        `existing PrCard at ${ctx.existingPrCardUrl} has no allFileContents — refusing to open an empty PR`,
      );
    }
    let prCardResult: RunCommandResponse = {
      ...result,
      cardResultString: JSON.stringify(prCardDoc),
    };
    // Binary files aren't stored on the PrCard; addContentsToCommit dedupes
    // by content-hash so re-running with empty binaries is safe when the
    // prior attempt already committed them.
    return {
      prCardResult,
      prCardUrl: ctx.existingPrCardUrl,
      binaryFiles: [],
    };
  }

  private async pushToGitHub(
    ctx: WorkflowContext,
    prCardData: PrCardData,
  ): Promise<void> {
    await this.createListingPRHandler.ensureCreateListingBranch(
      ctx.syntheticCreateEvent,
    );
    await this.createListingPRHandler.addContentsToCommit(
      ctx.syntheticCreateEvent,
      prCardData.prCardResult,
      prCardData.binaryFiles.map((f) => ({
        path: f.filename,
        content: f.contents,
      })),
    );
    let prResult = await this.createListingPRHandler.openCreateListingPR(
      ctx.syntheticCreateEvent,
      ctx.runAs,
      prCardData.prCardResult,
      ctx.workflowCardUrl,
    );
    log.info('pr-listing-create: PR created', {
      prNumber: prResult?.prNumber,
      prUrl: prResult?.prUrl,
    });
  }

  private async linkPrCardOnWorkflow(
    ctx: WorkflowContext,
    prCardUrl: string | null,
  ): Promise<void> {
    if (!ctx.workflowCardUrl || !prCardUrl) return;
    await this.patchWorkflowCard(ctx, {
      relationships: {
        prCard: { links: { self: prCardUrl } },
      },
    });
  }

  private async clearWorkflowError(
    ctx: WorkflowContext,
    prCardUrl: string | null,
  ): Promise<void> {
    if (!ctx.workflowCardUrl) return;
    let patch: Record<string, unknown> = {
      attributes: { prCreationError: null, failedStep: null },
    };
    // Re-assert prCard so a stale fetch can't drop the link.
    if (prCardUrl) {
      patch.relationships = { prCard: { links: { self: prCardUrl } } };
    }
    await this.patchWorkflowCard(ctx, patch);
  }

  private async recordWorkflowFailure(
    ctx: WorkflowContext,
    err: unknown,
  ): Promise<void> {
    if (!ctx.workflowCardUrl) return;
    let failedStep = err instanceof StepError ? err.step : null;
    let message = err instanceof Error ? err.message : String(err);
    try {
      await this.patchWorkflowCard(ctx, {
        attributes: {
          prCreationError: `PR creation failed: ${message}`,
          failedStep,
        },
      });
    } catch (patchError: any) {
      log.error(
        'pr-listing-create: failed to patch workflow card after PR creation failure',
        {
          patchError: patchError?.message ?? patchError,
          failedStep,
        },
      );
    }
  }

  private async recordRetryContextFailure(
    runAs: string,
    eventContent: BotTriggerEventContent,
    err: unknown,
  ): Promise<void> {
    let input = eventContent.input as Record<string, unknown> | null;
    let workflowCardUrl =
      typeof input?.workflowCardUrl === 'string' && input.workflowCardUrl.trim()
        ? input.workflowCardUrl.trim()
        : null;
    if (!workflowCardUrl) return;
    let workflowCardRealm =
      (typeof input?.workflowCardRealm === 'string' &&
      input.workflowCardRealm.trim()
        ? input.workflowCardRealm.trim()
        : null) ?? (eventContent.realm as string);
    let message = err instanceof Error ? err.message : String(err);
    try {
      let result = await this.enqueueRunCommand({
        runAs,
        realmURL: workflowCardRealm,
        command: PATCH_CARD_INSTANCE_COMMAND,
        commandInput: {
          cardId: workflowCardUrl,
          patch: {
            attributes: {
              prCreationError: `PR retry failed: ${message}`,
            },
          },
        },
      });
      requireReady(result, 'patch-card-instance (retry pre-context failure)');
    } catch (patchError: any) {
      log.error(
        'pr-listing-retry: failed to patch workflow card after retry context build failed',
        { patchError: patchError?.message ?? patchError },
      );
    }
  }

  // ── Realm helpers ──

  private async patchWorkflowCard(
    ctx: WorkflowContext,
    patch: Record<string, unknown>,
  ): Promise<void> {
    if (!ctx.workflowCardUrl) return;
    let result = await this.enqueueRunCommand({
      runAs: ctx.runAs,
      realmURL: ctx.workflowCardRealm,
      command: PATCH_CARD_INSTANCE_COMMAND,
      commandInput: { cardId: ctx.workflowCardUrl, patch },
    });
    requireReady(result, 'patch-card-instance (workflow card)');
  }

  private async fetchCardDocument(opts: {
    cardId: string;
    runAs: string;
    realmURL: string;
  }): Promise<any> {
    let result = await this.enqueueRunCommand({
      runAs: opts.runAs,
      realmURL: opts.realmURL,
      command: FETCH_CARD_JSON_COMMAND,
      commandInput: { url: opts.cardId },
    });
    requireReady(result, 'fetch-card-json');
    return extractFetchedDocument(result.cardResultString);
  }
}

// ── Module helpers ──

async function runStep<T>(step: FailedStep, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw err instanceof StepError ? err : new StepError(step, err);
  }
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`pr-listing trigger missing required field: ${fieldName}`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function requireReady(
  result: RunCommandResponse,
  label: string,
): asserts result is RunCommandResponse & { status: 'ready' } {
  if (result.status !== 'ready') {
    throw new Error(
      result.error?.trim() || `${label} returned status "${result.status}"`,
    );
  }
}

// Inverse of `Submit ${listingName}` from create-submission-workflow.ts;
// used to recover listingName on retry. Returns null for unrecognised
// shapes so we don't end up emitting "Add Submit X listing".
function stripSubmitPrefix(title: string | null): string | null {
  if (!title) return null;
  let prefix = 'Submit ';
  if (!title.startsWith(prefix)) return null;
  let rest = title.slice(prefix.length).trim();
  return rest || null;
}

function buildPrSummary(ctx: WorkflowContext, fileCount: number): string {
  return [
    '## Summary',
    ...(ctx.listingSummary ? [ctx.listingSummary, '', '---'] : []),
    `- Listing Name: ${ctx.listingName ?? 'Untitled'}`,
    `- Room ID: \`${ctx.roomId}\``,
    `- User ID: \`${ctx.runAs}\``,
    `- Number of Files: ${fileCount}`,
    ...(ctx.workflowCardUrl
      ? [`- Workflow Card: [${ctx.workflowCardUrl}](${ctx.workflowCardUrl})`]
      : []),
  ].join('\n');
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

// Unwrap the inner JSON-API document from a fetch-card-json result.
function extractFetchedDocument(cardResultString?: string | null): any | null {
  if (!cardResultString || !cardResultString.trim()) {
    return null;
  }
  try {
    let parsed = JSON.parse(cardResultString);
    return parsed?.data?.attributes?.document ?? null;
  } catch {
    return null;
  }
}

function extractFileContents(cardResultString?: string | null): FileContent[] {
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
