import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  IndexQueryEngine,
  IndexWriter,
  TRANSIENT_RENDER_FAILURE_RETRY_CAP,
  VirtualNetwork,
  findTransientIndexRetryRows,
  internalKeyFor,
  rri,
  type CodeRef,
  type Definition,
  type DefinitionLookup,
  type Diagnostics,
  type Prerenderer,
  type Reader,
  type RenderVisitResponse,
  type ResolvedCodeRef,
  type SerializedError,
} from '@cardstack/runtime-common';
import { IndexRunner } from '@cardstack/runtime-common/index-runner';
import type { PgAdapter } from '@cardstack/postgres';
import {
  closeTestPgAdapter,
  createTestPgAdapter,
  prepareTestDB,
  testRealm,
} from './helpers/index.ts';

// The index pass's twin of transient-render-failure-test.ts. A realm reset
// re-indexed a JSON Lines log whose visit timed out under an overloaded
// prerender service; the log's file row was stored as an error, and the post
// linking it took the log's error as its own and dropped out of search. A
// visit that did not finish (its render timed out, its prerender request
// aborted) is not a fact about the file: the pass keeps the file's last good
// row, and a card linking the file does not inherit the failure. A genuine
// extract error still counts, and still reaches the card.

const logName = 'Activity/p1/reactions.jsonl';
const postName = 'Post/p1.json';
const url = (name: string) => `${testRealm}${name}`;

function ref(module: string, name: string): ResolvedCodeRef {
  return { module: module as ResolvedCodeRef['module'], name };
}
const postModule = `${testRealm}post`;
const postRef = ref(postModule, 'Post');

const renderTimeout: SerializedError = {
  status: 504,
  title: 'Render timeout',
  message: 'Render timed-out after 60000 ms',
  additionalErrors: null,
  renderTimeout: true,
};
const genuineError: SerializedError = {
  status: 500,
  title: 'Error',
  message: 'the log is not valid JSON Lines',
  additionalErrors: null,
};

type LogOutcome = 'good' | 'times-out' | 'aborts' | 'broken';

const postSource = JSON.stringify({
  data: {
    type: 'card',
    attributes: {},
    meta: { adoptsFrom: { module: rri(postModule), name: 'Post' } },
  },
});

function reader(): Reader {
  return {
    async readFile(fileURL: URL) {
      let name = fileURL.href.slice(testRealm.length);
      if (name !== logName && name !== postName) {
        return undefined;
      }
      return {
        content: name === postName ? postSource : '{"like":1}\n',
        lastModified: 1,
        path: name,
      };
    },
    async readStream() {
      return undefined;
    },
    async mtimes() {
      return {};
    },
  } as unknown as Reader;
}

function fileExtract(name: string) {
  return {
    id: url(name),
    nonce: 'nonce',
    status: 'ready',
    searchDoc: { name },
    resource: {
      id: url(name),
      type: 'file-meta',
      attributes: { name },
      meta: {
        adoptsFrom: { module: '@cardstack/base/file-api', name: 'FileDef' },
      },
    },
    deps: [],
    types: ['https://cardstack.com/base/file-api/FileDef'],
  };
}

function prerenderer(
  logOutcome: () => LogOutcome,
  virtualNetwork: VirtualNetwork,
): Prerenderer {
  return {
    async prerenderVisit(args: { url: string }): Promise<RenderVisitResponse> {
      if (args.url === url(logName)) {
        let outcome = logOutcome();
        if (outcome === 'aborts') {
          throw new Error(
            'Prerender request to http://prerender.test/ aborted after 60000ms (requestId=r1)',
          );
        }
        if (outcome === 'times-out' || outcome === 'broken') {
          return {
            fileExtract: {
              id: url(logName),
              nonce: 'nonce',
              status: 'error',
              searchDoc: null,
              deps: [],
              error: {
                type: 'file-error',
                error: outcome === 'times-out' ? renderTimeout : genuineError,
              },
            },
          } as unknown as RenderVisitResponse;
        }
        return {
          fileExtract: fileExtract(logName),
        } as unknown as RenderVisitResponse;
      }
      // The post renders, consuming the log it links.
      return {
        card: {
          serialized: {
            data: {
              id: rri(url('Post/p1')),
              type: 'card',
              attributes: {},
              meta: { adoptsFrom: { module: rri(postModule), name: 'Post' } },
            },
          },
          searchDoc: { cardTitle: 'p1' },
          displayNames: ['Post'],
          deps: [url(logName)],
          types: [internalKeyFor(postRef, undefined, virtualNetwork)],
          isolatedHTML: '<div>p1</div>',
          headHTML: null,
          atomHTML: null,
          embeddedHTML: null,
          fittedHTML: null,
          iconHTML: null,
          markdown: null,
        },
        fileExtract: fileExtract(postName),
      } as unknown as RenderVisitResponse;
    },
    async releaseBatch() {},
    async prerenderModule() {
      throw new Error('this pass renders no modules');
    },
    async runCommand() {
      throw new Error('this pass runs no commands');
    },
  } as unknown as Prerenderer;
}

const postDef = {
  type: 'card-def',
  codeRef: postRef,
  displayName: 'Post',
  fields: {},
  fieldDefs: {},
} as Definition;

function definitionLookup(): DefinitionLookup {
  const lookup = {
    async lookupDefinition(codeRef: CodeRef) {
      if ('module' in codeRef && codeRef.module === postModule) {
        return postDef;
      }
      throw new Error(
        `unexpected definition lookup: ${JSON.stringify(codeRef)}`,
      );
    },
    async lookupCachedDefinition() {
      return undefined;
    },
    forRealm() {
      return lookup;
    },
  } as unknown as DefinitionLookup;
  return lookup;
}

module(basename(import.meta.filename), function (hooks) {
  let adapter: PgAdapter;
  let virtualNetwork: VirtualNetwork;
  let logOutcome: LogOutcome;
  let jobCounter = 3_000_000;

  hooks.beforeEach(async function () {
    prepareTestDB();
    adapter = await createTestPgAdapter();
    virtualNetwork = new VirtualNetwork();
    logOutcome = 'good';
  });

  hooks.afterEach(async function () {
    await closeTestPgAdapter(adapter);
  });

  // An incremental pass over `names` alone, its dependents left out so each
  // test says which visits the pass makes.
  async function pass(...names: string[]) {
    let runner = new IndexRunner({
      realmURL: new URL(testRealm),
      jobInfo: {
        jobId: jobCounter++,
        reservationId: 1,
        priority: 0,
        queueWaitMs: null,
        concurrencyGroup: null,
        laneFamily: null,
      },
      reader: reader(),
      indexWriter: new IndexWriter(adapter),
      definitionLookup: {} as DefinitionLookup,
      virtualNetwork,
      prerenderer: prerenderer(() => logOutcome, virtualNetwork),
      auth: 'auth',
      fetch: (async () => {
        throw new Error('this pass fetches nothing');
      }) as unknown as typeof globalThis.fetch,
      realmOwnerUserId: 'test_realm',
      writtenFileRereadDelaysMs: [],
    });
    await IndexRunner.incremental(runner, {
      changes: names.map((name) => ({
        url: new URL(url(name)),
        operation: 'update' as const,
      })),
    });
  }

  async function row(name: string, type: 'file' | 'instance') {
    let [found] = (await adapter.execute(
      `SELECT has_error, error_doc, pristine_doc, diagnostics, is_deleted
         FROM boxel_index WHERE url = $1 AND type = $2`,
      { bind: [url(name), type] },
    )) as {
      has_error: boolean | null;
      error_doc: SerializedError | null;
      pristine_doc: { attributes?: Record<string, unknown> } | null;
      diagnostics: Diagnostics | null;
      is_deleted: boolean | null;
    }[];
    return found;
  }

  async function searchPosts() {
    let engine = new IndexQueryEngine(
      adapter,
      definitionLookup(),
      virtualNetwork,
    );
    let { cards } = await engine.searchCards(new URL(testRealm), {
      filter: { type: postRef },
    });
    return cards.map((c) => String(c.id));
  }

  // The URLs the reconcile sweep would re-index, every index row aged past
  // its backoff.
  async function retriesDue() {
    await adapter.execute(`UPDATE boxel_index SET indexed_at = 0`);
    return (await findTransientIndexRetryRows(adapter)).get(testRealm) ?? [];
  }

  for (let outcome of ['times-out', 'aborts'] as const) {
    test(`a linked log whose visit ${outcome === 'times-out' ? 'times out' : 'aborts'} keeps its last good row, and the linking card stays searchable`, async function (assert) {
      await pass(logName, postName);
      assert.false(Boolean((await row(logName, 'file')).has_error));
      assert.deepEqual(await searchPosts(), [url('Post/p1')]);

      // The realm is re-indexed while the prerender service is overloaded.
      logOutcome = outcome;
      await pass(logName);
      await pass(postName);

      let log = await row(logName, 'file');
      assert.false(Boolean(log.has_error), 'the log is not stored as an error');
      assert.strictEqual(log.error_doc, null);
      assert.strictEqual(
        log.pristine_doc?.attributes?.name,
        logName,
        'its last good row is kept',
      );
      assert.deepEqual(
        log.diagnostics?.transientRenderFailure,
        ['file'],
        'the failure is recorded in diagnostics',
      );
      assert.ok(log.diagnostics?.transientRenderError?.message);

      let post = await row(postName, 'instance');
      assert.false(Boolean(post.has_error), 'the post is not errored');
      assert.deepEqual(
        await searchPosts(),
        [url('Post/p1')],
        'the post is still found',
      );
      assert.deepEqual(
        await retriesDue(),
        [url(logName)],
        'the reconcile sweep re-indexes the log',
      );
    });
  }

  test('a log whose visit keeps timing out keeps its last good row past the retries, and is no longer retried', async function (assert) {
    await pass(logName, postName);
    logOutcome = 'times-out';
    for (let i = 0; i <= TRANSIENT_RENDER_FAILURE_RETRY_CAP; i++) {
      if (i > 0) {
        assert.deepEqual(
          await retriesDue(),
          [url(logName)],
          `retry ${i} is due`,
        );
      }
      await pass(logName);
    }
    let log = await row(logName, 'file');
    assert.strictEqual(
      log.diagnostics?.transientRenderFailureRenders,
      TRANSIENT_RENDER_FAILURE_RETRY_CAP + 1,
    );
    assert.false(Boolean(log.has_error), 'still not the log’s error');
    assert.strictEqual(log.pristine_doc?.attributes?.name, logName, 'stale');
    assert.deepEqual(await retriesDue(), [], 'no retry past the cap');

    await pass(postName);
    assert.false(Boolean((await row(postName, 'instance')).has_error));
    assert.deepEqual(await searchPosts(), [url('Post/p1')]);

    logOutcome = 'good';
    await pass(logName);
    assert.notOk(
      (await row(logName, 'file')).diagnostics?.transientRenderFailure,
      'a good visit ends the run',
    );
  });

  test('a log with no good row to keep records its timeout, and the linking card does not inherit it', async function (assert) {
    logOutcome = 'times-out';
    await pass(logName);
    let log = await row(logName, 'file');
    assert.true(
      Boolean(log.has_error),
      'with nothing to keep, the failure is still visible on the log',
    );
    assert.deepEqual(log.diagnostics?.transientRenderFailure, ['file']);
    assert.true(log.error_doc?.noGoodRowToKeep, 'marked as such');
    assert.deepEqual(await retriesDue(), [url(logName)], 'and retried');

    await pass(postName);
    let post = await row(postName, 'instance');
    assert.false(
      Boolean(post.has_error),
      'the post does not take the log’s timeout as its own error',
    );
    assert.deepEqual(await searchPosts(), [url('Post/p1')]);
  });

  test('a genuinely broken log still errors, and the linking card still inherits it', async function (assert) {
    await pass(logName, postName);
    logOutcome = 'broken';
    await pass(logName);
    let log = await row(logName, 'file');
    assert.true(Boolean(log.has_error), 'the log is in error');
    assert.strictEqual(log.error_doc?.message, genuineError.message);
    assert.notOk(log.diagnostics?.transientRenderFailure);

    await pass(postName);
    let post = await row(postName, 'instance');
    assert.true(Boolean(post.has_error), 'the post inherits it, as before');
    assert.deepEqual(await searchPosts(), []);
  });
});
