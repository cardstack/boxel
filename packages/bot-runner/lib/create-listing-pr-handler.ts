import { logger, toBranchName } from '@cardstack/runtime-common';
import type { BotTriggerContent } from 'https://cardstack.com/base/matrix-event';
import type { GitHubClient } from './github';

const log = logger('bot-runner:create-listing-pr');

const DEFAULT_REPO = 'cardstack/boxel-catalog';
const DEFAULT_BASE_BRANCH = 'main';

export type BotTriggerEventContent = BotTriggerContent;

export type CreateListingPRHandler = (args: {
  eventContent: BotTriggerEventContent;
  runAs: string;
  githubClient: GitHubClient;
}) => Promise<void>;

export const openCreateListingPR: CreateListingPRHandler = async ({
  eventContent,
  runAs,
  githubClient,
}) => {
  if (eventContent.type !== 'pr-listing-create') {
    return;
  }

  if (!eventContent.input || typeof eventContent.input !== 'object') {
    log.warn('pr-listing-create trigger is missing input payload');
    return;
  }

  let input = eventContent.input as Record<string, unknown>;
  let roomId = typeof input.roomId === 'string' ? input.roomId.trim() : '';
  let listingName =
    typeof input.listingName === 'string' ? input.listingName.trim() : '';
  let listingDisplayName = listingName || 'UntitledListing';
  let title =
    typeof input.title === 'string' && input.title.trim()
      ? input.title.trim()
      : `Add listing: ${listingDisplayName}`;
  let headBranch = toBranchName(roomId, listingDisplayName);

  if (!headBranch) {
    throw new Error('pr-listing-create trigger must include a valid branch');
  }

  if (!title) {
    log.error('No title for the listing');
    return;
  }

  let repo = DEFAULT_REPO;

  let [owner, repoName] = repo.split('/');
  if (!owner || !repoName) {
    throw new Error(`Invalid repo format: ${repo}. Expected "owner/repo"`);
  }

  // TODO: create the head branch before attempting to open the pull request.
  let head = 'test-submissions'; //TODO: pls remove this temporary
  // let head = headBranch;

  try {
    let result = await githubClient.openPullRequest(
      {
        owner,
        repo: repoName,
        title,
        head,
        base: DEFAULT_BASE_BRANCH,
      },
      {
        label: runAs,
      },
    );

    log.info('opened PR from pr-listing-create trigger', {
      runAs,
      repo,
      prUrl: result.html_url,
    });
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error);
    if (message.includes('A pull request already exists')) {
      log.info('PR already exists for submission branch', {
        runAs,
        repo,
        head,
        error: message,
      });
      return;
    }

    log.error('failed to open PR from pr-listing-create trigger', {
      runAs,
      repo,
      head,
      error: message,
    });
    throw error;
  }

  return;
};
