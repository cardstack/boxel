import {
  encodeRouteSegment,
  fillCardIdPattern,
  fillRoutePathPattern,
  matchCardIdPattern,
  matchPatternSegments,
  matchRoutePathPattern,
  parseCardIdPattern,
  parseRoutePathPattern,
  splitRequestPath,
  type CardIdPattern,
  type ParseRoutePatternOptions,
  type RoutePathPattern,
  type RoutePatternErrorCode,
} from '../route-pattern.ts';
import type { SharedTests } from '../helpers/index.ts';

const REALM = 'https://example.test/user/blog/';

function path(source: string, options?: ParseRoutePatternOptions) {
  let result = parseRoutePathPattern(source, options);
  if (!result.ok) {
    throw new Error(`expected ${source} to parse: ${result.error.message}`);
  }
  return result.pattern;
}

function cardId(source: string, options?: ParseRoutePatternOptions) {
  let result = parseCardIdPattern(source, options);
  if (!result.ok) {
    throw new Error(`expected ${source} to parse: ${result.error.message}`);
  }
  return result.pattern;
}

function pathError(source: string, options?: ParseRoutePatternOptions) {
  let result = parseRoutePathPattern(source, options);
  return result.ok ? undefined : result.error;
}

function cardIdError(source: string) {
  let result = parseCardIdPattern(source);
  return result.ok ? undefined : result.error.code;
}

// Values that need encoding: reserved characters, spaces, unicode
// (including astral), the characters encodeURIComponent leaves alone,
// and a percent sign that must not be read as an escape.
const AWKWARD_VALUES = [
  'hello world',
  'a/b',
  'a?b#c',
  'a&b=c;d,e+f',
  "it's (really)*!",
  'café',
  'Ünïcödé',
  '日本語',
  '😀',
  '100%',
  '%41',
  ':colon',
  '..dots..',
  '~tilde_under-dash.dot',
];

const tests: SharedTests<unknown> = Object.freeze({
  'parseRoutePathPattern: parses literal and param segments': async (
    assert,
  ) => {
    let pattern = path('/c/:category/:product');
    assert.strictEqual(pattern.kind, 'path');
    assert.strictEqual(pattern.source, '/c/:category/:product');
    assert.deepEqual(pattern.segments, [
      { kind: 'literal', value: 'c' },
      { kind: 'param', name: 'category' },
      { kind: 'param', name: 'product' },
    ]);
    assert.deepEqual(pattern.paramNames, ['category', 'product']);

    assert.deepEqual(path('/').segments, [], 'the root has no segments');
    assert.deepEqual(
      path('/posts/:slug/').segments,
      path('/posts/:slug').segments,
      'a trailing slash is ignored',
    );
    assert.deepEqual(
      path('/caf%C3%A9').segments,
      [{ kind: 'literal', value: 'café' }],
      'an encoded literal is stored decoded',
    );
  },

  'parseRoutePathPattern: rejects each invalid pattern with a structured error':
    async (assert) => {
      let cases: [string, RoutePatternErrorCode, number | undefined][] = [
        ['posts/:slug', 'invalid-start', undefined],
        ['', 'invalid-start', undefined],
        ['/posts//:slug', 'empty-segment', 1],
        ['//', 'empty-segment', 0],
        ['/posts/:', 'empty-param-name', 1],
        ['/:', 'empty-param-name', 0],
        ['/:a/:a', 'duplicate-param-name', 1],
        ['/:slug/x/:slug', 'duplicate-param-name', 2],
        ['/posts/a:b', 'misplaced-colon', 1],
        ['/posts/slug:', 'misplaced-colon', 1],
        ['/posts/:a:b', 'misplaced-colon', 1],
        ['/posts/::a', 'misplaced-colon', 1],
        ['/posts/:1st', 'invalid-param-name', 1],
        ['/posts/:a-b', 'invalid-param-name', 1],
        ['/posts/:a.b', 'invalid-param-name', 1],
        ['/foo bar', 'invalid-literal', 0],
        ['/foo?x=1', 'invalid-literal', 0],
        ['/%zz', 'invalid-literal', 0],
        ['/%C3', 'invalid-literal', 0],
        ['/a/./b', 'invalid-literal', 1],
        ['/a/..', 'invalid-literal', 1],
        ['/*', 'invalid-literal', 0],
        ['/(.*)', 'invalid-literal', 0],
      ];
      for (let [source, code, segmentIndex] of cases) {
        let error = pathError(source);
        assert.strictEqual(error?.code, code, `${source} -> ${code}`);
        assert.strictEqual(
          error?.segmentIndex,
          segmentIndex,
          `${source} segment index`,
        );
        assert.ok(error?.message, `${source} has a message`);
      }
      assert.strictEqual(pathError('/:a/:a')?.name, 'a');
    },

  'parseRoutePathPattern: names must be unique including the parents’ names':
    async (assert) => {
      let parent = path('/c/:category');
      let error = pathError('/:category', { usedNames: parent.paramNames });
      assert.strictEqual(error?.code, 'duplicate-param-name');
      assert.strictEqual(error?.name, 'category');

      let child = path('/:product', { usedNames: parent.paramNames });
      assert.deepEqual(child.paramNames, ['product']);

      let grandchild = pathError('/:product', {
        usedNames: [...parent.paramNames, ...child.paramNames],
      });
      assert.strictEqual(grandchild?.code, 'duplicate-param-name');
    },

  'splitRequestPath: splits, decodes, and handles slashes': async (assert) => {
    assert.deepEqual(splitRequestPath('/'), []);
    assert.deepEqual(splitRequestPath('/posts/hello'), ['posts', 'hello']);
    assert.deepEqual(
      splitRequestPath('/posts/hello/'),
      ['posts', 'hello'],
      'one trailing slash is ignored',
    );
    assert.deepEqual(splitRequestPath('/a%20b/caf%C3%A9/a%2Fb'), [
      'a b',
      'café',
      'a/b',
    ]);
    assert.strictEqual(splitRequestPath('posts'), undefined, 'no leading /');
    assert.strictEqual(splitRequestPath(''), undefined);
    assert.strictEqual(splitRequestPath('//'), undefined);
    assert.strictEqual(splitRequestPath('/a//b'), undefined, 'empty segment');
    assert.strictEqual(splitRequestPath('/a//'), undefined);
    assert.strictEqual(splitRequestPath('/%zz'), undefined, 'bad escape');
    assert.strictEqual(splitRequestPath('/%E9'), undefined, 'bad UTF-8');
  },

  'matchRoutePathPattern: matches literals and params segment by segment':
    async (assert) => {
      let pattern = path('/c/:category/:product');
      assert.deepEqual(matchRoutePathPattern(pattern, '/c/shoes/trail'), {
        category: 'shoes',
        product: 'trail',
      });
      assert.strictEqual(
        matchRoutePathPattern(pattern, '/x/shoes/trail'),
        undefined,
        'literal differs',
      );
      assert.strictEqual(
        matchRoutePathPattern(pattern, '/C/shoes/trail'),
        undefined,
        'literals are case-sensitive',
      );
      assert.strictEqual(
        matchRoutePathPattern(pattern, '/c/shoes'),
        undefined,
        'too few segments',
      );
      assert.strictEqual(
        matchRoutePathPattern(pattern, '/c/shoes/trail/extra'),
        undefined,
        'too many segments: a param never spans two',
      );

      let literal = path('/about/team');
      assert.deepEqual(matchRoutePathPattern(literal, '/about/team'), {});
      assert.deepEqual(matchRoutePathPattern(path('/'), '/'), {});
      assert.strictEqual(matchRoutePathPattern(path('/'), '/a'), undefined);
      assert.deepEqual(
        matchRoutePathPattern(path('/caf%c3%a9'), '/caf%C3%A9'),
        {},
        'literals compare decoded',
      );
    },

  'matchRoutePathPattern: a param matches one non-empty segment': async (
    assert,
  ) => {
    let pattern = path('/posts/:slug');
    assert.strictEqual(matchRoutePathPattern(pattern, '/posts'), undefined);
    assert.strictEqual(matchRoutePathPattern(pattern, '/posts/'), undefined);
    assert.strictEqual(matchRoutePathPattern(pattern, '/posts//'), undefined);
    assert.strictEqual(
      matchRoutePathPattern(pattern, '/posts/%2E'),
      undefined,
      'a value of . is not a segment',
    );
    assert.strictEqual(
      matchRoutePathPattern(pattern, '/posts/%2E%2E'),
      undefined,
      'a value of .. is not a segment',
    );
  },

  'matchRoutePathPattern: values are percent-decoded': async (assert) => {
    let pattern = path('/posts/:slug');
    assert.deepEqual(matchRoutePathPattern(pattern, '/posts/hello%20world'), {
      slug: 'hello world',
    });
    assert.deepEqual(matchRoutePathPattern(pattern, '/posts/a%2Fb'), {
      slug: 'a/b',
    });
    assert.deepEqual(matchRoutePathPattern(pattern, '/posts/caf%c3%a9'), {
      slug: 'café',
    });
    assert.deepEqual(matchRoutePathPattern(pattern, "/posts/it's(1)"), {
      slug: "it's(1)",
    });
    assert.strictEqual(
      matchRoutePathPattern(pattern, '/posts/%zz'),
      undefined,
      'a malformed escape matches nothing',
    );
  },

  'matchRoutePathPattern: a trailing slash on the request is ignored': async (
    assert,
  ) => {
    let pattern = path('/posts/:slug');
    assert.deepEqual(matchRoutePathPattern(pattern, '/posts/hello/'), {
      slug: 'hello',
    });
  },

  'matchPatternSegments: matches from an offset for nested routes': async (
    assert,
  ) => {
    let parent = path('/c/:category');
    let child = path('/:product', { usedNames: parent.paramNames });
    let segments = splitRequestPath('/c/shoes/trail')!;

    let parentMatch = matchPatternSegments(parent, segments);
    assert.deepEqual(parentMatch, { params: { category: 'shoes' }, end: 2 });

    let childMatch = matchPatternSegments(child, segments, parentMatch!.end);
    assert.deepEqual(childMatch, { params: { product: 'trail' }, end: 3 });

    assert.strictEqual(
      matchPatternSegments(child, segments, 3),
      undefined,
      'nothing left to match',
    );
    assert.strictEqual(matchPatternSegments(child, segments, -1), undefined);
    assert.deepEqual(
      matchPatternSegments(path('/'), segments, 3),
      { params: {}, end: 3 },
      'an empty pattern matches at the end',
    );
  },

  'fillRoutePathPattern: fills params with the canonical encoding': async (
    assert,
  ) => {
    let pattern = path('/c/:category/:product');
    assert.strictEqual(
      fillRoutePathPattern(pattern, { category: 'shoes', product: 'trail' }),
      '/c/shoes/trail',
    );
    assert.strictEqual(
      fillRoutePathPattern(pattern, {
        category: 'a b/c',
        product: "it's",
        unused: 'x',
      }),
      '/c/a%20b%2Fc/it%27s',
    );
    assert.strictEqual(fillRoutePathPattern(path('/'), {}), '/');
    assert.strictEqual(
      fillRoutePathPattern(path('/caf%c3%a9/:x'), { x: 'y' }),
      '/caf%C3%A9/y',
      'literals are re-encoded canonically',
    );
  },

  'fillRoutePathPattern: refuses missing, empty, dot and malformed values':
    async (assert) => {
      let pattern = path('/posts/:slug');
      assert.strictEqual(fillRoutePathPattern(pattern, {}), undefined);
      assert.strictEqual(
        fillRoutePathPattern(pattern, { slug: '' }),
        undefined,
      );
      assert.strictEqual(
        fillRoutePathPattern(pattern, { slug: '.' }),
        undefined,
      );
      assert.strictEqual(
        fillRoutePathPattern(pattern, { slug: '..' }),
        undefined,
      );
      assert.strictEqual(
        fillRoutePathPattern(pattern, { slug: '\uD800' }),
        undefined,
        'a lone surrogate has no encoding',
      );
      assert.strictEqual(
        fillRoutePathPattern(pattern, Object.create({ slug: 'inherited' })),
        undefined,
        'only own properties count',
      );
    },

  'encodeRouteSegment: encodes everything but the unreserved set': async (
    assert,
  ) => {
    assert.strictEqual(encodeRouteSegment('AZaz09-._~'), 'AZaz09-._~');
    assert.strictEqual(encodeRouteSegment("!'()*"), '%21%27%28%29%2A');
    assert.strictEqual(encodeRouteSegment(' /?#%:@'), '%20%2F%3F%23%25%3A%40');
    assert.strictEqual(encodeRouteSegment('é'), '%C3%A9');
    assert.strictEqual(encodeRouteSegment('😀'), '%F0%9F%98%80');
  },

  'round trip: path fill then match gives the values back': async (assert) => {
    let pattern = path('/c/:category/:product');
    for (let value of AWKWARD_VALUES) {
      let params = { category: value, product: `${value}-2` };
      let filled = fillRoutePathPattern(pattern, params);
      assert.ok(filled, `fills ${value}`);
      assert.deepEqual(
        matchRoutePathPattern(pattern, filled!),
        params,
        `round trips ${value}`,
      );
    }
  },

  'round trip: path match then fill gives the canonical path back': async (
    assert,
  ) => {
    let pattern = path('/posts/:slug');
    for (let value of AWKWARD_VALUES) {
      let canonical = `/posts/${encodeRouteSegment(value)}`;
      let params = matchRoutePathPattern(pattern, canonical);
      assert.ok(params, `matches ${canonical}`);
      assert.strictEqual(fillRoutePathPattern(pattern, params!), canonical);
    }
    // A non-canonical spelling of a value comes back canonical.
    let params = matchRoutePathPattern(pattern, "/posts/caf%c3%a9-it's")!;
    assert.strictEqual(
      fillRoutePathPattern(pattern, params),
      '/posts/caf%C3%A9-it%27s',
    );
  },

  'parseCardIdPattern: parses a realm-relative pattern': async (assert) => {
    let pattern = cardId('./Person/:person_id');
    assert.strictEqual(pattern.kind, 'card-id');
    assert.deepEqual(pattern.segments, [
      { kind: 'literal', value: 'Person' },
      { kind: 'param', name: 'person_id' },
    ]);
    assert.deepEqual(pattern.paramNames, ['person_id']);
    assert.deepEqual(cardId('./:id').paramNames, ['id']);
  },

  'parseCardIdPattern: rejects patterns that are not anchored at the realm or are invalid':
    async (assert) => {
      assert.strictEqual(cardIdError('Person/:id'), 'invalid-start');
      assert.strictEqual(cardIdError('/Person/:id'), 'invalid-start');
      assert.strictEqual(cardIdError('../Person/:id'), 'invalid-start');
      assert.strictEqual(
        cardIdError('https://other.test/Person/:id'),
        'invalid-start',
      );
      assert.strictEqual(cardIdError('./'), 'empty-segment');
      assert.strictEqual(cardIdError('./Person/'), 'empty-segment');
      assert.strictEqual(cardIdError('./Person//:id'), 'empty-segment');
      assert.strictEqual(cardIdError('./../Person/:id'), 'invalid-literal');
      assert.strictEqual(cardIdError('./Person/:'), 'empty-param-name');
      assert.strictEqual(cardIdError('./:a/:a'), 'duplicate-param-name');
      assert.strictEqual(cardIdError('./Person/p:id'), 'misplaced-colon');
      let parent = parseCardIdPattern('./c/:category/:product', {
        usedNames: ['category'],
      });
      assert.strictEqual(
        parent.ok ? undefined : parent.error.code,
        'duplicate-param-name',
      );
    },

  'matchCardIdPattern: turns a card id into params': async (assert) => {
    let pattern = cardId('./Person/:person_id');
    assert.deepEqual(
      matchCardIdPattern(pattern, `${REALM}Person/robin`, REALM),
      {
        person_id: 'robin',
      },
    );
    assert.deepEqual(
      matchCardIdPattern(
        pattern,
        `${REALM}Person/caf%C3%A9%20au%20lait`,
        REALM,
      ),
      { person_id: 'café au lait' },
    );
    assert.deepEqual(
      matchCardIdPattern(
        cardId('./c/:category/:product'),
        `${REALM}c/shoes/trail`,
        REALM,
      ),
      { category: 'shoes', product: 'trail' },
    );
  },

  'matchCardIdPattern: a card id that does not fit is no match': async (
    assert,
  ) => {
    let pattern = cardId('./Person/:person_id');
    let noMatch = (id: string, message: string) =>
      assert.strictEqual(
        matchCardIdPattern(pattern, id, REALM),
        undefined,
        message,
      );
    noMatch(`${REALM}Person/archive/abc`, 'a value never spans two segments');
    noMatch(`${REALM}Person`, 'missing the param segment');
    noMatch(`${REALM}Person/`, 'empty param segment');
    noMatch(`${REALM}Pet/robin`, 'literal differs');
    noMatch(`${REALM}x/Person/robin`, 'anchored at the realm root');
    noMatch('https://example.test/user/other/Person/robin', 'another realm');
    noMatch('https://example.test/user/blog', 'the realm URL without its /');
    noMatch(`${REALM}Person/robin?x=1`, 'a query string');
    noMatch(`${REALM}Person/robin#top`, 'a fragment');
    noMatch(`${REALM}Person/%zz`, 'a malformed escape');
    noMatch(`${REALM}Person/%2E%2E`, 'a dot-dot value');
    assert.strictEqual(
      matchCardIdPattern(
        pattern,
        'https://example.test/user/blogPerson/robin',
        'https://example.test/user/blog',
      ),
      undefined,
      'a realm URL without a trailing / matches nothing',
    );
  },

  'fillCardIdPattern: builds a card id under the realm': async (assert) => {
    let pattern = cardId('./Person/:person_id');
    assert.strictEqual(
      fillCardIdPattern(pattern, { person_id: 'robin' }, REALM),
      `${REALM}Person/robin`,
    );
    assert.strictEqual(
      fillCardIdPattern(pattern, { person_id: 'a b/c' }, REALM),
      `${REALM}Person/a%20b%2Fc`,
    );
    assert.strictEqual(fillCardIdPattern(pattern, {}, REALM), undefined);
    assert.strictEqual(
      fillCardIdPattern(pattern, { person_id: '..' }, REALM),
      undefined,
    );
    assert.strictEqual(
      fillCardIdPattern(
        pattern,
        { person_id: 'robin' },
        'https://example.test/user/blog',
      ),
      undefined,
      'the realm URL must end with /',
    );
  },

  'round trip: card id fill then match, and match then fill': async (
    assert,
  ) => {
    let pattern: CardIdPattern = cardId('./c/:category/:product');
    for (let value of AWKWARD_VALUES) {
      let params = { category: value, product: 'p' };
      let id = fillCardIdPattern(pattern, params, REALM);
      assert.ok(id, `fills ${value}`);
      assert.strictEqual(new URL(id!).href, id, `${id} is already normalized`);
      assert.deepEqual(matchCardIdPattern(pattern, id!, REALM), params);
      assert.strictEqual(
        fillCardIdPattern(
          pattern,
          matchCardIdPattern(pattern, id!, REALM)!,
          REALM,
        ),
        id,
      );
    }
  },

  'round trip: a path match fills a card id and back': async (assert) => {
    let route: RoutePathPattern = path('/people/:person_id');
    let card = cardId('./Person/:person_id');
    let params = matchRoutePathPattern(
      route,
      '/people/sample%20%C3%B1and%C3%BA',
    )!;
    let id = fillCardIdPattern(card, params, REALM)!;
    assert.strictEqual(id, `${REALM}Person/sample%20%C3%B1and%C3%BA`);
    let back = matchCardIdPattern(card, id, REALM)!;
    assert.strictEqual(
      fillRoutePathPattern(route, back),
      '/people/sample%20%C3%B1and%C3%BA',
    );
  },
});

export default tests;
