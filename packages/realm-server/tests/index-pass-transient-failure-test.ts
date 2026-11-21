import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import {
  IndexQueryEngine,
  IndexWriter,
  TRANSIENT_RENDER_FAILURE_RETRY_BASE_MS,
  TRANSIENT_RENDER_FAILURE_RETRY_CAP,
  VirtualNetwork,
  findTransientIndexRetryRows,
  internalKeyFor,
  markVisitRequestFailure,
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

// `aborts` is a prerender request that failed transiently, as the prerender
// client throws it (marked); `refused` is one the prerender path refused, a
// 4xx (unmarked).
type LogOutcome = 'good' | 'times-out' | 'aborts' | 'refused' | 'broken';

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
          throw markVisitRequestFailure(
            new Error(
              'Prerender request to http://prerender.test/ aborted after 60000ms (requestId=r1)',
            ),
          );
        }
        if (outcome === 'refused') {
          throw new Error(
            'Prerender request to http://prerender.test/prerender-visit failed with status 400: URL is required',
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
    // The pass's job follows every job recorded so far, as a job enqueued
    // after them would.
    let [{ next_id }] = (await adapter.execute(
      `SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM jobs`,
    )) as { next_id: number | string }[];
    jobCounter = Math.max(jobCounter, Number(next_id));
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
  // its backoff. `includeLegacy` is the hourly sweep's.
  async function retriesDue(opts: { includeLegacy?: boolean } = {}) {
    await adapter.execute(`UPDATE boxel_index SET indexed_at = 0`);
    return (
      (await findTransientIndexRetryRows(adapter, opts)).get(testRealm) ?? []
    );
  }

  // Records an incremental pass over `name` that finished, `minutesAgo`,
  // without writing its row, as a rejected or timed-out retry leaves it. Its
  // id follows the job that wrote the failed attempt, as a retry enqueued
  // after that write would.
  async function retryDied(name: string, minutesAgo: number) {
    await adapter.execute(
      `INSERT INTO jobs (id, job_type, concurrency_group, args, status, timeout, finished_at)
       SELECT GREATEST(
                COALESCE((i.diagnostics ->> 'transientRenderFailureJobId')::int, 0),
                COALESCE((SELECT MAX(id) FROM jobs), 0)
              ) + 1,
              'incremental-index', 'indexing:' || i.realm_url,
              jsonb_build_object('realmURL', i.realm_url,
                'changes', jsonb_build_array(jsonb_build_object('url', i.url, 'operation', 'update'))),
              'rejected', 60, NOW() - ($2 || ' minutes')::interval
         FROM boxel_index i
        WHERE i.url = $1 AND i.type = 'file'`,
      { bind: [url(name), String(minutesAgo)] },
    );
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

  test('a log whose prerender request is refused is the log’s error, and the linking card inherits it', async function (assert) {
    await pass(logName, postName);
    logOutcome = 'refused';
    await pass(logName);
    let log = await row(logName, 'file');
    assert.true(Boolean(log.has_error), 'the refusal is the log’s error');
    assert.notOk(log.error_doc?.visitRequestFailure, 'not a request failure');
    assert.notOk(log.diagnostics?.transientRenderFailure, 'nor transient');
    assert.deepEqual(await retriesDue(), [], 'and nothing retries it');

    await pass(postName);
    assert.true(
      Boolean((await row(postName, 'instance')).has_error),
      'the post inherits it, as it would any error of the log',
    );
  });

  test('a failure after the retries ran out starts a new run, with retries of its own', async function (assert) {
    await pass(logName, postName);
    logOutcome = 'times-out';
    for (let i = 0; i <= TRANSIENT_RENDER_FAILURE_RETRY_CAP; i++) {
      await retriesDue();
      await pass(logName);
    }
    assert.deepEqual(await retriesDue(), [], 'the run is spent');

    // The log is indexed again for its own reason, and times out again.
    await pass(logName);
    assert.strictEqual(
      (await row(logName, 'file')).diagnostics?.transientRenderFailureRenders,
      1,
      'a new run',
    );
    assert.deepEqual(await retriesDue(), [url(logName)], 'which is retried');
  });

  test('a retry that dies before writing counts as a failed attempt', async function (assert) {
    let minutes = TRANSIENT_RENDER_FAILURE_RETRY_BASE_MS / 60_000;
    await pass(logName, postName);
    logOutcome = 'times-out';
    await pass(logName);
    await retryDied(logName, 2 * minutes - 1);
    assert.deepEqual(
      await retriesDue(),
      [],
      'the next retry waits out the second interval, timed from the dead one',
    );
    await adapter.execute(
      `UPDATE jobs SET finished_at = NOW() - ($1 || ' minutes')::interval`,
      { bind: [String(2 * minutes + 1)] },
    );
    assert.deepEqual(await retriesDue(), [url(logName)], 'then it is due');

    await retryDied(logName, 60);
    await retryDied(logName, 60);
    assert.deepEqual(
      await retriesDue(),
      [],
      'the failure and three dead retries spend the retries',
    );
  });

  test('a retry that fails after retries that died carries them in its run', async function (assert) {
    await pass(logName, postName);
    logOutcome = 'times-out';
    await pass(logName);
    await retryDied(logName, 24 * 60);
    await retryDied(logName, 24 * 60);
    assert.deepEqual(
      await retriesDue(),
      [url(logName)],
      'the last retry is due',
    );

    await pass(logName);
    assert.strictEqual(
      (await row(logName, 'file')).diagnostics?.transientRenderFailureRenders,
      TRANSIENT_RENDER_FAILURE_RETRY_CAP + 1,
      'the failure, the two retries that died and this one',
    );
    assert.deepEqual(await retriesDue(), [], 'the retries are spent');
  });

  test('the hourly sweep re-indexes a legacy row’s stored timeout once', async function (assert) {
    await pass(logName, postName);
    // A timeout an earlier release stored as the log's error, with no verdict.
    await adapter.execute(
      `UPDATE boxel_index
          SET has_error = TRUE, error_doc = $1::jsonb, diagnostics = NULL
        WHERE url = $2 AND type = 'file'`,
      {
        bind: [
          JSON.stringify({ ...renderTimeout, renderTimeout: undefined }),
          url(logName),
        ],
      },
    );
    assert.deepEqual(
      await retriesDue(),
      [],
      'the every-minute sweep leaves errored rows alone',
    );
    assert.deepEqual(
      await retriesDue({ includeLegacy: true }),
      [url(logName)],
      'the hourly sweep re-indexes it',
    );

    await retryDied(logName, 60);
    assert.deepEqual(
      await retriesDue({ includeLegacy: true }),
      [],
      'once: after a re-index that died, it is left as it is',
    );
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
