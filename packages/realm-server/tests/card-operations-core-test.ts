import QUnit from 'qunit';
const { module, test } = QUnit;
import { rmSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import type { Test, SuperTest } from 'supertest';
import type { RealmHttpServer as Server } from '../server.ts';
import type { DirResult } from 'tmp';
import type { CodeRef, Realm } from '@cardstack/runtime-common';
import {
  SupportedMimeType,
  baseRealm,
  computeContentHash,
  isSampledContentHash,
  CONTENT_HASH_WHOLE_LIMIT_BYTES,
  rri,
} from '@cardstack/runtime-common';
import {
  isDocumentResult,
  isHeadResult,
  isOperationFailure,
  isSourceResult,
  lowerQueryOperation,
  runOperation,
  type OperationCore,
  type OperationDefinition,
  type OperationHeadResult,
  type OperationRequest,
  type OperationResult,
  type OperationSourceBody,
  type OperationSourceResult,
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
//
// A `read` is held against what the card+json GET serves and a `readSource`
// against what the `card+source` GET serves, because those are the surfaces
// each will delegate to. Where a result is checked against a handler's
// response rather than against a literal, that is deliberate: the parity is
// the requirement, and a literal would let the two drift together.

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

function sourceOf(result: OperationResult): OperationSourceResult {
  if (!isSourceResult(result)) {
    throw new Error(`expected a source result, got ${JSON.stringify(result)}`);
  }
  return result;
}

// A stored-bytes read hands back whatever form the realm's file adapter
// produced — under Node that is an unread stream — so a test comparing content
// has to materialize it. Doing so here rather than in the executor is the
// point: a facade puts the body on a response without ever reading it.
async function bytesOf(
  body: OperationSourceBody | undefined,
): Promise<Uint8Array> {
  if (body === undefined) {
    throw new Error('expected a body');
  }
  if (typeof body === 'string') {
    return new TextEncoder().encode(body);
  }
  if (body instanceof Uint8Array) {
    return body;
  }
  let chunks: Uint8Array[] = [];
  for await (let chunk of body as AsyncIterable<Uint8Array | string>) {
    chunks.push(
      typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk,
    );
  }
  let total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  let bytes = new Uint8Array(total);
  let offset = 0;
  for (let chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function textOf(body: OperationSourceBody | undefined): Promise<string> {
  return new TextDecoder().decode(await bytesOf(body));
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

    // The realm's directory on disk, for the one case that has to reach past
    // the realm to set itself up: a file changed without the realm's write
    // path seeing it.
    let testRealmPath: string;

    function onRealmSetup(args: {
      testRealm: Realm;
      testRealmHttpServer: Server;
      testRealmPath: string;
      request: SuperTest<Test>;
      dir: DirResult;
      dbAdapter: PgAdapter;
    }) {
      testRealm = args.testRealm;
      testRealmHttpServer = args.testRealmHttpServer;
      testRealmPath = args.testRealmPath;
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

      // Against the card+json GET rather than the file-meta endpoint: the
      // card+json handler is the surface that will delegate here, so it is the
      // one the read has to reproduce.
      let response = await realmRequest
        .get('/sample.md')
        .set('Accept', SupportedMimeType.CardJson);
      assert.strictEqual(
        response.status,
        200,
        `HTTP 200 status: ${response.text}`,
      );
      assert.deepEqual(
        document,
        JSON.parse(response.text),
        'the read operation assembles the same document the card+json GET returns for a file',
      );
    });

    test('a read of the realm root serves the index card', async function (assert) {
      let response = await realmRequest
        .get('/')
        .set('Accept', SupportedMimeType.CardJson);
      assert.strictEqual(
        response.status,
        200,
        `HTTP 200 status: ${response.text}`,
      );

      let result = await runOperation(
        testRealm.operationCore,
        request({ kind: 'instance', url: testRealmHref }, 'read'),
      );
      assert.deepEqual(
        documentOf(result),
        JSON.parse(response.text),
        'the realm root resolves to the index card, as it does over HTTP',
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

    test('a stored-bytes read serves a card instance source verbatim', async function (assert) {
      // The `.json` spelling names the card's stored bytes, which is why
      // dispatch leaves it as written rather than resolving it to the card.
      let result = await runOperation(
        testRealm.operationCore,
        request(
          { kind: 'instance', url: `${testRealmHref}person-1.json` },
          'readSource',
        ),
      );
      let source = sourceOf(result);
      assert.strictEqual(
        source.contentType,
        'application/json',
        'the content type is inferred from the path, as both byte routes infer it',
      );

      // Against the `card+source` GET rather than the card+json one: that is
      // the surface this read will serve, so it is the one it has to
      // reproduce.
      let response = await realmRequest
        .get('/person-1.json')
        .set('Accept', SupportedMimeType.CardSource);
      assert.strictEqual(
        response.status,
        200,
        `HTTP 200 status: ${response.text}`,
      );
      assert.strictEqual(
        await textOf(source.body),
        response.text,
        'the bytes are the ones the source route serves',
      );
      assert.true(
        response.headers['etag'].startsWith(source.version!),
        `the source ETag is built from the version the read reports: ${response.headers['etag']} / ${source.version}`,
      );
    });

    test('a stored-bytes read of a module serves its text', async function (assert) {
      // A module has no `adoptsFrom` and no definition-cache entry, so this is
      // the target the definition-free dispatch exists for. Its extension is
      // a registered one, which is what would otherwise send it through a
      // file def's type and a cache lookup on it.
      let result = await runOperation(
        testRealm.operationCore,
        request(
          { kind: 'instance', url: `${testRealmHref}person.gts` },
          'readSource',
        ),
      );
      let source = sourceOf(result);
      assert.strictEqual(source.contentType, 'text/typescript+glimmer');

      let response = await realmRequest
        .get('/person.gts')
        .set('Accept', SupportedMimeType.CardSource);
      assert.strictEqual(
        response.status,
        200,
        `HTTP 200 status: ${response.text}`,
      );
      assert.strictEqual(await textOf(source.body), response.text);
    });

    test('a stored-bytes read of an image serves its bytes and its content type', async function (assert) {
      // Written through the realm rather than taken from the fixture, for two
      // reasons: the fixture holds no binary file, and a realm write is what
      // persists the content-meta row, so this is also the case where
      // `version` is the hash the realm recorded rather than one computed from
      // the bytes on read.
      let bytes = new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff,
      ]);
      await testRealm.write('logo.png', bytes);

      let result = await runOperation(
        testRealm.operationCore,
        request(
          { kind: 'instance', url: `${testRealmHref}logo.png` },
          'readSource',
        ),
      );
      let source = sourceOf(result);
      assert.strictEqual(source.contentType, 'image/png');
      assert.deepEqual(
        Array.from(await bytesOf(source.body)),
        Array.from(bytes),
        'the bytes come back undecoded',
      );
      assert.strictEqual(
        source.version,
        computeContentHash(bytes),
        'and `version` is the content hash of the bytes the realm stored',
      );
      assert.strictEqual(
        typeof source.created,
        'number',
        'a realm write records when the realm first saw the path',
      );
    });

    test('a stored-bytes read of an underscore-prefixed file reaches it', async function (assert) {
      // Only the specific registered `_` endpoints are realm endpoints. A file
      // stored under such a name is one `upsertCardSource` writes and the byte
      // routes serve, so a read of its bytes must not report it missing.
      await testRealm.write('_notes.md', '# notes');

      let result = await runOperation(
        testRealm.operationCore,
        request(
          { kind: 'instance', url: `${testRealmHref}_notes.md` },
          'readSource',
        ),
      );
      let source = sourceOf(result);
      assert.strictEqual(source.contentType, 'text/markdown');
      // Read once and hold it. The body is whatever the adapter produced — a
      // single-use stream under Node — so reading it twice yields the bytes
      // and then nothing, which is what a facade putting it on a response
      // gets too: one pass.
      let bytes = await textOf(source.body);
      assert.strictEqual(bytes, '# notes');

      let response = await realmRequest
        .get('/_notes.md')
        .set('Accept', SupportedMimeType.CardSource);
      assert.strictEqual(
        response.status,
        200,
        `the source route serves it too: ${response.text}`,
      );
      assert.strictEqual(bytes, response.text);
    });

    test('a stored-bytes read never reports a version that describes other bytes', async function (assert) {
      // `version` identifies the body it comes back with, and the realm's
      // file-meta row is refreshed only by the realm's own write path. A file
      // overwritten out of band therefore has a row describing bytes that are
      // gone, and reporting that hash would let a conditional GET answer 304
      // for content that changed.
      //
      // Run against a module and against a `.md`, the two sides of the line
      // the byte routes draw for their own validators, since a stored-bytes
      // read draws none: what a stale row means does not depend on the
      // extension it sits under.
      let read = async (localPath: string) =>
        sourceOf(
          await runOperation(
            testRealm.operationCore,
            request(
              { kind: 'instance', url: `${testRealmHref}${localPath}` },
              'readSource',
            ),
          ),
        );

      await testRealm.write('notes.gts', 'export const first = 1;');
      assert.strictEqual(
        (await read('notes.gts')).version,
        computeContentHash('export const first = 1;'),
        'a realm write records the hash of what it wrote',
      );

      // Straight to disk, so nothing refreshes the row. The new bytes are a
      // different length, which is what the recorded hash is checked against.
      writeFileSync(
        join(testRealmPath, 'notes.gts'),
        'export const second = 2; // and longer',
      );
      let overwritten = await read('notes.gts');
      assert.strictEqual(
        await textOf(overwritten.body),
        'export const second = 2; // and longer',
        'the read serves the bytes that are on disk',
      );
      assert.strictEqual(
        overwritten.version,
        computeContentHash('export const second = 2; // and longer'),
        'and `version` identifies those bytes rather than the recorded ones',
      );
      let overwrittenHeaders = sourceOf(
        await runOperation(
          testRealm.operationCore,
          request(
            { kind: 'instance', url: `${testRealmHref}notes.gts` },
            'readSource',
          ),
          { headersOnly: true },
        ),
      );
      assert.strictEqual(
        overwrittenHeaders.version,
        overwritten.version,
        'and the mode that returns no body reports the same one — a ' +
          'fingerprint is read in bounded ranges of the file rather than out ' +
          'of the body, so declining the body costs no part of it',
      );

      // The same overwrite on a path the source route would validate on
      // `lastModified` rather than on a hash. The recorded hash is equally
      // untrustworthy here, and the read that replaces it is equally bounded,
      // so this answers with the new bytes' fingerprint too — which route asks
      // for one is the facade's business, not this read's.
      await testRealm.write('notes.md', '# first');
      writeFileSync(join(testRealmPath, 'notes.md'), '# second, and longer');
      let unhashed = await read('notes.md');
      assert.strictEqual(
        await textOf(unhashed.body),
        '# second, and longer',
        'the bytes on disk are still what is served',
      );
      assert.strictEqual(
        unhashed.version,
        computeContentHash('# second, and longer'),
        'and `version` identifies them rather than the recorded bytes',
      );
    });

    test('a stored-bytes read fingerprints a file larger than it reads', async function (assert) {
      // Above `CONTENT_HASH_WHOLE_LIMIT_BYTES` the fingerprint is the byte
      // length plus a hash of the head and one of the tail, so the realm
      // assembles it from two bounded reads and the stat — the same value
      // hashing the whole file yields, for a read that does not grow with the
      // file. Written straight to disk so there is no row to recall it from,
      // and under an extension the source route would validate on
      // `lastModified`: the bounded read is what makes fingerprinting every
      // path affordable, so this is the case that would be tempting to skip
      // and is exactly the one a large media serve wants a strong validator
      // for.
      let content = new Uint8Array(CONTENT_HASH_WHOLE_LIMIT_BYTES + 4096);
      for (let i = 0; i < content.length; i++) {
        content[i] = (i * 31 + 7) & 0xff;
      }
      writeFileSync(join(testRealmPath, 'large.bin'), content);
      let large = sourceOf(
        await runOperation(
          testRealm.operationCore,
          request(
            { kind: 'instance', url: `${testRealmHref}large.bin` },
            'readSource',
          ),
          { headersOnly: true },
        ),
      );
      // Off the realm's directory before anything can fail, so nothing that
      // runs after this reads a fixture this case invented.
      rmSync(join(testRealmPath, 'large.bin'));
      assert.strictEqual(
        large.size,
        content.length,
        'the size comes from the stat',
      );
      assert.true(
        isSampledContentHash(large.version!),
        'the fingerprint samples rather than covering the whole file',
      );
      assert.strictEqual(
        large.version,
        computeContentHash(content),
        'and it is the same value hashing the whole content produces, so one ' +
          'compares equal to the other wherever they meet',
      );
    });

    test('a headers-only stored-bytes read reports the same metadata with no body', async function (assert) {
      let target: OperationTarget = {
        kind: 'instance',
        url: `${testRealmHref}sample.md`,
      };
      let headers = sourceOf(
        await runOperation(
          testRealm.operationCore,
          request(target, 'readSource'),
          { headersOnly: true },
        ),
      );
      assert.strictEqual(headers.body, undefined, 'no bytes in this mode');
      assert.strictEqual(headers.contentType, 'text/markdown');

      let withBody = sourceOf(
        await runOperation(
          testRealm.operationCore,
          request(target, 'readSource'),
        ),
      );
      let { body: _body, ...metadata } = withBody;
      assert.deepEqual(
        metadata,
        headers,
        'the two modes agree on every value a response header is computed ' +
          'from — `version` included, which is why neither mode may reach ' +
          'for the body to produce one',
      );
    });

    test('a stored-bytes read of a path with no bytes is not found', async function (assert) {
      // A name nothing is stored under, and a name that is a directory. Both
      // are "no bytes here" and answer alike; `_search` is deliberately not
      // among them, since what makes a path unreadable is having no file, not
      // its name.
      for (let path of ['does-not-exist', 'dir']) {
        let error = await refusalFrom(() =>
          runOperation(
            testRealm.operationCore,
            request(
              { kind: 'instance', url: `${testRealmHref}${path}` },
              'readSource',
            ),
          ),
        );
        assert.strictEqual(
          error.code,
          'target-not-found',
          `${path} has no bytes to read: ${error.detail}`,
        );
        assert.strictEqual(error.status, 404);
      }
    });

    test('a type target carries no stored-bytes read', async function (assert) {
      // A type has no stored bytes, and the refusal does not depend on which
      // kind of def the type turns out to be: a `FieldDef` refuses for the
      // same reason a `CardDef` does, rather than because a field def carries
      // nothing.
      let types: { label: string; codeRef: CodeRef }[] = [
        {
          label: 'a card def',
          codeRef: { module: rri(`${testRealmHref}person`), name: 'Person' },
        },
        {
          label: 'a field def',
          codeRef: { module: rri(`${baseRealm.url}string`), name: 'default' },
        },
      ];
      for (let { label, codeRef } of types) {
        let error = await refusalFrom(() =>
          runOperation(
            testRealm.operationCore,
            request(
              { kind: 'type', codeRef, realm: testRealmHref },
              'readSource',
            ),
          ),
        );
        assert.strictEqual(
          error.code,
          'operation-not-allowed',
          `${label} type target is refused: ${error.detail}`,
        );
        assert.strictEqual(error.status, 405);
      }
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

    test('a card marker resolves to the identity it wraps', function (assert) {
      let definition = savedSearch();
      definition.query!.filter = {
        'item.on': personRef,
        eq: {
          'item.owner': { $ref: 'card', value: { $ref: 'actor', key: 'id' } },
        },
      };
      let query = lowerQueryOperation(definition, {
        actor: '@test-actor:localhost',
        params: { status: 'open' },
      });
      assert.deepEqual(query.filter, {
        'item.on': personRef,
        eq: { 'item.owner': '@test-actor:localhost' },
      });
    });

    test('a keyed actor reference needs the actor card, so it is refused', async function (assert) {
      let definition = savedSearch();
      definition.query!.filter = {
        'item.on': personRef,
        eq: { 'item.ownerName': { $ref: 'actor', key: 'name' } },
      };
      let error = await refusalFrom(async () =>
        lowerQueryOperation(definition, {
          actor: '@test-actor:localhost',
          params: { status: 'open' },
        }),
      );
      assert.strictEqual(error.code, 'invalid-params');
      assert.ok(
        error.detail.includes('identity'),
        `the refusal says why: ${error.detail}`,
      );
    });

    test('a marker nothing knows how to resolve is refused', async function (assert) {
      let definition = savedSearch();
      definition.query!.filter = {
        'item.on': personRef,
        eq: { 'item.title': { $ref: 'nonsense' } as never },
      };
      let error = await refusalFrom(async () =>
        lowerQueryOperation(definition, {
          actor: '@test-actor:localhost',
          params: { status: 'open' },
        }),
      );
      assert.strictEqual(error.code, 'invalid-params');
    });

    test('a param key every object answers to is not a declared param', async function (assert) {
      let definition = savedSearch();
      definition.query!.filter = {
        'item.on': personRef,
        eq: { 'item.title': { $ref: 'params', key: '__proto__' } },
      };
      let error = await refusalFrom(async () =>
        lowerQueryOperation(definition, {
          actor: '@test-actor:localhost',
          params: { status: 'open' },
        }),
      );
      assert.strictEqual(
        error.code,
        'invalid-params',
        'a prototype member is not a param, so nothing of it reaches the query',
      );
    });

    test('a substituted value the realm would refuse is refused here', async function (assert) {
      // Lowering checks a declared query against the realm's grammar only
      // where it can: a template still holding a marker stands in for a value
      // the realm types concretely, so the check is deferred to the invocation
      // that supplies it. This is that check.
      let definition = savedSearch();
      definition.query!.filter = {
        'item.on': personRef,
        matches: { $ref: 'params', key: 'status' },
      };
      let error = await refusalFrom(async () =>
        lowerQueryOperation(definition, {
          actor: '@test-actor:localhost',
          params: { status: 42 },
        }),
      );
      assert.strictEqual(error.code, 'invalid-params');
      assert.ok(
        error.detail.includes('matches must be a string'),
        `the refusal carries the grammar's own reason: ${error.detail}`,
      );

      // A list operand is the other half of the same rule.
      let listy = savedSearch();
      listy.query!.filter = {
        'item.on': personRef,
        in: { 'item.status': { $ref: 'params', key: 'status' } },
      };
      let listError = await refusalFrom(async () =>
        lowerQueryOperation(listy, {
          actor: '@test-actor:localhost',
          params: { status: 'open' },
        }),
      );
      assert.strictEqual(listError.code, 'invalid-params');
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
