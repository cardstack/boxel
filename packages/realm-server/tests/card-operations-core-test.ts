import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { Test, SuperTest } from 'supertest';
import type { RealmHttpServer as Server } from '../server.ts';
import type { DirResult } from 'tmp';
import type { Realm } from '@cardstack/runtime-common';
import { SupportedMimeType, baseRealm, rri } from '@cardstack/runtime-common';
import {
  isDocumentResult,
  isHeadResult,
  isOperationFailure,
  lowerQueryOperation,
  runOperation,
  type OperationCore,
  type OperationDefinition,
  type OperationHeadResult,
  type OperationRequest,
  type OperationResult,
  type OperationTarget,
} from '@cardstack/runtime-common/card-operations';
import {
  setupPermissionedRealmCached,
  closeServer,
  withRealmPath,
  type RealmRequest,
} from './helpers/index.ts';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms.ts';
import type { PgAdapter } from '@cardstack/postgres';

// The operation core, exercised the way the HTTP surfaces will once they route
// to it: obtain the core from a realm and call `runOperation` directly. Nothing
// is routed here yet, so these are the only callers.

function request(
  target: OperationTarget,
  name: string,
  params?: Record<string, unknown>,
): OperationRequest {
  return {
    target,
    name,
    ...(params ? { params } : {}),
    actor: '@node-test_realm:localhost',
    clientRequestId: 'card-operations-core-test',
  };
}

// Narrow a result to the shape the mode under test promises, raising rather
// than letting a wrong shape read as a passing assertion further down.
function documentOf(result: OperationResult) {
  if (!isDocumentResult(result)) {
    throw new Error(
      `expected a document result, got ${JSON.stringify(result)}`,
    );
  }
  return result.document;
}

function headersOf(result: OperationResult): OperationHeadResult {
  if (!isHeadResult(result)) {
    throw new Error(`expected a headers result, got ${JSON.stringify(result)}`);
  }
  return result;
}

// The failure a call is expected to produce. Rethrows anything that is not an
// operation failure so a genuine bug reports itself rather than being read as
// the refusal under test.
async function refusalFrom(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (err) {
    if (isOperationFailure(err)) {
      return err.error;
    }
    throw err;
  }
  throw new Error('expected the operation to be refused, but it succeeded');
}

module(basename(import.meta.filename), function () {
  module('card operations | the operation core', function (hooks) {
    let realmURL = new URL('http://127.0.0.1:4444/test/');
    let testRealmHref = realmURL.href;
    let testRealm: Realm;
    let testRealmHttpServer: Server;
    let realmRequest: RealmRequest;

    function onRealmSetup(args: {
      testRealm: Realm;
      testRealmHttpServer: Server;
      request: SuperTest<Test>;
      dir: DirResult;
      dbAdapter: PgAdapter;
    }) {
      testRealm = args.testRealm;
      testRealmHttpServer = args.testRealmHttpServer;
      realmRequest = withRealmPath(args.request, realmURL);
    }

    hooks.afterEach(async function () {
      await closeServer(testRealmHttpServer);
      resetCatalogRealms();
    });

    setupPermissionedRealmCached(hooks, {
      fixture: 'realistic',
      realmURL,
      permissions: {
        '*': ['read'],
        '@node-test_realm:localhost': ['read', 'realm-owner'],
      },
      onRealmSetup,
    });

    test('a read returns the document the card+json GET serves', async function (assert) {
      let response = await realmRequest
        .get('/person-1')
        .set('Accept', SupportedMimeType.CardJson);
      assert.strictEqual(
        response.status,
        200,
        `HTTP 200 status: ${response.text}`,
      );

      let result = await runOperation(
        testRealm.operationCore,
        request({ kind: 'instance', url: `${testRealmHref}person-1` }, 'read'),
      );
      assert.deepEqual(
        documentOf(result),
        JSON.parse(response.text),
        'the read operation assembles the same document the GET returns',
      );
    });

    test('a headers-only read peeks the index row and never assembles a document', async function (assert) {
      let core = testRealm.operationCore;
      let cardDocumentCalls = 0;
      let instanceCalls = 0;
      let spied: OperationCore = {
        ...core,
        indexQueryEngine: {
          cardDocument: (...args) => {
            cardDocumentCalls++;
            return core.indexQueryEngine.cardDocument(...args);
          },
          instance: (...args) => {
            instanceCalls++;
            return core.indexQueryEngine.instance(...args);
          },
          file: (...args) => core.indexQueryEngine.file(...args),
        },
      };

      let result = await runOperation(
        spied,
        request({ kind: 'instance', url: `${testRealmHref}person-1` }, 'read'),
        { headersOnly: true },
      );
      assert.strictEqual(
        cardDocumentCalls,
        0,
        'the headers-only mode never reaches cardDocument',
      );
      assert.strictEqual(
        instanceCalls,
        1,
        'dispatch and the executor share one read of the index row',
      );
      let headers = headersOf(result);
      assert.strictEqual(
        typeof headers.generation,
        'number',
        'the index-data generation is reported',
      );
      assert.notEqual(
        headers.indexedAt,
        null,
        'the validator base is reported',
      );
      assert.notEqual(
        headers.lastModified,
        null,
        'the modification time is reported',
      );
    });

    test('a read of a file answers with its file-meta document', async function (assert) {
      let result = await runOperation(
        testRealm.operationCore,
        request({ kind: 'instance', url: `${testRealmHref}sample.md` }, 'read'),
      );
      let document = documentOf(result);
      assert.strictEqual(
        document.data.type,
        'file-meta',
        'a file target reads as its metadata document, not as a card',
      );

      let response = await realmRequest
        .get('/sample.md')
        .set('Accept', SupportedMimeType.FileMeta);
      assert.strictEqual(
        response.status,
        200,
        `HTTP 200 status: ${response.text}`,
      );
      assert.deepEqual(
        document,
        JSON.parse(response.text),
        'the read operation assembles the same document the file-meta GET returns',
      );
    });

    test('a name that is neither declared nor a base operation is refused', async function (assert) {
      let error = await refusalFrom(() =>
        runOperation(
          testRealm.operationCore,
          request(
            { kind: 'instance', url: `${testRealmHref}person-1` },
            'addComment',
          ),
        ),
      );
      assert.strictEqual(error.code, 'unknown-operation');
      assert.strictEqual(error.status, 404);
      assert.ok(
        error.detail.includes('addComment'),
        `the refusal names the operation: ${error.detail}`,
      );
    });

    test('a base operation a file does not carry is refused', async function (assert) {
      let error = await refusalFrom(() =>
        runOperation(
          testRealm.operationCore,
          request(
            { kind: 'instance', url: `${testRealmHref}sample.md` },
            'transform',
          ),
        ),
      );
      assert.strictEqual(error.code, 'operation-not-allowed');
      assert.strictEqual(error.status, 405);
      assert.ok(
        error.detail.includes('read'),
        `the refusal names what a file does carry: ${error.detail}`,
      );
    });

    test('a target with no index row and no source is not found', async function (assert) {
      let error = await refusalFrom(() =>
        runOperation(
          testRealm.operationCore,
          request(
            { kind: 'instance', url: `${testRealmHref}does-not-exist` },
            'read',
          ),
        ),
      );
      assert.strictEqual(error.code, 'target-not-found');
      assert.strictEqual(error.status, 404);
    });

    test('a target outside the realm is not this core to serve', async function (assert) {
      let error = await refusalFrom(() =>
        runOperation(
          testRealm.operationCore,
          request(
            { kind: 'instance', url: 'http://127.0.0.1:4444/other/person-1' },
            'read',
          ),
        ),
      );
      assert.strictEqual(error.code, 'target-not-found');
    });
  });

  // Invocation-time query lowering is a pure function over a stored template,
  // so it needs no realm: the whole input is the definition plus what the
  // invocation supplies.
  module('card operations | lowering a declared query', function () {
    let personRef = {
      module: rri('http://127.0.0.1:4444/test/person'),
      name: 'Person',
    };
    let stringRef = { module: rri(`${baseRealm.url}string`), name: 'default' };

    function savedSearch(): OperationDefinition {
      return {
        base: 'query',
        deterministic: true,
        params: { status: { kind: 'field', codeRef: stringRef } },
        query: {
          filter: {
            'item.on': personRef,
            every: [
              { eq: { 'item.owner.id': { $ref: 'actor', key: 'id' } } },
              { eq: { 'item.status': { $ref: 'params', key: 'status' } } },
            ],
          },
        },
      } satisfies OperationDefinition;
    }

    test('markers resolve to the values the invocation supplies', function (assert) {
      let query = lowerQueryOperation(savedSearch(), {
        actor: '@test-actor:localhost',
        params: { status: 'open' },
        realms: ['http://127.0.0.1:4444/test/'],
      });
      assert.deepEqual(query, {
        filter: {
          'item.on': personRef,
          every: [
            { eq: { 'item.owner.id': '@test-actor:localhost' } },
            { eq: { 'item.status': 'open' } },
          ],
        },
        realms: ['http://127.0.0.1:4444/test/'],
      });
    });

    test('an authored realm scope is kept over the invocation default', function (assert) {
      let definition = savedSearch();
      definition.query!.realms = ['http://127.0.0.1:4444/authored/'];
      let query = lowerQueryOperation(definition, {
        actor: '@test-actor:localhost',
        params: { status: 'open' },
        realms: ['http://127.0.0.1:4444/test/'],
      });
      assert.deepEqual(query.realms, ['http://127.0.0.1:4444/authored/']);
    });

    test('a param the invocation did not supply is refused', async function (assert) {
      let error = await refusalFrom(async () =>
        lowerQueryOperation(savedSearch(), { actor: '@test-actor:localhost' }),
      );
      assert.strictEqual(error.code, 'invalid-params');
      assert.ok(
        error.detail.includes('status'),
        `the refusal names the missing param: ${error.detail}`,
      );
    });

    test('instance() has no target to resolve against in a query', async function (assert) {
      let definition = savedSearch();
      definition.query!.filter = {
        'item.on': personRef,
        eq: { 'item.title': { $ref: 'instance', key: 'title' } },
      };
      let error = await refusalFrom(async () =>
        lowerQueryOperation(definition, {
          actor: '@test-actor:localhost',
          params: { status: 'open' },
        }),
      );
      assert.strictEqual(error.code, 'invalid-params');
      assert.ok(
        error.detail.includes('instance()'),
        `the refusal names the marker: ${error.detail}`,
      );
    });
  });
});
