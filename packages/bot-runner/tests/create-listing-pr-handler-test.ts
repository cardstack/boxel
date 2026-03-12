import { module, test } from 'qunit';
import type { GitHubClient } from '../lib/github';
import {
  CreateListingPRHandler,
  type BotTriggerEventContent,
} from '../lib/create-listing-pr-handler';

module('create-listing-pr handler', () => {
  test('opens PR with expected params and summary body', async (assert) => {
    let opened: { params: unknown }[] = [];
    let githubClient: GitHubClient = {
      openPullRequest: async (params) => {
        opened.push({ params });
        return { number: 1, html_url: 'https://example.com/pr/1' };
      },
      createBranch: async () => ({ ref: 'refs/heads/test', sha: 'abc123' }),
      writeFileToBranch: async () => ({ commitSha: 'def456' }),
      writeFilesToBranch: async () => ({ commitSha: 'def456' }),
    };

    let eventContent: BotTriggerEventContent = {
      type: 'pr-listing-create',
      realm: 'http://localhost:4201/test/',
      userId: '@alice:localhost',
      input: {
        roomId: '!abc123:localhost',
        listingName: 'My Listing',
        listingDescription: 'Example listing',
      },
    };

    let handler = new CreateListingPRHandler(githubClient);
    let result = await handler.openCreateListingPR(
      eventContent,
      '@alice:localhost',
      {
        status: 'ready',
        cardResultString: JSON.stringify({
          data: {
            attributes: {
              allFileContents: [
                { filename: 'catalog/Listing/listing.json', contents: '{}' },
                { filename: 'catalog/Listing/readme.md', contents: '# readme' },
              ],
            },
          },
        }),
      },
    );

    assert.strictEqual(result?.prNumber, 1, 'returns PR number');
    assert.strictEqual(result?.prUrl, 'https://example.com/pr/1', 'returns PR URL');
    assert.strictEqual(
      result?.prTitle,
      'Add My Listing listing',
      'returns PR title',
    );
    assert.true(
      result?.branchName?.endsWith('/my-listing') ?? false,
      'returns branch name used to open the PR',
    );

    assert.strictEqual(opened.length, 1, 'opens exactly one PR');
    let openedCall = opened[0] as {
      params: Record<string, unknown>;
    };

    assert.propContains(
      openedCall.params,
      {
        owner: 'cardstack',
        repo: 'boxel-catalog',
        title: 'Add My Listing listing',
        base: 'main',
      },
      'passes expected PR params',
    );
    assert.true(
      openedCall.params.head?.toString().includes('my-listing'),
      'head branch includes listing slug',
    );
    assert.true(
      openedCall.params.body?.toString().includes('## Summary'),
      'includes summary markdown body',
    );
    assert.true(
      openedCall.params.body?.toString().includes('- Number of Files: 2'),
      'summary body includes file count',
    );
    assert.false(
      openedCall.params.body?.toString().includes('Submission Card'),
      'summary body omits submission card URL when not provided',
    );
  });

  test('includes submission card URL as a markdown link when provided', async (assert) => {
    let opened: { params: unknown }[] = [];
    let githubClient: GitHubClient = {
      openPullRequest: async (params) => {
        opened.push({ params });
        return { number: 2, html_url: 'https://example.com/pr/2' };
      },
      createBranch: async () => ({ ref: 'refs/heads/test', sha: 'abc123' }),
      writeFileToBranch: async () => ({ commitSha: 'def456' }),
      writeFilesToBranch: async () => ({ commitSha: 'def456' }),
    };

    let eventContent: BotTriggerEventContent = {
      type: 'pr-listing-create',
      realm: 'http://localhost:4201/test/',
      userId: '@alice:localhost',
      input: {
        roomId: '!abc123:localhost',
        listingName: 'My Listing',
        listingDescription: 'Example listing',
      },
    };

    let submissionCardUrl =
      'http://localhost:4201/submissions/SubmissionCard/abc-123';

    let handler = new CreateListingPRHandler(githubClient);
    let result = await handler.openCreateListingPR(
      eventContent,
      '@alice:localhost',
      {
        status: 'ready',
        cardResultString: JSON.stringify({
          data: {
            id: submissionCardUrl,
            attributes: {
              allFileContents: [
                { filename: 'catalog/Listing/listing.json', contents: '{}' },
              ],
            },
          },
        }),
      },
      submissionCardUrl,
    );
    assert.strictEqual(result?.prNumber, 2, 'returns PR metadata when opened');

    assert.strictEqual(opened.length, 1, 'opens exactly one PR');
    let body = (opened[0] as { params: Record<string, unknown> }).params.body?.toString() ?? '';
    assert.true(
      body.includes(`[${submissionCardUrl}](${submissionCardUrl})`),
      'summary body includes submission card URL as a markdown link',
    );
  });

  test('returns null when PR already exists', async (assert) => {
    let githubClient: GitHubClient = {
      openPullRequest: async () => {
        throw new Error('A pull request already exists for this branch');
      },
      createBranch: async () => ({ ref: 'refs/heads/test', sha: 'abc123' }),
      writeFileToBranch: async () => ({ commitSha: 'def456' }),
      writeFilesToBranch: async () => ({ commitSha: 'def456' }),
    };

    let eventContent: BotTriggerEventContent = {
      type: 'pr-listing-create',
      realm: 'http://localhost:4201/test/',
      userId: '@alice:localhost',
      input: {
        roomId: '!abc123:localhost',
        listingName: 'My Listing',
      },
    };

    let handler = new CreateListingPRHandler(githubClient);
    let result = await handler.openCreateListingPR(
      eventContent,
      '@alice:localhost',
    );

    assert.strictEqual(result, null, 'returns null when PR already exists');
  });

  test('returns null when branch has no commits beyond base', async (assert) => {
    let githubClient: GitHubClient = {
      openPullRequest: async () => {
        throw new Error('No commits between main and feature-branch');
      },
      createBranch: async () => ({ ref: 'refs/heads/test', sha: 'abc123' }),
      writeFileToBranch: async () => ({ commitSha: 'def456' }),
      writeFilesToBranch: async () => ({ commitSha: 'def456' }),
    };

    let eventContent: BotTriggerEventContent = {
      type: 'pr-listing-create',
      realm: 'http://localhost:4201/test/',
      userId: '@alice:localhost',
      input: {
        roomId: '!abc123:localhost',
        listingName: 'My Listing',
      },
    };

    let handler = new CreateListingPRHandler(githubClient);
    let result = await handler.openCreateListingPR(
      eventContent,
      '@alice:localhost',
    );

    assert.strictEqual(
      result,
      null,
      'returns null when no PR can be opened',
    );
  });
});
