import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import hostRoutesTests from '@cardstack/runtime-common/tests/host-routes-test';

module(basename(import.meta.filename), function () {
  test('validateHostRoutes: the fixed routing map is what it was', async function (assert) {
    await runSharedTest(hostRoutesTests, assert, {});
  });

  test('validateHostRoutes: each route has exactly one form', async function (assert) {
    await runSharedTest(hostRoutesTests, assert, {});
  });

  test('validateHostRoutes: a card id template keeps its parsed patterns', async function (assert) {
    await runSharedTest(hostRoutesTests, assert, {});
  });

  test('validateHostRoutes: a card pattern needs a :name from the path', async function (assert) {
    await runSharedTest(hostRoutesTests, assert, {});
  });

  test('validateHostRoutes: a redirect target uses only names from its path', async function (assert) {
    await runSharedTest(hostRoutesTests, assert, {});
  });

  test('validateHostRoutes: a field match names a card type', async function (assert) {
    await runSharedTest(hostRoutesTests, assert, {});
  });

  test('validateHostRoutes: each :name is matched by exactly one field', async function (assert) {
    await runSharedTest(hostRoutesTests, assert, {});
  });

  test('validateHostRoutes: where must be client-evaluable', async function (assert) {
    await runSharedTest(hostRoutesTests, assert, {});
  });

  test('validateHostRoutes: a child route infers its one link to its parent', async function (assert) {
    await runSharedTest(hostRoutesTests, assert, {});
  });

  test('validateHostRoutes: two links between the types need parent', async function (assert) {
    await runSharedTest(hostRoutesTests, assert, {});
  });

  test('validateHostRoutes: a link on its own type is read by its kind', async function (assert) {
    await runSharedTest(hostRoutesTests, assert, {});
  });

  test('validateHostRoutes: a child with no link to its parent is dropped', async function (assert) {
    await runSharedTest(hostRoutesTests, assert, {});
  });

  test('validateHostRoutes: a card id template under a dynamic route', async function (assert) {
    await runSharedTest(hostRoutesTests, assert, {});
  });

  test('validateHostRoutes: a child of a fixed route needs no link', async function (assert) {
    await runSharedTest(hostRoutesTests, assert, {});
  });

  test('validateHostRoutes: fixed routes cannot have :name segments', async function (assert) {
    await runSharedTest(hostRoutesTests, assert, {});
  });

  test('validateHostRoutes: a dropped route drops its children', async function (assert) {
    await runSharedTest(hostRoutesTests, assert, {});
  });

  test('validateHostRoutes: route names are unique in the realm', async function (assert) {
    await runSharedTest(hostRoutesTests, assert, {});
  });

  test('validateHostRoutes: two fixed routes cannot share a path', async function (assert) {
    await runSharedTest(hostRoutesTests, assert, {});
  });

  test('validateHostRoutes: at most 20 dynamic routes', async function (assert) {
    await runSharedTest(hostRoutesTests, assert, {});
  });

  test('validateHostRoutes: warns when one card gets no address', async function (assert) {
    await runSharedTest(hostRoutesTests, assert, {});
  });

  test('validateHostRoutes: match takes primitive fields only', async function (assert) {
    await runSharedTest(hostRoutesTests, assert, {});
  });

  test('validateHostRoutes: an unavailable type makes the validation incomplete', async function (assert) {
    await runSharedTest(hostRoutesTests, assert, {});
  });
});
