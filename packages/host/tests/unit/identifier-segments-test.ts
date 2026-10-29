import { module, test } from 'qunit';

import {
  codeRefWithAbsoluteIdentifier,
  decodedLastSegmentOfIdentifier,
  extensionOfIdentifier,
  lastSegmentOfIdentifier,
  nameWithoutExtension,
  rri,
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

  test('a realm root has no last segment in either form', function (assert) {
    assert.strictEqual(
      lastSegmentOfIdentifier('https://realms.example.test'),
      '',
    );
    assert.strictEqual(
      lastSegmentOfIdentifier('https://realms.example.test/'),
      '',
    );
    assert.strictEqual(lastSegmentOfIdentifier('@cardstack/catalog'), '');
    assert.strictEqual(lastSegmentOfIdentifier('@cardstack/catalog/'), '');
    assert.strictEqual(lastSegmentOfIdentifier(''), '');
  });

  test('the decoded last segment falls back to the raw one', function (assert) {
    assert.strictEqual(
      decodedLastSegmentOfIdentifier('@cardstack/catalog/my%20notes.md'),
      'my notes.md',
    );
    assert.strictEqual(
      decodedLastSegmentOfIdentifier('https://realms.example.test/r/bad%E0.md'),
      'bad%E0.md',
    );
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
    assert.strictEqual(
      extensionOfIdentifier('https://realms.example.test/r/notes.md/'),
      '',
      'a trailing slash names a directory',
    );
  });

  test('a name without its extension keeps a dotfile whole', function (assert) {
    assert.strictEqual(nameWithoutExtension('todo.md'), 'todo');
    assert.strictEqual(nameWithoutExtension('archive.tar.gz'), 'archive.tar');
    assert.strictEqual(nameWithoutExtension('.gitignore'), '.gitignore');
    assert.strictEqual(nameWithoutExtension('README'), 'README');
  });

  test('a relative tool module joins against a skill id in either form', function (assert) {
    let ref = { module: rri('./my-tool'), name: 'MyTool' };
    assert.deepEqual(
      codeRefWithAbsoluteIdentifier(
        ref,
        rri('@cardstack/skills/my-skill/SKILL.md'),
        undefined,
      ),
      { module: rri('@cardstack/skills/my-skill/my-tool'), name: 'MyTool' },
    );
    assert.deepEqual(
      codeRefWithAbsoluteIdentifier(
        ref,
        rri('https://realms.example.test/skills/my-skill/SKILL.md'),
        undefined,
      ),
      {
        module: rri('https://realms.example.test/skills/my-skill/my-tool'),
        name: 'MyTool',
      },
    );
  });
});
