import {
  findDuplicateRoutingPaths,
  normalizeRoutingPath,
  parseRedirectStatusCode,
  validateRedirectTarget,
  validateRoutingPath,
} from '../host-routing-validation.ts';
import type { SharedTests } from '../helpers/index.ts';

const INVALID_CHARS_MSG =
  'Path may only contain letters, numbers, /, -, _, ., ~, or %XX-encoded characters';
const MISSING_SLASH_MSG = 'Path must start with /';
const INVALID_TARGET_MSG =
  'Redirect target must be a path starting with / or a full http(s) URL';
const PROTOCOL_RELATIVE_MSG =
  'Redirect target must start with a single /; use a full http(s) URL for an external target';

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

  'findDuplicateRoutingPaths: treats trailing-slash variants as the same route':
    async (assert) => {
      // The map normalizes both to '/pricing' and resolves via .find(), so
      // the second target would be silently unreachable; the editor must
      // flag the collision. Reported in normalized form.
      assert.deepEqual(
        findDuplicateRoutingPaths([
          { path: '/pricing' },
          { path: '/pricing/' },
        ]),
        ['/pricing'],
      );
      assert.deepEqual(
        findDuplicateRoutingPaths([{ path: '/docs/' }, { path: '/docs' }]),
        ['/docs'],
      );
      // Root variants collapse together too.
      assert.deepEqual(
        findDuplicateRoutingPaths([{ path: '/' }, { path: '//' }]),
        ['/'],
      );
      // A genuine non-colliding pair still reports nothing.
      assert.deepEqual(
        findDuplicateRoutingPaths([
          { path: '/pricing' },
          { path: '/pricing-2' },
        ]),
        [],
      );
    },

  'normalizeRoutingPath: strips trailing slashes and preserves the root':
    async (assert) => {
      assert.strictEqual(normalizeRoutingPath('/pricing/'), '/pricing');
      assert.strictEqual(normalizeRoutingPath('/pricing'), '/pricing');
      assert.strictEqual(normalizeRoutingPath('/a/b//'), '/a/b');
      assert.strictEqual(normalizeRoutingPath('/'), '/');
      assert.strictEqual(normalizeRoutingPath('//'), '/');
    },

  'validateRedirectTarget: no warning for empty or unset targets': async (
    assert,
  ) => {
    assert.strictEqual(validateRedirectTarget(null), undefined);
    assert.strictEqual(validateRedirectTarget(undefined), undefined);
    assert.strictEqual(validateRedirectTarget(''), undefined);
    assert.strictEqual(validateRedirectTarget('   '), undefined);
  },

  'validateRedirectTarget: accepts realm-relative paths, including query strings':
    async (assert) => {
      assert.strictEqual(validateRedirectTarget('/terms'), undefined);
      assert.strictEqual(validateRedirectTarget('/blog/2024/post'), undefined);
      assert.strictEqual(validateRedirectTarget('/terms?ref=tos'), undefined);
      assert.strictEqual(validateRedirectTarget('  /terms  '), undefined);
      assert.strictEqual(validateRedirectTarget('/'), undefined);
    },

  'validateRedirectTarget: accepts external http(s) URLs': async (assert) => {
    assert.strictEqual(
      validateRedirectTarget('https://example.com/page'),
      undefined,
    );
    assert.strictEqual(validateRedirectTarget('http://example.com'), undefined);
    assert.strictEqual(
      validateRedirectTarget('https://example.com/page?x=1#frag'),
      undefined,
    );
  },

  'validateRedirectTarget: warns on non-http(s) schemes': async (assert) => {
    assert.strictEqual(
      validateRedirectTarget('javascript:alert(1)'),
      INVALID_TARGET_MSG,
    );
    assert.strictEqual(
      validateRedirectTarget('data:text/html,hi'),
      INVALID_TARGET_MSG,
    );
    assert.strictEqual(
      validateRedirectTarget('mailto:someone@example.com'),
      INVALID_TARGET_MSG,
    );
  },

  'validateRedirectTarget: warns on slash-less and protocol-relative targets':
    async (assert) => {
      assert.strictEqual(validateRedirectTarget('terms'), INVALID_TARGET_MSG);
      assert.strictEqual(
        validateRedirectTarget('example.com/terms'),
        INVALID_TARGET_MSG,
      );
      // '//example.com/x' would otherwise resolve as the realm path
      // '/example.com/x' (leading slashes collapse), which is unlikely to
      // be what the author meant — steer them to a full URL.
      assert.strictEqual(
        validateRedirectTarget('//example.com/x'),
        PROTOCOL_RELATIVE_MSG,
      );
    },

  'parseRedirectStatusCode: coerces supported codes, rejects everything else':
    async (assert) => {
      assert.strictEqual(parseRedirectStatusCode(301), 301);
      assert.strictEqual(parseRedirectStatusCode(302), 302);
      assert.strictEqual(parseRedirectStatusCode(308), 308);
      assert.strictEqual(parseRedirectStatusCode('301'), 301);
      assert.strictEqual(parseRedirectStatusCode(' 308 '), 308);
      assert.strictEqual(parseRedirectStatusCode(307), undefined);
      assert.strictEqual(parseRedirectStatusCode(200), undefined);
      assert.strictEqual(parseRedirectStatusCode('perm'), undefined);
      assert.strictEqual(parseRedirectStatusCode(''), undefined);
      assert.strictEqual(parseRedirectStatusCode(null), undefined);
      assert.strictEqual(parseRedirectStatusCode(undefined), undefined);
    },
});

export default tests;
