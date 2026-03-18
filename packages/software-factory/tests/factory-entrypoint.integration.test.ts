import { readFileSync, mkdtempSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { module, test } from 'qunit';

const packageRoot = resolve(__dirname, '..');
const stickyNoteFixture = readFileSync(
  resolve(__dirname, '../realm/Wiki/sticky-note.json'),
  'utf8',
);

interface FactoryEntrypointIntegrationSummary {
  command: string;
  mode: string;
  brief: {
    url: string;
    title: string;
    contentSummary: string;
    tags: string[];
  };
  targetRealm: {
    path: string;
    exists: boolean;
  };
  result: Record<string, string>;
}

interface RunCommandOptions {
  cwd: string;
  encoding: BufferEncoding;
}

interface RunCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

module('factory-entrypoint integration', function () {
  test('factory:go package script prints a structured JSON summary', async function (assert) {
    let targetRealmPath = mkdtempSync(
      join(tmpdir(), 'factory-entrypoint-cli-'),
    );
    let server = createServer((request, response) => {
      assert.strictEqual(request.headers.authorization, 'Bearer brief-token');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(stickyNoteFixture);
    });

    await new Promise<void>((resolvePromise) =>
      server.listen(0, resolvePromise),
    );
    let address = server.address();

    if (!address || typeof address === 'string') {
      throw new Error('Expected test server to bind to a TCP port');
    }

    let briefUrl = `http://127.0.0.1:${address.port}/software-factory/Wiki/sticky-note`;

    try {
      let result = await runCommand(
        'pnpm',
        [
          '--silent',
          'factory:go',
          '--',
          '--brief-url',
          briefUrl,
          '--auth-token',
          'Bearer brief-token',
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

      let summary = JSON.parse(
        result.stdout,
      ) as FactoryEntrypointIntegrationSummary;
      assert.strictEqual(summary.command, 'factory:go');
      assert.strictEqual(summary.mode, 'resume');
      assert.strictEqual(summary.brief.url, briefUrl);
      assert.strictEqual(summary.brief.title, 'Sticky Note');
      assert.strictEqual(
        summary.brief.contentSummary,
        'Colorful, short-form note designed for spatial arrangement on boards and artboards.',
      );
      assert.deepEqual(summary.brief.tags, [
        'documents-content',
        'sticky',
        'note',
      ]);
      assert.strictEqual(summary.targetRealm.path, targetRealmPath);
      assert.true(summary.targetRealm.exists);
      assert.deepEqual(summary.result, {
        status: 'ready',
        nextStep: 'bootstrap-and-select-active-ticket',
      });
    } finally {
      await new Promise<void>((resolvePromise, reject) =>
        server.close((error) => (error ? reject(error) : resolvePromise())),
      );
    }
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
    assert.true(/--auth-token <token>/.test(result.stdout));
    assert.true(/--mode <mode>/.test(result.stdout));
  });
});

async function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions,
): Promise<RunCommandResult> {
  return await new Promise((resolvePromise, reject) => {
    let child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding(options.encoding);
    child.stderr.setEncoding(options.encoding);
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (status) => {
      resolvePromise({ status, stdout, stderr });
    });
  });
}
