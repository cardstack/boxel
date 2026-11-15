import QUnit from 'qunit';
const { module, test } = QUnit;
import type { GitHubClient } from '../lib/github.ts';
import {
  CreateListingPRHandler,
  type BotTriggerEventContent,
} from '../lib/pr-listing/create-listing-pr-handler.ts';

const BRANCH_PATTERN = /^[a-f0-9]{6}-/;

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
        listingSummary: 'My listing Summary',
      },
    };

    let handler = new CreateListingPRHandler(githubClient);
    let result = await handler.openCreateListingPR(
      eventContent,
      '@alice:localhost',
      2,
    );

    assert.strictEqual(result?.prNumber, 1, 'returns PR number');
    assert.strictEqual(
      result?.prUrl,
      'https://example.com/pr/1',
      'returns PR URL',
    );
    assert.strictEqual(
      result?.prTitle,
      'Add My Listing listing',
      'returns PR title',
    );
    assert.true(
      /^[a-f0-9]{6}-my-listing$/.test(result?.branchName ?? ''),
      `returns branch name used to open the PR: ${result?.branchName}`,
    );
    assert.true(
      result?.summary?.includes('## Summary') ?? false,
      'returns generated summary for downstream consumers',
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
      'summary body omits workflow card URL when not provided',
    );
    assert.true(
      openedCall.params.body?.toString().includes('My listing Summary\n\n---'),
      'summary body includes listing summary followed by divider',
    );
  });

  test('includes workflow card URL as a markdown link when provided', async (assert) => {
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
        listingSummary: 'My listing Summary',
      },
    };

    let workflowCardUrl =
      'http://localhost:4201/submissions/SubmissionWorkflowCard/abc-123';

    let handler = new CreateListingPRHandler(githubClient);
    let result = await handler.openCreateListingPR(
      eventContent,
      '@alice:localhost',
      1,
      workflowCardUrl,
    );
    assert.strictEqual(result?.prNumber, 2, 'returns PR metadata when opened');
    assert.true(
      result?.summary?.includes(`[${workflowCardUrl}](${workflowCardUrl})`) ??
        false,
      'returns summary including the workflow card URL',
    );

    assert.strictEqual(opened.length, 1, 'opens exactly one PR');
    let body =
      (
        opened[0] as { params: Record<string, unknown> }
      ).params.body?.toString() ?? '';
    assert.true(
      body.includes(`[${workflowCardUrl}](${workflowCardUrl})`),
      'summary body includes workflow card URL as a markdown link',
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
      0,
    );

    assert.strictEqual(result, null, 'returns null when PR already exists');
  });

  test('addContentsToCommit wraps files under the {hash}-{slug} folder', async (assert) => {
    let writeCalls: {
      files: { path: string; content: string }[];
      message: string;
      syncFolder?: string;
    }[] = [];
    let githubClient: GitHubClient = {
      openPullRequest: async () => ({ number: 1, html_url: 'x' }),
      createBranch: async () => ({ ref: 'refs/heads/test', sha: 'abc123' }),
      writeFileToBranch: async () => ({ commitSha: 'def456' }),
      writeFilesToBranch: async (params) => {
        writeCalls.push({
          files: params.files,
          message: params.message,
          syncFolder: params.syncFolder,
        });
        return { commitSha: 'def456' };
      },
    };

    let branchName = 'a1b2c3-my-listing';
    let eventContent: BotTriggerEventContent = {
      type: 'pr-listing-create',
      realm: 'http://localhost:4201/test/',
      userId: '@alice:localhost',
      input: {
        roomId: '!abc123:localhost',
        listingName: 'My Listing',
        branchName,
      },
    };

    let handler = new CreateListingPRHandler(githubClient);
    await handler.addContentsToCommit(eventContent, [
      { path: 'CardListing/abc.json', content: '{}' },
      { path: 'Spec/def.json', content: '{}' },
      { path: 'Recipe.gts', content: 'export const x = 1;' },
    ]);

    assert.strictEqual(writeCalls.length, 1, 'writes once');
    assert.deepEqual(
      writeCalls[0].files.map((f) => f.path).sort(),
      [
        `${branchName}/CardListing/abc.json`,
        `${branchName}/Recipe.gts`,
        `${branchName}/Spec/def.json`,
      ],
      'every file is prefixed with the branch-name folder, inner layout preserved',
    );
    assert.strictEqual(
      writeCalls[0].syncFolder,
      branchName,
      'the write syncs the submission folder so a retry drops paths missing from the fresh collection',
    );
  });

  test('a trigger that names a branch no submission could have refuses to write or open anything', async (assert) => {
    let calls: string[] = [];
    let githubClient: GitHubClient = {
      openPullRequest: async () => {
        calls.push('openPullRequest');
        return { number: 1, html_url: 'x' };
      },
      createBranch: async () => {
        calls.push('createBranch');
        return { ref: 'refs/heads/test', sha: 'abc123' };
      },
      writeFileToBranch: async () => ({ commitSha: 'def456' }),
      writeFilesToBranch: async () => {
        calls.push('writeFilesToBranch');
        return { commitSha: 'def456' };
      },
    };
    let handler = new CreateListingPRHandler(githubClient);

    for (let branchName of [
      'scripts',
      'commands',
      'catalog-app',
      '.github',
      '.github/workflows',
      'a1b2c3-listing/../scripts',
      'A1B2C3-listing',
      'a1b2c3_listing',
      'main',
    ]) {
      let eventContent: BotTriggerEventContent = {
        type: 'pr-listing-create',
        realm: 'http://localhost:4201/test/',
        userId: '@alice:localhost',
        input: {
          roomId: '!abc123:localhost',
          listingName: 'My Listing',
          branchName,
        },
      };
      await assert.rejects(
        handler.ensureCreateListingBranch(eventContent),
        /is not a submission branch/,
        `'${branchName}' creates no branch`,
      );
      await assert.rejects(
        handler.addContentsToCommit(eventContent, [
          { path: 'Recipe.gts', content: 'x' },
        ]),
        /is not a submission branch/,
        `'${branchName}' writes no files`,
      );
    }
    assert.deepEqual(calls, [], 'GitHub is never called');
  });

  test('addContentsToCommit refuses a file path that leaves the submission folder', async (assert) => {
    let writes = 0;
    let githubClient: GitHubClient = {
      openPullRequest: async () => ({ number: 1, html_url: 'x' }),
      createBranch: async () => ({ ref: 'refs/heads/test', sha: 'abc123' }),
      writeFileToBranch: async () => ({ commitSha: 'def456' }),
      writeFilesToBranch: async () => {
        writes++;
        return { commitSha: 'def456' };
      },
    };
    let eventContent: BotTriggerEventContent = {
      type: 'pr-listing-create',
      realm: 'http://localhost:4201/test/',
      userId: '@alice:localhost',
      input: {
        roomId: '!abc123:localhost',
        listingName: 'My Listing',
        branchName: 'a1b2c3-my-listing',
      },
    };
    let handler = new CreateListingPRHandler(githubClient);

    for (let path of [
      '../scripts/preview-paths.mjs',
      'nested/../../.github/workflows/ci.yml',
      '/etc/passwd',
      './Recipe.gts',
      'nested//Recipe.gts',
      'nested\\Recipe.gts',
      '',
    ]) {
      await assert.rejects(
        handler.addContentsToCommit(eventContent, [{ path, content: 'x' }]),
        /is not a path inside the submission folder/,
        `'${path}' is refused as a text file`,
      );
      await assert.rejects(
        handler.addContentsToCommit(eventContent, [], [{ path, content: 'x' }]),
        /is not a path inside the submission folder/,
        `'${path}' is refused as a binary file`,
      );
    }
    assert.strictEqual(writes, 0, 'nothing is written');
  });

  test('addContentsToCommit asks for the submission folder to be new on the base branch', async (assert) => {
    let asked: (string | undefined)[] = [];
    let githubClient: GitHubClient = {
      openPullRequest: async () => ({ number: 1, html_url: 'x' }),
      createBranch: async () => ({ ref: 'refs/heads/test', sha: 'abc123' }),
      writeFileToBranch: async () => ({ commitSha: 'def456' }),
      writeFilesToBranch: async (params) => {
        asked.push(params.folderMustBeNewOn);
        return { commitSha: 'def456' };
      },
    };
    let handler = new CreateListingPRHandler(githubClient);
    await handler.addContentsToCommit(
      {
        type: 'pr-listing-create',
        realm: 'http://localhost:4201/test/',
        userId: '@alice:localhost',
        input: {
          roomId: '!abc123:localhost',
          listingName: 'My Listing',
          branchName: 'a1b2c3-my-listing',
        },
      },
      [{ path: 'Recipe.gts', content: 'x' }],
    );
    assert.deepEqual(asked, ['main']);
  });

  test('addContentsToCommit produces the same folder when branchName is persisted (idempotency)', async (assert) => {
    let writeCalls: { path: string }[][] = [];
    let githubClient: GitHubClient = {
      openPullRequest: async () => ({ number: 1, html_url: 'x' }),
      createBranch: async () => ({ ref: 'refs/heads/test', sha: 'abc123' }),
      writeFileToBranch: async () => ({ commitSha: 'def456' }),
      writeFilesToBranch: async (params) => {
        writeCalls.push(params.files.map((f) => ({ path: f.path })));
        return { commitSha: 'def456' };
      },
    };

    let eventContent: BotTriggerEventContent = {
      type: 'pr-listing-create',
      realm: 'http://localhost:4201/test/',
      userId: '@alice:localhost',
      input: {
        roomId: '!abc123:localhost',
        listingName: 'My Listing',
        branchName: 'a1b2c3-my-listing',
      },
    };

    let handler = new CreateListingPRHandler(githubClient);
    let files = [{ path: 'Recipe.gts', content: 'x' }];
    await handler.addContentsToCommit(eventContent, files);
    await handler.addContentsToCommit(eventContent, files);

    assert.strictEqual(writeCalls.length, 2, 'writes twice');
    assert.deepEqual(
      writeCalls[0],
      writeCalls[1],
      'same persisted branchName → same prefixed paths across runs',
    );
  });

  test('addContentsToCommit folder matches the {hash}-{slug} pattern when branchName is not provided', async (assert) => {
    let folders: string[] = [];
    let githubClient: GitHubClient = {
      openPullRequest: async () => ({ number: 1, html_url: 'x' }),
      createBranch: async () => ({ ref: 'refs/heads/test', sha: 'abc123' }),
      writeFileToBranch: async () => ({ commitSha: 'def456' }),
      writeFilesToBranch: async (params) => {
        folders.push(params.files[0].path.split('/')[0]);
        return { commitSha: 'def456' };
      },
    };

    let handler = new CreateListingPRHandler(githubClient);
    let files = [{ path: 'Recipe.gts', content: 'x' }];

    await handler.addContentsToCommit(
      {
        type: 'pr-listing-create',
        realm: 'http://localhost:4201/test/',
        userId: '@alice:localhost',
        input: { roomId: '!room-a:localhost', listingName: 'My Listing' },
      },
      files,
    );

    assert.strictEqual(folders.length, 1, 'wrote once');
    assert.ok(
      BRANCH_PATTERN.test(folders[0]),
      `folder ${folders[0]} matches {hash6}-{slug}`,
    );
    assert.ok(
      folders[0].endsWith('-my-listing'),
      'folder ends with kebab-cased listing slug',
    );
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
      0,
    );

    assert.strictEqual(result, null, 'returns null when no PR can be opened');
  });
});
