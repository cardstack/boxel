import { module, test } from 'qunit';

import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';

import {
  FactoryEntrypointUsageError,
  buildFactoryEntrypointSummary,
  getFactoryEntrypointUsage,
  parseFactoryEntrypointArgs,
  runFactoryEntrypoint,
  wantsFactoryEntrypointHelp,
} from '../src/factory-entrypoint';
import type { FactoryBootstrapResult } from '../src/factory-bootstrap';
import type { FactoryBrief } from '../src/factory-brief';
import type { FactoryTargetRealmBootstrapResult } from '../src/factory-target-realm';

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
  authorization: 'Bearer token',
};
const mockBootstrapResult: FactoryBootstrapResult = {
  project: { id: 'Projects/sticky-note-mvp', status: 'created' },
  knowledgeArticles: [
    { id: 'Knowledge Articles/sticky-note-brief-context', status: 'created' },
    {
      id: 'Knowledge Articles/sticky-note-agent-onboarding',
      status: 'created',
    },
  ],
  tickets: [
    { id: 'Tickets/sticky-note-define-core', status: 'created' },
    { id: 'Tickets/sticky-note-design-views', status: 'created' },
    { id: 'Tickets/sticky-note-add-integration', status: 'created' },
  ],
  activeTicket: { id: 'Tickets/sticky-note-define-core', status: 'created' },
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
      mockBootstrapResult,
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
        'bootstrapped-project-artifacts',
      ],
    );
    assert.strictEqual(summary.bootstrap.projectId, 'Projects/sticky-note-mvp');
    assert.strictEqual(summary.bootstrap.ticketIds.length, 3);
    assert.strictEqual(
      summary.bootstrap.activeTicket.id,
      'Tickets/sticky-note-define-core',
    );
    assert.strictEqual(summary.bootstrap.activeTicket.status, 'created');
    assert.deepEqual(summary.result, {
      status: 'ready',
      nextStep: 'bootstrap-target-realm',
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
    assert.true(
      /MATRIX_URL \+ MATRIX_USERNAME \+ MATRIX_PASSWORD \+ REALM_SERVER_URL/.test(
        usage,
      ),
    );
    assert.false(/REALM_SECRET_SEED/.test(usage));
  });

  test('runFactoryEntrypoint loads and includes normalized brief data', async function (assert) {
    process.env.MATRIX_USERNAME = 'hassan';

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
        bootstrapArtifacts: async () => mockBootstrapResult,
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
    assert.strictEqual(
      summary.brief.contentSummary,
      'Colorful, short-form note designed for spatial arrangement on boards and artboards.',
    );
    assert.true(summary.brief.content.includes('structured drafting'));
  });

  test('runFactoryEntrypoint uses the resolved realm server URL for darkfactory artifacts', async function (assert) {
    process.env.MATRIX_USERNAME = 'hassan';

    let capturedDarkfactoryModuleUrl: string | undefined;

    await runFactoryEntrypoint(
      {
        briefUrl,
        targetRealmUrl,
        realmServerUrl: 'https://realms.example.test/app/',
        mode: 'implement',
      },
      {
        bootstrapTargetRealm: async (resolution) => ({
          ...bootstrappedTargetRealm,
          url: resolution.url,
          serverUrl: resolution.serverUrl,
          createdRealm: false,
          authorization: 'Bearer target-realm-token',
        }),
        bootstrapArtifacts: async (_brief, _targetRealmUrl, options) => {
          capturedDarkfactoryModuleUrl = options?.darkfactoryModuleUrl;
          return mockBootstrapResult;
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

    assert.strictEqual(
      capturedDarkfactoryModuleUrl,
      'https://realms.example.test/app/software-factory/darkfactory',
    );
  });
});
