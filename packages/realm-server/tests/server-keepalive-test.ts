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
        // The ALB in front of the hosted deployments is configured at 4000s.
        // Anything at or below that leaves the reuse race open: the balancer
        // sends on a connection this server has already closed, and answers
        // 502 with an HTML body the caller never asked for.
        assert.true(
          server.keepAliveTimeout > 4000 * 1000,
          `keepAliveTimeout outlasts a 4000s load-balancer idle timeout (got ${server.keepAliveTimeout}ms)`,
        );
        // Node's default is 5s, which is the state that produced the outage.
        assert.notStrictEqual(
          server.keepAliveTimeout,
          5000,
          'not left at the Node default',
        );
      } finally {
        server.close();
      }
    });

    test('headers are judged after the connection may be reused, not before', function (assert) {
      let server = withLoadBalancerKeepAlive(http.createServer());
      try {
        // `headersTimeout` below `keepAliveTimeout` reintroduces the same race
        // one layer up: a connection held open for reuse whose request headers
        // are then judged late.
        assert.true(
          server.headersTimeout > server.keepAliveTimeout,
          `headersTimeout (${server.headersTimeout}ms) exceeds keepAliveTimeout (${server.keepAliveTimeout}ms)`,
        );
      } finally {
        server.close();
      }
    });
  });
});
