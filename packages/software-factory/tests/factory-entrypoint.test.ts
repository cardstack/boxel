import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { module, test } from 'qunit';

import { resetProfileManager } from '@cardstack/boxel-cli';
import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';

import {
  FactoryEntrypointUsageError,
  buildFactoryEntrypointSummary,
  getFactoryEntrypointUsage,
  parseFactoryEntrypointArgs,
  runFactoryEntrypoint,
  wantsFactoryEntrypointHelp,
} from '../src/factory-entrypoint';
import type { FactoryBrief } from '../src/factory-brief';
import type { FactoryTargetRealmBootstrapResult } from '../src/factory-target-realm';
import type { SeedIssueResult } from '../src/factory-seed';

const briefUrl =
  'https://briefs.example.test/software-factory/Wiki/sticky-note';
const targetRealmUrl = 'https://realms.example.test/hassan/personal/';
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
  url: targetRealmUrl,
  serverUrl: 'https://realms.example.test/',
  ownerUsername: 'hassan',
  createdRealm: true,
};
const mockSeedResult: SeedIssueResult = {
  issueId: 'Issues/bootstrap-seed',
  status: 'created',
};

module('factory-entrypoint', function (hooks) {
  let originalMatrixUsername = process.env.MATRIX_USERNAME;

  hooks.afterEach(function () {
    process.env.MATRIX_USERNAME = originalMatrixUsername;
  });

  test('parseFactoryEntrypointArgs accepts required inputs and defaults mode', function (assert) {
    let options = parseFactoryEntrypointArgs([
      '--brief-url',
      briefUrl,
      '--target-realm-url',
      targetRealmUrl,
      '--realm-server-url',
      'https://realms.example.test/',
    ]);

    assert.deepEqual(options, {
      briefUrl,
      targetRealmUrl,
      realmServerUrl: 'https://realms.example.test/',
      mode: 'implement',
      model: undefined,
      debug: undefined,
    });
  });

  test('parseFactoryEntrypointArgs rejects invalid mode', function (assert) {
    assert.throws(
      () =>
        parseFactoryEntrypointArgs([
          '--brief-url',
          briefUrl,
          '--target-realm-url',
          targetRealmUrl,
          '--mode',
          'ship-it',
        ]),
      (error: unknown) =>
        error instanceof FactoryEntrypointUsageError &&
        error.message ===
          'Invalid --mode "ship-it". Expected one of: bootstrap, implement, resume',
    );
  });
  test('parseFactoryEntrypointArgs rejects missing required inputs', function (assert) {
    assert.throws(
      () => parseFactoryEntrypointArgs(['--target-realm-url', targetRealmUrl]),
      (error: unknown) =>
        error instanceof FactoryEntrypointUsageError &&
        error.message === 'Missing required --brief-url',
    );
  });

  test('buildFactoryEntrypointSummary reports structured run details', function (assert) {
    let summary = buildFactoryEntrypointSummary(
      {
        briefUrl,
        targetRealmUrl,
        mode: 'bootstrap',
        realmServerUrl: null,
      },
      normalizedBrief,
      bootstrappedTargetRealm,
      mockSeedResult,
    );

    assert.strictEqual(summary.command, 'factory:go');
    assert.strictEqual(summary.mode, 'bootstrap');
    assert.strictEqual(summary.brief.url, briefUrl);
    assert.strictEqual(summary.brief.title, 'Sticky Note');
    assert.deepEqual(summary.brief.tags, [
      'documents-content',
      'sticky',
      'note',
    ]);
    assert.strictEqual(summary.targetRealm.url, targetRealmUrl);
    assert.strictEqual(summary.targetRealm.ownerUsername, 'hassan');
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
      nextStep: 'seed-issue-created',
    });
  });

  test('wantsFactoryEntrypointHelp detects help flag', function (assert) {
    assert.true(wantsFactoryEntrypointHelp(['--help']));
    assert.true(wantsFactoryEntrypointHelp(['--', '--help']));
    assert.false(wantsFactoryEntrypointHelp(['--brief-url', briefUrl]));
  });

  test('getFactoryEntrypointUsage documents required flags', function (assert) {
    let usage = getFactoryEntrypointUsage();

    assert.true(/--brief-url <url>/.test(usage));
    assert.true(/--target-realm-url <url>/.test(usage));
    assert.true(/--realm-server-url <url>/.test(usage));
    assert.true(/--mode <mode>/.test(usage));
    assert.true(/--help/.test(usage));
    assert.true(/MATRIX_USERNAME is required/.test(usage));
    assert.true(/For public briefs, no auth setup is needed./.test(usage));
    assert.true(/MATRIX_URL \+ MATRIX_USERNAME \+ MATRIX_PASSWORD/.test(usage));
    assert.false(/REALM_SECRET_SEED/.test(usage));
  });

  test('runFactoryEntrypoint creates seed issue and loads brief data', async function (assert) {
    // Isolate HOME so ensureActiveProfile finds a synthetic profile
    // instead of the developer's real one (or none in CI).
    let originalHome = process.env.HOME;
    let tempHome = mkdtempSync(join(tmpdir(), 'factory-ep-test-'));
    let profilesDir = join(tempHome, '.boxel-cli');
    mkdirSync(profilesDir, { recursive: true });
    writeFileSync(
      join(profilesDir, 'profiles.json'),
      JSON.stringify({
        activeProfile: '@hassan:example.test',
        profiles: {
          '@hassan:example.test': {
            displayName: 'test',
            matrixUrl: 'https://matrix.example.test',
            realmServerUrl: 'https://realms.example.test/',
            password: 'test',
          },
        },
      }),
      { mode: 0o600 },
    );
    process.env.HOME = tempHome;
    resetProfileManager();
    process.env.MATRIX_USERNAME = 'hassan';

    try {
    let summary = await runFactoryEntrypoint(
      {
        briefUrl,
        targetRealmUrl,
        realmServerUrl: null,
        mode: 'implement',
      },
      {
        bootstrapTargetRealm: async (resolution) => ({
          ...bootstrappedTargetRealm,
          url: resolution.url,
          serverUrl: resolution.serverUrl,
          createdRealm: false,
        }),
        createSeed: async () => mockSeedResult,
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
    assert.strictEqual(summary.targetRealm.ownerUsername, 'hassan');
    assert.strictEqual(summary.seedIssue.seedIssueId, 'Issues/bootstrap-seed');
    assert.strictEqual(summary.issueLoop?.outcome, 'all_issues_done');
    assert.strictEqual(summary.result.status, 'completed');
    } finally {
      process.env.HOME = originalHome;
      resetProfileManager();
      rmSync(tempHome, { recursive: true, force: true });
    }
  });

  test('runFactoryEntrypoint uses the resolved realm server URL for darkfactory module', async function (assert) {
    let originalHome = process.env.HOME;
    let tempHome = mkdtempSync(join(tmpdir(), 'factory-ep-test-'));
    let profilesDir = join(tempHome, '.boxel-cli');
    mkdirSync(profilesDir, { recursive: true });
    writeFileSync(
      join(profilesDir, 'profiles.json'),
      JSON.stringify({
        activeProfile: '@hassan:example.test',
        profiles: {
          '@hassan:example.test': {
            displayName: 'test',
            matrixUrl: 'https://matrix.example.test',
            realmServerUrl: 'https://realms.example.test/app/',
            password: 'test',
          },
        },
      }),
      { mode: 0o600 },
    );
    process.env.HOME = tempHome;
    resetProfileManager();
    process.env.MATRIX_USERNAME = 'hassan';

    let capturedDarkfactoryModuleUrl: string | undefined;

    try {
    await runFactoryEntrypoint(
      {
        briefUrl,
        targetRealmUrl,
        realmServerUrl: 'https://realms.example.test/app/',
        mode: 'bootstrap',
      },
      {
        bootstrapTargetRealm: async (resolution) => ({
          ...bootstrappedTargetRealm,
          url: resolution.url,
          serverUrl: resolution.serverUrl,
          createdRealm: false,
        }),
        createSeed: async (_brief, _url, options) => {
          capturedDarkfactoryModuleUrl = options.darkfactoryModuleUrl;
          return mockSeedResult;
        },
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
    } finally {
      process.env.HOME = originalHome;
      resetProfileManager();
      rmSync(tempHome, { recursive: true, force: true });
    }
  });
});
