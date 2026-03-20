import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';

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

// Known issue (CS-10472): This test hangs when run in the same Playwright
// suite after other specs that start isolated realm servers. The subprocess's
// auth middleware hangs during Matrix auth → realm _session when prior
// isolated realm server teardowns leave orphaned processes. Passes reliably
// when run in isolation:
//   pnpm exec playwright test tests/factory-target-realm.spec.ts
test.fixme('factory:go creates a target realm and bootstraps project artifacts end-to-end', async ({
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
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(stickyNoteFixture);
    } else {
      response.writeHead(404);
      response.end('not found');
    }
  });
  await new Promise<void>((r) => briefServer.listen(0, '127.0.0.1', r));
  let briefPort = (briefServer.address() as AddressInfo).port;
  let briefUrl = `http://127.0.0.1:${briefPort}/brief/sticky-note`;

  let serverOrigin = realm.realmURL.origin;
  let newEndpoint = `e2e-realm-${Date.now()}`;
  let targetRealmUrl = `${serverOrigin}/${targetUsername}/${newEndpoint}/`;

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
        `${serverOrigin}/`,
        '--mode',
        'implement',
      ],
      {
        cwd: packageRoot,
        env: {
          ...process.env,
          MATRIX_USERNAME: targetUsername,
          MATRIX_PASSWORD: targetPassword,
          MATRIX_URL: matrixURL,
          REALM_SERVER_URL: `${serverOrigin}/`,
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
      bootstrap: {
        createdProject: string;
        createdTickets: string[];
        createdKnowledgeArticles: string[];
        activeTicket: { id: string; status: string };
      };
    };

    expect(summary.command).toBe('factory:go');
    expect(summary.targetRealm.ownerUsername).toBe(targetUsername);
    expect(summary.bootstrap.createdProject).toBe('Project/sticky-note-mvp');
    expect(summary.bootstrap.createdTickets).toHaveLength(3);
    expect(summary.bootstrap.createdKnowledgeArticles).toHaveLength(2);
    expect(summary.bootstrap.activeTicket.id).toBe(
      'Ticket/sticky-note-define-core',
    );
    expect(summary.bootstrap.activeTicket.status).toBe('in_progress');

    // Verify the project card actually exists in the newly created target realm
    // by authenticating as the target user who owns the realm
    let targetRealmToken = await getRealmToken(
      matrixURL,
      targetUsername,
      targetPassword,
      summary.targetRealm.url,
    );

    let projectUrl = new URL('Project/sticky-note-mvp', summary.targetRealm.url)
      .href;
    let projectResponse = await fetch(projectUrl, {
      headers: {
        Accept: 'application/vnd.card+source',
        Authorization: targetRealmToken,
      },
    });

    expect(projectResponse.ok).toBe(true);
    let projectJson = (await projectResponse.json()) as {
      data: { attributes: { projectName: string } };
    };
    expect(projectJson.data.attributes.projectName).toBe('Sticky Note MVP');
  } finally {
    await new Promise<void>((r, reject) =>
      briefServer.close((err) => (err ? reject(err) : r())),
    );
  }
});
