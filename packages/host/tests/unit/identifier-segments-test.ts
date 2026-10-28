import { module, test } from 'qunit';

import {
  extensionOfIdentifier,
  lastSegmentOfIdentifier,
} from '@cardstack/runtime-common';

module('Unit | identifier segments', function () {
  test('the last segment is the same in either form', function (assert) {
    assert.strictEqual(
      lastSegmentOfIdentifier('https://realms.example.test/r/notes/todo.md'),
      'todo.md',
    );
    assert.strictEqual(
      lastSegmentOfIdentifier('@cardstack/catalog/notes/todo.md'),
      'todo.md',
    );
    assert.strictEqual(lastSegmentOfIdentifier('./notes/todo.md'), 'todo.md');
  });

  test('the last segment ignores a query, a fragment and a trailing slash', function (assert) {
    assert.strictEqual(
      lastSegmentOfIdentifier('https://realms.example.test/r/data.csv?v=1#top'),
      'data.csv',
    );
    assert.strictEqual(
      lastSegmentOfIdentifier('@cardstack/catalog/notes/'),
      'notes',
    );
  });

  test('a URL with no path has no last segment', function (assert) {
    assert.strictEqual(
      lastSegmentOfIdentifier('https://realms.example.test'),
      '',
    );
    assert.strictEqual(
      lastSegmentOfIdentifier('https://realms.example.test/'),
      '',
    );
    assert.strictEqual(lastSegmentOfIdentifier(''), '');
  });

  test('the extension comes from the last segment only', function (assert) {
    assert.strictEqual(
      extensionOfIdentifier('@cardstack/catalog/v1.2/readme'),
      '',
      'a dot in a directory name is not an extension',
    );
    assert.strictEqual(
      extensionOfIdentifier('@cardstack/catalog/v1.2/readme.md'),
      '.md',
    );
    assert.strictEqual(
      extensionOfIdentifier('https://realms.example.test/r/Data.CSV'),
      '.csv',
    );
    assert.strictEqual(
      extensionOfIdentifier('https://realms.example.test/r/.gitignore'),
      '',
      'a leading dot names a file, not an extension',
    );
  });
});
