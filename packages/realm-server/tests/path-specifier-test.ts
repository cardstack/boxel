import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import pathSpecifierTests from '@cardstack/runtime-common/tests/path-specifier-test';

module(basename(import.meta.filename), function () {
  test('parsePathPrefix: parses a directory, a file and the whole realm', async function (assert) {
    await runSharedTest(pathSpecifierTests, assert, {});
  });

  test('parsePathPrefix: a leading slash is optional, a trailing slash makes a directory', async function (assert) {
    await runSharedTest(pathSpecifierTests, assert, {});
  });

  test('parsePathPrefix: decodes percent-escapes once, with decodeURI', async function (assert) {
    await runSharedTest(pathSpecifierTests, assert, {});
  });

  test('parsePathPrefix: refuses each invalid prefix with a structured error', async function (assert) {
    await runSharedTest(pathSpecifierTests, assert, {});
  });

  test('parsePathPrefix: an error names the prefix and the offending segment', async function (assert) {
    await runSharedTest(pathSpecifierTests, assert, {});
  });

  test('parsePathSpecifier: an empty list is valid and means no path limit', async function (assert) {
    await runSharedTest(pathSpecifierTests, assert, {});
  });

  test('parsePathSpecifier: one invalid prefix makes the whole specifier invalid', async function (assert) {
    await runSharedTest(pathSpecifierTests, assert, {});
  });

  test('pathSpecifierMatches: a directory covers itself and everything in it', async function (assert) {
    await runSharedTest(pathSpecifierTests, assert, {});
  });

  test('pathSpecifierMatches: blog/ never matches blog-old/ or blog.json', async function (assert) {
    await runSharedTest(pathSpecifierTests, assert, {});
  });

  test('pathSpecifierMatches: a file prefix covers exactly that file', async function (assert) {
    await runSharedTest(pathSpecifierTests, assert, {});
  });

  test('pathSpecifierMatches: kind decides, and a trailing slash does not', async function (assert) {
    await runSharedTest(pathSpecifierTests, assert, {});
  });

  test('pathSpecifierMatches: matches paths as RealmPaths.local resolves them', async function (assert) {
    await runSharedTest(pathSpecifierTests, assert, {});
  });

  test('pathSpecifierMatches: / covers the whole realm', async function (assert) {
    await runSharedTest(pathSpecifierTests, assert, {});
  });

  test('pathSpecifierMatches: a list matches a path under any of its prefixes', async function (assert) {
    await runSharedTest(pathSpecifierTests, assert, {});
  });

  test('pathSpecifierMatches: compares segments case-sensitively, with no Unicode normalization', async function (assert) {
    await runSharedTest(pathSpecifierTests, assert, {});
  });

  test('pathSpecifierMatches: compares decoded segments', async function (assert) {
    await runSharedTest(pathSpecifierTests, assert, {});
  });

  test('pathSpecifierMatches: a malformed path matches nothing', async function (assert) {
    await runSharedTest(pathSpecifierTests, assert, {});
  });

  test('pathPrefixMatches: matches one prefix', async function (assert) {
    await runSharedTest(pathSpecifierTests, assert, {});
  });

  test('path-specifier serializer: reads back a list exactly as written', async function (assert) {
    await runSharedTest(pathSpecifierTests, assert, {});
  });

  test('path-specifier serializer: reads null as absent', async function (assert) {
    await runSharedTest(pathSpecifierTests, assert, {});
  });

  test('path-specifier serializer: refuses a malformed value', async function (assert) {
    await runSharedTest(pathSpecifierTests, assert, {});
  });

  test('path-specifier serializer: is registered by name', async function (assert) {
    await runSharedTest(pathSpecifierTests, assert, {});
  });
});
