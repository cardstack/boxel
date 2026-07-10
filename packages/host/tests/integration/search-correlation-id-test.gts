import type { RenderingTestContext } from '@ember/test-helpers';
import { settled } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  baseRealm,
  rri,
  setSearchTimingSinkForTests,
  X_BOXEL_LOGGING_CORRELATION_ID_HEADER,
} from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';
import type { Query } from '@cardstack/runtime-common/query';

import type NetworkService from '@cardstack/host/services/network';
import type StoreService from '@cardstack/host/services/store';

import {
  testRealmURL,
  setupCardLogs,
  setupLocalIndexing,
  setupIntegrationTestRealm,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

// End-to-end coverage for the search correlation id: the in-realm browser
// (the prerendered host SPA) mints `x-boxel-logging-correlation-id` on its
// `_federated-search` fetch, and the realm-server's search path emits a
// `realm:search-timing` line keyed by that same id. This proves the id
// threads all the way from the client that originated it through to the
// server log a triage would join against.
//
// The host test exercises the *real* code on both ends: the SPA's
// `loggingCorrelationIdHeader()` stamps the header, and the realm-server-mock hands it
// to the real `searchEntryRealms`, which emits the line. Only the prerender
// context flag is simulated (the host normally sets it inside a prerender
// tab).

const personModule = `
  import { contains, field, CardDef } from '@cardstack/base/card-api';
  import StringField from '@cardstack/base/string';

  export class Person extends CardDef {
    static displayName = 'Person';
    @field name = contains(StringField);
  }
`;

let loader: Loader;

module('Integration | search correlation id', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks);

  hooks.beforeEach(function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;
  });

  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  hooks.beforeEach(async function () {
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'person.gts': personModule,
        'person-1.json': {
          data: {
            attributes: { name: 'Alice' },
            meta: { adoptsFrom: { module: './person', name: 'Person' } },
          },
        },
        'person-2.json': {
          data: {
            attributes: { name: 'Bob' },
            meta: { adoptsFrom: { module: './person', name: 'Person' } },
          },
        },
      },
    });
  });

  // Restore globals + sink between tests so a failure can't leak into the
  // next test or the rest of the suite.
  hooks.afterEach(function () {
    delete (globalThis as Record<string, unknown>).__boxelRenderContext;
    setSearchTimingSinkForTests(undefined);
  });

  const personQuery: Query = {
    filter: { type: { module: rri(`${testRealmURL}person`), name: 'Person' } },
  };

  test('a client-issued search threads its correlation id into the server timing log', async function (assert) {
    let store = getService('store') as StoreService;
    let network = getService('network') as NetworkService;

    // Capture the realm-server's `realm:search-timing` emissions.
    let timingLines: string[] = [];
    setSearchTimingSinkForTests((line) => timingLines.push(line));

    // Capture the correlation id the client actually puts on the wire.
    let sentRequestIds: string[] = [];
    let spy = async (request: Request) => {
      if (new URL(request.url).pathname.endsWith('/_federated-search')) {
        let id = request.headers.get(X_BOXEL_LOGGING_CORRELATION_ID_HEADER);
        if (id) {
          sentRequestIds.push(id);
        }
      }
      // Return null to fall through to the realm-server-mock route.
      return null;
    };
    network.virtualNetwork.mount(spy, { prepend: true });

    // Simulate the prerender context, which is what gates the host's
    // correlation-id stamping (mirrors a card rendering inside a prerender
    // tab issuing a query-backed search).
    (globalThis as Record<string, unknown>).__boxelRenderContext = true;

    let results = await store.search(personQuery, [testRealmURL]);
    await settled();

    assert.strictEqual(results.length, 2, 'the search returned both people');

    assert.strictEqual(
      sentRequestIds.length,
      1,
      'the client stamped exactly one correlation id on its _federated-search fetch',
    );
    let sentId = sentRequestIds[0];
    assert.ok(
      /^[A-Za-z0-9._:-]{8,}$/.test(sentId),
      `client-minted correlation id looks well-formed (${sentId})`,
    );

    let matching = timingLines.filter((line) =>
      line.includes(`corr=${sentId}`),
    );
    assert.strictEqual(
      matching.length,
      1,
      `the server emitted exactly one realm:search-timing line keyed by the client's id (lines: ${JSON.stringify(
        timingLines,
      )})`,
    );
    assert.ok(
      /\bsql=\d+\b/.test(matching[0]),
      `the timing line carries the sql stage (${matching[0]})`,
    );
    assert.ok(
      /\bloadLinks=\d+\b/.test(matching[0]),
      `the timing line carries the loadLinks stage (${matching[0]})`,
    );
  });

  test('a non-prerender search stamps no id and emits no timing line', async function (assert) {
    let store = getService('store') as StoreService;
    let network = getService('network') as NetworkService;

    let timingLines: string[] = [];
    setSearchTimingSinkForTests((line) => timingLines.push(line));

    let sawHeader = false;
    let spy = async (request: Request) => {
      if (
        new URL(request.url).pathname.endsWith('/_federated-search') &&
        request.headers.get(X_BOXEL_LOGGING_CORRELATION_ID_HEADER)
      ) {
        sawHeader = true;
      }
      return null;
    };
    network.virtualNetwork.mount(spy, { prepend: true });

    // No __boxelRenderContext: live SPA traffic must not stamp the header
    // (so it pays nothing and the server emits no timing line).
    let results = await store.search(personQuery, [testRealmURL]);
    await settled();

    assert.strictEqual(results.length, 2, 'the search still returns results');
    assert.false(
      sawHeader,
      'live (non-prerender) traffic sends no x-boxel-logging-correlation-id header',
    );
    assert.strictEqual(
      timingLines.length,
      0,
      'no realm:search-timing line is emitted without a correlation id',
    );
  });
});
