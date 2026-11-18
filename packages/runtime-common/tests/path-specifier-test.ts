import {
  parsePathPrefix,
  parsePathSpecifier,
  pathPrefixMatches,
  pathSpecifierMatches,
  type PathPrefix,
  type PathPrefixErrorCode,
  type PathSpecifier,
} from '../path-specifier.ts';
import { RealmPaths } from '../paths.ts';
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

const REALM = 'https://example.test/realm/';

function isFile(specifier: PathSpecifier, path: string): boolean {
  return pathSpecifierMatches(specifier, path, 'file');
}

function isDirectory(specifier: PathSpecifier, path: string): boolean {
  return pathSpecifierMatches(specifier, path, 'directory');
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

  'parsePathPrefix: decodes percent-escapes once': async (assert) => {
    assert.deepEqual(prefix('My%20Posts/').segments, ['My Posts']);
    assert.deepEqual(prefix('My Posts/').segments, ['My Posts']);
    assert.deepEqual(prefix('caf%C3%A9/').segments, ['café']);
    assert.deepEqual(prefix('café/').segments, ['café']);
    assert.deepEqual(prefix('100%25.json').segments, ['100%.json']);
    // The escapes of URL delimiters stay as they are, as they do in the path
    // of a file the realm stores.
    assert.deepEqual(prefix('a%2Fb/').segments, ['a%2Fb']);
    assert.deepEqual(prefix('a%3Fb/').segments, ['a%3Fb']);
    // `*` and `:` as written are reserved, so their escapes name them.
    assert.deepEqual(prefix('blog/%2A/').segments, ['blog', '*']);
    assert.strictEqual(prefix('blog/%2A/').source, 'blog/%2A/');
    assert.deepEqual(prefix('notes re%3A budget.m4a').segments, [
      'notes re: budget.m4a',
    ]);
    assert.deepEqual(prefix('a%3ab/').segments, ['a:b']);
    assert.strictEqual(prefix('notes/a%3Ab.json').path, 'notes/a:b.json');
    assert.deepEqual(
      prefix('a%253Ab/').segments,
      ['a%3Ab'],
      'an escaped % before 3A is decoded once',
    );
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
      assert.true(isFile(result.specifier, 'anything/at/all.json'));
      assert.true(isDirectory(result.specifier, ''));
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
      assert.true(isDirectory(blog, 'blog'));
      assert.true(isFile(blog, 'blog/BlogPost/1.json'));
      assert.true(isDirectory(blog, 'blog/drafts'));
      assert.true(isFile(blog, '/blog/BlogPost/1.json'));
      assert.false(isDirectory(blog, ''), 'not the realm root');
      assert.false(isFile(blog, 'BlogPost/1.json'));
      assert.false(isFile(blog, 'drafts/blog/1.json'));
    },

  'pathSpecifierMatches: blog/ never matches blog-old/ or blog.json': async (
    assert,
  ) => {
    let blog = specifier('blog/');
    assert.false(isDirectory(blog, 'blog-old'));
    assert.false(isFile(blog, 'blog-old/BlogPost/1.json'));
    assert.false(isFile(blog, 'blog.json'));
    assert.false(isFile(blog, 'blog'), 'a file named blog');
  },

  'pathSpecifierMatches: a file prefix covers exactly that file': async (
    assert,
  ) => {
    let post = specifier('blog/post-1.json');
    assert.true(isFile(post, 'blog/post-1.json'));
    assert.false(
      isDirectory(post, 'blog/post-1.json'),
      'not a directory of that name',
    );
    assert.false(isFile(post, 'blog/post-1.json/x.json'));
    assert.false(isFile(post, 'blog/post-1'));
    assert.false(isFile(post, 'blog/post-10.json'));
    assert.false(isDirectory(post, 'blog'));
  },

  'pathSpecifierMatches: kind decides, and a trailing slash does not': async (
    assert,
  ) => {
    let blog = specifier('blog/');
    let file = specifier('blog');
    assert.true(isDirectory(blog, 'blog/'));
    assert.false(isFile(blog, 'blog/'), 'a file named blog');
    assert.true(isFile(file, 'blog/'));
    assert.false(isDirectory(file, 'blog'), 'a directory named blog');
  },

  'pathSpecifierMatches: matches paths as RealmPaths.local resolves them':
    async (assert) => {
      let realm = new RealmPaths(new URL(REALM));
      let local = (path: string) => realm.local(new URL(path, REALM));
      let blog = specifier('blog/');
      let file = specifier('blog');
      // `local` strips a directory's trailing slash, so the caller says
      // which it is.
      assert.strictEqual(local('blog/'), 'blog');
      assert.true(isDirectory(blog, local('blog/')));
      assert.false(isDirectory(file, local('blog/')));
      assert.true(isFile(blog, local('blog/BlogPost/1.json')));
      assert.true(
        isFile(specifier('My Posts/'), local('My%20Posts/Post/1.json')),
      );
      assert.true(
        isFile(specifier('a%2Fb/'), local('a%2Fb/x.json')),
        'a delimiter escape stays encoded on both sides',
      );
      // A realm resolves a `:` in a URL's path as is, and a prefix names it
      // with `%3A`.
      assert.strictEqual(local('notes/a:b.json'), 'notes/a:b.json');
      assert.true(
        isFile(specifier('notes/a%3Ab.json'), local('notes/a:b.json')),
      );
      assert.false(
        isFile(specifier('notes/a%3Ab.json'), local('notes/a%3Ab.json')),
        'a URL that escapes the colon resolves to a different path',
      );
      assert.true(
        isFile(specifier('notes/a%253Ab.json'), local('notes/a%3Ab.json')),
      );
      // A realm resolves `%2A` in a URL's path to `*`, as a prefix does.
      assert.strictEqual(local('notes/a%2Ab.json'), 'notes/a*b.json');
      assert.true(
        isFile(specifier('notes/a%2Ab.json'), local('notes/a*b.json')),
      );
      assert.false(
        isFile(specifier('notes/%2A/'), local('notes/a.json')),
        'an escaped * is literal, not a wildcard',
      );
    },

  'pathSpecifierMatches: / covers the whole realm': async (assert) => {
    let realm = specifier('/');
    assert.true(isDirectory(realm, ''));
    assert.true(isDirectory(realm, '/'));
    assert.true(isFile(realm, 'index.json'));
    assert.true(isFile(realm, 'a/b/c/d.gts'));
    assert.false(isFile(realm, ''), 'the root is not a file');
  },

  'pathSpecifierMatches: a list matches a path under any of its prefixes':
    async (assert) => {
      let both = specifier('blog/', 'posts/');
      assert.true(isFile(both, 'blog/BlogPost/1.json'));
      assert.true(isFile(both, 'posts/Post/2.json'));
      assert.false(isFile(both, 'news/Article/3.json'));
      assert.false(isFile(both, 'blogposts/1.json'));
    },

  'pathSpecifierMatches: compares segments case-sensitively, with no Unicode normalization':
    async (assert) => {
      let blog = specifier('blog/');
      assert.false(isFile(blog, 'Blog/BlogPost/1.json'));
      assert.false(isDirectory(blog, 'BLOG'));
      assert.false(isFile(specifier('Blog/'), 'blog/1.json'));
      let composed = specifier('café/');
      assert.true(isFile(composed, 'café/menu.json'));
      assert.false(
        isFile(composed, 'café/menu.json'),
        'a decomposed é is a different segment',
      );
    },

  'pathSpecifierMatches: compares decoded segments': async (assert) => {
    assert.true(isFile(specifier('My%20Posts/'), 'My Posts/Post/1.json'));
    assert.true(isFile(specifier('My Posts/'), 'My Posts/Post/1.json'));
    assert.true(isFile(specifier('caf%C3%A9/'), 'café/1.json'));
    assert.true(isFile(specifier('100%25.json'), '100%.json'));
    assert.false(
      isFile(specifier('My%20Posts/'), 'My%20Posts/Post/1.json'),
      'the path is matched as the realm resolved it, never as spelled in a URL',
    );
  },

  'pathSpecifierMatches: a malformed path matches nothing': async (assert) => {
    let realm = specifier('/');
    assert.false(isFile(realm, 'blog//1.json'));
    assert.false(isFile(realm, 'blog/../secret.json'));
    assert.false(isFile(realm, './blog/1.json'));
    assert.false(isFile(specifier('blog/'), 'blog/../secret.json'));
  },

  'pathPrefixMatches: matches one prefix': async (assert) => {
    assert.true(pathPrefixMatches(prefix('blog/'), 'blog/1.json', 'file'));
    assert.true(pathPrefixMatches(prefix('blog/'), 'blog', 'directory'));
    assert.false(pathPrefixMatches(prefix('blog/'), 'blog', 'file'));
    assert.false(pathPrefixMatches(prefix('blog/'), 'news/1.json', 'file'));
    assert.false(pathPrefixMatches(prefix('blog/'), 'blog//1.json', 'file'));
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
