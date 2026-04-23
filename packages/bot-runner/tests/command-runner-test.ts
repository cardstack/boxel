import { module, test, skip } from 'qunit';
import type {
  DBAdapter,
  ExecuteOptions,
  PgPrimitive,
  QueuePublisher,
  RunCommandResponse,
} from '@cardstack/runtime-common';
import type { GitHubClient } from '../lib/github';
import {
  CommandRunner,
  type LintSubmissionFilesFn,
} from '../lib/command-runner';

const passThroughLint: LintSubmissionFilesFn = async (files) => ({
  passed: true,
  fixedFiles: files.map((f) => ({
    filename: f.filename,
    contents: f.contents ?? '',
  })),
  lintErrors: [],
  fixedFileCount: 0,
});

const SUBMISSION_REALM_URL = 'http://localhost:4201/submissions/';
const SUBMISSION_BOT_USER_ID = '@submissionbot:localhost';

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
      openPullRequest: async () => ({
        number: 1,
        html_url: 'https://example/pr/1',
      }),
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
      SUBMISSION_BOT_USER_ID,
      dbAdapter,
      queuePublisher,
      githubClient,
      passThroughLint,
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

    assert.strictEqual(
      publishedJobs.length,
      1,
      'published one run-command job',
    );
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
      'http://localhost:4201/submissions/SubmissionWorkflowCard/abc-123';
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
            command:
              '@cardstack/catalog/commands/collect-submission-files/default',
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
      SUBMISSION_BOT_USER_ID,
      dbAdapter,
      queuePublisher,
      githubClient,
      passThroughLint,
    );
    await commandRunner.maybeEnqueueCommand(
      '@alice:localhost',
      {
        type: 'pr-listing-create',
        realm: 'http://localhost:4201/test/',
        userId: '@alice:localhost',
        input: {
          roomId: '!abc123:localhost',
          listingId: 'http://localhost:4201/test/Listing/1',
          listingName: 'My Listing Name',
          listingSummary: 'My listing Summary',
          workflowCardUrl: submissionCardUrl,
        },
      },
      'bot-registration-2',
    );

    assert.strictEqual(
      publishedJobs.length,
      4,
      'enqueues collect-files, lintStatus=passed patch, create-pr-card, and prCard-link patch (lint step skipped)',
    );
    assert.strictEqual(createdBranches.length, 1, 'creates branch');
    assert.strictEqual(branchWrites.length, 1, 'writes files to branch');
    assert.strictEqual(openedPRs.length, 1, 'opens pull request');

    // Job 1: collect-files — user realm
    assert.strictEqual(
      (publishedJobs[0] as { concurrencyGroup: string }).concurrencyGroup,
      'command:http://localhost:4201/test/',
      'Job 1 (collect-files) uses default realm concurrency group',
    );
    // TEMP: lint step skipped — the lintStatus=in-progress patch is not
    // enqueued. Uncomment and shift indices below back up by 1 when the
    // lint step is restored in command-runner.ts.
    // assert.strictEqual(
    //   (publishedJobs[1] as { concurrencyGroup: string }).concurrencyGroup,
    //   'command:http://localhost:4201/test/',
    //   'Job 2 (lintStatus in-progress) uses default realm concurrency group',
    // );
    // Job 2: patch lintStatus=passed — user realm
    assert.strictEqual(
      (publishedJobs[1] as { concurrencyGroup: string }).concurrencyGroup,
      'command:http://localhost:4201/test/',
      'Job 2 (lintStatus passed) uses default realm concurrency group',
    );
    // Job 3: create-pr-card — submissions realm
    assert.strictEqual(
      (publishedJobs[2] as { concurrencyGroup: string }).concurrencyGroup,
      `command:${SUBMISSION_REALM_URL}`,
      'Job 3 (create-pr-card) uses submissions realm concurrency group',
    );
    // Job 4: prCard link patch — user realm
    assert.strictEqual(
      (publishedJobs[3] as { concurrencyGroup: string }).concurrencyGroup,
      'command:http://localhost:4201/test/',
      'Job 4 (prCard link patch) uses default realm concurrency group',
    );

    assert.deepEqual(
      (publishedJobs[2] as { args: Record<string, unknown> }).args,
      {
        realmURL: SUBMISSION_REALM_URL,
        realmUsername: SUBMISSION_BOT_USER_ID,
        runAs: SUBMISSION_BOT_USER_ID,
        command: '@cardstack/catalog/commands/create-pr-card/default',
        commandInput: {
          realm: SUBMISSION_REALM_URL,
          branchName: 'room-IWFiYzEyMzpsb2NhbGhvc3Q/my-listing-name',
          submittedBy: '@alice:localhost',
          prSummary: `## Summary\nMy listing Summary\n\n---\n- Listing Name: My Listing Name\n- Room ID: \`!abc123:localhost\`\n- User ID: \`@alice:localhost\`\n- Number of Files: 1\n- Workflow Card: [${submissionCardUrl}](${submissionCardUrl})`,
          allFileContents: [
            {
              filename: 'catalog/MyListing/listing.json',
              contents: '{"data":{"type":"card"}}',
            },
          ],
        },
      },
      'enqueues PR card creation in submissions realm',
    );
    assert.deepEqual(
      (publishedJobs[3] as { args: Record<string, unknown> }).args,
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
      'enqueues workflow card patch in the user realm',
    );
    let prBody =
      (
        openedPRs[0] as { params: Record<string, unknown> }
      ).params.body?.toString() ?? '';
    assert.true(
      prBody.includes(`[${submissionCardUrl}](${submissionCardUrl})`),
      'PR body includes workflow card URL as markdown link',
    );
  });

  test('does not enqueue patch job when PR already exists', async (assert) => {
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
                id: 'http://localhost:4201/submissions/SubmissionWorkflowCard/abc-123',
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
            command:
              '@cardstack/catalog/commands/collect-submission-files/default',
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
      SUBMISSION_BOT_USER_ID,
      dbAdapter,
      queuePublisher,
      githubClient,
      passThroughLint,
    );
    await commandRunner.maybeEnqueueCommand(
      '@alice:localhost',
      {
        type: 'pr-listing-create',
        realm: 'http://localhost:4201/test/',
        userId: '@alice:localhost',
        input: {
          roomId: '!abc123:localhost',
          listingId: 'http://localhost:4201/test/Listing/1',
          listingName: 'My Listing',
        },
      },
      'bot-registration-4',
    );

    assert.strictEqual(
      publishedJobs.length,
      2,
      'collect-files and create-pr-card are enqueued, but no patch job since PR was not opened',
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
            command:
              '@cardstack/catalog/commands/collect-submission-files/default',
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
      SUBMISSION_BOT_USER_ID,
      dbAdapter,
      queuePublisher,
      githubClient,
      passThroughLint,
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
            listingId: 'http://localhost:4201/test/Listing/1',
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
    assert.strictEqual(
      branchWrites.length,
      0,
      'does not write files to branch',
    );
    assert.strictEqual(openedPRs.length, 0, 'does not open pull request');
  });

  // TEMP: Re-enable this test when lint is restored.
  skip('patches prCreationError when create-pr-card fails after lint passes', async (assert) => {
    let submissionCardUrl =
      'http://localhost:4201/submissions/SubmissionWorkflowCard/abc-123';
    let publishedJobs: Array<{
      args: Record<string, unknown>;
      concurrencyGroup: string;
    }> = [];
    let queuePublisher: QueuePublisher = {
      publish: async (job: unknown) => {
        let typedJob = job as {
          args: Record<string, unknown>;
          concurrencyGroup: string;
        };
        publishedJobs.push(typedJob);
        // Job 1 (collect-files) → returns one file
        // Jobs 2-3 (lintStatus patches: in-progress, passed) → ready
        // Job 4 (create-pr-card in submissions realm) → error
        // Job 5 (compensating prCreationError patch) → ready
        let command =
          (typedJob.args.command as string | undefined)?.toString() ?? '';
        if (command.endsWith('/collect-submission-files/default')) {
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
        if (command.endsWith('/create-pr-card/default')) {
          return {
            id: 2,
            done: Promise.resolve({
              status: 'error',
              error: 'boom: submissions realm worker exploded',
            }),
          } as any;
        }
        // patch-card-instance calls — always ready
        return {
          id: 3,
          done: Promise.resolve({ status: 'ready', cardResultString: null }),
        } as any;
      },
      destroy: async () => {},
    };

    let githubClient: GitHubClient = {
      createBranch: async () => ({ ref: 'refs/heads/test', sha: 'abc123' }),
      writeFileToBranch: async () => ({ commitSha: 'def456' }),
      writeFilesToBranch: async () => ({ commitSha: 'def456' }),
      openPullRequest: async () => ({
        number: 1,
        html_url: 'https://example/pr/1',
      }),
    };

    let commandsByRegistrationId = new Map<
      string,
      Record<string, PgPrimitive>[]
    >([
      [
        'bot-registration-5',
        [
          {
            command_filter: {
              type: 'matrix-event',
              event_type: 'app.boxel.bot-trigger',
              content_type: 'pr-listing-create',
            },
            command:
              '@cardstack/catalog/commands/collect-submission-files/default',
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
      SUBMISSION_BOT_USER_ID,
      dbAdapter,
      queuePublisher,
      githubClient,
      passThroughLint,
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
            listingId: 'http://localhost:4201/test/Listing/1',
            listingName: 'My Listing',
            workflowCardUrl: submissionCardUrl,
          },
        },
        'bot-registration-5',
      ),
      /boom: submissions realm worker exploded/,
      'original create-pr-card error bubbles up',
    );

    // Expect 5 jobs: collect-files, lintStatus=in-progress, lintStatus=passed,
    // create-pr-card (failed), and the compensating prCreationError patch.
    assert.strictEqual(
      publishedJobs.length,
      5,
      'enqueues collect, two lint patches, create-pr-card, and compensating prCreationError patch',
    );

    let lastJob = publishedJobs[publishedJobs.length - 1];
    let lastArgs = lastJob.args as {
      command: string;
      commandInput: {
        cardId: string;
        patch: { attributes: Record<string, unknown> };
      };
    };
    assert.strictEqual(
      lastArgs.command,
      '@cardstack/boxel-host/commands/patch-card-instance/default',
      'compensating patch uses patch-card-instance',
    );
    assert.strictEqual(
      lastArgs.commandInput.cardId,
      submissionCardUrl,
      'compensating patch targets the workflow card',
    );
    assert.strictEqual(
      typeof lastArgs.commandInput.patch.attributes.prCreationError,
      'string',
      'compensating patch writes prCreationError',
    );
    assert.ok(
      (
        lastArgs.commandInput.patch.attributes.prCreationError as string
      ).startsWith('PR creation failed:'),
      `prCreationError message is prefixed: ${lastArgs.commandInput.patch.attributes.prCreationError}`,
    );
    assert.notOk(
      'lintStatus' in lastArgs.commandInput.patch.attributes,
      'compensating patch does NOT touch lintStatus',
    );
    assert.notOk(
      'lintErrors' in lastArgs.commandInput.patch.attributes,
      'compensating patch does NOT touch lintErrors',
    );
  });
});
