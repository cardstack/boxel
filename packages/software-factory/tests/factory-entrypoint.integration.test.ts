import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { module, test } from 'qunit';

import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';

const packageRoot = resolve(__dirname, '..');
const stickyNoteFixture = readFileSync(
  resolve(__dirname, '../realm/Wiki/sticky-note.json'),
  'utf8',
);

/**
 * Create a throwaway HOME directory containing ~/.boxel-cli/profiles.json
 * with an active profile pointing at `serverOrigin`. Used by integration
 * tests so the spawned `factory:go` subprocess does not inherit (and
 * authenticate against) the developer's real Boxel profile.
 */
function makeTempHomeWithProfile(
  serverOrigin: string,
  matrixId = '@hassan:localhost',
): string {
  let tempHome = mkdtempSync(join(tmpdir(), 'factory-test-home-'));
  let profilesDir = join(tempHome, '.boxel-cli');
  mkdirSync(profilesDir, { recursive: true });
  writeFileSync(
    join(profilesDir, 'profiles.json'),
    JSON.stringify({
      activeProfile: matrixId,
      profiles: {
        [matrixId]: {
          displayName: 'integration test',
          matrixUrl: serverOrigin,
          realmServerUrl: `${serverOrigin}/`,
          password: 'secret',
        },
      },
    }),
    { mode: 0o600 },
  );
  return tempHome;
}

function makeTempHomeWithoutProfile(): string {
  return mkdtempSync(join(tmpdir(), 'factory-test-home-empty-'));
}

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
  bootstrap: {
    projectId: string;
    knowledgeArticleIds: string[];
    issueIds: string[];
    activeIssue: { id: string; status: string };
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
    let canonicalTargetRealmUrl: string;
    let targetRealmUrl: string;
    let createdCardPaths = new Set<string>();
    let server = createServer((request, response) => {
      if (request.url === '/software-factory/Wiki/sticky-note') {
        response.writeHead(200, { 'content-type': SupportedMimeType.JSON });
        response.end(stickyNoteFixture);
      } else if (
        request.url === '/_matrix/client/v3/login' &&
        request.method === 'POST'
      ) {
        response.writeHead(200, { 'content-type': SupportedMimeType.JSON });
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
        response.writeHead(200, { 'content-type': SupportedMimeType.JSON });
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
          'content-type': SupportedMimeType.JSON,
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
        response.writeHead(201, { 'content-type': SupportedMimeType.JSON });
        response.end(
          JSON.stringify({
            data: {
              type: 'realm',
              id: canonicalTargetRealmUrl,
            },
          }),
        );
      } else if (
        request.url ===
          '/_matrix/client/v3/user/%40hassan%3Alocalhost/account_data/app.boxel.realms' &&
        request.method === 'GET'
      ) {
        response.writeHead(200, { 'content-type': SupportedMimeType.JSON });
        response.end(JSON.stringify({ realms: [] }));
      } else if (
        request.url ===
          '/_matrix/client/v3/user/%40hassan%3Alocalhost/account_data/app.boxel.realms' &&
        request.method === 'PUT'
      ) {
        response.writeHead(200, { 'content-type': SupportedMimeType.JSON });
        response.end('{}');
      } else if (request.url === '/_realm-auth' && request.method === 'POST') {
        response.writeHead(200, { 'content-type': SupportedMimeType.JSON });
        response.end(
          JSON.stringify({
            [canonicalTargetRealmUrl]: 'Bearer target-realm-token',
            // The brief lives on a separate realm; include it so the
            // factory's per-realm auth lookup succeeds for the brief URL.
            [`${origin}/software-factory/Wiki/`]: 'Bearer brief-realm-token',
          }),
        );
      } else if (
        request.url === '/hassan/personal/_readiness-check' &&
        request.method === 'GET'
      ) {
        response.writeHead(200, {
          'content-type': 'text/html',
        });
        response.end('');
      } else if (
        request.url === '/hassan/personal/_session' &&
        request.method === 'POST'
      ) {
        // Realm session for target realm auth
        response.writeHead(201, {
          'content-type': SupportedMimeType.JSON,
          Authorization: 'Bearer target-realm-token',
        });
        response.end('');
      } else if (
        request.url?.startsWith('/hassan/personal/') &&
        request.method === 'GET'
      ) {
        let cardPath = request.url
          .replace('/hassan/personal/', '')
          .replace(/\.json$/, '');
        if (createdCardPaths.has(cardPath)) {
          response.writeHead(200, { 'content-type': SupportedMimeType.JSON });
          response.end(
            JSON.stringify({
              data: {
                type: 'card',
                attributes: {},
                meta: {
                  adoptsFrom: {
                    module: `${origin}/software-factory/darkfactory`,
                    name: 'Project',
                  },
                },
              },
            }),
          );
        } else {
          // Card existence check — return 404 for first run
          response.writeHead(404, { 'content-type': 'text/plain' });
          response.end('not found');
        }
      } else if (
        request.url?.startsWith('/hassan/personal/') &&
        request.method === 'POST'
      ) {
        createdCardPaths.add(
          request.url.replace('/hassan/personal/', '').replace(/\.json$/, ''),
        );
        // Card creation — accept it
        response.writeHead(204);
        response.end();
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
    targetRealmUrl = `${origin}/typed-by-user/personal/`;
    canonicalTargetRealmUrl = `${origin}/hassan/personal/`;

    // Isolate HOME so the subprocess does not inherit the developer's real
    // ~/.boxel-cli/profiles.json. Seed a synthetic profile pointing at the
    // test server — this is what @cardstack/boxel-cli authenticates with.
    let tempHome = makeTempHomeWithProfile(origin);

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
          '--realm-server-url',
          `${origin}/`,
          '--mode',
          'resume',
        ],
        {
          cwd: packageRoot,
          encoding: 'utf8',
          env: {
            ...process.env,
            HOME: tempHome,
            MATRIX_USERNAME: 'hassan',
            MATRIX_PASSWORD: 'secret',
            MATRIX_URL: origin,
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
      assert.strictEqual(summary.targetRealm.url, canonicalTargetRealmUrl);
      assert.strictEqual(summary.targetRealm.ownerUsername, 'hassan');
      assert.strictEqual(
        summary.bootstrap.projectId,
        'Projects/sticky-note-mvp',
      );
      assert.strictEqual(summary.bootstrap.issueIds.length, 3);
      assert.strictEqual(
        summary.bootstrap.activeIssue.id,
        'Issues/sticky-note-define-core',
      );
      assert.strictEqual(summary.bootstrap.activeIssue.status, 'created');
      assert.deepEqual(summary.result, {
        status: 'ready',
        nextStep: 'bootstrap-and-select-active-issue',
      });
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
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
      response.writeHead(200, { 'content-type': SupportedMimeType.JSON });
      response.end(stickyNoteFixture);
    });

    await new Promise<void>((resolvePromise) =>
      server.listen(0, resolvePromise),
    );
    let address = server.address();

    if (!address || typeof address === 'string') {
      throw new Error('Expected test server to bind to a TCP port');
    }

    // Isolate HOME so the subprocess cannot pick up the developer's real
    // ~/.boxel-cli/profiles.json — without isolation, ensureActiveProfile
    // would silently use that profile and the missing-MATRIX_USERNAME
    // assertion would never fire.
    let tempHome = makeTempHomeWithoutProfile();

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
            HOME: tempHome,
            MATRIX_USERNAME: '',
          },
        },
      );

      assert.strictEqual(result.status, 1);
      assert.true(
        /No active Boxel profile/.test(result.stderr),
        `expected stderr to mention "No active Boxel profile", got: ${result.stderr}`,
      );
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
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
