import {
  logger,
  toBranchName,
  type RunCommandResponse,
} from '@cardstack/runtime-common';
import type { BotTriggerContent } from '@cardstack/base/matrix-event';
import { createHash } from 'node:crypto';
import type { GitHubClient, OpenPullRequestResult } from './github';

const log = logger('bot-runner:create-listing-pr');

const DEFAULT_REPO = 'cardstack/boxel-catalog';
const DEFAULT_BASE_BRANCH = 'main';

export type BotTriggerEventContent = BotTriggerContent;

interface CreateListingPRContext {
  owner: string;
  repoName: string;
  repo: string;
  head: string;
  title: string;
  listingDisplayName: string;
  roomId: string;
}

export interface CreatedListingPRResult {
  prNumber: number;
  prUrl: string;
  prTitle: string;
  branchName: string;
  summary: string | null;
}

function getCreateListingPRContext(
  eventContent: BotTriggerEventContent,
): CreateListingPRContext | null {
  if (eventContent.type !== 'pr-listing-create') {
    return null;
  }

  if (!eventContent.input || typeof eventContent.input !== 'object') {
    log.warn('pr-listing-create trigger is missing input payload');
    return null;
  }

  let input = eventContent.input as Record<string, unknown>;
  let roomId = typeof input.roomId === 'string' ? input.roomId.trim() : '';
  let listingName =
    typeof input.listingName === 'string' ? input.listingName.trim() : '';
  let listingDisplayName = listingName || 'UntitledListing';
  let title =
    typeof input.title === 'string' && input.title.trim()
      ? input.title.trim()
      : `Add ${listingDisplayName} listing`;
  let headBranch = toBranchName(roomId, listingDisplayName);

  if (!headBranch) {
    throw new Error('pr-listing-create trigger must include a valid branch');
  }

  if (!title) {
    throw new Error('pr-listing-create trigger must include a valid title');
  }

  let repo = DEFAULT_REPO;

  let [owner, repoName] = repo.split('/');
  if (!owner || !repoName) {
    throw new Error(`Invalid repo format: ${repo}. Expected "owner/repo"`);
  }

  return {
    owner,
    repoName,
    repo,
    head: headBranch,
    title,
    listingDisplayName,
    roomId,
  };
}

export class CreateListingPRHandler {
  constructor(private githubClient: GitHubClient) {}

  async ensureCreateListingBranch(
    eventContent: BotTriggerEventContent,
  ): Promise<void> {
    let context = getCreateListingPRContext(eventContent);
    if (!context) {
      return;
    }
    try {
      await this.githubClient.createBranch({
        owner: context.owner,
        repo: context.repoName,
        branch: context.head,
        fromBranch: DEFAULT_BASE_BRANCH,
      });
    } catch (error) {
      let message = error instanceof Error ? error.message : String(error);
      if (!message.includes('Reference already exists')) {
        throw error;
      }
    }
  }

  async addContentsToCommit(
    eventContent: BotTriggerEventContent,
    runCommandResult?: RunCommandResponse | null,
  ): Promise<void> {
    let context = getCreateListingPRContext(eventContent);
    if (!context) {
      return;
    }
    let branchWrite = await getContentsFromRealm(
      runCommandResult?.cardResultString,
    );
    if (branchWrite.files.length === 0) {
      return;
    }
    await this.githubClient.writeFilesToBranch({
      owner: context.owner,
      repo: context.repoName,
      branch: context.head,
      files: branchWrite.files,
      message: `add ${context.listingDisplayName} changes [boxel-content-hash:${branchWrite.hash}]`,
    });
  }

  async openCreateListingPR(
    eventContent: BotTriggerEventContent,
    runAs: string,
    runCommandResult?: RunCommandResponse | null,
    submissionCardUrl?: string | null,
  ): Promise<CreatedListingPRResult | null> {
    let context = getCreateListingPRContext(eventContent);
    if (!context) {
      return null;
    }
    let { owner, repoName, repo, head, title, listingDisplayName } = context;

    try {
      let summary = await this.getSubmissionSummary(
        eventContent,
        runAs,
        runCommandResult,
        submissionCardUrl,
      );
      let prParams = {
        owner,
        repo: repoName,
        title,
        head,
        base: DEFAULT_BASE_BRANCH,
        body: summary ?? undefined,
      };
      let result = await this.githubClient.openPullRequest(prParams);

      log.info('opened PR from pr-listing-create trigger', {
        runAs,
        repo,
        prUrl: result.html_url,
      });
      return mapOpenPullRequestResult(result, title, head, summary);
    } catch (error) {
      let message = error instanceof Error ? error.message : String(error);
      if (message.includes('No commits between')) {
        log.info('cannot open PR because branch has no commits beyond base', {
          runAs,
          repo,
          head,
          listingDisplayName,
          error: message,
        });
        return null;
      }

      if (message.includes('A pull request already exists')) {
        log.info('PR already exists for submission branch', {
          runAs,
          repo,
          head,
          error: message,
        });
        return null;
      }

      log.error('failed to open PR from pr-listing-create trigger', {
        runAs,
        repo,
        head,
        error: message,
      });
      throw error;
    }
  }

  async getSubmissionSummary(
    eventContent: BotTriggerEventContent,
    runAs: string,
    runCommandResult?: RunCommandResponse | null,
    submissionCardUrl?: string | null,
  ): Promise<string | null> {
    let context = getCreateListingPRContext(eventContent);
    if (!context) {
      return null;
    }
    let input =
      eventContent.input && typeof eventContent.input === 'object'
        ? (eventContent.input as Record<string, unknown>)
        : {};
    let listingSummary =
      typeof input.listingSummary === 'string'
        ? input.listingSummary.trim()
        : '';
    let files = await getContentsFromRealm(runCommandResult?.cardResultString);

    return [
      '## Summary',
       ...(listingSummary
        ? [listingSummary, '', '---']
        : []),
      `- Listing Name: ${context.listingDisplayName}`,
      `- Room ID: \`${context.roomId}\``,
      `- User ID: \`${runAs}\``,
      `- Number of Files: ${files.files.length}`,
      ...(submissionCardUrl
        ? [`- Submission Card: [${submissionCardUrl}](${submissionCardUrl})`]
        : []),
    ].join('\n');
  }
}

function mapOpenPullRequestResult(
  result: OpenPullRequestResult,
  prTitle: string,
  branchName: string,
  summary: string | null,
): CreatedListingPRResult {
  return {
    prNumber: result.number,
    prUrl: result.html_url,
    prTitle,
    branchName,
    summary,
  };
}

async function getContentsFromRealm(cardResultString?: string | null): Promise<{
  files: { path: string; content: string }[];
  hash: string;
}> {
  if (!cardResultString || !cardResultString.trim()) {
    return { files: [], hash: hashFiles([]) };
  }

  let parsed = parseJSONLike(cardResultString);
  if (parsed === undefined) {
    return { files: [], hash: hashFiles([]) };
  }

  let files = extractFileContents(parsed);
  return { files, hash: hashFiles(files) };
}

function parseJSONLike(value: string): unknown | undefined {
  let current: unknown = value;
  for (let i = 0; i < 3; i++) {
    if (typeof current !== 'string') {
      return current;
    }
    let text = current.trim();
    if (!text) {
      return undefined;
    }
    try {
      current = JSON.parse(text);
      continue;
    } catch {
      try {
        current = JSON.parse(decodeURIComponent(text));
        continue;
      } catch {
        return undefined;
      }
    }
  }
  return current;
}

function extractFileContents(
  doc: unknown,
): { path: string; content: string }[] {
  if (!doc || typeof doc !== 'object') {
    return [];
  }
  let root = doc as Record<string, unknown>;
  let attributes = (root.data as Record<string, unknown> | undefined)
    ?.attributes as Record<string, unknown> | undefined;
  let items = attributes?.allFileContents;
  if (!Array.isArray(items)) {
    items = attributes?.filesWithContent;
  }
  if (!Array.isArray(items)) {
    return [];
  }
  let dedupe = new Map<string, { path: string; content: string }>();
  for (let item of items) {
    let normalized =
      typeof item === 'string' ? parseJSONLike(item) : (item as unknown);
    if (!normalized || typeof normalized !== 'object') {
      continue;
    }
    let record = normalized as Record<string, unknown>;
    let path =
      typeof record.filename === 'string'
        ? record.filename.trim()
        : typeof record.path === 'string'
          ? record.path.trim()
          : '';
    let content =
      typeof record.contents === 'string'
        ? record.contents
        : typeof record.content === 'string'
          ? record.content
          : '';
    if (!path) {
      continue;
    }
    dedupe.set(path, { path, content });
  }
  return [...dedupe.values()];
}

function hashFiles(files: { path: string; content: string }[]): string {
  let normalized = files
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => `${file.path}\n${file.content}`)
    .join('\n---\n');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}
