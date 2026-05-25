import { module, test, skip } from 'qunit';
import type {
  DBAdapter,
  ExecuteOptions,
  PgPrimitive,
  QueuePublisher,
  RunCommandResponse,
} from '@cardstack/runtime-common';
import type { GitHubClient } from '../lib/github';
import { CommandRunner, makeEnqueueRunCommand } from '../lib/command-runner';
import {
  PrListingWorkflowHandler,
  type LintSubmissionFilesFn,
} from '../lib/pr-listing/pr-listing-workflow-handler';

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

function makeRunner(
  dbAdapter: DBAdapter,
  queuePublisher: QueuePublisher,
  githubClient: GitHubClient,
  lintSubmissionFiles: LintSubmissionFilesFn = passThroughLint,
): CommandRunner {
  let workflowHandler = new PrListingWorkflowHandler({
    submissionBotUserId: SUBMISSION_BOT_USER_ID,
    enqueueRunCommand: makeEnqueueRunCommand(queuePublisher, dbAdapter),
    githubClient,
    lintSubmissionFiles,
  });
  return new CommandRunner(dbAdapter, queuePublisher, [workflowHandler]);
}

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
      notify: async () => {},
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
      withWriteLock: async (_url, fn) => fn(undefined),
      withUserCostLock: async (_userId, fn) => fn(),
    } as DBAdapter;

    let commandRunner = makeRunner(dbAdapter, queuePublisher, githubClient);
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
      notify: async () => {},
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
      withWriteLock: async (_url, fn) => fn(undefined),
      withUserCostLock: async (_userId, fn) => fn(),
    } as DBAdapter;

    let commandRunner = makeRunner(dbAdapter, queuePublisher, githubClient);
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
          branchName: 'a1b2c3-my-listing-name',
        },
      },
      'bot-registration-2',
    );

    assert.strictEqual(
      publishedJobs.length,
      5,
      'enqueues collect-files, lintStatus=passed patch, create-pr-card, prCard-link patch, and clear-error patch (lint step skipped)',
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
    // Job 4: prCard link patch — user realm. Persisted immediately after
    // create-pr-card so retry on a later GitHub failure can find it.
    assert.strictEqual(
      (publishedJobs[3] as { concurrencyGroup: string }).concurrencyGroup,
      'command:http://localhost:4201/test/',
      'Job 4 (prCard link patch) uses default realm concurrency group',
    );
    // Job 5: clear-error patch — user realm
    assert.strictEqual(
      (publishedJobs[4] as { concurrencyGroup: string }).concurrencyGroup,
      'command:http://localhost:4201/test/',
      'Job 5 (clear-error patch) uses default realm concurrency group',
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
          branchName: 'a1b2c3-my-listing-name',
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
      'persists prCard link on the workflow card immediately after create-pr-card succeeds (so retry on later failure can reuse the existing PrCard)',
    );
    assert.deepEqual(
      (publishedJobs[4] as { args: Record<string, unknown> }).args,
      {
        realmURL: 'http://localhost:4201/test/',
        realmUsername: '@alice:localhost',
        runAs: '@alice:localhost',
        command: '@cardstack/boxel-host/commands/patch-card-instance/default',
        commandInput: {
          cardId: submissionCardUrl,
          patch: {
            attributes: {
              prCreationError: null,
              failedStep: null,
            },
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
      'clears prior error attributes on the workflow card after the GitHub PR succeeds, re-asserting the prCard link to survive any stale-fetch race',
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
      notify: async () => {},
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
      withWriteLock: async (_url, fn) => fn(undefined),
      withUserCostLock: async (_userId, fn) => fn(),
    } as DBAdapter;

    let commandRunner = makeRunner(dbAdapter, queuePublisher, githubClient);
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
      notify: async () => {},
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
      withWriteLock: async (_url, fn) => fn(undefined),
      withUserCostLock: async (_userId, fn) => fn(),
    } as DBAdapter;

    let commandRunner = makeRunner(dbAdapter, queuePublisher, githubClient);

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
      notify: async () => {},
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
      withWriteLock: async (_url, fn) => fn(undefined),
      withUserCostLock: async (_userId, fn) => fn(),
    } as DBAdapter;

    let commandRunner = makeRunner(dbAdapter, queuePublisher, githubClient);

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

  test('pr-listing-retry with existing PrCard skips collect-files + create-pr-card', async (assert) => {
    let workflowCardUrl =
      'http://localhost:4201/test/SubmissionWorkflowCard/abc-123';
    let prCardUrl = 'http://localhost:4201/submissions/PrCard/pr-1';
    let publishedJobs: Array<{
      args: Record<string, any>;
      concurrencyGroup: string;
    }> = [];

    let queuePublisher: QueuePublisher = {
      publish: async (job: any) => {
        publishedJobs.push(job);
        let command = (job.args.command as string | undefined) ?? '';
        let url = (job.args.commandInput as any)?.url;

        if (command.endsWith('/fetch-card-json/default')) {
          if (url === workflowCardUrl) {
            return {
              id: publishedJobs.length,
              done: Promise.resolve({
                status: 'ready',
                cardResultString: JSON.stringify({
                  data: {
                    attributes: {
                      document: {
                        data: {
                          id: workflowCardUrl,
                          attributes: {
                            roomId: '!abc123:localhost',
                            // title is the display-formatted "Submit <X>";
                            // retry must NOT derive branchName from it.
                            title: 'Submit My Listing',
                            branchName:
                              'a1b2c3-my-listing',
                          },
                          relationships: {
                            listing: {
                              links: {
                                self: 'http://localhost:4201/test/Listing/1',
                              },
                            },
                            prCard: { links: { self: prCardUrl } },
                          },
                        },
                      },
                    },
                  },
                }),
              }),
            } as any;
          }
          if (url === prCardUrl) {
            return {
              id: publishedJobs.length,
              done: Promise.resolve({
                status: 'ready',
                cardResultString: JSON.stringify({
                  data: {
                    attributes: {
                      document: {
                        data: {
                          id: prCardUrl,
                          attributes: {
                            allFileContents: [
                              {
                                filename: 'catalog/MyListing/listing.json',
                                contents: '{"data":{"type":"card"}}',
                              },
                            ],
                          },
                        },
                      },
                    },
                  },
                }),
              }),
            } as any;
          }
        }
        // patch-card-instance — final link/clear patch
        return {
          id: publishedJobs.length,
          done: Promise.resolve({ status: 'ready', cardResultString: null }),
        } as any;
      },
      destroy: async () => {},
    };

    let createdBranches: unknown[] = [];
    let branchWrites: unknown[] = [];
    let openedPRs: unknown[] = [];
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
        openedPRs.push(params);
        return { number: 1, html_url: 'https://example/pr/1' };
      },
    };

    let commandsByRegistrationId = new Map<
      string,
      Record<string, PgPrimitive>[]
    >([
      [
        'bot-registration-retry',
        [
          {
            command_filter: {
              type: 'matrix-event',
              event_type: 'app.boxel.bot-trigger',
              content_type: 'pr-listing-retry',
            },
            command:
              '@cardstack/catalog/commands/collect-submission-files/default',
          },
        ],
      ],
    ]);
    let dbAdapter = {
      kind: 'pg',
      notify: async () => {},
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
      withWriteLock: async (_url, fn) => fn(undefined),
      withUserCostLock: async (_userId, fn) => fn(),
    } as DBAdapter;

    let commandRunner = makeRunner(dbAdapter, queuePublisher, githubClient);

    await commandRunner.maybeEnqueueCommand(
      '@alice:localhost',
      {
        type: 'pr-listing-retry',
        realm: 'http://localhost:4201/test/',
        userId: '@alice:localhost',
        input: { workflowCardUrl },
      },
      'bot-registration-retry',
    );

    let commands = publishedJobs.map((j) => j.args.command);
    assert.notOk(
      commands.some((c: string) =>
        c.endsWith('/collect-submission-files/default'),
      ),
      'retry skips collect-submission-files',
    );
    assert.notOk(
      commands.some((c: string) => c.endsWith('/create-pr-card/default')),
      'retry skips create-pr-card',
    );
    assert.strictEqual(
      commands.filter((c: string) => c.endsWith('/fetch-card-json/default'))
        .length,
      2,
      'retry fetches workflow card AND existing PrCard',
    );
    assert.strictEqual(createdBranches.length, 1, 'creates GitHub branch');
    assert.strictEqual(branchWrites.length, 1, 'writes files to branch');
    assert.strictEqual(openedPRs.length, 1, 'opens pull request');
    // Regression: retry must reuse the *persisted* branchName, not recompute
    // from the workflow card's display-formatted title. Without this guard,
    // retry creates a different branch than the original attempt and orphans
    // any previous commits/PR.
    assert.strictEqual(
      (createdBranches[0] as { branch: string }).branch,
      'a1b2c3-my-listing',
      'retry uses the persisted branchName from the workflow card',
    );
  });

  test('pr-listing-create failure tags workflow card with failedStep', async (assert) => {
    let workflowCardUrl =
      'http://localhost:4201/test/SubmissionWorkflowCard/abc-123';
    let publishedJobs: Array<{
      args: Record<string, any>;
      concurrencyGroup: string;
    }> = [];

    let queuePublisher: QueuePublisher = {
      publish: async (job: any) => {
        publishedJobs.push(job);
        let command = (job.args.command as string | undefined) ?? '';
        if (command.endsWith('/collect-submission-files/default')) {
          return {
            id: publishedJobs.length,
            done: Promise.resolve({
              status: 'error',
              error: 'collect crashed',
            }),
          } as any;
        }
        return {
          id: publishedJobs.length,
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
        'bot-registration-fail',
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
      notify: async () => {},
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
      withWriteLock: async (_url, fn) => fn(undefined),
      withUserCostLock: async (_userId, fn) => fn(),
    } as DBAdapter;

    let commandRunner = makeRunner(dbAdapter, queuePublisher, githubClient);

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
            workflowCardUrl,
          },
        },
        'bot-registration-fail',
      ),
      /collect crashed/,
      'collect-files error bubbles up',
    );

    let lastJob = publishedJobs[publishedJobs.length - 1];
    let attrs = lastJob.args.commandInput.patch.attributes as Record<
      string,
      unknown
    >;
    assert.strictEqual(
      lastJob.args.command,
      '@cardstack/boxel-host/commands/patch-card-instance/default',
      'last job is the failure-recording patch',
    );
    assert.strictEqual(
      attrs.failedStep,
      'collect-files',
      'failedStep tagged as collect-files',
    );
    assert.ok(
      typeof attrs.prCreationError === 'string' &&
        (attrs.prCreationError as string).includes('collect crashed'),
      'prCreationError carries the underlying message',
    );
  });
});
