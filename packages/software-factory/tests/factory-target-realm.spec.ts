import { createServer } from 'node:http';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
  let targetRealmIdentifier = new URL(
    `${targetUsername}/${newEndpoint}/`,
    realmServerURL,
  ).href;

  let tempProfileHome = createTempProfileHome(
    targetUsername,
    targetPassword,
    matrixURL,
    realmServerURL,
  );

  try {
    // The factory always runs the issue loop after seed creation. We
    // force the OpenRouter path here so the loop fails deterministically
    // on the missing OPENROUTER_API_KEY — this test is only validating
    // seed-issue creation and target-realm bootstrap, not the agent loop.
    // Without the explicit `--agent openrouter`, the default `claude`
    // backend would try to use the Claude Agent SDK, with less
    // predictable failure modes in the test harness.
    let result = await runCommand(
      'node',
      [
        '--no-warnings',
        '--require',
        require.resolve('ts-node/register/transpile-only'),
        resolve(packageRoot, 'src/cli/factory-entrypoint.ts'),
        '--brief-url',
        briefUrl,
        '--target-realm-identifier',
        targetRealmIdentifier,
        '--realm-server-url',
        realmServerURL,
        '--no-retry-blocked',
        '--agent',
        'openrouter',
      ],
      {
        cwd: packageRoot,
        env: {
          ...process.env,
          HOME: tempProfileHome,
        },
        timeoutMs: 120_000,
      },
    );

    // The factory exits non-zero because the loop fails without an API key,
    // but the seed issue and target realm were created before the loop ran.
    expect(
      result.status,
      `factory:go unexpected status.\nstderr:\n${result.stderr}\nstdout:\n${result.stdout}`,
    ).toBe(1);

    // Verify the seed issue exists in the newly created target realm
    // by authenticating as the target user who owns the realm
    let targetRealmToken = await getRealmToken(
      matrixURL,
      targetUsername,
      targetPassword,
      targetRealmIdentifier,
    );

    let seedIssueUrl = new URL('Issues/bootstrap-seed', targetRealmIdentifier).href;
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
    // The loop picks up the seed issue and sets it to in_progress before
    // the agent fails (no OPENROUTER_API_KEY), so the status is in_progress.
    expect(issueJson.data.attributes.status).toBe('in_progress');
    expect(issueJson.data.attributes.summary).toContain(
      'Process brief and create project artifacts',
    );
  } finally {
    rmSync(tempProfileHome, { recursive: true, force: true });
    await new Promise<void>((r, reject) =>
      briefServer.close((err) => (err ? reject(err) : r())),
    );
  }
});

function createTempProfileHome(
  username: string,
  password: string,
  matrixUrl: string,
  realmServerUrl: string,
): string {
  let tempHome = mkdtempSync(join(tmpdir(), 'boxel-test-'));
  let boxelCliDir = join(tempHome, '.boxel-cli');
  mkdirSync(boxelCliDir, { recursive: true });

  let profileId = `@${username}:localhost`;
  writeFileSync(
    join(boxelCliDir, 'profiles.json'),
    JSON.stringify({
      profiles: {
        [profileId]: { matrixUrl, realmServerUrl, password },
      },
      activeProfile: profileId,
    }),
  );

  return tempHome;
}
