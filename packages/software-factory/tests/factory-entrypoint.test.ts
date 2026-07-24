import QUnit from 'qunit';
const { module, test } = QUnit;

import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';

import {
  FactoryEntrypointUsageError,
  buildFactoryEntrypointSummary,
  buildModelPolicy,
  getFactoryEntrypointUsage,
  parseFactoryEntrypointArgs,
  runFactoryEntrypoint,
  wantsFactoryEntrypointHelp,
} from '../src/factory-entrypoint.ts';
import type { FactoryBrief } from '../src/factory-brief.ts';
import type { FactoryTargetRealmBootstrapResult } from '../src/factory-target-realm.ts';
import type { SeedIssueResult } from '../src/factory-seed.ts';
import { installTestProfile } from './helpers/test-profile.ts';

const briefUrl =
  'https://briefs.example.test/software-factory/Wiki/sticky-note';
const targetRealm = 'https://realms.example.test/testuser/personal/';
const normalizedBrief: FactoryBrief = {
  title: 'Sticky Note',
  sourceUrl: briefUrl,
  content:
    'Structured note content with enough context to describe the first MVP.',
  contentSummary:
    'Colorful, short-form note designed for spatial arrangement on boards and artboards.',
  tags: ['documents-content', 'sticky', 'note'],
};
const bootstrappedTargetRealm: FactoryTargetRealmBootstrapResult = {
  url: targetRealm,
  serverUrl: 'https://realms.example.test/',
  ownerUsername: 'testuser',
  createdRealm: true,
};
const mockSeedResult: SeedIssueResult = {
  issueId: 'Issues/bootstrap-seed',
  status: 'created',
};

module('factory-entrypoint', function (hooks) {
  let cleanupProfile: (() => void) | undefined;

  hooks.afterEach(function () {
    cleanupProfile?.();
    cleanupProfile = undefined;
  });

  function useTestProfile() {
    cleanupProfile = installTestProfile({
      username: 'testuser',
      matrixUrl: 'https://matrix.example.test/',
      realmServerUrl: 'https://realms.example.test/',
      password: 'secret',
    });
  }

  test('parseFactoryEntrypointArgs accepts required inputs', function (assert) {
    let options = parseFactoryEntrypointArgs([
      '--brief-url',
      briefUrl,
      '--target-realm',
      targetRealm,
      '--realm-server-url',
      'https://realms.example.test/',
    ]);

    // Round-trip through JSON to drop undefined-valued optional flags, so
    // this assertion pins the defined defaults without re-enumerating every
    // optional flag the parser knows about.
    assert.deepEqual(JSON.parse(JSON.stringify(options)), {
      briefUrl,
      targetRealm,
      controlRealm: null,
      realmServerUrl: 'https://realms.example.test/',
      agent: 'claude',
      retryBlocked: true,
    });
  });

  test('parseFactoryEntrypointArgs accepts --agent claude', function (assert) {
    let options = parseFactoryEntrypointArgs([
      '--brief-url',
      briefUrl,
      '--target-realm',
      targetRealm,
      '--agent',
      'claude',
    ]);

    assert.strictEqual(options.agent, 'claude');
    assert.strictEqual(options.openRouterModel, undefined);
  });

  test('parseFactoryEntrypointArgs accepts --agent codex', function (assert) {
    let options = parseFactoryEntrypointArgs([
      '--brief-url',
      briefUrl,
      '--target-realm',
      targetRealm,
      '--agent',
      'codex',
    ]);

    assert.strictEqual(options.agent, 'codex');
  });

  test('parseFactoryEntrypointArgs accepts --agent openrouter', function (assert) {
    let options = parseFactoryEntrypointArgs([
      '--brief-url',
      briefUrl,
      '--target-realm',
      targetRealm,
      '--agent',
      'openrouter',
    ]);

    assert.strictEqual(options.agent, 'openrouter');
    assert.strictEqual(options.openRouterModel, undefined);
  });

  test('parseFactoryEntrypointArgs accepts --agent openrouter=<model-id>', function (assert) {
    let options = parseFactoryEntrypointArgs([
      '--brief-url',
      briefUrl,
      '--target-realm',
      targetRealm,
      '--agent',
      'openrouter=anthropic/claude-sonnet-4',
    ]);

    assert.strictEqual(options.agent, 'openrouter');
    assert.strictEqual(options.openRouterModel, 'anthropic/claude-sonnet-4');
  });

  test('parseFactoryEntrypointArgs defaults --agent to claude when omitted', function (assert) {
    let options = parseFactoryEntrypointArgs([
      '--brief-url',
      briefUrl,
      '--target-realm',
      targetRealm,
    ]);

    assert.strictEqual(options.agent, 'claude');
  });

  test('parseFactoryEntrypointArgs rejects invalid --agent provider', function (assert) {
    assert.throws(
      () =>
        parseFactoryEntrypointArgs([
          '--brief-url',
          briefUrl,
          '--target-realm',
          targetRealm,
          '--agent',
          'ollama',
        ]),
      (error: unknown) =>
        error instanceof FactoryEntrypointUsageError &&
        /Invalid --agent provider/.test(error.message),
    );
  });

  test('parseFactoryEntrypointArgs rejects --agent claude=foo suffix', function (assert) {
    assert.throws(
      () =>
        parseFactoryEntrypointArgs([
          '--brief-url',
          briefUrl,
          '--target-realm',
          targetRealm,
          '--agent',
          'claude=foo',
        ]),
      (error: unknown) =>
        error instanceof FactoryEntrypointUsageError &&
        /does not accept a .*=.*suffix/.test(error.message),
    );
  });

  test('parseFactoryEntrypointArgs rejects --agent openrouter= with empty suffix', function (assert) {
    assert.throws(
      () =>
        parseFactoryEntrypointArgs([
          '--brief-url',
          briefUrl,
          '--target-realm',
          targetRealm,
          '--agent',
          'openrouter=',
        ]),
      (error: unknown) =>
        error instanceof FactoryEntrypointUsageError &&
        /non-empty model id/.test(error.message),
    );
  });

  test('parseFactoryEntrypointArgs accepts --no-retry-blocked', function (assert) {
    let options = parseFactoryEntrypointArgs([
      '--brief-url',
      briefUrl,
      '--target-realm',
      targetRealm,
      '--no-retry-blocked',
    ]);

    assert.false(options.retryBlocked);
  });

  test('parseFactoryEntrypointArgs rejects missing required inputs', function (assert) {
    assert.throws(
      () => parseFactoryEntrypointArgs(['--target-realm', targetRealm]),
      (error: unknown) =>
        error instanceof FactoryEntrypointUsageError &&
        /Missing required input: pass --brief-url .* or --repo-url/.test(
          error.message,
        ),
    );
  });

  test('buildFactoryEntrypointSummary reports structured run details', function (assert) {
    let summary = buildFactoryEntrypointSummary(
      {
        briefUrl,
        targetRealm,
        realmServerUrl: null,
        agent: 'claude',
      },
      normalizedBrief,
      bootstrappedTargetRealm,
      mockSeedResult,
    );

    assert.strictEqual(summary.command, 'factory:go');
    assert.strictEqual(summary.brief.url, briefUrl);
    assert.strictEqual(summary.brief.title, 'Sticky Note');
    assert.deepEqual(summary.brief.tags, [
      'documents-content',
      'sticky',
      'note',
    ]);
    assert.strictEqual(summary.targetRealm.url, targetRealm);
    assert.strictEqual(summary.targetRealm.ownerUsername, 'testuser');
    assert.deepEqual(
      summary.actions.map((action) => action.name),
      [
        'validated-inputs',
        'resolved-target-realm-owner',
        'fetched-brief',
        'normalized-brief',
        'resolved-target-realm',
        'bootstrapped-target-realm',
        'created-seed-issue',
      ],
    );
    assert.strictEqual(summary.seedIssue.seedIssueId, 'Issues/bootstrap-seed');
    assert.strictEqual(summary.seedIssue.seedIssueStatus, 'created');
    assert.deepEqual(summary.result, {
      status: 'ready',
      nextStep: 'run-issue-loop',
    });
  });

  test('runFactoryEntrypoint rejects --agent codex before any side effects', async function (assert) {
    useTestProfile();
    let createSeedCalled = false;
    let bootstrapCalled = false;

    await assert.rejects(
      runFactoryEntrypoint(
        {
          briefUrl,
          targetRealm,
          realmServerUrl: null,
          agent: 'codex',
        },
        {
          bootstrapTargetRealm: async () => {
            bootstrapCalled = true;
            return bootstrappedTargetRealm;
          },
          createSeed: async () => {
            createSeedCalled = true;
            return mockSeedResult;
          },
          runIssueLoop: async () => ({
            outcome: 'all_issues_done' as const,
            outerCycles: 0,
            issueResults: [],
          }),
          fetch: async () =>
            new Response('{}', {
              status: 200,
              headers: { 'content-type': SupportedMimeType.JSON },
            }),
        },
      ),
      /Codex CLI native agent is not yet implemented/,
    );

    assert.false(
      bootstrapCalled,
      'bootstrapTargetRealm must not run for unsupported --agent',
    );
    assert.false(
      createSeedCalled,
      'createSeed must not run for unsupported --agent',
    );
  });

  test('wantsFactoryEntrypointHelp detects help flag', function (assert) {
    assert.true(wantsFactoryEntrypointHelp(['--help']));
    assert.true(wantsFactoryEntrypointHelp(['--', '--help']));
    assert.false(wantsFactoryEntrypointHelp(['--brief-url', briefUrl]));
  });

  test('getFactoryEntrypointUsage documents required flags', function (assert) {
    let usage = getFactoryEntrypointUsage();

    assert.true(/--brief-url <url>/.test(usage));
    assert.true(/--target-realm <realm>/.test(usage));
    assert.true(/--realm-server-url <url>/.test(usage));
    assert.true(/--no-retry-blocked/.test(usage));
    assert.true(/--help/.test(usage));
    assert.true(/active Boxel profile/.test(usage));
    assert.true(
      /For public briefs, no further auth setup is needed./.test(usage),
    );
    assert.false(/REALM_SECRET_SEED/.test(usage));
  });

  test('runFactoryEntrypoint creates seed issue and loads brief data', async function (assert) {
    useTestProfile();

    let summary = await runFactoryEntrypoint(
      {
        briefUrl,
        targetRealm,
        realmServerUrl: null,
        agent: 'claude',
      },
      {
        bootstrapTargetRealm: async (resolution) => ({
          ...bootstrappedTargetRealm,
          url: resolution.url,
          serverUrl: resolution.serverUrl,
          createdRealm: false,
        }),
        createSeed: async () => mockSeedResult,
        // Stub the workspace pull/sync so unit tests don't make real HTTP
        // calls; the factory's workspace setup is covered by integration
        // specs that exercise a live realm.
        pullTargetRealm: async () => {},
        syncWorkspaceToRealm: async () => {},
        runIssueLoop: async () => ({
          outcome: 'all_issues_done' as const,
          outerCycles: 1,
          issueResults: [
            {
              issueId: 'Issues/bootstrap-seed',
              issueSummary: 'Process brief and create project artifacts',
              exitReason: 'done' as const,
              innerIterations: 1,
              toolCallLog: [],
            },
          ],
        }),
        fetch: async (_input, init) => {
          assert.strictEqual(
            new Headers(init?.headers).get('Authorization'),
            null,
          );

          return new Response(
            JSON.stringify({
              data: {
                attributes: {
                  content:
                    'Build a sticky note card with structured drafting, review, and reuse support.',
                  cardInfo: {
                    name: 'Sticky Note',
                    summary:
                      'Colorful, short-form note designed for spatial arrangement on boards and artboards.',
                  },
                  tags: ['documents-content', 'sticky', 'note'],
                },
              },
            }),
            {
              status: 200,
              headers: {
                'content-type': SupportedMimeType.JSON,
              },
            },
          );
        },
      },
    );

    assert.strictEqual(summary.brief.title, 'Sticky Note');
    assert.strictEqual(summary.brief.sourceUrl, briefUrl);
    assert.strictEqual(summary.targetRealm.ownerUsername, 'testuser');
    assert.strictEqual(summary.seedIssue.seedIssueId, 'Issues/bootstrap-seed');
    assert.strictEqual(summary.issueLoop?.outcome, 'all_issues_done');
    assert.strictEqual(summary.result.status, 'completed');
  });

  test('runFactoryEntrypoint uses the resolved realm server URL for darkfactory module', async function (assert) {
    useTestProfile();

    let capturedDarkfactoryModuleUrl: string | undefined;

    await runFactoryEntrypoint(
      {
        briefUrl,
        targetRealm,
        realmServerUrl: 'https://realms.example.test/app/',
        agent: 'claude',
      },
      {
        bootstrapTargetRealm: async (resolution) => ({
          ...bootstrappedTargetRealm,
          url: resolution.url,
          serverUrl: resolution.serverUrl,
          createdRealm: false,
        }),
        createSeed: async (_brief, options) => {
          capturedDarkfactoryModuleUrl = options.darkfactoryModuleUrl;
          return mockSeedResult;
        },
        pullTargetRealm: async () => {},
        syncWorkspaceToRealm: async () => {},
        runIssueLoop: async () => ({
          outcome: 'all_issues_done' as const,
          outerCycles: 0,
          issueResults: [],
        }),
        fetch: async () =>
          new Response(
            JSON.stringify({
              data: {
                attributes: {
                  content: 'Brief content',
                  cardInfo: {
                    name: 'Sticky Note',
                    summary:
                      'Colorful, short-form note designed for spatial arrangement on boards and artboards.',
                  },
                  tags: ['documents-content', 'sticky', 'note'],
                },
              },
            }),
            {
              status: 200,
              headers: {
                'content-type': SupportedMimeType.JSON,
              },
            },
          ),
      },
    );

    // inferDarkfactoryModuleUrl uses the target realm URL origin
    assert.strictEqual(
      capturedDarkfactoryModuleUrl,
      'https://realms.example.test/software-factory/darkfactory',
    );
  });

  function briefFetch(): typeof globalThis.fetch {
    return (async () =>
      new Response(
        JSON.stringify({
          data: {
            attributes: {
              content: 'Brief content',
              cardInfo: { name: 'Sticky Note', summary: 'summary' },
              tags: [],
            },
          },
        }),
        { status: 200, headers: { 'content-type': SupportedMimeType.JSON } },
      )) as unknown as typeof globalThis.fetch;
  }

  test('runFactoryEntrypoint sets the RealmDashboard index page for a freshly-created realm', async function (assert) {
    useTestProfile();

    let capturedWorkspaceDir: string | undefined;
    let capturedRealmUrl: string | undefined;

    await runFactoryEntrypoint(
      { briefUrl, targetRealm, realmServerUrl: null, agent: 'claude' },
      {
        bootstrapTargetRealm: async (resolution) => ({
          ...bootstrappedTargetRealm,
          url: resolution.url,
          serverUrl: resolution.serverUrl,
          createdRealm: true,
        }),
        createSeed: async () => mockSeedResult,
        pullTargetRealm: async () => {},
        syncWorkspaceToRealm: async () => {},
        writeRealmIndex: async (workspaceDir, realmUrl) => {
          capturedWorkspaceDir = workspaceDir;
          capturedRealmUrl = realmUrl;
        },
        linkRealmIndexBoard: async () => false,
        linkBootstrapIssueProject: async () => false,
        runIssueLoop: async () => ({
          outcome: 'all_issues_done' as const,
          outerCycles: 0,
          issueResults: [],
        }),
        fetch: briefFetch(),
      },
    );

    assert.ok(
      capturedWorkspaceDir,
      'writeRealmIndex runs for a freshly-created realm',
    );
    assert.strictEqual(capturedRealmUrl, targetRealm);
  });

  test('runFactoryEntrypoint links the index board after the loop and re-syncs when a board was found', async function (assert) {
    useTestProfile();

    let linkBoardCalled = false;
    let syncCount = 0;

    await runFactoryEntrypoint(
      { briefUrl, targetRealm, realmServerUrl: null, agent: 'claude' },
      {
        bootstrapTargetRealm: async (resolution) => ({
          ...bootstrappedTargetRealm,
          url: resolution.url,
          serverUrl: resolution.serverUrl,
          createdRealm: true,
        }),
        createSeed: async () => mockSeedResult,
        pullTargetRealm: async () => {},
        syncWorkspaceToRealm: async () => {
          syncCount++;
        },
        writeRealmIndex: async () => {},
        linkRealmIndexBoard: async (options) => {
          linkBoardCalled = true;
          assert.strictEqual(
            options.realmUrl,
            targetRealm,
            'board linker receives the target realm URL',
          );
          assert.strictEqual(
            options.darkfactoryModuleUrl,
            'https://realms.example.test/software-factory/darkfactory',
            'board linker receives the darkfactory module URL',
          );
          // Report a modification so the entrypoint re-syncs the index.
          return true;
        },
        // No project change here — this test isolates the board re-sync.
        linkBootstrapIssueProject: async () => false,
        runIssueLoop: async () => ({
          outcome: 'all_issues_done' as const,
          outerCycles: 0,
          issueResults: [],
        }),
        fetch: briefFetch(),
      },
    );

    assert.true(linkBoardCalled, 'linkRealmIndexBoard runs after the loop');
    // One sync for the seed/index push, one for the board-linked index.
    assert.strictEqual(syncCount, 2, 'the board-linked index is re-synced');
  });

  test('runFactoryEntrypoint links the seed issue project and re-syncs when a project was found', async function (assert) {
    useTestProfile();

    let linkProjectCalled = false;
    let syncCount = 0;

    await runFactoryEntrypoint(
      { briefUrl, targetRealm, realmServerUrl: null, agent: 'claude' },
      {
        bootstrapTargetRealm: async (resolution) => ({
          ...bootstrappedTargetRealm,
          url: resolution.url,
          serverUrl: resolution.serverUrl,
          createdRealm: true,
        }),
        createSeed: async () => mockSeedResult,
        pullTargetRealm: async () => {},
        syncWorkspaceToRealm: async () => {
          syncCount++;
        },
        writeRealmIndex: async () => {},
        // No board change — this test isolates the seed-issue project link.
        linkRealmIndexBoard: async () => false,
        linkBootstrapIssueProject: async (options) => {
          linkProjectCalled = true;
          assert.strictEqual(
            options.realmUrl,
            targetRealm,
            'project linker receives the target realm URL',
          );
          assert.strictEqual(
            options.darkfactoryModuleUrl,
            'https://realms.example.test/software-factory/darkfactory',
            'project linker receives the darkfactory module URL',
          );
          // Report a modification so the entrypoint re-syncs the seed issue.
          return true;
        },
        runIssueLoop: async () => ({
          outcome: 'all_issues_done' as const,
          outerCycles: 0,
          issueResults: [],
        }),
        fetch: briefFetch(),
      },
    );

    assert.true(
      linkProjectCalled,
      'linkBootstrapIssueProject runs for a freshly-created realm',
    );
    // One sync for the seed/index push, one for the project-linked seed issue.
    assert.strictEqual(
      syncCount,
      2,
      'the project-linked seed issue is re-synced',
    );
  });

  test('runFactoryEntrypoint links the board as soon as the bootstrap issue completes, before the loop returns', async function (assert) {
    useTestProfile();

    let events: string[] = [];

    await runFactoryEntrypoint(
      { briefUrl, targetRealm, realmServerUrl: null, agent: 'claude' },
      {
        bootstrapTargetRealm: async (resolution) => ({
          ...bootstrappedTargetRealm,
          url: resolution.url,
          serverUrl: resolution.serverUrl,
          createdRealm: true,
        }),
        createSeed: async () => mockSeedResult,
        pullTargetRealm: async () => {},
        syncWorkspaceToRealm: async () => {
          events.push('sync');
        },
        writeRealmIndex: async () => {},
        linkRealmIndexBoard: async () => {
          events.push('link');
          return true;
        },
        linkBootstrapIssueProject: async () => false,
        // The bootstrap issue finishes mid-run; a later implementation issue
        // never completes, so the loop returns a non-complete outcome. The
        // board must still be linked — via the bootstrap-complete hook the
        // entrypoint passes in — before the loop returns.
        runIssueLoop: async (config) => {
          await config.onBootstrapComplete?.();
          events.push('loop-returns');
          return {
            outcome: 'no_unblocked_issues' as const,
            outerCycles: 2,
            issueResults: [
              {
                issueId: 'Issues/bootstrap-seed',
                issueSummary: 'bootstrap',
                exitReason: 'done' as const,
                innerIterations: 1,
                toolCallLog: [],
              },
            ],
          };
        },
        fetch: briefFetch(),
      },
    );

    let firstLink = events.indexOf('link');
    assert.notStrictEqual(firstLink, -1, 'the board was linked');
    assert.ok(
      firstLink < events.indexOf('loop-returns'),
      'board linked via the bootstrap-complete hook, before the loop finished',
    );
  });

  test('runFactoryEntrypoint leaves the index page untouched for a pre-existing realm', async function (assert) {
    useTestProfile();

    let writeRealmIndexCalled = false;
    let linkBoardCalled = false;
    let linkProjectCalled = false;

    await runFactoryEntrypoint(
      { briefUrl, targetRealm, realmServerUrl: null, agent: 'claude' },
      {
        bootstrapTargetRealm: async (resolution) => ({
          ...bootstrappedTargetRealm,
          url: resolution.url,
          serverUrl: resolution.serverUrl,
          createdRealm: false,
        }),
        createSeed: async () => mockSeedResult,
        pullTargetRealm: async () => {},
        syncWorkspaceToRealm: async () => {},
        writeRealmIndex: async () => {
          writeRealmIndexCalled = true;
        },
        linkRealmIndexBoard: async () => {
          linkBoardCalled = true;
          return false;
        },
        linkBootstrapIssueProject: async () => {
          linkProjectCalled = true;
          return false;
        },
        runIssueLoop: async () => ({
          outcome: 'all_issues_done' as const,
          outerCycles: 0,
          issueResults: [],
        }),
        fetch: briefFetch(),
      },
    );

    assert.false(
      writeRealmIndexCalled,
      'writeRealmIndex must not run for a pre-existing realm',
    );
    assert.false(
      linkBoardCalled,
      'linkRealmIndexBoard must not run for a pre-existing realm',
    );
    assert.false(
      linkProjectCalled,
      'linkBootstrapIssueProject must not run for a pre-existing realm',
    );
  });
});

// ---------------------------------------------------------------------------
// buildModelPolicy — review turn budget
// ---------------------------------------------------------------------------

module('factory-entrypoint > buildModelPolicy review budget', function () {
  test('review turn is unbudgeted by default (inherits flagship)', function (assert) {
    let policy = buildModelPolicy({ v2: true });
    assert.strictEqual(policy?.acceptance, undefined);
  });

  test('--review-model opts the review turn into a cheaper budget', function (assert) {
    let policy = buildModelPolicy({ v2: true, reviewModel: 'claude-sonnet-5' });
    assert.deepEqual(policy?.acceptance, {
      model: 'claude-sonnet-5',
      effort: 'medium',
    });
  });

  test('review-model inherit keeps the flagship, effort-only budgets effort', function (assert) {
    let policy = buildModelPolicy({
      v2: true,
      reviewModel: 'inherit',
      reviewEffort: 'low',
    });
    assert.deepEqual(policy?.acceptance, { effort: 'low' });
  });
});

module('factory-entrypoint > buildModelPolicy bootstrap budget', function () {
  test('bootstrap defaults to claude-sonnet-5 at medium under v2', function (assert) {
    let policy = buildModelPolicy({ v2: true });
    assert.deepEqual(policy?.bootstrap, {
      model: 'claude-sonnet-5',
      effort: 'medium',
    });
  });

  test('bootstrap-model inherit keeps the session flagship', function (assert) {
    let policy = buildModelPolicy({ v2: true, bootstrapModel: 'inherit' });
    assert.deepEqual(policy?.bootstrap, { effort: 'medium' });
  });

  test('no policy at all outside v2', function (assert) {
    assert.strictEqual(buildModelPolicy({}), undefined);
  });
});
