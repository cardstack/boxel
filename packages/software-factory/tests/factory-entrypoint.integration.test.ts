import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
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
    url: string;
    ownerUsername: string;
  };
  result: Record<string, string>;
}

interface RunCommandOptions {
  cwd: string;
  encoding: BufferEncoding;
  env?: NodeJS.ProcessEnv;
}

interface RunCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

module('factory-entrypoint integration', function () {
  test('factory:go package script prints a structured JSON summary', async function (assert) {
    let targetRealmUrl: string;
    let server = createServer((request, response) => {
      if (request.url === '/software-factory/Wiki/sticky-note') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(stickyNoteFixture);
      } else if (
        request.url === '/_matrix/client/v3/login' &&
        request.method === 'POST'
      ) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            access_token: 'matrix-access-token',
            device_id: 'device-id',
            user_id: '@hassan:localhost',
          }),
        );
      } else if (
        request.url ===
          '/_matrix/client/v3/user/%40hassan%3Alocalhost/openid/request_token' &&
        request.method === 'POST'
      ) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            access_token: 'openid-token',
            expires_in: 300,
            matrix_server_name: 'localhost',
            token_type: 'Bearer',
          }),
        );
      } else if (
        request.url === '/_server-session' &&
        request.method === 'POST'
      ) {
        response.writeHead(200, {
          'content-type': 'application/json',
          Authorization: 'Bearer realm-server-token',
        });
        response.end('{}');
      } else if (
        request.url === '/_create-realm' &&
        request.method === 'POST'
      ) {
        assert.strictEqual(
          request.headers.authorization,
          'Bearer realm-server-token',
        );
        response.writeHead(201, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            data: {
              type: 'realm',
              id: targetRealmUrl,
            },
          }),
        );
      } else {
        response.writeHead(404, { 'content-type': 'text/plain' });
        response.end(`Unexpected request: ${request.method} ${request.url}`);
      }
    });

    await new Promise<void>((resolvePromise) =>
      server.listen(0, resolvePromise),
    );
    let address = server.address();

    if (!address || typeof address === 'string') {
      throw new Error('Expected test server to bind to a TCP port');
    }

    let origin = `http://127.0.0.1:${address.port}`;
    let briefUrl = `${origin}/software-factory/Wiki/sticky-note`;
    targetRealmUrl = `${origin}/hassan/personal/`;

    try {
      let result = await runCommand(
        'pnpm',
        [
          '--silent',
          'factory:go',
          '--',
          '--brief-url',
          briefUrl,
          '--target-realm-url',
          targetRealmUrl,
          '--mode',
          'resume',
        ],
        {
          cwd: packageRoot,
          encoding: 'utf8',
          env: {
            ...process.env,
            MATRIX_USERNAME: 'hassan',
            MATRIX_PASSWORD: 'secret',
            MATRIX_URL: origin,
            REALM_SERVER_URL: `${origin}/`,
          },
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
      assert.strictEqual(summary.targetRealm.url, targetRealmUrl);
      assert.strictEqual(summary.targetRealm.ownerUsername, 'hassan');
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
        '--target-realm-url',
        'https://realms.example.test/hassan/personal/',
      ],
      {
        cwd: packageRoot,
        encoding: 'utf8',
      },
    );

    assert.strictEqual(result.status, 1);
    assert.true(/Missing required --brief-url/.test(result.stderr));
    assert.true(/Usage:/.test(result.stderr));
    assert.true(/--target-realm-url <url>/.test(result.stderr));
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

  test('factory:go fails clearly when MATRIX_USERNAME is missing', async function (assert) {
    let server = createServer((_request, response) => {
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

    try {
      let briefUrl = `http://127.0.0.1:${address.port}/software-factory/Wiki/sticky-note`;
      let targetRealmUrl = `http://127.0.0.1:${address.port}/hassan/personal/`;
      let result = await runCommand(
        'pnpm',
        [
          '--silent',
          'factory:go',
          '--',
          '--brief-url',
          briefUrl,
          '--target-realm-url',
          targetRealmUrl,
        ],
        {
          cwd: packageRoot,
          encoding: 'utf8',
          env: {
            ...process.env,
            MATRIX_USERNAME: '',
          },
        },
      );

      assert.strictEqual(result.status, 1);
      assert.true(
        /Set MATRIX_USERNAME before running factory:go/.test(result.stderr),
      );
    } finally {
      await new Promise<void>((resolvePromise, reject) =>
        server.close((error) => (error ? reject(error) : resolvePromise())),
      );
    }
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
      env: options.env,
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
