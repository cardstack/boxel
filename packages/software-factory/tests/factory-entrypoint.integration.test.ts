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
import QUnit from 'qunit';
const { module, test } = QUnit;

import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';

const packageRoot = resolve(import.meta.dirname, '..');
const stickyNoteFixture = readFileSync(
  resolve(import.meta.dirname, '../realm/Wiki/sticky-note.json'),
  'utf8',
);

interface FactoryEntrypointIntegrationSummary {
  command: string;
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
  seedIssue: {
    seedIssueId: string;
    seedIssueStatus: string;
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

function createTempProfileHome(options: {
  username: string;
  matrixUrl: string;
  realmServerUrl: string;
}): string {
  let tempHome = mkdtempSync(join(tmpdir(), 'boxel-test-'));
  let boxelCliDir = join(tempHome, '.boxel-cli');
  mkdirSync(boxelCliDir, { recursive: true });

  let profileId = `@${options.username}:localhost`;
  // CS-10725 swapped stored password for the Matrix access token —
  // `getStoredMatrixAuth` now refuses any profile without a
  // `matrixAccessToken` field. The mock matrix server in this test
  // returns `'matrix-access-token'` from `/v3/login`; pre-populate the
  // same value so the factory startup path skips the login and uses
  // the stored token directly (same behavior as a real `boxel
  // profile add` having already run on the user's machine).
  let config = {
    profiles: {
      [profileId]: {
        matrixUrl: options.matrixUrl,
        realmServerUrl: options.realmServerUrl,
        matrixAccessToken: 'matrix-access-token',
        matrixUserId: profileId,
        matrixDeviceId: 'device-id',
      },
    },
    activeProfile: profileId,
  };

  writeFileSync(
    join(boxelCliDir, 'profiles.json'),
    JSON.stringify(config, null, 2),
  );

  return tempHome;
}

module('factory-entrypoint integration', function () {
  test('factory:go --debug prints a structured JSON summary', async function (assert) {
    let canonicalTargetRealmUrl: string;
    let targetRealm: string;
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
            user_id: '@testuser:localhost',
          }),
        );
      } else if (
        request.url ===
          '/_matrix/client/v3/user/%40testuser%3Alocalhost/openid/request_token' &&
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
          '/_matrix/client/v3/user/%40testuser%3Alocalhost/account_data/app.boxel.realms' &&
        request.method === 'GET'
      ) {
        response.writeHead(200, { 'content-type': SupportedMimeType.JSON });
        response.end(JSON.stringify({ realms: [] }));
      } else if (
        request.url ===
          '/_matrix/client/v3/user/%40testuser%3Alocalhost/account_data/app.boxel.realms' &&
        request.method === 'PUT'
      ) {
        response.writeHead(200, { 'content-type': SupportedMimeType.JSON });
        response.end('{}');
      } else if (request.url === '/_realm-auth' && request.method === 'POST') {
        response.writeHead(200, { 'content-type': SupportedMimeType.JSON });
        response.end(
          JSON.stringify({
            [canonicalTargetRealmUrl]: 'Bearer target-realm-token',
          }),
        );
      } else if (request.url === '/_run-command' && request.method === 'POST') {
        // Schema loading — return error so wiring layer skips (non-fatal)
        response.writeHead(200, { 'content-type': SupportedMimeType.JSON });
        response.end(
          JSON.stringify({
            data: {
              type: 'card',
              attributes: {
                status: 'error',
                error: 'Schema not available in test',
              },
            },
          }),
        );
      } else if (
        request.url === '/testuser/personal/_search' &&
        request.method === 'QUERY'
      ) {
        // Issue store search — return empty so the loop exits cleanly
        // and reports 'all_issues_done'.
        response.writeHead(200, { 'content-type': SupportedMimeType.CardJson });
        response.end(JSON.stringify({ data: [] }));
      } else if (
        request.url === '/testuser/personal/_mtimes' &&
        request.method === 'GET'
      ) {
        // Used by client.pull / client.sync to list remote state. The
        // factory pulls on startup and syncs the seed — an empty manifest
        // is enough for the pull path, and sync treats every local file
        // as a push.
        response.writeHead(200, { 'content-type': SupportedMimeType.JSONAPI });
        response.end(JSON.stringify({ data: { attributes: { mtimes: {} } } }));
      } else if (
        request.url?.startsWith('/testuser/personal/_atomic') &&
        request.method === 'POST'
      ) {
        // Used by client.sync to atomically push card writes. Parse the
        // atomic operations payload to register every pushed path so
        // subsequent GETs (the post-seed `waitForFile` poll) resolve.
        // The sync client requires:
        //   - HTTP 201 (not 200) as the success status,
        //   - each result's `data.id` matching the operation's href
        //     (full URL), so sync can map results back to local paths.
        let body = '';
        request.on('data', (chunk) => (body += chunk.toString()));
        request.on('end', () => {
          let results: { data: { id: string; type: string } }[] = [];
          try {
            let parsed = JSON.parse(body) as {
              'atomic:operations'?: { op: string; href?: string }[];
            };
            for (let op of parsed['atomic:operations'] ?? []) {
              if (op.op === 'add' || op.op === 'update') {
                let href = op.href ?? '';
                let path = href
                  .replace(/^https?:\/\/[^/]+\/testuser\/personal\//, '')
                  .replace(/^\.\/?/, '')
                  .replace(/\.json$/, '');
                createdCardPaths.add(path);
                results.push({ data: { id: href, type: 'source' } });
              }
            }
          } catch {
            // ignore — sync will surface the parse failure
          }
          response.writeHead(201, {
            'content-type': SupportedMimeType.JSONAPI,
          });
          response.end(JSON.stringify({ 'atomic:results': results }));
        });
        return;
      } else if (
        request.url === '/testuser/personal/_readiness-check' &&
        request.method === 'GET'
      ) {
        response.writeHead(200, {
          'content-type': 'text/html',
        });
        response.end('');
      } else if (
        request.url === '/testuser/personal/_session' &&
        request.method === 'POST'
      ) {
        // Realm session for target realm auth
        response.writeHead(201, {
          'content-type': SupportedMimeType.JSON,
          Authorization: 'Bearer target-realm-token',
        });
        response.end('');
      } else if (
        request.url?.startsWith('/testuser/personal/') &&
        request.method === 'GET'
      ) {
        let cardPath = request.url
          .replace('/testuser/personal/', '')
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
        request.url?.startsWith('/testuser/personal/') &&
        request.method === 'POST'
      ) {
        createdCardPaths.add(
          request.url.replace('/testuser/personal/', '').replace(/\.json$/, ''),
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
    targetRealm = `${origin}/typed-by-user/personal/`;
    canonicalTargetRealmUrl = `${origin}/testuser/personal/`;

    let tempHome = createTempProfileHome({
      username: 'testuser',
      matrixUrl: `${origin}/`,
      realmServerUrl: `${origin}/`,
    });

    try {
      let result = await runCommand(
        'pnpm',
        [
          '--silent',
          'factory:go',
          '--',
          '--brief-url',
          briefUrl,
          '--target-realm',
          targetRealm,
          '--realm-server-url',
          `${origin}/`,
          '--debug',
        ],
        {
          cwd: packageRoot,
          encoding: 'utf8',
          env: {
            ...process.env,
            HOME: tempHome,
          },
        },
      );

      assert.strictEqual(result.status, 0, result.stderr);

      let summary = JSON.parse(
        result.stdout,
      ) as FactoryEntrypointIntegrationSummary;
      assert.strictEqual(summary.command, 'factory:go');
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
      assert.strictEqual(summary.targetRealm.ownerUsername, 'testuser');
      assert.strictEqual(
        summary.seedIssue.seedIssueId,
        'Issues/bootstrap-seed',
      );
      assert.strictEqual(summary.seedIssue.seedIssueStatus, 'created');
      // Loop runs and completes immediately (no issues in realm)
      assert.deepEqual(summary.result, {
        status: 'completed',
        nextStep: 'all-issues-completed',
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
        '--target-realm',
        'https://realms.example.test/testuser/personal/',
      ],
      {
        cwd: packageRoot,
        encoding: 'utf8',
      },
    );

    assert.strictEqual(result.status, 1);
    assert.true(
      /Missing required input: pass --brief-url .* or --repo-url/.test(
        result.stderr,
      ),
    );
    assert.true(/Usage:/.test(result.stderr));
    assert.true(/--target-realm <realm>/.test(result.stderr));
  });

  test('factory:go package script prints usage with --help', function (assert) {
    let result = spawnSync('pnpm', ['--silent', 'factory:go', '--', '--help'], {
      cwd: packageRoot,
      encoding: 'utf8',
    });

    assert.strictEqual(result.status, 0, result.stderr);
    assert.true(/Usage:/.test(result.stdout));
    assert.true(/--brief-url <url>/.test(result.stdout));
    assert.true(/--no-retry-blocked/.test(result.stdout));
  });

  test('factory:go fails clearly when no profile is configured', async function (assert) {
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

    try {
      let briefUrl = `http://127.0.0.1:${address.port}/software-factory/Wiki/sticky-note`;
      let targetRealm = `http://127.0.0.1:${address.port}/testuser/personal/`;
      let result = await runCommand(
        'pnpm',
        [
          '--silent',
          'factory:go',
          '--',
          '--brief-url',
          briefUrl,
          '--target-realm',
          targetRealm,
        ],
        {
          cwd: packageRoot,
          encoding: 'utf8',
          env: {
            ...process.env,
            HOME: '/tmp/no-boxel-cli-here',
          },
        },
      );

      assert.strictEqual(result.status, 1);
      assert.true(/boxel profile add/.test(result.stderr));
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
