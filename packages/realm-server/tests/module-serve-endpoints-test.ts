import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { utimesSync } from 'fs';
import type { Realm } from '@cardstack/runtime-common';
import { SupportedMimeType } from '@cardstack/runtime-common';
import {
  setupPermissionedRealmCached,
  createJWT,
  withRealmPath,
  type RealmRequest,
} from './helpers/index.ts';

// The transpiled module serve: a `GET` for a `.gts`, `.ts` or `.js` path under
// an `Accept` the realm's router does not claim. What comes back is not the
// file — the realm compiles the module's stored text to plain JavaScript and
// serves that, so what a client can observe here is the compiler's output
// under headers derived from the file it was compiled from.
//
// It shares the fall-through with the raw byte serve, and the two split on
// whether the resolved path carries an executable extension: a `.png` is sent
// as stored, a `.gts` is transpiled. It also shares the path with the
// `card+source` route, which a client selects with
// `Accept: application/vnd.card+source` and which serves the text as written
// — so the same URL answers with different bytes and a different validator
// depending on the `Accept`, which several assertions below hold still.
//
// Three caches sit in front of the compiler, because a transpile costs 50–500
// ms: an in-memory one per process, a database table shared across processes,
// and an in-flight dedup so concurrent requests for one path run the compiler
// once. `X-Boxel-Cache` reports whether the response came from the in-memory
// one, and the transpile counter reports whether the compiler ran at all —
// which is how the assertions below tell the three layers apart from outside.
module(basename(import.meta.filename), function () {
  module('Realm-specific Endpoints | transpiled module serve', function () {
    let realmURL = new URL('http://127.0.0.1:4444/test/');
    let testRealmHref = realmURL.href;
    let testRealm: Realm;
    let testRealmPath: string;
    let request: RealmRequest;

    // A card def rather than a bare export: the transpile only visibly does
    // something for source carrying a template and decorators, so a response
    // that had served the stored text instead reads as a failed assertion
    // rather than as bytes that happen to match.
    function cardSource(className: string) {
      return `
        import {
          contains,
          field,
          Component,
          CardDef,
        } from '@cardstack/base/card-api';
        import StringField from '@cardstack/base/string';

        export class ${className} extends CardDef {
          static displayName = '${className}';
          @field name = contains(StringField);
          static isolated = class Isolated extends Component<typeof this> {
            <template>
              <h1 data-test-${className}><@fields.name /></h1>
            </template>
          };
        }
      `;
    }

    // Records every stored-bytes read the realm's operation core is asked to
    // make. `openStoredFile` is the one call a `readSource` makes of the core,
    // and the router reaches the core only by dispatching, so a request that
    // dispatches nothing leaves this empty. Resolving a name is not a read
    // through the core and does not appear here.
    function recordSourceReads() {
      let core = testRealm.operationCore;
      let original = core.openStoredFile;
      let paths: string[] = [];
      core.openStoredFile = (localPath) => {
        paths.push(localPath);
        return original(localPath);
      };
      return {
        countFor: (localPath: string) =>
          paths.filter((path) => path === localPath).length,
        restore: () => {
          core.openStoredFile = original;
        },
      };
    }

    module('public readable realm', function (hooks) {
      // Every test writes to a path of its own, so one boot is shared across
      // the module and no test can observe another's cache state.
      setupPermissionedRealmCached(hooks, {
        fixture: 'simple',
        realmURL,
        mode: 'before',
        permissions: {
          '*': ['read', 'write'],
          '@node-test_realm:localhost': ['read', 'realm-owner'],
        },
        onRealmSetup: (args) => {
          testRealm = args.testRealm;
          testRealmPath = args.testRealmPath;
          request = withRealmPath(args.request, realmURL);
        },
      });

      test('a module GET serves compiled JavaScript under the headers a module carries', async function (assert) {
        await testRealm.write('serve-headers.gts', cardSource('ServeHeaders'));

        let response = await request
          .get('/serve-headers.gts')
          .set('Accept', SupportedMimeType.All);

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.strictEqual(
          response.headers['content-type'],
          'text/javascript',
          'the compiled module is served as JavaScript, not as the source it was compiled from',
        );
        assert.strictEqual(
          response.headers['cache-control'],
          'public, max-age=0',
          'a client may store it but has to revalidate every time',
        );
        assert.ok(response.headers['etag'], 'a validator is present');
        assert.ok(
          response.headers['last-modified'],
          'the modification time is present',
        );
        assert.strictEqual(
          response.headers['x-boxel-canonical-path'],
          `${testRealmHref}serve-headers.gts`,
          'the response names the file it compiled',
        );
        assert.true(
          response.text.includes('setComponentTemplate'),
          'the body is the compiler output',
        );
        assert.false(
          response.text.includes('<template'),
          'and carries none of the template syntax only the compiler understands',
        );
      });

      test('the source route serves the same module as stored text under its own validator', async function (assert) {
        await testRealm.write(
          'serve-variants.gts',
          cardSource('ServeVariants'),
        );

        let compiled = await request
          .get('/serve-variants.gts')
          .set('Accept', SupportedMimeType.All);
        let stored = await request
          .get('/serve-variants.gts')
          .set('Accept', SupportedMimeType.CardSource);

        assert.strictEqual(stored.status, 200, 'the source route answers 200');
        assert.true(
          stored.text.includes('<template'),
          'the source route serves the text as written',
        );
        assert.notStrictEqual(
          compiled.headers['etag'],
          stored.headers['etag'],
          'the two representations of one path do not share a validator',
        );
      });

      test("a module's validator answers a conditional GET from the in-memory cache", async function (assert) {
        await testRealm.write(
          'conditional-warm.gts',
          cardSource('ConditionalWarm'),
        );

        let first = await request
          .get('/conditional-warm.gts')
          .set('Accept', SupportedMimeType.All);
        let etag = first.headers['etag'];
        assert.ok(etag, 'the first response carries a validator');

        let second = await request
          .get('/conditional-warm.gts')
          .set('Accept', SupportedMimeType.All)
          .set('If-None-Match', etag);

        assert.strictEqual(second.status, 304, 'HTTP 304 status');
        assert.strictEqual(
          second.headers['x-boxel-cache'],
          'hit',
          'the in-memory cache is what answered',
        );
        assert.strictEqual(
          second.headers['etag'],
          etag,
          'the 304 echoes the validator it matched',
        );
        assert.strictEqual(
          second.headers['cache-control'],
          'public, max-age=0',
          'and repeats the caching directive the 200 carried',
        );
        assert.strictEqual(
          second.headers['last-modified'],
          first.headers['last-modified'],
          'and the modification time',
        );
        assert.strictEqual(
          second.headers['x-boxel-canonical-path'],
          `${testRealmHref}conditional-warm.gts`,
          'and still names the file it is answering for',
        );
        assert.notOk(second.text, 'a 304 carries no body');
      });

      test('a conditional GET is answered without the in-memory cache and without compiling', async function (assert) {
        await testRealm.write(
          'conditional-cold.gts',
          cardSource('ConditionalCold'),
        );

        let first = await request
          .get('/conditional-cold.gts')
          .set('Accept', SupportedMimeType.All);
        let etag = first.headers['etag'];
        assert.ok(etag, 'the first response carries a validator');

        // Drops the in-memory cache and resets the compiler's call counter, so
        // what follows is measured from a process that has never served this
        // module.
        testRealm.__testOnlyClearCaches();

        let second = await request
          .get('/conditional-cold.gts')
          .set('Accept', SupportedMimeType.All)
          .set('If-None-Match', etag);

        assert.strictEqual(second.status, 304, 'HTTP 304 status');
        assert.strictEqual(
          second.headers['x-boxel-cache'],
          'miss',
          'nothing in memory answered it',
        );
        assert.strictEqual(
          second.headers['etag'],
          etag,
          'the validator is rebuilt from the file and matches the one it was sent',
        );
        assert.strictEqual(
          second.headers['cache-control'],
          'public, max-age=0',
          "the caching directive is the 200's",
        );
        assert.strictEqual(
          second.headers['last-modified'],
          first.headers['last-modified'],
          'and so is the modification time',
        );
        assert.strictEqual(
          second.headers['x-boxel-canonical-path'],
          `${testRealmHref}conditional-cold.gts`,
          'and the canonical path',
        );
        assert.strictEqual(
          testRealm.__testOnlyGetTranspileCallCount(),
          0,
          'answering a validator never reaches the compiler',
        );
        assert.notOk(second.text, 'a 304 carries no body');
      });

      test('the shared cache answers a request that opts out of the in-memory one, without compiling again', async function (assert) {
        // A path this realm has never served, so neither cache holds anything
        // for it and the compiler's call count moves only for what this test
        // asks for. Clearing the caches instead would not do: that drops the
        // shared layer along with the in-memory one, which is the layer under
        // test here.
        await testRealm.write('shared-cache.gts', cardSource('SharedCache'));
        let before = testRealm.__testOnlyGetTranspileCallCount();

        // The header opts out of the in-memory cache alone. The shared one
        // still answers, which is what tells the two layers apart from
        // outside: both requests report a miss, and only one of them compiles.
        let first = await request
          .get('/shared-cache.gts')
          .set('Accept', SupportedMimeType.All)
          .set('X-Boxel-Disable-Module-Cache', 'true');

        assert.strictEqual(first.status, 200, 'HTTP 200 status');
        assert.strictEqual(
          testRealm.__testOnlyGetTranspileCallCount(),
          before + 1,
          'the first request compiled the module',
        );

        let second = await request
          .get('/shared-cache.gts')
          .set('Accept', SupportedMimeType.All)
          .set('X-Boxel-Disable-Module-Cache', 'true');

        assert.strictEqual(second.status, 200, 'HTTP 200 status');
        assert.strictEqual(
          second.headers['x-boxel-cache'],
          'miss',
          'the in-memory cache did not answer it',
        );
        assert.strictEqual(
          testRealm.__testOnlyGetTranspileCallCount(),
          before + 1,
          'and the compiler did not run again: the shared cache held the bytes',
        );
        assert.strictEqual(
          second.text,
          first.text,
          'the bytes are the ones the first request compiled',
        );
        assert.strictEqual(
          second.headers['etag'],
          first.headers['etag'],
          'under the same validator',
        );
      });

      test('compiling a module reads it through the source operation, and a cached answer reads nothing', async function (assert) {
        await testRealm.write(
          'operation-read.gts',
          cardSource('OperationRead'),
        );
        let reads = recordSourceReads();
        try {
          let compiled = await request
            .get('/operation-read.gts')
            .set('Accept', SupportedMimeType.All);

          assert.strictEqual(compiled.status, 200, 'HTTP 200 status');
          assert.strictEqual(
            reads.countFor('operation-read.gts'),
            1,
            'compiling the module read its stored bytes through the operation, once',
          );

          let inMemory = await request
            .get('/operation-read.gts')
            .set('Accept', SupportedMimeType.All);

          assert.strictEqual(
            inMemory.headers['x-boxel-cache'],
            'hit',
            'the in-memory cache answered the second request',
          );
          assert.strictEqual(
            reads.countFor('operation-read.gts'),
            1,
            'which cost no read of the file',
          );

          let shared = await request
            .get('/operation-read.gts')
            .set('Accept', SupportedMimeType.All)
            .set('X-Boxel-Disable-Module-Cache', 'true');

          assert.strictEqual(
            shared.headers['x-boxel-cache'],
            'miss',
            'opting out of the in-memory cache reaches the shared one',
          );
          assert.strictEqual(
            shared.text,
            compiled.text,
            'which answers with the bytes the compile produced',
          );
          assert.strictEqual(
            reads.countFor('operation-read.gts'),
            1,
            'and costs no read of the file either',
          );

          let conditional = await request
            .get('/operation-read.gts')
            .set('Accept', SupportedMimeType.All)
            .set('X-Boxel-Disable-Module-Cache', 'true')
            .set('If-None-Match', compiled.headers['etag']);

          assert.strictEqual(
            conditional.status,
            304,
            'a validator that still matches answers 304',
          );
          assert.strictEqual(
            reads.countFor('operation-read.gts'),
            1,
            'without reading the bytes that validator describes',
          );
        } finally {
          reads.restore();
        }
      });

      test('an extension-less request resolves to the module and names what it resolved to', async function (assert) {
        await testRealm.write('extensionless.gts', cardSource('Extensionless'));

        let response = await request
          .get('/extensionless')
          .set('Accept', SupportedMimeType.All);

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.strictEqual(
          response.headers['x-boxel-canonical-path'],
          `${testRealmHref}extensionless.gts`,
          'the response names the file the extension-less name resolved to',
        );
        assert.strictEqual(
          response.headers['content-type'],
          'text/javascript',
          'which is compiled like any other module request',
        );
      });

      test('a path naming no module is a 404', async function (assert) {
        let response = await request
          .get('/nothing-is-here.gts')
          .set('Accept', SupportedMimeType.All);

        assert.strictEqual(response.status, 404, 'HTTP 404 status');
      });

      test('a module the compiler rejects is a 406 carrying the failure', async function (assert) {
        await testRealm.write(
          'uncompilable.gts',
          `export class Broken extends {{{ {`,
        );

        let response = await request
          .get('/uncompilable.gts')
          .set('Accept', SupportedMimeType.All);

        assert.strictEqual(response.status, 406, 'HTTP 406 status');
        assert.strictEqual(
          response.headers['content-type'],
          SupportedMimeType.JSONAPI,
          'the failure is reported as a JSON:API error document',
        );
        // Read the payload out of the text: this content type has no parser
        // registered on the client, so letting one pick would test which
        // parser it picked rather than what the realm sent.
        let payload = JSON.parse(response.text) as {
          errors?: { status?: number; title?: string; message?: string }[];
        };
        let error = payload.errors?.[0];
        assert.strictEqual(payload.errors?.length, 1, 'one error is reported');
        assert.strictEqual(
          error?.status,
          406,
          'whose status is the one the response carries',
        );
        // The compiler's own complaint, not the request's URL: the URL is in
        // `errors[0].id` for every refusal on this path, so reading it back
        // would pass for a refusal that never reached the compiler.
        assert.true(
          (error?.message ?? '').includes('uncompilable.gts'),
          'and whose message is the compiler naming the module it could not parse',
        );
      });

      test('a module that stops existing between resolution and the read is refused as the route refuses everything', async function (assert) {
        await testRealm.write('vanishing.gts', cardSource('Vanishing'));
        // The realm answers `undefined` for a path that holds no file, which
        // is what the operation sees when a delete lands in the window between
        // the name being resolved and its bytes being read. Nothing else can
        // open that window from outside: the resolution and the read are two
        // statements of one method.
        let core = testRealm.operationCore;
        let original = core.openStoredFile;
        core.openStoredFile = (localPath) =>
          localPath === 'vanishing.gts'
            ? Promise.resolve(undefined)
            : original(localPath);
        let response;
        try {
          response = await request
            .get('/vanishing.gts')
            .set('Accept', SupportedMimeType.All);
        } finally {
          core.openStoredFile = original;
        }

        assert.strictEqual(response.status, 406, 'HTTP 406 status');
        let payload = JSON.parse(response.text) as {
          errors?: { status?: number; title?: string }[];
        };
        assert.strictEqual(
          payload.errors?.[0]?.status,
          406,
          'and a body reporting the same status as the response',
        );
        assert.strictEqual(
          payload.errors?.[0]?.title,
          'Module transpilation failed',
          'under the title this route gives every module it cannot produce',
        );
      });

      test('a caller can ask for the module without the in-memory cache', async function (assert) {
        await testRealm.write('uncached.gts', cardSource('Uncached'));

        let first = await request
          .get('/uncached.gts')
          .set('Accept', SupportedMimeType.All)
          .set('X-Boxel-Disable-Module-Cache', 'true');
        let second = await request
          .get('/uncached.gts')
          .set('Accept', SupportedMimeType.All)
          .set('X-Boxel-Disable-Module-Cache', 'true');

        assert.strictEqual(first.status, 200, 'HTTP 200 status');
        assert.strictEqual(
          first.headers['x-boxel-cache'],
          'miss',
          'the first request is not served from memory',
        );
        assert.strictEqual(
          second.headers['x-boxel-cache'],
          'miss',
          'and neither is the second: the header opts out of both reading and filling that cache',
        );
        assert.strictEqual(
          second.text,
          first.text,
          'opting out changes what answers, not what is answered',
        );

        let third = await request
          .get('/uncached.gts')
          .set('Accept', SupportedMimeType.All);
        let fourth = await request
          .get('/uncached.gts')
          .set('Accept', SupportedMimeType.All);

        assert.strictEqual(
          third.headers['x-boxel-cache'],
          'miss',
          'a request that does not opt out finds the cache the opted-out ones left empty',
        );
        assert.strictEqual(
          fourth.headers['x-boxel-cache'],
          'hit',
          'and fills it for the next one',
        );
      });

      test('a write to a module is what the next request compiles', async function (assert) {
        await testRealm.write('recompiled.gts', cardSource('RecompiledBefore'));
        let before = await request
          .get('/recompiled.gts')
          .set('Accept', SupportedMimeType.All);
        assert.true(
          before.text.includes('RecompiledBefore'),
          'the first response compiled what was written',
        );

        await testRealm.write('recompiled.gts', cardSource('RecompiledAfter'));
        let after = await request
          .get('/recompiled.gts')
          .set('Accept', SupportedMimeType.All);

        assert.strictEqual(
          after.headers['x-boxel-cache'],
          'miss',
          'the write emptied the cache the previous response filled',
        );
        assert.true(
          after.text.includes('RecompiledAfter'),
          'and the next response compiled the text written over it',
        );
        assert.notStrictEqual(
          after.headers['etag'],
          before.headers['etag'],
          'under a validator of its own, whichever second the two writes land in',
        );
      });

      // A prerender tab revalidates every module it imports, so a rewrite in
      // the second it last read has to move the validator it holds, or the
      // tab goes on evaluating the module compiled from the earlier text.
      test('a rewrite within the same whole second is not answered 304 against the earlier validator', async function (assert) {
        let modulePath = 'same-second.gts';
        let absolutePath = join(testRealmPath, modulePath);
        let pinnedMtime = new Date('2026-01-01T00:00:00Z');

        // Writing a module indexes it, and indexing compiles it before the
        // time below is pinned, so what that compile left cached describes a
        // time the file no longer carries. Dropping it has the realm answer
        // from the file as it now stands, as it would had the write landed
        // in the pinned second.
        async function writePinned(source: string) {
          await testRealm.write(modulePath, source);
          utimesSync(absolutePath, pinnedMtime, pinnedMtime);
          testRealm.__testOnlyClearCaches();
        }

        // Equal lengths, so the size alone cannot tell the two apart.
        await writePinned(cardSource('PinnedFirst'));
        let first = await request
          .get(`/${modulePath}`)
          .set('Accept', SupportedMimeType.All);
        assert.strictEqual(first.status, 200, 'HTTP 200 status');
        let etag = first.headers['etag'];
        assert.ok(etag, 'the first response carries a validator');

        await writePinned(cardSource('PinnedAfter'));
        let conditional = await request
          .get(`/${modulePath}`)
          .set('Accept', SupportedMimeType.All)
          .set('If-None-Match', etag);

        assert.strictEqual(
          conditional.headers['last-modified'],
          first.headers['last-modified'],
          'the two versions share a modification time',
        );
        assert.strictEqual(
          conditional.status,
          200,
          'the earlier validator does not match the rewritten module',
        );
        assert.true(
          conditional.text.includes('PinnedAfter'),
          'the body is compiled from the rewritten text',
        );
        assert.notStrictEqual(
          conditional.headers['etag'],
          etag,
          'under a validator of its own',
        );
      });
    });

    module('permissioned realm', function (hooks) {
      setupPermissionedRealmCached(hooks, {
        fixture: 'simple',
        realmURL,
        mode: 'before',
        permissions: {
          john: ['read'],
          '@node-test_realm:localhost': ['read', 'realm-owner'],
        },
        onRealmSetup: (args) => {
          testRealm = args.testRealm;
          request = withRealmPath(args.request, realmURL);
        },
      });

      test('401 without a JWT', async function (assert) {
        let response = await request
          .get('/person.gts')
          .set('Accept', SupportedMimeType.All);

        assert.strictEqual(response.status, 401, 'HTTP 401 status');
      });

      test('401 with an invalid JWT', async function (assert) {
        let response = await request
          .get('/person.gts')
          .set('Accept', SupportedMimeType.All)
          .set('Authorization', `Bearer invalid-token`);

        assert.strictEqual(response.status, 401, 'HTTP 401 status');
      });

      test('403 without permission', async function (assert) {
        let response = await request
          .get('/person.gts')
          .set('Accept', SupportedMimeType.All)
          .set('Authorization', `Bearer ${createJWT(testRealm, 'not-john')}`);

        assert.strictEqual(response.status, 403, 'HTTP 403 status');
      });

      test('200 with permission', async function (assert) {
        let response = await request
          .get('/person.gts')
          .set('Accept', SupportedMimeType.All)
          .set(
            'Authorization',
            `Bearer ${createJWT(testRealm, 'john', ['read'])}`,
          );

        assert.strictEqual(response.status, 200, 'HTTP 200 status');
        assert.strictEqual(
          response.headers['content-type'],
          'text/javascript',
          'a reader of a realm that is not world-readable gets the compiled module',
        );
        // The directive a module carries is fixed rather than derived from the
        // realm's permissions, so it says `public` here where the raw byte
        // serve of the same realm says `private`.
        assert.strictEqual(
          response.headers['cache-control'],
          'public, max-age=0',
          'under the same caching directive a world-readable realm answers with',
        );
      });
    });
  });
});
