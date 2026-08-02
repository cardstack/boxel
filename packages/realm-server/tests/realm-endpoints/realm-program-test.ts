import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type {
  Realm,
  RealmNotebookRequest,
  RealmProgramExecutor,
} from '@cardstack/runtime-common';
import { SupportedMimeType } from '@cardstack/runtime-common';
import { createRealmProgramExecutor } from '@cardstack/realm-runner';
import type { SuperTest, Test } from 'supertest';

import { createJWT, setupPermissionedRealmCached } from '../helpers/index.ts';

module(`realm-endpoints/${basename(import.meta.filename)}`, function () {
  module('Realm-specific Endpoints | _realm-program', function (hooks) {
    let testRealm: Realm;
    let request: SuperTest<Test>;
    let calls: Parameters<RealmProgramExecutor['execute']>[0][] = [];
    let executor: RealmProgramExecutor = {
      async execute(input) {
        calls.push(input);
        return { value: 42 };
      },
    };

    setupPermissionedRealmCached(hooks, {
      fixture: 'blank',
      permissions: {
        reader: ['read'],
        writer: ['read', 'write'],
      },
      realmProgramExecutor: executor,
      onRealmSetup(args) {
        testRealm = args.testRealm;
        request = args.request;
        calls = [];
      },
    });

    test('executes preview programs through the read permission boundary', async function (assert) {
      let authorization = `Bearer ${createJWT(testRealm, 'reader', ['read'])}`;
      let response = await request
        .post('/_realm-program')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', SupportedMimeType.JSON)
        .set('Content-Type', SupportedMimeType.JSON)
        .set('Authorization', authorization)
        .send({ code: 'return 6 * 7;', mode: 'preview' });

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.deepEqual(response.body, { value: 42 }, 'returns executor output');
      assert.deepEqual(
        calls,
        [
          {
            code: 'return 6 * 7;',
            mode: 'preview',
            realmURL: testRealm.url,
            authorization,
          },
        ],
        'forwards the scoped execution context',
      );
    });

    test('executes commit programs through the write permission boundary', async function (assert) {
      let authorization = `Bearer ${createJWT(testRealm, 'writer', [
        'read',
        'write',
      ])}`;
      let response = await request
        .post('/_realm-program')
        .set('Accept', SupportedMimeType.JSON)
        .set('Content-Type', SupportedMimeType.JSON)
        .set('Authorization', authorization)
        .send({
          code: 'realm.fs.writeText("hello.txt", "hi");',
          mode: 'commit',
        });

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.strictEqual(calls.length, 1, 'executor is called once');
      assert.strictEqual(calls[0].mode, 'commit', 'commit mode is forwarded');
    });

    test('forwards ad-hoc input and notebook cell settings', async function (assert) {
      let authorization = `Bearer ${createJWT(testRealm, 'reader', ['read'])}`;
      let notebook = {
        sessionId: '!room:example.test',
        cellId: 'grep',
        persistence: 'ephemeral',
        inputs: { candidates: { cellId: 'search' } },
      } satisfies RealmNotebookRequest;
      let response = await request
        .post('/_realm-program')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', SupportedMimeType.JSON)
        .set('Content-Type', SupportedMimeType.JSON)
        .set('Authorization', authorization)
        .send({
          code: 'return realm.input;',
          mode: 'preview',
          input: { direct: true },
          notebook,
        });

      assert.strictEqual(response.status, 200);
      assert.deepEqual(calls[0].input, { direct: true });
      assert.deepEqual(calls[0].notebook, notebook);
    });

    test('does not let a read-only user execute commit programs', async function (assert) {
      let response = await request
        .post('/_realm-program')
        .set('Accept', SupportedMimeType.JSON)
        .set('Content-Type', SupportedMimeType.JSON)
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'reader', ['read'])}`,
        )
        .send({ code: 'return 1;', mode: 'commit' });

      assert.strictEqual(response.status, 403, 'HTTP 403 status');
      assert.strictEqual(calls.length, 0, 'executor is not called');
    });

    test('rejects a mode that does not match the HTTP permission boundary', async function (assert) {
      let response = await request
        .post('/_realm-program')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', SupportedMimeType.JSON)
        .set('Content-Type', SupportedMimeType.JSON)
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'writer', ['read', 'write'])}`,
        )
        .send({ code: 'return 1;', mode: 'commit' });

      assert.strictEqual(response.status, 400, 'HTTP 400 status');
      assert.strictEqual(
        response.body.error.code,
        'INVALID_ARGUMENT',
        'returns a structured error',
      );
      assert.strictEqual(calls.length, 0, 'executor is not called');
    });
  });

  module('when Realm Program execution is not configured', function (hooks) {
    let testRealm: Realm;
    let request: SuperTest<Test>;

    setupPermissionedRealmCached(hooks, {
      fixture: 'blank',
      permissions: { reader: ['read'] },
      onRealmSetup(args) {
        testRealm = args.testRealm;
        request = args.request;
      },
    });

    test('reports that the capability is unavailable', async function (assert) {
      let response = await request
        .post('/_realm-program')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', SupportedMimeType.JSON)
        .set('Content-Type', SupportedMimeType.JSON)
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'reader', ['read'])}`,
        )
        .send({ code: 'return 1;', mode: 'preview' });

      assert.strictEqual(response.status, 501, 'HTTP 501 status');
      assert.strictEqual(
        response.body.error.code,
        'REALM_PROGRAM_UNAVAILABLE',
        'returns a structured error',
      );
    });
  });

  module('with the QuickJS Realm Program executor', function (hooks) {
    let testRealm: Realm;
    let request: SuperTest<Test>;
    let executorPromise:
      | ReturnType<typeof createRealmProgramExecutor>
      | undefined;
    let executor: RealmProgramExecutor = {
      async execute(input) {
        executorPromise ??= createRealmProgramExecutor({
          notebookEncryptionKey:
            'realm-program-test-notebook-encryption-key-material',
        });
        return (await executorPromise).execute(input);
      },
    };

    setupPermissionedRealmCached(hooks, {
      fixture: 'blank',
      permissions: {
        reader: ['read'],
        writer: ['read', 'write'],
      },
      realmProgramExecutor: executor,
      onRealmSetup(args) {
        testRealm = args.testRealm;
        request = args.request;
      },
    });

    test('runs a capability-scoped program through the authenticated Realm API', async function (assert) {
      let response = await request
        .post('/_realm-program')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', SupportedMimeType.JSON)
        .set('Content-Type', SupportedMimeType.JSON)
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'reader', ['read'])}`,
        )
        .send({
          code: `
            const paths = await realm.fs.list();
            const bxl = await realm.bxl.jq('.items | length', {
              items: [1, 2, 3, 4, 5],
            });
            return { paths, processType: typeof process, bxl };
          `,
          mode: 'preview',
        });

      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.deepEqual(response.body.value, {
        paths: ['.gitkeep'],
        processType: 'undefined',
        bxl: 5,
      });
      assert.strictEqual(response.body.mode, 'preview');
      assert.deepEqual(response.body.changes, []);
    });

    test('streams sanitized activity before the final result', async function (assert) {
      let response = await request
        .post('/_realm-program')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('X-Boxel-Realm-Program-Stream', 'activity-v1')
        .set('Accept', SupportedMimeType.JSON)
        .set('Content-Type', SupportedMimeType.JSON)
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'reader', ['read'])}`,
        )
        .send({
          code: `
            await realm.activity('Inspecting candidates');
            return {
              apiVersion: realm.apiVersion,
              features: realm.features,
              notebook: realm.notebook,
            };
          `,
          mode: 'preview',
        });

      assert.strictEqual(response.status, 200);
      assert.true(
        response.headers['content-type'].startsWith('application/x-ndjson'),
      );
      let events = response.text
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.true(
        events.some(
          (event) =>
            event.type === 'activity' &&
            event.activity.message === 'Inspecting candidates',
        ),
        'semantic activity is streamed',
      );
      let result = events.find((event) => event.type === 'result').result;
      assert.deepEqual(result.value, {
        apiVersion: '2',
        features: {
          notebooks: true,
          activity: true,
          streamingActivity: true,
        },
        notebook: null,
      });
      assert.strictEqual(events.at(-1).type, 'result');
    });

    test('persists encrypted notebook cells and reuses them after executor restart', async function (assert) {
      let authorization = `Bearer ${createJWT(testRealm, 'writer', [
        'read',
        'write',
      ])}`;
      let payload = {
        code: `return { candidates: ['private-search-result.gts'] };`,
        mode: 'preview',
        notebook: {
          sessionId: '!persistent-room:example.test',
          cellId: 'federated-search',
          persistence: 'realm',
        },
      };

      let first = await request
        .post('/_realm-program')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', SupportedMimeType.JSON)
        .set('Content-Type', SupportedMimeType.JSON)
        .set('Authorization', authorization)
        .send(payload);

      assert.strictEqual(first.status, 200, 'first cell succeeds');
      assert.false(first.body.notebook.reused, 'first cell executed');
      executorPromise = undefined;

      let second = await request
        .post('/_realm-program')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', SupportedMimeType.JSON)
        .set('Content-Type', SupportedMimeType.JSON)
        .set('Authorization', authorization)
        .send(payload);

      assert.strictEqual(second.status, 200, 'restored cell succeeds');
      assert.true(second.body.notebook.reused, 'stored result was reused');
      assert.strictEqual(
        second.body.notebook.executionId,
        first.body.notebook.executionId,
        'the immutable execution is preserved',
      );
      assert.deepEqual(second.body.value, first.body.value);

      let rerun = await request
        .post('/_realm-program')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', SupportedMimeType.JSON)
        .set('Content-Type', SupportedMimeType.JSON)
        .set('Authorization', authorization)
        .send({
          mode: 'preview',
          notebook: {
            sessionId: '!persistent-room:example.test',
            cellId: 'federated-search',
            persistence: 'realm',
            runSaved: true,
            force: true,
          },
        });
      assert.strictEqual(rerun.status, 200, 'saved source reruns');
      assert.false(rerun.body.notebook.reused, 'rerun creates an execution');
      assert.strictEqual(rerun.body.notebook.revision, 2);
      assert.deepEqual(rerun.body.value, first.body.value);

      let inspection = await request
        .post('/_realm-program')
        .set('X-HTTP-Method-Override', 'QUERY')
        .set('Accept', SupportedMimeType.JSON)
        .set('Content-Type', SupportedMimeType.JSON)
        .set('Authorization', authorization)
        .send({
          code: `
            const files = await realm.fs.glob('.boxel/realm-notebooks/**/*', { dot: true });
            const contents = [];
            for (const path of files) contents.push(await realm.fs.readText(path));
            return { files, contents };
          `,
          mode: 'preview',
        });
      assert.strictEqual(inspection.status, 200);
      assert.true(
        inspection.body.value.files.length >= 2,
        'manifest and execution records are durable Realm files',
      );
      assert.false(
        inspection.body.value.contents.some((source: string) =>
          source.includes('private-search-result.gts'),
        ),
        'federated output is encrypted at rest',
      );
    });

    test('uses the raw authenticated API for endpoints and source writes', async function (assert) {
      let authorization = `Bearer ${createJWT(testRealm, 'writer', [
        'read',
        'write',
      ])}`;
      let response = await request
        .post('/_realm-program')
        .set('Accept', SupportedMimeType.JSON)
        .set('Content-Type', SupportedMimeType.JSON)
        .set('Authorization', authorization)
        .send({
          code: `
            const info = await realm.api.request('GET', '_info', {
              accept: '${SupportedMimeType.RealmInfo}',
            });
            const written = await realm.api.request('POST', 'agent-note.txt', {
              body: 'created by Realm Script\\n',
              bodyType: 'text',
              contentType: '${SupportedMimeType.CardSource}',
              accept: '${SupportedMimeType.CardSource}',
            });
            const binaryWritten = await realm.api.request('POST', 'agent.bin', {
              body: 'AAEC/w==',
              bodyType: 'base64',
              contentType: '${SupportedMimeType.OctetStream}',
              accept: '${SupportedMimeType.OctetStream}',
            });
            return {
              infoStatus: info.status,
              writeStatus: written.status,
              binaryWriteStatus: binaryWritten.status,
            };
          `,
          mode: 'commit',
        });

      assert.strictEqual(response.status, 200, 'Realm Program succeeds');
      assert.strictEqual(response.body.value.infoStatus, 200, 'GET succeeds');
      assert.true(
        [200, 201, 204].includes(response.body.value.writeStatus),
        'source write succeeds',
      );
      assert.true(
        [200, 201, 204].includes(response.body.value.binaryWriteStatus),
        'binary write succeeds',
      );

      let readback = await request
        .get('/agent-note.txt')
        .set('Accept', SupportedMimeType.CardSource)
        .set('Authorization', authorization);
      assert.strictEqual(readback.status, 200, 'written source is readable');
      assert.strictEqual(readback.text, 'created by Realm Script\n');

      let binaryReadback = await request
        .get('/agent.bin')
        .set('Accept', SupportedMimeType.OctetStream)
        .set('Authorization', authorization)
        .buffer(true);
      assert.strictEqual(
        binaryReadback.status,
        200,
        'written binary is readable',
      );
      assert.deepEqual(
        [...(binaryReadback.body as Buffer)],
        [0, 1, 2, 255],
        'binary bytes round-trip exactly',
      );
    });

    test('reports a raw side effect when the guest fails afterward', async function (assert) {
      let authorization = `Bearer ${createJWT(testRealm, 'writer', [
        'read',
        'write',
      ])}`;
      let response = await request
        .post('/_realm-program')
        .set('Accept', SupportedMimeType.JSON)
        .set('Content-Type', SupportedMimeType.JSON)
        .set('Authorization', authorization)
        .send({
          code: `
            await realm.api.request('POST', 'partial-effect.txt', {
              body: 'persisted before failure\\n',
              bodyType: 'text',
              contentType: '${SupportedMimeType.CardSource}',
              accept: '${SupportedMimeType.CardSource}',
            });
            throw new Error('failure after write');
          `,
          mode: 'commit',
        });

      assert.strictEqual(response.status, 500, 'program failure is reported');
      assert.strictEqual(response.body.error.code, 'RUNTIME_ERROR');
      let [effect] = response.body.error.details.effects;
      assert.deepEqual(
        {
          scope: effect.scope,
          realm: effect.realm,
          method: effect.method,
          path: effect.path,
          ok: effect.ok,
        },
        {
          scope: 'realm',
          realm: testRealm.url,
          method: 'POST',
          path: 'partial-effect.txt',
          ok: true,
        },
      );
      assert.true([200, 201, 204].includes(effect.status));

      let readback = await request
        .get('/partial-effect.txt')
        .set('Accept', SupportedMimeType.CardSource)
        .set('Authorization', authorization);
      assert.strictEqual(readback.status, 200, 'side effect persisted');
      assert.strictEqual(readback.text, 'persisted before failure\n');
    });
  });
});
