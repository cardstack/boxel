import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import hostRouteResolverTests from '@cardstack/runtime-common/tests/host-route-resolver-test';

module(basename(import.meta.filename), function () {
  test('resolveHostRoute: a card id template loads its card by id', async function (assert) {
    await runSharedTest(hostRouteResolverTests, assert, {});
  });

  test('resolveHostRoute: a percent-encoded segment is decoded once', async function (assert) {
    await runSharedTest(hostRouteResolverTests, assert, {});
  });

  test('resolveHostRoute: a trailing slash is ignored and a malformed path matches nothing', async function (assert) {
    await runSharedTest(hostRouteResolverTests, assert, {});
  });

  test('resolveHostRoute: a field match searches with one eq per field and the where', async function (assert) {
    await runSharedTest(hostRouteResolverTests, assert, {});
  });

  test('resolveHostRoute: literal segments go before :name segments', async function (assert) {
    await runSharedTest(hostRouteResolverTests, assert, {});
  });

  test('resolveHostRoute: a route that matches only a prefix does not hide a literal sibling', async function (assert) {
    await runSharedTest(hostRouteResolverTests, assert, {});
  });

  test('resolveHostRoute: the order of siblings with different patterns does not depend on the list order', async function (assert) {
    await runSharedTest(hostRouteResolverTests, assert, {});
  });

  test('resolveHostRoute: a miss or an unreadable card falls through to the next sibling', async function (assert) {
    await runSharedTest(hostRouteResolverTests, assert, {});
  });

  test('resolveHostRoute: a failed lookup is an error, not a miss', async function (assert) {
    await runSharedTest(hostRouteResolverTests, assert, {});
  });

  test('resolveHostRoute: a child route resolves within its parent card (link on the child)', async function (assert) {
    await runSharedTest(hostRouteResolverTests, assert, {});
  });

  test('resolveHostRoute: a child route resolves within its parent card (link on the parent)', async function (assert) {
    await runSharedTest(hostRouteResolverTests, assert, {});
  });

  test('resolveHostRoute: a card id template under a dynamic route', async function (assert) {
    await runSharedTest(hostRouteResolverTests, assert, {});
  });

  test('resolveHostRoute: once a level resolves, a child miss is nothing', async function (assert) {
    await runSharedTest(hostRouteResolverTests, assert, {});
  });

  test('resolveHostRoute: a child of a fixed route needs no link', async function (assert) {
    await runSharedTest(hostRouteResolverTests, assert, {});
  });

  test('resolveHostRoute: a redirect copies :name values without a lookup', async function (assert) {
    await runSharedTest(hostRouteResolverTests, assert, {});
  });

  test('resolveHostRoute: an alias route resolves its card and leaves the canonical address to the caller', async function (assert) {
    await runSharedTest(hostRouteResolverTests, assert, {});
  });

  test('resolveHostRoute: the result must be in the routing realm', async function (assert) {
    await runSharedTest(hostRouteResolverTests, assert, {});
  });
});
