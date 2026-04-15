import { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';

import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';

import { expect, test } from './fixtures';
import {
  getRealmToken,
  readSupportMetadata,
  registerMatrixUser,
} from './helpers/matrix-auth';
import { runCommand } from './helpers/run-command';

const bootstrapTargetDir = resolve(
  process.cwd(),
  'test-fixtures',
  'bootstrap-target',
);
const packageRoot = resolve(process.cwd());
const stickyNoteFixture = readFileSync(
  resolve(packageRoot, 'realm/Wiki/sticky-note.json'),
  'utf8',
);

test.use({ realmDir: bootstrapTargetDir });
test.use({ realmServerMode: 'isolated' });
test.setTimeout(180_000);

test('factory:go creates a target realm and bootstraps project artifacts end-to-end', async ({
  realm,
}) => {
  let supportMetadata = readSupportMetadata();
  let { matrixURL, matrixRegistrationSecret } = supportMetadata;

  let targetUsername = `factory-target-${Date.now()}`;
  let targetPassword = 'password';

  await registerMatrixUser(
    matrixURL,
    matrixRegistrationSecret,
    targetUsername,
    targetPassword,
  );

  // Serve the brief from a local HTTP server since the harness source realm
  // uses a fixture that doesn't include Wiki cards
  let briefServer = createServer((request, response) => {
    if (request.url === '/brief/sticky-note') {
      response.writeHead(200, { 'content-type': SupportedMimeType.JSON });
      response.end(stickyNoteFixture);
    } else {
      response.writeHead(404);
      response.end('not found');
    }
  });
  await new Promise<void>((r) => briefServer.listen(0, '127.0.0.1', r));
  let briefPort = (briefServer.address() as AddressInfo).port;
  let briefUrl = `http://127.0.0.1:${briefPort}/brief/sticky-note`;

  let realmServerURL = realm.realmServerURL.href;
  let newEndpoint = `e2e-realm-${Date.now()}`;
  let targetRealmUrl = new URL(
    `${targetUsername}/${newEndpoint}/`,
    realmServerURL,
  ).href;

  try {
    let result = await runCommand(
      'node',
      [
        '--no-warnings',
        '--require',
        require.resolve('ts-node/register/transpile-only'),
        resolve(packageRoot, 'src/cli/factory-entrypoint.ts'),
        '--brief-url',
        briefUrl,
        '--target-realm-url',
        targetRealmUrl,
        '--realm-server-url',
        realmServerURL,
        '--mode',
        'bootstrap',
      ],
      {
        cwd: packageRoot,
        env: {
          ...process.env,
          HOME: mkdtempSync(join(tmpdir(), 'boxel-test-')),
          MATRIX_USERNAME: targetUsername,
          MATRIX_PASSWORD: targetPassword,
          MATRIX_URL: matrixURL,
          REALM_SERVER_URL: realmServerURL,
        },
        timeoutMs: 120_000,
      },
    );

    expect(
      result.status,
      `factory:go failed (status=${result.status}).\nstderr:\n${result.stderr}\nstdout:\n${result.stdout}`,
    ).toBe(0);

    let summary = JSON.parse(result.stdout) as {
      command: string;
      targetRealm: { url: string; ownerUsername: string };
      seedIssue: {
        seedIssueId: string;
        seedIssueStatus: string;
      };
    };

    expect(summary.command).toBe('factory:go');
    expect(summary.targetRealm.ownerUsername).toBe(targetUsername);
    expect(summary.seedIssue.seedIssueId).toBe('Issues/bootstrap-seed');
    expect(summary.seedIssue.seedIssueStatus).toBe('created');

    // Verify the seed issue actually exists in the newly created target realm
    // by authenticating as the target user who owns the realm
    let targetRealmToken = await getRealmToken(
      matrixURL,
      targetUsername,
      targetPassword,
      summary.targetRealm.url,
    );

    let seedIssueUrl = new URL('Issues/bootstrap-seed', summary.targetRealm.url)
      .href;
    let seedIssueResponse = await fetch(seedIssueUrl, {
      headers: {
        Accept: SupportedMimeType.CardSource,
        Authorization: targetRealmToken,
      },
    });

    expect(seedIssueResponse.ok).toBe(true);
    let issueJson = (await seedIssueResponse.json()) as {
      data: {
        attributes: {
          issueType: string;
          status: string;
          summary: string;
        };
      };
    };
    expect(issueJson.data.attributes.issueType).toBe('bootstrap');
    expect(issueJson.data.attributes.status).toBe('backlog');
    expect(issueJson.data.attributes.summary).toContain(
      'Process brief and create project artifacts',
    );
  } finally {
    await new Promise<void>((r, reject) =>
      briefServer.close((err) => (err ? reject(err) : r())),
    );
  }
});
