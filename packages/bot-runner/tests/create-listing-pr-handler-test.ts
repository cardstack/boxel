import { module, test } from 'qunit';
import type { GitHubClient } from '../lib/github';
import {
  CreateListingPRHandler,
  type BotTriggerEventContent,
} from '../lib/create-listing-pr-handler';

module('create-listing-pr handler', () => {
  test('opens PR with expected params, labels, and summary body', async (assert) => {
    let opened: { params: unknown; options: unknown }[] = [];
    let githubClient: GitHubClient = {
      openPullRequest: async (params, options) => {
        opened.push({ params, options });
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
    await handler.openCreateListingPR(eventContent, '@alice:localhost', {
      status: 'ready',
      cardResultString: JSON.stringify({
        data: {
          attributes: {
            allFileContents: [
              { path: 'catalog/Listing/listing.json', content: '{}' },
              { path: 'catalog/Listing/readme.md', content: '# readme' },
            ],
          },
        },
      }),
    });

    assert.strictEqual(opened.length, 1, 'opens exactly one PR');
    let openedCall = opened[0] as {
      params: Record<string, unknown>;
      options: Record<string, unknown>;
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

    assert.deepEqual(
      openedCall.options.labels,
      [
        { name: '@alice:localhost', color: '1d76db' },
        { name: 'room-id:!abc123:localhost', color: '0e8a16' },
      ],
      'passes expected PR labels',
    );
  });
});
