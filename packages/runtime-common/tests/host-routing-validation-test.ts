import {
  findDuplicateRoutingPaths,
  validateRoutingPath,
} from '../host-routing-validation.ts';
import type { SharedTests } from '../helpers/index.ts';

const INVALID_CHARS_MSG =
  'Path may only contain letters, numbers, /, -, _, ., ~, or %XX-encoded characters';
const MISSING_SLASH_MSG = 'Path must start with /';

const tests: SharedTests<unknown> = Object.freeze({
  'validateRoutingPath: no warning for empty or whitespace paths': async (
    assert,
  ) => {
    assert.strictEqual(validateRoutingPath(null), undefined);
    assert.strictEqual(validateRoutingPath(undefined), undefined);
    assert.strictEqual(validateRoutingPath(''), undefined);
    assert.strictEqual(validateRoutingPath('   '), undefined);
  },

  'validateRoutingPath: warns when path is missing the leading slash': async (
    assert,
  ) => {
    assert.strictEqual(validateRoutingPath('docs'), MISSING_SLASH_MSG);
    assert.strictEqual(validateRoutingPath('foo/bar'), MISSING_SLASH_MSG);
  },

  'validateRoutingPath: accepts paths in the unreserved character set': async (
    assert,
  ) => {
    assert.strictEqual(validateRoutingPath('/'), undefined);
    assert.strictEqual(validateRoutingPath('/docs'), undefined);
    assert.strictEqual(validateRoutingPath('/blog/posts/2024-01'), undefined);
    assert.strictEqual(validateRoutingPath('/foo_bar.html'), undefined);
    assert.strictEqual(validateRoutingPath('/api/v1/~me'), undefined);
  },

  'validateRoutingPath: warns when path contains disallowed characters': async (
    assert,
  ) => {
    assert.strictEqual(validateRoutingPath('/foo bar'), INVALID_CHARS_MSG);
    assert.strictEqual(validateRoutingPath('/foo?baz=1'), INVALID_CHARS_MSG);
    assert.strictEqual(validateRoutingPath('/foo:1'), INVALID_CHARS_MSG);
    assert.strictEqual(validateRoutingPath('/<docs>'), INVALID_CHARS_MSG);
  },

  'validateRoutingPath: accepts well-formed percent-encoded sequences': async (
    assert,
  ) => {
    assert.strictEqual(validateRoutingPath('/foo%20bar'), undefined);
    assert.strictEqual(validateRoutingPath('/foo%2Fbar'), undefined);
    assert.strictEqual(validateRoutingPath('/%C3%A9'), undefined);
  },

  'validateRoutingPath: warns on malformed percent-encoded sequences': async (
    assert,
  ) => {
    assert.strictEqual(validateRoutingPath('/foo%'), INVALID_CHARS_MSG);
    assert.strictEqual(validateRoutingPath('/foo%2'), INVALID_CHARS_MSG);
    assert.strictEqual(validateRoutingPath('/foo%2g'), INVALID_CHARS_MSG);
    assert.strictEqual(validateRoutingPath('/foo%gg'), INVALID_CHARS_MSG);
  },

  'validateRoutingPath: advises when the path has a trailing slash': async (
    assert,
  ) => {
    assert.strictEqual(
      validateRoutingPath('/pricing/'),
      'Trailing slash is ignored; this route matches "/pricing"',
    );
    assert.strictEqual(
      validateRoutingPath('/blog/posts/'),
      'Trailing slash is ignored; this route matches "/blog/posts"',
    );
    // Trimmed before checking, so trailing whitespace after the slash
    // still warns and normalizes correctly.
    assert.strictEqual(
      validateRoutingPath('  /docs/  '),
      'Trailing slash is ignored; this route matches "/docs"',
    );
    // The realm root's slash is the root itself, not a trailing slash.
    assert.strictEqual(validateRoutingPath('/'), undefined);
  },

  'validateRoutingPath: trims surrounding whitespace before validating': async (
    assert,
  ) => {
    assert.strictEqual(validateRoutingPath('  /docs  '), undefined);
    assert.strictEqual(validateRoutingPath('  docs  '), MISSING_SLASH_MSG);
  },

  'findDuplicateRoutingPaths: returns empty when there are no rules': async (
    assert,
  ) => {
    assert.deepEqual(findDuplicateRoutingPaths(null), []);
    assert.deepEqual(findDuplicateRoutingPaths(undefined), []);
    assert.deepEqual(findDuplicateRoutingPaths([]), []);
  },

  'findDuplicateRoutingPaths: returns empty when no paths repeat': async (
    assert,
  ) => {
    assert.deepEqual(
      findDuplicateRoutingPaths([
        { path: '/' },
        { path: '/docs' },
        { path: '/pricing' },
      ]),
      [],
    );
  },

  'findDuplicateRoutingPaths: reports each duplicate path exactly once': async (
    assert,
  ) => {
    assert.deepEqual(
      findDuplicateRoutingPaths([
        { path: '/docs' },
        { path: '/pricing' },
        { path: '/docs' },
        { path: '/docs' },
        { path: '/pricing' },
      ]),
      ['/docs', '/pricing'],
    );
  },

  'findDuplicateRoutingPaths: ignores empty paths so unfilled rules do not flag':
    async (assert) => {
      assert.deepEqual(
        findDuplicateRoutingPaths([
          { path: '' },
          { path: '   ' },
          { path: null },
          { path: undefined },
          { path: '/docs' },
        ]),
        [],
      );
    },

  'findDuplicateRoutingPaths: treats surrounding whitespace as equivalent':
    async (assert) => {
      assert.deepEqual(
        findDuplicateRoutingPaths([
          { path: '/docs' },
          { path: '  /docs' },
          { path: '/docs  ' },
        ]),
        ['/docs'],
      );
    },
});

export default tests;
