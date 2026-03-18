import { module, test } from 'qunit';
import type {
  DBAdapter,
  ExecuteOptions,
  PgPrimitive,
  QueuePublisher,
  RunCommandResponse,
} from '@cardstack/runtime-common';
import type { GitHubClient } from '../lib/github';
import { CommandRunner } from '../lib/command-runner';

module('command runner', () => {
  test('enqueues run-command job for matching trigger', async (assert) => {
    let publishedJobs: unknown[] = [];
    let queueJobDoneResult: RunCommandResponse = {
      status: 'ready',
      cardResultString: '{"ok":true}',
    };
    let queuePublisher: QueuePublisher = {
      publish: async (job: unknown) => {
        publishedJobs.push(job);
        return { id: 1, done: Promise.resolve(queueJobDoneResult) } as any;
      },
      destroy: async () => {},
    };
    let githubClient: GitHubClient = {
      openPullRequest: async () => ({ number: 1, html_url: 'https://example/pr/1' }),
      createBranch: async () => ({ ref: 'refs/heads/test', sha: 'abc123' }),
      writeFileToBranch: async () => ({ commitSha: 'def456' }),
      writeFilesToBranch: async () => ({ commitSha: 'def456' }),
    };
    let commandsByRegistrationId = new Map<
      string,
      Record<string, PgPrimitive>[]
    >([
      [
        'bot-registration-1',
        [
          {
            command_filter: {
              type: 'matrix-event',
              event_type: 'app.boxel.bot-trigger',
              content_type: 'show-card',
            },
            command: '@cardstack/boxel-host/commands/show-card/default',
          },
        ],
      ],
    ]);
    let dbAdapter = {
      kind: 'pg',
      isClosed: false,
      execute: async (sql: string, opts?: ExecuteOptions) => {
        if (sql.includes('FROM bot_commands WHERE bot_id =')) {
          let registrationId = opts?.bind?.[0];
          if (typeof registrationId !== 'string') {
            return [];
          }
          return commandsByRegistrationId.get(registrationId) ?? [];
        }
        return [];
      },
      close: async () => {},
      getColumnNames: async () => [],
    } as DBAdapter;

    let commandRunner = new CommandRunner(
      '@submissionbot:localhost',
      dbAdapter,
      queuePublisher,
      githubClient,
    );
    let result = await commandRunner.maybeEnqueueCommand(
      '@alice:localhost',
      {
        type: 'show-card',
        realm: 'http://localhost:4201/test/',
        userId: '@alice:localhost',
        input: { cardId: 'http://localhost:4201/test/Person/1' },
      },
      'bot-registration-1',
    );

    assert.strictEqual(publishedJobs.length, 1, 'published one run-command job');
    assert.deepEqual(
      publishedJobs[0],
      {
        jobType: 'run-command',
        concurrencyGroup: 'command:http://localhost:4201/test/',
        timeout: 60,
        priority: 10,
        args: {
          realmURL: 'http://localhost:4201/test/',
          realmUsername: '@alice:localhost',
          runAs: '@alice:localhost',
          command: '@cardstack/boxel-host/commands/show-card/default',
          commandInput: { cardId: 'http://localhost:4201/test/Person/1' },
        },
      },
      'publishes expected run-command payload',
    );
    assert.deepEqual(result, queueJobDoneResult, 'returns queue job result');
  });

  test('handles pr-listing-create with branch, commit, and PR', async (assert) => {
    let publishedJobs: unknown[] = [];
    let submissionCardUrl =
      'http://localhost:4201/submissions/SubmissionCard/abc-123';
    let prCardUrl = 'http://localhost:4201/test/PrCard/pr-1';
    let queuePublisher: QueuePublisher = {
      publish: async (job: unknown) => {
        publishedJobs.push(job);
        if (publishedJobs.length === 1) {
          return {
            id: 1,
            done: Promise.resolve({
              status: 'ready',
              cardResultString: JSON.stringify({
                data: {
                  id: submissionCardUrl,
                  attributes: {
                    allFileContents: [
                      {
                        filename: 'catalog/MyListing/listing.json',
                        contents: '{"data":{"type":"card"}}',
                      },
                    ],
                  },
                },
              }),
            }),
          } as any;
        }
        return {
          id: 2,
          done: Promise.resolve({
            status: 'ready',
            cardResultString: JSON.stringify({
              data: {
                id: prCardUrl,
                attributes: {
                  prNumber: 1,
                },
              },
            }),
          }),
        } as any;
      },
      destroy: async () => {},
    };

    let createdBranches: unknown[] = [];
    let branchWrites: unknown[] = [];
    let openedPRs: { params: unknown }[] = [];
    let githubClient: GitHubClient = {
      createBranch: async (params) => {
        createdBranches.push(params);
        return { ref: 'refs/heads/test', sha: 'abc123' };
      },
      writeFileToBranch: async () => ({ commitSha: 'def456' }),
      writeFilesToBranch: async (params) => {
        branchWrites.push(params);
        return { commitSha: 'def456' };
      },
      openPullRequest: async (params) => {
        openedPRs.push({ params });
        return { number: 1, html_url: 'https://example/pr/1' };
      },
    };
    let commandsByRegistrationId = new Map<
      string,
      Record<string, PgPrimitive>[]
    >([
      [
        'bot-registration-2',
        [
          {
            command_filter: {
              type: 'matrix-event',
              event_type: 'app.boxel.bot-trigger',
              content_type: 'pr-listing-create',
            },
            command: '@cardstack/catalog/commands/create-submission/default',
          },
        ],
      ],
    ]);
    let dbAdapter = {
      kind: 'pg',
      isClosed: false,
      execute: async (sql: string, opts?: ExecuteOptions) => {
        if (sql.includes('FROM bot_commands WHERE bot_id =')) {
          let registrationId = opts?.bind?.[0];
          if (typeof registrationId !== 'string') {
            return [];
          }
          return commandsByRegistrationId.get(registrationId) ?? [];
        }
        return [];
      },
      close: async () => {},
      getColumnNames: async () => [],
    } as DBAdapter;

    let commandRunner = new CommandRunner(
      '@submissionbot:localhost',
      dbAdapter,
      queuePublisher,
      githubClient,
    );
    await commandRunner.maybeEnqueueCommand(
      '@alice:localhost',
      {
        type: 'pr-listing-create',
        realm: 'http://localhost:4201/test/',
        userId: '@alice:localhost',
        input: {
          roomId: '!abc123:localhost',
          listingName: 'My Listing Name',
          listingSummary: 'My listing Summary'
        },  
      },
      'bot-registration-2',
    );

    assert.strictEqual(
      publishedJobs.length,
      3,
      'enqueues create-submission, create-pr-card, and patch-card-instance jobs',
    );
    assert.strictEqual(createdBranches.length, 1, 'creates branch');
    assert.strictEqual(branchWrites.length, 1, 'writes files to branch');
    assert.strictEqual(openedPRs.length, 1, 'opens pull request');
    assert.deepEqual(
      (publishedJobs[1] as { args: Record<string, unknown> }).args,
      {
        realmURL: 'http://localhost:4201/submissions/',
        realmUsername: '@submissionbot:localhost',
        runAs: '@submissionbot:localhost',
        command: '@cardstack/catalog/commands/create-pr-card/default',
        commandInput: {
          realm: 'http://localhost:4201/submissions/',
          prNumber: 1,
          prUrl: 'https://example/pr/1',
          prTitle: 'Add My Listing Name listing',
          branchName: 'room-IWFiYzEyMzpsb2NhbGhvc3Q/my-listing-name',
          prSummary: `## Summary\nMy listing Summary\n\n---\n- Listing Name: My Listing Name\n- Room ID: \`!abc123:localhost\`\n- User ID: \`@alice:localhost\`\n- Number of Files: 1\n- Submission Card: [${submissionCardUrl}](${submissionCardUrl})`,
          submittedBy: '@alice:localhost',
        },
      },
      'enqueues PR card creation in submissions realm',
    );
    assert.deepEqual(
      (publishedJobs[2] as { args: Record<string, unknown> }).args,
      {
        realmURL: 'http://localhost:4201/test/',
        realmUsername: '@alice:localhost',
        runAs: '@alice:localhost',
        command: '@cardstack/boxel-host/commands/patch-card-instance/default',
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
      },
      'enqueues submission card patch in the user realm',
    );
    let prBody = (openedPRs[0] as { params: Record<string, unknown> }).params.body?.toString() ?? '';
    assert.true(
      prBody.includes(`[${submissionCardUrl}](${submissionCardUrl})`),
      'PR body includes submission card URL as markdown link',
    );
  });

  test('does not enqueue PR card creation when PR is not opened', async (assert) => {
    let publishedJobs: unknown[] = [];
    let queuePublisher: QueuePublisher = {
      publish: async (job: unknown) => {
        publishedJobs.push(job);
        return {
          id: 1,
          done: Promise.resolve({
            status: 'ready',
            cardResultString: JSON.stringify({
              data: {
                id: 'http://localhost:4201/submissions/SubmissionCard/abc-123',
                attributes: {
                  allFileContents: [
                    {
                      filename: 'catalog/MyListing/listing.json',
                      contents: '{"data":{"type":"card"}}',
                    },
                  ],
                },
              },
            }),
          }),
        } as any;
      },
      destroy: async () => {},
    };

    let githubClient: GitHubClient = {
      createBranch: async () => ({ ref: 'refs/heads/test', sha: 'abc123' }),
      writeFileToBranch: async () => ({ commitSha: 'def456' }),
      writeFilesToBranch: async () => ({ commitSha: 'def456' }),
      openPullRequest: async () => {
        throw new Error('A pull request already exists for this branch');
      },
    };
    let commandsByRegistrationId = new Map<
      string,
      Record<string, PgPrimitive>[]
    >([
      [
        'bot-registration-4',
        [
          {
            command_filter: {
              type: 'matrix-event',
              event_type: 'app.boxel.bot-trigger',
              content_type: 'pr-listing-create',
            },
            command: '@cardstack/catalog/commands/create-submission/default',
          },
        ],
      ],
    ]);
    let dbAdapter = {
      kind: 'pg',
      isClosed: false,
      execute: async (sql: string, opts?: ExecuteOptions) => {
        if (sql.includes('FROM bot_commands WHERE bot_id =')) {
          let registrationId = opts?.bind?.[0];
          if (typeof registrationId !== 'string') {
            return [];
          }
          return commandsByRegistrationId.get(registrationId) ?? [];
        }
        return [];
      },
      close: async () => {},
      getColumnNames: async () => [],
    } as DBAdapter;

    let commandRunner = new CommandRunner(
      '@submissionbot:localhost',
      dbAdapter,
      queuePublisher,
      githubClient,
    );
    await commandRunner.maybeEnqueueCommand(
      '@alice:localhost',
      {
        type: 'pr-listing-create',
        realm: 'http://localhost:4201/test/',
        userId: '@alice:localhost',
        input: {
          roomId: '!abc123:localhost',
          listingName: 'My Listing',
        },
      },
      'bot-registration-4',
    );

    assert.strictEqual(
      publishedJobs.length,
      1,
      'only the submission command is enqueued when PR creation returns null',
    );
  });

  test('propagates run-command error for pr-listing-create and skips github writes', async (assert) => {
    let publishedJobs: unknown[] = [];
    let queuePublisher: QueuePublisher = {
      publish: async (job: unknown) => {
        publishedJobs.push(job);
        return {
          id: 1,
          done: Promise.resolve({
            status: 'error',
            error: 'permission denied',
          }),
        } as any;
      },
      destroy: async () => {},
    };

    let createdBranches: unknown[] = [];
    let branchWrites: unknown[] = [];
    let openedPRs: { params: unknown }[] = [];
    let githubClient: GitHubClient = {
      createBranch: async (params) => {
        createdBranches.push(params);
        return { ref: 'refs/heads/test', sha: 'abc123' };
      },
      writeFileToBranch: async () => ({ commitSha: 'def456' }),
      writeFilesToBranch: async (params) => {
        branchWrites.push(params);
        return { commitSha: 'def456' };
      },
      openPullRequest: async (params) => {
        openedPRs.push({ params });
        return { number: 1, html_url: 'https://example/pr/1' };
      },
    };

    let commandsByRegistrationId = new Map<
      string,
      Record<string, PgPrimitive>[]
    >([
      [
        'bot-registration-3',
        [
          {
            command_filter: {
              type: 'matrix-event',
              event_type: 'app.boxel.bot-trigger',
              content_type: 'pr-listing-create',
            },
            command: '@cardstack/catalog/commands/create-submission/default',
          },
        ],
      ],
    ]);
    let dbAdapter = {
      kind: 'pg',
      isClosed: false,
      execute: async (sql: string, opts?: ExecuteOptions) => {
        if (sql.includes('FROM bot_commands WHERE bot_id =')) {
          let registrationId = opts?.bind?.[0];
          if (typeof registrationId !== 'string') {
            return [];
          }
          return commandsByRegistrationId.get(registrationId) ?? [];
        }
        return [];
      },
      close: async () => {},
      getColumnNames: async () => [],
    } as DBAdapter;

    let commandRunner = new CommandRunner(
      '@submissionbot:localhost',
      dbAdapter,
      queuePublisher,
      githubClient,
    );

    await assert.rejects(
      commandRunner.maybeEnqueueCommand(
        '@alice:localhost',
        {
          type: 'pr-listing-create',
          realm: 'http://localhost:4201/test/',
          userId: '@alice:localhost',
          input: {
            roomId: '!abc123:localhost',
            listingName: 'My Listing',
          },
        },
        'bot-registration-3',
      ),
      /permission denied/,
      'bubbles run-command error',
    );

    assert.strictEqual(publishedJobs.length, 1, 'enqueues run-command job');
    assert.strictEqual(createdBranches.length, 0, 'does not create branch');
    assert.strictEqual(branchWrites.length, 0, 'does not write files to branch');
    assert.strictEqual(openedPRs.length, 0, 'does not open pull request');
  });
});
