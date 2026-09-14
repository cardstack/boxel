import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import http from 'http';
import { withLoadBalancerKeepAlive } from '../server.ts';

module(basename(import.meta.filename), function () {
  module('load-balancer keep-alive', function () {
    test('an idle connection outlives the load balancer that pools it', function (assert) {
      let server = withLoadBalancerKeepAlive(http.createServer());
      try {
        // The balancer in front of the hosted deployments allows 4000s.
        // Anything at or below that leaves the reuse race open: it sends on a
        // connection this server has already closed, and answers 502 with a
        // body of its own making.
        assert.true(
          server.keepAliveTimeout > 4000 * 1000,
          `keepAliveTimeout outlasts a 4000s balancer idle timeout (got ${server.keepAliveTimeout}ms)`,
        );
        // Node's default is 5s, which is what leaves the race open.
        assert.notStrictEqual(
          server.keepAliveTimeout,
          5000,
          'not left at the Node default',
        );
      } finally {
        server.close();
      }
    });

    test('the header and whole-request deadlines are left alone', function (assert) {
      let server = withLoadBalancerKeepAlive(http.createServer());
      try {
        // Raising `headersTimeout` past `requestTimeout` does not extend the
        // header deadline: Node swaps them when headers is the larger, so the
        // only effect is to stretch the whole-request timeout — here from five
        // minutes to over an hour. Leaving both at their defaults keeps that
        // relationship intact.
        assert.true(
          server.headersTimeout <= server.requestTimeout,
          `headersTimeout (${server.headersTimeout}ms) stays within requestTimeout (${server.requestTimeout}ms)`,
        );
        assert.strictEqual(
          server.requestTimeout,
          new http.Server().requestTimeout,
          'the whole-request deadline is untouched',
        );
      } finally {
        server.close();
      }
    });
  });
});
