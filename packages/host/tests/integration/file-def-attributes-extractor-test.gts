// The FileDefAttributesExtractor walks the FileDef class chain: a subclass
// that cannot parse the content hands off to its parent, so a malformed file
// still indexes as a plain FileDef. These tests pin the boundary of that
// fallback: a failure to OBTAIN the bytes (fetch rejected, non-ok response,
// or the body stream erroring mid-read) must abort the extract with
// `status: 'error'` instead — the base FileDef would "succeed" without
// reading the bytes and permanently misclassify the file (a markdown skill
// loses `kind`, so it stops being a skill).

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, rri } from '@cardstack/runtime-common';

import type LoaderService from '@cardstack/host/services/loader-service';
import type NetworkService from '@cardstack/host/services/network';
import {
  FileDefAttributesExtractor,
  resetHardFetchFailureMemoryForTest,
} from '@cardstack/host/utils/file-def-attributes-extractor';
import { buildFileExtractError } from '@cardstack/host/utils/file-extract-runner';

import { setupLocalIndexing, testRealmURL } from '../helpers';
import { setupBaseRealm } from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

const SKILL_MD = `---
boxel:
  kind: skill
---
# A Markdown Skill

Body paragraph.
`;

module('Integration | file-def-attributes-extractor', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);
  setupMockMatrix(hooks);

  let loaderService: LoaderService;
  let network: NetworkService;

  hooks.beforeEach(function () {
    loaderService = getService('loader-service');
    network = getService('network');
    resetHardFetchFailureMemoryForTest();
  });

  function makeExtractor(
    authedFetch: (request: Request) => Promise<Response>,
    opts: { fetchRetryDelaysMs?: number[] } = { fetchRetryDelaysMs: [] },
  ) {
    return new FileDefAttributesExtractor({
      loaderService,
      network: {
        virtualNetwork: network.virtualNetwork,
        authedFetch,
      } as unknown as NetworkService,
      fileURL: `${testRealmURL}index.md`,
      fileDefCodeRef: {
        module: rri(`${baseRealm.url}markdown-file-def`),
        name: 'MarkdownDef',
      },
      baseFileDefCodeRef: {
        module: rri(`${baseRealm.url}card-api`),
        name: 'FileDef',
      },
      contentHash: undefined,
      contentSize: undefined,
      buildError: buildFileExtractError,
      ...opts,
    });
  }

  test('extracts markdown attributes when the bytes stream cleanly', async function (assert) {
    let extractor = makeExtractor(
      async () => new Response(new TextEncoder().encode(SKILL_MD)),
    );

    let result = await extractor.extract();

    assert.strictEqual(result.status, 'ready');
    assert.strictEqual(result.searchDoc?.kind, 'skill');
    assert.true(
      (result.types ?? []).some((type) => type.endsWith('/MarkdownDef')),
      `types carry the markdown subtype: ${JSON.stringify(result.types)}`,
    );
  });

  test('a rejected byte fetch aborts the extract instead of falling back to FileDef', async function (assert) {
    let fetchCount = 0;
    let extractor = makeExtractor(async () => {
      fetchCount++;
      throw new TypeError('network error');
    });

    let result = await extractor.extract();

    assert.strictEqual(result.status, 'error');
    assert.strictEqual(
      result.types,
      undefined,
      'no fallback type chain is stamped for a file whose bytes never arrived',
    );
    assert.ok(result.error, 'the failure is carried on the result');
    assert.ok(fetchCount >= 1, 'the fetch was attempted');
  });

  test('a transient fetch failure is retried and the extract succeeds', async function (assert) {
    let fetchCount = 0;
    let extractor = makeExtractor(
      async () => {
        fetchCount++;
        if (fetchCount <= 2) {
          throw new TypeError('network error');
        }
        return new Response(new TextEncoder().encode(SKILL_MD));
      },
      { fetchRetryDelaysMs: [1, 1] },
    );

    let result = await extractor.extract();

    assert.strictEqual(fetchCount, 3, 'two retries, then success');
    assert.strictEqual(result.status, 'ready');
    assert.strictEqual(result.searchDoc?.kind, 'skill');
  });

  test('the retry budget is finite: a persistent fetch failure still aborts', async function (assert) {
    let fetchCount = 0;
    let extractor = makeExtractor(
      async () => {
        fetchCount++;
        throw new TypeError('network error');
      },
      { fetchRetryDelaysMs: [1, 1] },
    );

    let result = await extractor.extract();

    assert.strictEqual(fetchCount, 3, 'the initial attempt plus two retries');
    assert.strictEqual(result.status, 'error');
  });

  test('an origin that is already failing hard is not retried per file', async function (assert) {
    let fetchCount = 0;
    let deadOriginFetch = async () => {
      fetchCount++;
      throw new TypeError('connection refused');
    };

    // The first file against the dead origin spends the full retry budget…
    let first = makeExtractor(deadOriginFetch, { fetchRetryDelaysMs: [1, 1] });
    await first.extract();
    assert.strictEqual(fetchCount, 3, 'first file retried');

    // …and every following file within the failure window fails fast, so a
    // batch of visits against a dead realm cannot stall the indexing worker
    // for the whole batch.
    fetchCount = 0;
    let second = makeExtractor(deadOriginFetch, { fetchRetryDelaysMs: [1, 1] });
    let result = await second.extract();
    assert.strictEqual(fetchCount, 1, 'later files fail fast');
    assert.strictEqual(result.status, 'error');
  });

  test('a body stream erroring mid-read aborts the extract instead of falling back to FileDef', async function (assert) {
    let body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(SKILL_MD.slice(0, 10)));
        controller.error(new TypeError('connection reset mid-stream'));
      },
    });
    let served = false;
    let extractor = makeExtractor(async () => {
      if (served) {
        // The retry stream re-fetches; fail that too so the extract cannot
        // quietly recover through the buffered path.
        throw new TypeError('connection reset');
      }
      served = true;
      return new Response(body);
    });

    let result = await extractor.extract();

    assert.strictEqual(result.status, 'error');
    assert.strictEqual(
      result.types,
      undefined,
      'no fallback type chain is stamped when the stream died mid-read',
    );
  });
});
