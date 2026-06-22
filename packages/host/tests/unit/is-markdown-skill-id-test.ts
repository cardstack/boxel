import { module, test } from 'qunit';

import { isMarkdownSkillId } from '@cardstack/host/lib/skill-commands';

// `isMarkdownSkillId` drives the load-type dispatch for skills: a true result
// loads through the `file-meta` read type, false loads as a card. Lock the
// contract so the URL-parsing fallback and case-insensitive extension match
// don't silently shift under a future "simplification."
module('Unit | isMarkdownSkillId', function () {
  test('a URL ending in .md is a markdown skill id', function (assert) {
    assert.true(isMarkdownSkillId('http://test-realm/foo/realm-sync/SKILL.md'));
  });

  test('a URL ending in .markdown is a markdown skill id', function (assert) {
    assert.true(isMarkdownSkillId('http://test-realm/foo/notes.markdown'));
  });

  test('the extension match is case-insensitive', function (assert) {
    assert.true(isMarkdownSkillId('http://test-realm/foo/SKILL.MD'));
    assert.true(isMarkdownSkillId('http://test-realm/foo/Notes.Markdown'));
  });

  test('a skill card id (no extension) is not a markdown skill id', function (assert) {
    assert.false(isMarkdownSkillId('http://test-realm/Skill/example'));
  });

  test('a non-markdown file extension is not a markdown skill id', function (assert) {
    assert.false(isMarkdownSkillId('http://test-realm/foo/card.json'));
    assert.false(isMarkdownSkillId('http://test-realm/foo/code.gts'));
  });

  test('an .md segment in the middle of the path does not match', function (assert) {
    assert.false(
      isMarkdownSkillId('http://test-realm/foo.md/not-actually-markdown'),
    );
  });

  test('a query string or hash does not defeat the extension match', function (assert) {
    assert.true(
      isMarkdownSkillId('http://test-realm/foo/SKILL.md?v=1'),
      'query string after the pathname',
    );
    assert.true(
      isMarkdownSkillId('http://test-realm/foo/SKILL.md#section'),
      'hash fragment after the pathname',
    );
  });

  test('a non-URL string ending in .md falls back to raw matching', function (assert) {
    // `new URL('relative/path.md')` throws; the implementation falls back to
    // matching the raw string so relative/bare ids still classify correctly.
    assert.true(isMarkdownSkillId('relative/path.md'));
    assert.true(isMarkdownSkillId('SKILL.md'));
  });

  test('a non-URL string without a markdown extension is not a markdown skill id', function (assert) {
    assert.false(isMarkdownSkillId('relative/path'));
    assert.false(isMarkdownSkillId('Skill/example'));
  });
});
