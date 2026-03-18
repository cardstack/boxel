import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { module, test } from 'qunit';

import {
  FactoryEntrypointUsageError,
  buildFactoryEntrypointSummary,
  getFactoryEntrypointUsage,
  parseFactoryEntrypointArgs,
  wantsFactoryEntrypointHelp,
} from '../src/factory-entrypoint';

const briefUrl =
  'https://briefs.example.test/software-factory/Wiki/sticky-note';
const targetRealmUrl = 'https://realms.example.test/hassan/personal/';

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
      targetRealmPath: './realms/personal',
      targetRealmUrl: null,
      mode: 'implement',
    });
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

    let summary = buildFactoryEntrypointSummary({
      briefUrl,
      targetRealmPath,
      targetRealmUrl,
      mode: 'bootstrap',
    });

    assert.strictEqual(summary.command, 'factory:go');
    assert.strictEqual(summary.mode, 'bootstrap');
    assert.strictEqual(summary.brief.url, briefUrl);
    assert.strictEqual(summary.targetRealm.path, targetRealmPath);
    assert.true(summary.targetRealm.exists);
    assert.strictEqual(summary.targetRealm.url, targetRealmUrl);
    assert.deepEqual(
      summary.actions.map((action) => action.name),
      [
        'validated-inputs',
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
    assert.true(/--target-realm-path <path>/.test(usage));
    assert.true(/--target-realm-url <url>/.test(usage));
    assert.true(/--mode <mode>/.test(usage));
    assert.true(/--help/.test(usage));
  });
});
