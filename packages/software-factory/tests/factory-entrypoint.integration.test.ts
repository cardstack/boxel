import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { module, test } from 'qunit';

const packageRoot = resolve(__dirname, '..');
const briefUrl =
  'https://briefs.example.test/software-factory/Wiki/sticky-note';

module('factory-entrypoint integration', function () {
  test('factory:go package script prints a structured JSON summary', function (assert) {
    let targetRealmPath = mkdtempSync(
      join(tmpdir(), 'factory-entrypoint-cli-'),
    );
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

    assert.strictEqual(result.status, 0, result.stderr);

    let summary = JSON.parse(result.stdout) as {
      command: string;
      mode: string;
      brief: { url: string };
      targetRealm: { path: string; exists: boolean };
      result: Record<string, string>;
    };
    assert.strictEqual(summary.command, 'factory:go');
    assert.strictEqual(summary.mode, 'resume');
    assert.strictEqual(summary.brief.url, briefUrl);
    assert.strictEqual(summary.targetRealm.path, targetRealmPath);
    assert.true(summary.targetRealm.exists);
    assert.deepEqual(summary.result, {
      status: 'ready',
      nextStep: 'bootstrap-and-select-active-ticket',
    });
  });

  test('factory:go package script fails clearly when required inputs are missing', function (assert) {
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

    assert.strictEqual(result.status, 1);
    assert.true(/Missing required --brief-url/.test(result.stderr));
    assert.true(/Usage:/.test(result.stderr));
    assert.true(/--target-realm-path <path>/.test(result.stderr));
  });

  test('factory:go package script prints usage with --help', function (assert) {
    let result = spawnSync('pnpm', ['--silent', 'factory:go', '--', '--help'], {
      cwd: packageRoot,
      encoding: 'utf8',
    });

    assert.strictEqual(result.status, 0, result.stderr);
    assert.true(/Usage:/.test(result.stdout));
    assert.true(/--brief-url <url>/.test(result.stdout));
    assert.true(/--mode <mode>/.test(result.stdout));
  });
});
