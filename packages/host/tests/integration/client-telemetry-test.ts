import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type ClientTelemetryService from '@cardstack/host/services/client-telemetry';

import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

// The instrument is gated off under `isTesting()` and only arms when a test
// opts in via `enableForTest()`. These tests drive its public emit API and
// assert the event shapes the realm-server ingest + Grafana dashboard depend
// on, without relying on the flush timer, a session token, or the network.
module('Integration | Service | client-telemetry', function (hooks) {
  setupRenderingTest(hooks);
  setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    autostart: true,
  });

  function telemetry(): ClientTelemetryService {
    return getService('client-telemetry') as ClientTelemetryService;
  }

  hooks.afterEach(function () {
    // Every test arms the instrument; make sure it is torn down so no interval
    // or observer leaks into the next test.
    telemetry().teardown();
  });

  test('is disabled under tests until explicitly opted in', function (assert) {
    let svc = telemetry();
    assert.false(svc.isEnabled, 'dormant under isTesting() by default');
    svc.enableForTest();
    assert.true(svc.isEnabled, 'armed after enableForTest()');
  });

  test('records a server-request event with a normalized endpoint', function (assert) {
    let svc = telemetry();
    svc.enableForTest();
    svc.drainBufferForTest();

    let req = new Request('https://realm.example/my-realm/_search', {
      method: 'POST',
    });
    let res = new Response('{}', {
      status: 200,
      headers: {
        'content-length': '2',
        'x-boxel-realm-url': 'https://realm.example/my-realm/',
      },
    });
    svc.recordServerRequestTiming(req, res, 42.7, true);

    let events = svc.drainBufferForTest();
    assert.strictEqual(events.length, 1, 'one event buffered');
    let e = events[0] as any;
    assert.strictEqual(e.event_type, 'server-request');
    assert.strictEqual(e.endpoint, '_search', 'underscore endpoint collapses');
    assert.strictEqual(e.method, 'POST');
    assert.strictEqual(e.status, 200);
    assert.strictEqual(e.duration_ms, 43, 'duration is rounded');
    assert.strictEqual(e.resp_bytes, 2);
    assert.true(e.retried, 'retried flag carried through');
    assert.strictEqual(e.realm, 'https://realm.example/my-realm/');
    assert.strictEqual(typeof e.ts, 'number', 'timestamp stamped');
  });

  test('normalizes a card GET to a low-cardinality label', function (assert) {
    let svc = telemetry();
    svc.enableForTest();
    svc.drainBufferForTest();
    svc.recordServerRequestTiming(
      new Request('https://realm.example/my-realm/Person/abc123', {
        method: 'GET',
      }),
      new Response(null, { status: 200 }),
      10,
      false,
    );
    let e = svc.drainBufferForTest()[0] as any;
    assert.strictEqual(
      e.endpoint,
      'GET card',
      'an instance id collapses to "GET card" (no per-id cardinality)',
    );
  });

  test('records a deserialize event with doc size and card type', function (assert) {
    let svc = telemetry();
    svc.enableForTest();
    svc.drainBufferForTest();

    let doc = { data: { id: 'x' }, included: [{}, {}] };
    svc.recordDeserialize({
      durationMs: 12.2,
      doc,
      resource: {
        meta: {
          adoptsFrom: {
            module: 'https://realm.example/my-realm/person',
            name: 'Person',
          },
          realmURL: 'https://realm.example/my-realm/',
        },
      } as any,
    });

    let e = svc.drainBufferForTest()[0] as any;
    assert.strictEqual(e.event_type, 'deserialize');
    assert.strictEqual(e.duration_ms, 12);
    assert.strictEqual(e.included_count, 2);
    assert.strictEqual(e.card_type, 'Person');
    assert.strictEqual(e.realm, 'https://realm.example/my-realm/');
    assert.ok(e.doc_bytes > 0, 'doc size measured');
  });

  test('a recorded event carries the wedge breadcrumb shape', function (assert) {
    let svc = telemetry();
    svc.enableForTest();
    svc.drainBufferForTest();
    svc.recordEvent({
      event_type: 'wedge',
      duration_ms: 3000,
      worst_gap_ms: 3000,
      blocked_ms: 2900,
      longtask_count: 4,
      top_frame_function: 'compute',
      top_frame_url: 'https://realm.example/my-realm/person',
      top_frame_char: 120,
      top_frame_blocked_ms: 2800,
      top_frames: 'compute @ https://realm.example/my-realm/person:120',
      loaf_scripts: [
        {
          source_url: 'https://realm.example/my-realm/person',
          function_name: 'compute',
          char_position: 120,
          invoker: 'classAttribute',
          blocking_duration_ms: 2800,
        },
      ],
    });
    let e = svc.drainBufferForTest()[0] as any;
    assert.strictEqual(e.event_type, 'wedge');
    assert.strictEqual(e.blocked_ms, 2900);
    assert.strictEqual(
      e.top_frame_function,
      'compute',
      'the wedging frame is surfaced as a scalar field',
    );
    assert.strictEqual(e.loaf_scripts[0].function_name, 'compute');
  });

  test('teardown disarms the instrument and drops further events', function (assert) {
    let svc = telemetry();
    svc.enableForTest();
    assert.true(svc.isEnabled);
    svc.teardown();
    assert.false(svc.isEnabled, 'disarmed after teardown');
    svc.recordEvent({
      event_type: 'keepalive',
      window_ms: 1,
      max_gap_ms: 0,
    });
    assert.strictEqual(
      svc.drainBufferForTest().length,
      0,
      'recordEvent is a no-op once disarmed',
    );
  });
});
