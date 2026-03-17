import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import test from 'node:test';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const briefUrl =
  'https://briefs.example.test/software-factory/Wiki/sticky-note';

test('factory:go package script prints a structured JSON summary', () => {
  let targetRealmPath = mkdtempSync(join(tmpdir(), 'factory-entrypoint-cli-'));
  let result = spawnSync(
    'pnpm',
    [
      '--silent',
      'factory:go',
      '--',
      '--brief-url',
      briefUrl,
      '--target-realm-path',
      targetRealmPath,
      '--mode',
      'resume',
    ],
    {
      cwd: packageRoot,
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 0, result.stderr);

  let summary = JSON.parse(result.stdout);
  assert.equal(summary.command, 'factory:go');
  assert.equal(summary.mode, 'resume');
  assert.equal(summary.brief.url, briefUrl);
  assert.equal(summary.targetRealm.path, targetRealmPath);
  assert.equal(summary.targetRealm.exists, true);
  assert.deepEqual(summary.result, {
    status: 'ready',
    nextStep: 'bootstrap-and-select-active-ticket',
  });
});

test('factory:go package script fails clearly when required inputs are missing', () => {
  let result = spawnSync(
    'pnpm',
    [
      '--silent',
      'factory:go',
      '--',
      '--target-realm-path',
      './realms/personal',
    ],
    {
      cwd: packageRoot,
      encoding: 'utf8',
    },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing required --brief-url/);
  assert.match(result.stderr, /Usage:/);
  assert.match(result.stderr, /--target-realm-path <path>/);
});

test('factory:go package script prints usage with --help', () => {
  let result = spawnSync('pnpm', ['--silent', 'factory:go', '--', '--help'], {
    cwd: packageRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /--brief-url <url>/);
  assert.match(result.stdout, /--mode <mode>/);
});
