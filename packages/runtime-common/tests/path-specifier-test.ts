import {
  parsePathPrefix,
  parsePathSpecifier,
  pathPrefixMatches,
  pathSpecifierMatches,
  type PathPrefix,
  type PathPrefixErrorCode,
  type PathSpecifier,
} from '../path-specifier.ts';
import * as PathSpecifierSerializer from '../serializers/path-specifier.ts';
import { getSerializer } from '../serializers/index.ts';
import type { SharedTests } from '../helpers/index.ts';

function prefix(source: string): PathPrefix {
  let result = parsePathPrefix(source);
  if (!result.ok) {
    throw new Error(`expected ${source} to parse: ${result.error.message}`);
  }
  return result.prefix;
}

function specifier(...sources: string[]): PathSpecifier {
  let result = parsePathSpecifier(sources);
  if (!result.ok) {
    throw new Error(
      `expected ${JSON.stringify(sources)} to parse: ${result.errors
        .map((e) => e.message)
        .join(' ')}`,
    );
  }
  return result.specifier;
}

function errorCode(source: string): PathPrefixErrorCode | undefined {
  let result = parsePathPrefix(source);
  return result.ok ? undefined : result.error.code;
}

async function deserialize(value: unknown): Promise<unknown> {
  return await PathSpecifierSerializer.deserialize.call({} as never, value);
}

const tests: SharedTests<unknown> = Object.freeze({
  'parsePathPrefix: parses a directory, a file and the whole realm': async (
    assert,
  ) => {
    assert.deepEqual(prefix('blog/'), {
      source: 'blog/',
      segments: ['blog'],
      directory: true,
      path: 'blog/',
    });
    assert.deepEqual(prefix('blog/post-1.json'), {
      source: 'blog/post-1.json',
      segments: ['blog', 'post-1.json'],
      directory: false,
      path: 'blog/post-1.json',
    });
    assert.deepEqual(prefix('/'), {
      source: '/',
      segments: [],
      directory: true,
      path: '',
    });
    assert.deepEqual(prefix('blog/drafts/').segments, ['blog', 'drafts']);
  },

  'parsePathPrefix: a leading slash is optional, a trailing slash makes a directory':
    async (assert) => {
      assert.deepEqual(prefix('/blog/'), {
        ...prefix('blog/'),
        source: '/blog/',
      });
      assert.deepEqual(prefix('/blog/post-1.json'), {
        ...prefix('blog/post-1.json'),
        source: '/blog/post-1.json',
      });
      assert.true(prefix('blog/').directory, 'blog/ is a directory');
      assert.false(prefix('blog').directory, 'blog is a file');
      assert.strictEqual(prefix('/blog').path, 'blog');
    },

  'parsePathPrefix: decodes percent-escapes once, with decodeURI': async (
    assert,
  ) => {
    assert.deepEqual(prefix('My%20Posts/').segments, ['My Posts']);
    assert.deepEqual(prefix('My Posts/').segments, ['My Posts']);
    assert.deepEqual(prefix('caf%C3%A9/').segments, ['café']);
    assert.deepEqual(prefix('café/').segments, ['café']);
    assert.deepEqual(prefix('100%25.json').segments, ['100%.json']);
    // `decodeURI` leaves the escapes of URL delimiters as they are, as it
    // does for the path of a file the realm stores.
    assert.deepEqual(prefix('a%2Fb/').segments, ['a%2Fb']);
    assert.deepEqual(prefix('a%3Fb/').segments, ['a%3Fb']);
    assert.strictEqual(prefix('My%20Posts/').source, 'My%20Posts/');
  },

  'parsePathPrefix: refuses each invalid prefix with a structured error':
    async (assert) => {
      let cases: [string, PathPrefixErrorCode][] = [
        ['', 'empty-prefix'],
        [' blog/', 'surrounding-whitespace'],
        ['blog/ ', 'surrounding-whitespace'],
        ['blog//drafts/', 'empty-segment'],
        ['//', 'empty-segment'],
        ['blog//', 'empty-segment'],
        ['.', 'dot-segment'],
        ['./blog/', 'dot-segment'],
        ['..', 'dot-segment'],
        ['../secret/', 'dot-segment'],
        ['blog/../../secret/', 'dot-segment'],
        ['%2E%2E/secret/', 'dot-segment'],
        ['%2e%2e/secret/', 'dot-segment'],
        ['blog/%2E/', 'dot-segment'],
        ['blog\\drafts/', 'invalid-character'],
        ['..\\secret/', 'invalid-character'],
        ['blog%5Cdrafts/', 'invalid-character'],
        ['blog/*', 'reserved-character'],
        ['blog/**/', 'reserved-character'],
        ['posts/:slug', 'reserved-character'],
        ['https://example.test/blog/', 'reserved-character'],
        ['blog/?draft=1', 'invalid-character'],
        ['blog/#top', 'invalid-character'],
        ['blog/\u0007/', 'invalid-character'],
        ['blog/%0A/', 'invalid-character'],
        ['blog/\uD800/', 'invalid-character'],
        ['100%/', 'invalid-escape'],
        ['blog/%E0%A4%A/', 'invalid-escape'],
      ];
      for (let [source, code] of cases) {
        assert.strictEqual(errorCode(source), code, JSON.stringify(source));
      }
    },

  'parsePathPrefix: an error names the prefix and the offending segment':
    async (assert) => {
      let result = parsePathPrefix('blog/../secret/');
      assert.false(result.ok);
      if (result.ok) {
        return;
      }
      assert.deepEqual(result.error, {
        code: 'dot-segment',
        message:
          'Path prefix "blog/../secret/" has a . or .. segment. A prefix names a path inside the realm, from its root.',
        source: 'blog/../secret/',
        segmentIndex: 1,
      });
      let empty = parsePathPrefix('');
      assert.false(empty.ok);
      if (!empty.ok) {
        assert.strictEqual(empty.error.segmentIndex, undefined);
        assert.true(
          empty.error.message.includes('"/"'),
          'tells the author how to write the whole realm',
        );
      }
    },

  'parsePathSpecifier: an empty list is valid and means no path limit': async (
    assert,
  ) => {
    let result = parsePathSpecifier([]);
    assert.true(result.ok);
    if (result.ok) {
      assert.deepEqual(result.specifier.prefixes, []);
      assert.true(
        pathSpecifierMatches(result.specifier, 'anything/at/all.json'),
      );
      assert.true(pathSpecifierMatches(result.specifier, ''));
    }
  },

  'parsePathSpecifier: one invalid prefix makes the whole specifier invalid':
    async (assert) => {
      let result = parsePathSpecifier(['blog/', '../secret/', 'posts/', '*']);
      assert.false(result.ok);
      if (result.ok) {
        return;
      }
      assert.deepEqual(
        result.errors.map((e) => [e.prefixIndex, e.code, e.source]),
        [
          [1, 'dot-segment', '../secret/'],
          [3, 'reserved-character', '*'],
        ],
        'reports every invalid prefix with its position',
      );
      assert.false(parsePathSpecifier(['../secret/']).ok);
    },

  'pathSpecifierMatches: a directory covers itself and everything in it':
    async (assert) => {
      let blog = specifier('blog/');
      assert.true(pathSpecifierMatches(blog, 'blog/'));
      assert.true(pathSpecifierMatches(blog, 'blog/BlogPost/1.json'));
      assert.true(pathSpecifierMatches(blog, 'blog/drafts/'));
      assert.true(pathSpecifierMatches(blog, '/blog/BlogPost/1.json'));
      assert.false(pathSpecifierMatches(blog, ''), 'not the realm root');
      assert.false(pathSpecifierMatches(blog, 'BlogPost/1.json'));
      assert.false(pathSpecifierMatches(blog, 'drafts/blog/1.json'));
    },

  'pathSpecifierMatches: blog/ never matches blog-old/ or blog.json': async (
    assert,
  ) => {
    let blog = specifier('blog/');
    assert.false(pathSpecifierMatches(blog, 'blog-old/'));
    assert.false(pathSpecifierMatches(blog, 'blog-old/BlogPost/1.json'));
    assert.false(pathSpecifierMatches(blog, 'blog.json'));
    assert.false(pathSpecifierMatches(blog, 'blog'), 'a file named blog');
  },

  'pathSpecifierMatches: a file prefix covers exactly that file': async (
    assert,
  ) => {
    let post = specifier('blog/post-1.json');
    assert.true(pathSpecifierMatches(post, 'blog/post-1.json'));
    assert.false(
      pathSpecifierMatches(post, 'blog/post-1.json/'),
      'not a directory',
    );
    assert.false(pathSpecifierMatches(post, 'blog/post-1.json/x.json'));
    assert.false(pathSpecifierMatches(post, 'blog/post-1'));
    assert.false(pathSpecifierMatches(post, 'blog/post-10.json'));
    assert.false(pathSpecifierMatches(post, 'blog/'));
  },

  'pathSpecifierMatches: / covers the whole realm': async (assert) => {
    let realm = specifier('/');
    assert.true(pathSpecifierMatches(realm, ''));
    assert.true(pathSpecifierMatches(realm, '/'));
    assert.true(pathSpecifierMatches(realm, 'index.json'));
    assert.true(pathSpecifierMatches(realm, 'a/b/c/d.gts'));
  },

  'pathSpecifierMatches: a list matches a path under any of its prefixes':
    async (assert) => {
      let both = specifier('blog/', 'posts/');
      assert.true(pathSpecifierMatches(both, 'blog/BlogPost/1.json'));
      assert.true(pathSpecifierMatches(both, 'posts/Post/2.json'));
      assert.false(pathSpecifierMatches(both, 'news/Article/3.json'));
      assert.false(pathSpecifierMatches(both, 'blogposts/1.json'));
    },

  'pathSpecifierMatches: compares segments case-sensitively, with no Unicode normalization':
    async (assert) => {
      let blog = specifier('blog/');
      assert.false(pathSpecifierMatches(blog, 'Blog/BlogPost/1.json'));
      assert.false(pathSpecifierMatches(blog, 'BLOG/'));
      assert.false(pathSpecifierMatches(specifier('Blog/'), 'blog/1.json'));
      let composed = specifier('café/');
      assert.true(pathSpecifierMatches(composed, 'café/menu.json'));
      assert.false(
        pathSpecifierMatches(composed, 'café/menu.json'),
        'a decomposed é is a different segment',
      );
    },

  'pathSpecifierMatches: compares decoded segments': async (assert) => {
    assert.true(
      pathSpecifierMatches(specifier('My%20Posts/'), 'My Posts/Post/1.json'),
    );
    assert.true(
      pathSpecifierMatches(specifier('My Posts/'), 'My Posts/Post/1.json'),
    );
    assert.true(pathSpecifierMatches(specifier('caf%C3%A9/'), 'café/1.json'));
    assert.true(pathSpecifierMatches(specifier('100%25.json'), '100%.json'));
    assert.false(
      pathSpecifierMatches(specifier('My%20Posts/'), 'My%20Posts/Post/1.json'),
      'the path is matched as the realm resolved it, never as spelled in a URL',
    );
  },

  'pathSpecifierMatches: a malformed path matches nothing': async (assert) => {
    let realm = specifier('/');
    assert.false(pathSpecifierMatches(realm, 'blog//1.json'));
    assert.false(pathSpecifierMatches(realm, 'blog/../secret.json'));
    assert.false(pathSpecifierMatches(realm, './blog/1.json'));
    assert.false(
      pathSpecifierMatches(specifier('blog/'), 'blog/../secret.json'),
    );
  },

  'pathPrefixMatches: matches one prefix': async (assert) => {
    assert.true(pathPrefixMatches(prefix('blog/'), 'blog/1.json'));
    assert.false(pathPrefixMatches(prefix('blog/'), 'news/1.json'));
    assert.false(pathPrefixMatches(prefix('blog/'), 'blog//1.json'));
  },

  'path-specifier serializer: reads back a list exactly as written': async (
    assert,
  ) => {
    let written = [
      '/blog/',
      'My%20Posts/',
      ' not trimmed ',
      '../kept/as/written',
    ];
    let value = await deserialize(written);
    assert.deepEqual(value, written);
    assert.notStrictEqual(value, written, 'reads into a copy');
    assert.deepEqual(PathSpecifierSerializer.serialize(value), written);
    assert.deepEqual(PathSpecifierSerializer.queryableValue(value), written);
    assert.deepEqual(await deserialize([]), [], 'an empty list stays empty');
    assert.deepEqual(PathSpecifierSerializer.serialize([]), []);
  },

  'path-specifier serializer: reads null as absent': async (assert) => {
    assert.strictEqual(await deserialize(null), null);
    assert.strictEqual(await deserialize(undefined), null);
    assert.strictEqual(PathSpecifierSerializer.serialize(null), null);
    assert.strictEqual(PathSpecifierSerializer.serialize(undefined), null);
    assert.strictEqual(PathSpecifierSerializer.queryableValue(null), null);
  },

  'path-specifier serializer: refuses a malformed value': async (assert) => {
    let malformed: unknown[] = [
      'blog/',
      42,
      true,
      {},
      { prefixes: ['blog/'] },
      ['blog/', 7],
      ['blog/', null],
      [['blog/']],
      // A sparse array has a hole where a prefix should be.
      // eslint-disable-next-line no-sparse-arrays
      ['blog/', , 'posts/'],
    ];
    for (let value of malformed) {
      await assert.rejects(
        deserialize(value),
        /a path specifier/,
        `deserialize refuses ${JSON.stringify(value)}`,
      );
      assert.throws(
        () => PathSpecifierSerializer.serialize(value),
        /a path specifier/,
        `serialize refuses ${JSON.stringify(value)}`,
      );
    }
  },

  'path-specifier serializer: is registered by name': async (assert) => {
    let serializer = getSerializer('path-specifier');
    assert.deepEqual(serializer.serialize(['blog/']), ['blog/']);
    assert.strictEqual(serializer.serialize(null), null);
  },
});

export default tests;
