import { module, test } from 'qunit';
import { basename } from 'path';
import { isJsonContentType } from '@cardstack/runtime-common';

module(basename(import.meta.filename), function () {
  test('accepts application/json and JSON-suffix media types', function (assert) {
    assert.true(isJsonContentType('application/json'));
    assert.true(isJsonContentType('text/json'));
    assert.true(isJsonContentType('application/vnd.api+json'));
    assert.true(isJsonContentType('application/vnd.card+json'));
    assert.true(isJsonContentType('application/vnd.card.file-meta+json'));
  });

  test('ignores parameters and is case-insensitive', function (assert) {
    assert.true(isJsonContentType('application/json; charset=utf-8'));
    assert.true(isJsonContentType('APPLICATION/VND.API+JSON'));
    assert.true(isJsonContentType('  application/json  '));
  });

  test('rejects binary and other non-JSON media types', function (assert) {
    assert.false(isJsonContentType('image/jpeg'));
    assert.false(isJsonContentType('application/pdf'));
    assert.false(isJsonContentType('application/octet-stream'));
    assert.false(isJsonContentType('text/html'));
    // `+source` is a structured-suffix type but it is not JSON.
    assert.false(isJsonContentType('application/vnd.card+source'));
  });

  test('rejects a missing or empty content type', function (assert) {
    assert.false(isJsonContentType(null));
    assert.false(isJsonContentType(undefined));
    assert.false(isJsonContentType(''));
  });
});
