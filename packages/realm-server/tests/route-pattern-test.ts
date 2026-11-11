import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import routePatternTests from '@cardstack/runtime-common/tests/route-pattern-test';

module(basename(import.meta.filename), function () {
  test('parseRoutePathPattern: parses literal and param segments', async function (assert) {
    await runSharedTest(routePatternTests, assert, {});
  });

  test('parseRoutePathPattern: rejects each invalid pattern with a structured error', async function (assert) {
    await runSharedTest(routePatternTests, assert, {});
  });

  test('parseRoutePathPattern: names must be unique including the parents’ names', async function (assert) {
    await runSharedTest(routePatternTests, assert, {});
  });

  test('splitRequestPath: splits, decodes, and handles slashes', async function (assert) {
    await runSharedTest(routePatternTests, assert, {});
  });

  test('matchRoutePathPattern: matches literals and params segment by segment', async function (assert) {
    await runSharedTest(routePatternTests, assert, {});
  });

  test('matchRoutePathPattern: a param matches one non-empty segment', async function (assert) {
    await runSharedTest(routePatternTests, assert, {});
  });

  test('matchRoutePathPattern: values are percent-decoded', async function (assert) {
    await runSharedTest(routePatternTests, assert, {});
  });

  test('matchRoutePathPattern: a trailing slash on the request is ignored', async function (assert) {
    await runSharedTest(routePatternTests, assert, {});
  });

  test('matchPatternSegments: matches from an offset for nested routes', async function (assert) {
    await runSharedTest(routePatternTests, assert, {});
  });

  test('fillRoutePathPattern: fills params with the canonical encoding', async function (assert) {
    await runSharedTest(routePatternTests, assert, {});
  });

  test('fillRoutePathPattern: refuses missing, empty, dot and malformed values', async function (assert) {
    await runSharedTest(routePatternTests, assert, {});
  });

  test('encodeRouteSegment: encodes everything but the unreserved set', async function (assert) {
    await runSharedTest(routePatternTests, assert, {});
  });

  test('round trip: path fill then match gives the values back', async function (assert) {
    await runSharedTest(routePatternTests, assert, {});
  });

  test('round trip: path match then fill gives the canonical path back', async function (assert) {
    await runSharedTest(routePatternTests, assert, {});
  });

  test('parseCardIdPattern: parses a realm-relative pattern', async function (assert) {
    await runSharedTest(routePatternTests, assert, {});
  });

  test('parseCardIdPattern: rejects patterns that are not anchored at the realm or are invalid', async function (assert) {
    await runSharedTest(routePatternTests, assert, {});
  });

  test('matchCardIdPattern: turns a card id into params', async function (assert) {
    await runSharedTest(routePatternTests, assert, {});
  });

  test('matchCardIdPattern: a card id that does not fit is no match', async function (assert) {
    await runSharedTest(routePatternTests, assert, {});
  });

  test('fillCardIdPattern: builds a card id under the realm', async function (assert) {
    await runSharedTest(routePatternTests, assert, {});
  });

  test('round trip: card id fill then match, and match then fill', async function (assert) {
    await runSharedTest(routePatternTests, assert, {});
  });

  test('round trip: a path match fills a card id and back', async function (assert) {
    await runSharedTest(routePatternTests, assert, {});
  });
});
