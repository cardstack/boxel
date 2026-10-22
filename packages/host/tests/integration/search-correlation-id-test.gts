import type { RenderingTestContext } from '@ember/test-helpers';
import { settled } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  rri,
  setSearchTimingSinkForTests,
  X_BOXEL_LOGGING_CORRELATION_ID_HEADER,
} from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';
import type { Query } from '@cardstack/runtime-common/query';

import type ClientTelemetryService from '@cardstack/host/services/client-telemetry';
import type { ServerRequestEvent } from '@cardstack/host/services/client-telemetry';
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

// End-to-end coverage for the search correlation id: the browser mints
// `x-boxel-logging-correlation-id` on its `_federated-search` fetch, and the
// realm-server's search path emits a `realm:search-timing` line keyed by that
// same id. This proves the id threads all the way from the client that
// originated it through to the server log a triage would join against.
//
// Two clients mint it, by two different mechanisms, and both are covered here:
// a card rendering inside a prerender tab, where `loggingCorrelationIdHeader()`
// supplies the id the render is already running under, and live SPA traffic,
// where the client-telemetry timing middleware mints one per request and
// records it on the `server-request` event for the same call.
//
// The host test exercises the *real* code on both ends: the realm-server-mock
// hands the header to the real `searchEntryRealms`, which emits the line. Only
// the prerender context flag is simulated (the host normally sets it inside a
// prerender tab).

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
    async () => await loader.import('@cardstack/base/card-api'),
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
    // Drain before teardown so the teardown flush has nothing to put on the
    // network, and so no interval or observer an armed instrument installed
    // leaks into the next test.
    let telemetry = getService('client-telemetry') as ClientTelemetryService;
    telemetry.drainBufferForTest();
    telemetry.teardown();
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

  test('a live search stamps a correlation id and records it on a server-request event', async function (assert) {
    let store = getService('store') as StoreService;
    let network = getService('network') as NetworkService;
    let telemetry = getService('client-telemetry') as ClientTelemetryService;

    // On live traffic the id rides on the client-telemetry timing middleware,
    // so the id on the wire and the `server-request` event carrying it arrive
    // together. Arming the instrument is what a browser does at boot; under
    // tests it stays dormant unless a test opts in.
    telemetry.enableForTest();
    telemetry.drainBufferForTest();

    let timingLines: string[] = [];
    setSearchTimingSinkForTests((line) => timingLines.push(line));

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

    try {
      // No __boxelRenderContext: this is the live SPA path, the one a user's
      // search takes.
      let results = await store.search(personQuery, [testRealmURL]);
      await settled();

      assert.strictEqual(results.length, 2, 'the search returned both people');
      assert.strictEqual(
        sentRequestIds.length,
        1,
        'the live search stamped exactly one correlation id on its _federated-search fetch',
      );
      let sentId = sentRequestIds[0];

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

      let searchEvents = telemetry
        .drainBufferForTest()
        .filter(
          (event): event is ServerRequestEvent =>
            event.event_type === 'server-request' &&
            (event as ServerRequestEvent).endpoint === '_federated-search',
        );
      assert.strictEqual(
        searchEvents.length,
        1,
        'and the client recorded one server-request event for the search',
      );
      assert.strictEqual(
        searchEvents[0].method,
        'QUERY',
        'carrying the method the endpoint is called with',
      );
      assert.strictEqual(
        searchEvents[0].status,
        200,
        'the status the server answered',
      );
      assert.strictEqual(
        searchEvents[0].correlation_id,
        sentId,
        'and the same id that went on the wire, so the two ends join',
      );
    } finally {
      network.virtualNetwork.unmount(spy);
    }
  });

  test('a search stamps no id while the telemetry instrument is dormant', async function (assert) {
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

    // Neither mechanism is in play: no __boxelRenderContext, and the
    // client-telemetry instrument is unarmed. A search then pays nothing for
    // correlation and the server has no id to key a timing line on.
    let results = await store.search(personQuery, [testRealmURL]);
    await settled();

    assert.strictEqual(results.length, 2, 'the search still returns results');
    assert.false(sawHeader, 'no x-boxel-logging-correlation-id header is sent');
    assert.strictEqual(
      timingLines.length,
      0,
      'no realm:search-timing line is emitted without a correlation id',
    );
  });
});
