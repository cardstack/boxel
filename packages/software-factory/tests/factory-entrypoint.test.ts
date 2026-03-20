import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { module, test } from 'qunit';

import {
  FactoryEntrypointUsageError,
  buildFactoryEntrypointSummary,
  getFactoryEntrypointUsage,
  parseFactoryEntrypointArgs,
  runFactoryEntrypoint,
  wantsFactoryEntrypointHelp,
} from '../src/factory-entrypoint';
import type { FactoryBrief } from '../src/factory-brief';

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

module('factory-entrypoint', function () {
  test('parseFactoryEntrypointArgs accepts required inputs and defaults mode', function (assert) {
    let options = parseFactoryEntrypointArgs([
      '--brief-url',
      briefUrl,
      '--target-realm-path',
      './realms/personal',
    ]);

    assert.deepEqual(options, {
      briefUrl,
      authToken: null,
      targetRealmPath: './realms/personal',
      targetRealmUrl: null,
      mode: 'implement',
    });
  });

  test('parseFactoryEntrypointArgs accepts an optional brief auth token override', function (assert) {
    let options = parseFactoryEntrypointArgs([
      '--brief-url',
      briefUrl,
      '--auth-token',
      'Bearer brief-token',
      '--target-realm-path',
      './realms/personal',
    ]);

    assert.strictEqual(options.authToken, 'Bearer brief-token');
  });

  test('parseFactoryEntrypointArgs rejects invalid mode', function (assert) {
    assert.throws(
      () =>
        parseFactoryEntrypointArgs([
          '--brief-url',
          briefUrl,
          '--target-realm-path',
          './realms/personal',
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
      () =>
        parseFactoryEntrypointArgs([
          '--target-realm-path',
          './realms/personal',
        ]),
      (error: unknown) =>
        error instanceof FactoryEntrypointUsageError &&
        error.message === 'Missing required --brief-url',
    );
  });

  test('buildFactoryEntrypointSummary reports structured run details', function (assert) {
    let targetRealmPath = mkdtempSync(join(tmpdir(), 'factory-go-summary-'));

    let summary = buildFactoryEntrypointSummary(
      {
        briefUrl,
        authToken: null,
        targetRealmPath,
        targetRealmUrl,
        mode: 'bootstrap',
      },
      normalizedBrief,
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
    assert.strictEqual(summary.targetRealm.path, targetRealmPath);
    assert.true(summary.targetRealm.exists);
    assert.strictEqual(summary.targetRealm.url, targetRealmUrl);
    assert.deepEqual(
      summary.actions.map((action) => action.name),
      [
        'validated-inputs',
        'fetched-brief',
        'normalized-brief',
        'resolved-target-realm-path',
        'resolved-target-realm-url',
      ],
    );
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
    assert.true(/--auth-token <token>/.test(usage));
    assert.true(/--target-realm-path <path>/.test(usage));
    assert.true(/--target-realm-url <url>/.test(usage));
    assert.true(/--mode <mode>/.test(usage));
    assert.true(/--help/.test(usage));
    assert.true(/For public briefs, no auth setup is needed./.test(usage));
    assert.true(
      /MATRIX_URL \+ MATRIX_USERNAME \+ MATRIX_PASSWORD \+ REALM_SERVER_URL/.test(
        usage,
      ),
    );
    assert.true(
      /MATRIX_URL \+ REALM_SERVER_URL \+ REALM_SECRET_SEED/.test(usage),
    );
  });

  test('runFactoryEntrypoint loads and includes normalized brief data', async function (assert) {
    let targetRealmPath = mkdtempSync(join(tmpdir(), 'factory-go-summary-'));

    let summary = await runFactoryEntrypoint(
      {
        briefUrl,
        authToken: 'Bearer brief-token',
        targetRealmPath,
        targetRealmUrl: null,
        mode: 'implement',
      },
      {
        fetch: async (_input, init) => {
          assert.strictEqual(
            new Headers(init?.headers).get('Authorization'),
            'Bearer brief-token',
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
                'content-type': 'application/json',
              },
            },
          );
        },
      },
    );

    assert.strictEqual(summary.brief.title, 'Sticky Note');
    assert.strictEqual(summary.brief.sourceUrl, briefUrl);
    assert.strictEqual(
      summary.brief.contentSummary,
      'Colorful, short-form note designed for spatial arrangement on boards and artboards.',
    );
    assert.true(summary.brief.content.includes('structured drafting'));
  });
});
