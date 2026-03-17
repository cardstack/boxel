import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

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

test('parseFactoryEntrypointArgs accepts required inputs and defaults mode', () => {
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

test('parseFactoryEntrypointArgs rejects invalid mode', () => {
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

test('parseFactoryEntrypointArgs rejects missing required inputs', () => {
  assert.throws(
    () =>
      parseFactoryEntrypointArgs(['--target-realm-path', './realms/personal']),
    (error: unknown) =>
      error instanceof FactoryEntrypointUsageError &&
      error.message === 'Missing required --brief-url',
  );
});

test('buildFactoryEntrypointSummary reports structured run details', () => {
  let targetRealmPath = mkdtempSync(join(tmpdir(), 'factory-go-summary-'));

  let summary = buildFactoryEntrypointSummary({
    briefUrl,
    targetRealmPath,
    targetRealmUrl,
    mode: 'bootstrap',
  });

  assert.equal(summary.command, 'factory:go');
  assert.equal(summary.mode, 'bootstrap');
  assert.equal(summary.brief.url, briefUrl);
  assert.equal(summary.targetRealm.path, targetRealmPath);
  assert.equal(summary.targetRealm.exists, true);
  assert.equal(summary.targetRealm.url, targetRealmUrl);
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

test('wantsFactoryEntrypointHelp detects help flag', () => {
  assert.equal(wantsFactoryEntrypointHelp(['--help']), true);
  assert.equal(wantsFactoryEntrypointHelp(['--', '--help']), true);
  assert.equal(wantsFactoryEntrypointHelp(['--brief-url', briefUrl]), false);
});

test('getFactoryEntrypointUsage documents required flags', () => {
  let usage = getFactoryEntrypointUsage();

  assert.match(usage, /--brief-url <url>/);
  assert.match(usage, /--target-realm-path <path>/);
  assert.match(usage, /--target-realm-url <url>/);
  assert.match(usage, /--mode <mode>/);
  assert.match(usage, /--help/);
});
