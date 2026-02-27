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

    let commandRunner = new CommandRunner(dbAdapter, queuePublisher, githubClient);
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
          puppeteerTimeoutMs: null,
        },
      },
      'publishes expected run-command payload',
    );
    assert.deepEqual(result, queueJobDoneResult, 'returns queue job result');
  });

  test('handles pr-listing-create with branch, commit, and PR', async (assert) => {
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
            command: '@cardstack/boxel-host/commands/create-listing-pr/default',
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

    let commandRunner = new CommandRunner(dbAdapter, queuePublisher, githubClient);
    await commandRunner.maybeEnqueueCommand(
      '@alice:localhost',
      {
        type: 'pr-listing-create',
        realm: 'http://localhost:4201/test/',
        userId: '@alice:localhost',
        input: {
          roomId: '!abc123:localhost',
          listingId: 'http://localhost:4201/catalog/AppListing/some-id',
          listingName: 'My Listing',
          listingDescription: 'Example listing',
        },
      },
      'bot-registration-2',
    );

    // Allow fire-and-forget save-submission microtasks to flush
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.strictEqual(
      publishedJobs.length,
      2,
      'enqueues create-submission job and save-submission job',
    );
    assert.deepEqual(
      (publishedJobs[1] as any).args.command,
      '@cardstack/boxel-host/commands/save-submission/default',
      'second job is the save-submission command',
    );
    assert.strictEqual(
      (publishedJobs[1] as any).timeout,
      300,
      'save-submission job uses a 300-second timeout',
    );
    assert.deepEqual(
      (publishedJobs[1] as any).args.commandInput,
      {
        realm: 'http://localhost:4201/test/',
        roomId: '!abc123:localhost',
        listingId: 'http://localhost:4201/catalog/AppListing/some-id',
      },
      'save-submission job receives realm, roomId, and listingId',
    );
    assert.strictEqual(createdBranches.length, 1, 'creates branch');
    assert.strictEqual(branchWrites.length, 1, 'writes files to branch');
    assert.strictEqual(openedPRs.length, 1, 'opens pull request');
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
            command: '@cardstack/boxel-host/commands/create-listing-pr/default',
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

    let commandRunner = new CommandRunner(dbAdapter, queuePublisher, githubClient);

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
