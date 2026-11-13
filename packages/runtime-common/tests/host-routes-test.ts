import {
  hostRoutingMapFromRoutes,
  validateHostRoutes,
  type HostRoute,
  type HostRouteTypeInfo,
  type HostRouteWarning,
  type HostRoutesValidation,
  type ValidateHostRoutesOptions,
} from '../host-routes.ts';
import type { RawHostRoutingRule } from '../realm.ts';
import type { ResolvedCodeRef } from '../code-ref.ts';
import type { SharedTests } from '../helpers/index.ts';

const REALM = 'http://realm.test/site/';
const MODULE = `${REALM}types`;

type Fields = HostRouteTypeInfo['fields'];

function cardType(name: string, fields: Fields): HostRouteTypeInfo {
  return {
    key: `${MODULE}/${name}`,
    types: [`${MODULE}/${name}`, 'https://base/card-api/CardDef'],
    isCardType: true,
    fields,
  };
}

const contains = { type: 'contains' as const, isPrimitive: true };
const compound = { type: 'contains' as const, isPrimitive: false };
const linksTo = (name: string) => ({
  type: 'linksTo' as const,
  isPrimitive: false,
  target: `${MODULE}/${name}`,
});
const linksToMany = (name: string) => ({
  type: 'linksToMany' as const,
  isPrimitive: false,
  target: `${MODULE}/${name}`,
});

const TYPES: Record<string, HostRouteTypeInfo> = {
  // Two links to its own type: `friendOf` and `friends`.
  Person: cardType('Person', {
    slug: contains,
    friendOf: linksTo('Person'),
    friends: linksToMany('Person'),
  }),
  // One link to Person, on the post.
  Post: cardType('Post', {
    slug: contains,
    author: linksTo('Person'),
    place: compound,
  }),
  // Linked both ways: two candidates.
  Category: cardType('Category', {
    slug: contains,
    products: linksToMany('Product'),
  }),
  Product: cardType('Product', {
    slug: contains,
    category: linksTo('Category'),
  }),
  // Only the shelf holds the link.
  Shelf: cardType('Shelf', { slug: contains, items: linksToMany('Item') }),
  Item: cardType('Item', { slug: contains }),
  Address: { ...cardType('Address', { city: contains }), isCardType: false },
  // City descends from Place, and a venue links to a Place.
  City: {
    ...cardType('City', { slug: contains }),
    types: [
      `${MODULE}/City`,
      `${MODULE}/Place`,
      'https://base/card-api/CardDef',
    ],
  },
  // The same city type without its adoption chain.
  BareCity: {
    ...cardType('City', { slug: contains }),
    types: [`${MODULE}/City`],
  },
  Venue: cardType('Venue', { slug: contains, place: linksTo('Place') }),
};

function type(name: string): ResolvedCodeRef {
  return { module: MODULE, name } as ResolvedCodeRef;
}

function validate(
  rules: RawHostRoutingRule[],
  options: Partial<ValidateHostRoutesOptions> = {},
): HostRoutesValidation {
  return validateHostRoutes(rules, {
    realmURL: new URL(REALM),
    lookupType: (ref) =>
      ref.module !== MODULE
        ? undefined
        : ref.name === 'Pending'
          ? 'unavailable'
          : TYPES[ref.name],
    ...options,
  });
}

function instance(local: string) {
  return { id: `${REALM}${local}` };
}

function fieldMatch(
  path: string,
  typeName: string,
  match: Record<string, string>,
  extra: RawHostRoutingRule = {},
): RawHostRoutingRule {
  return { path, type: type(typeName), match, ...extra };
}

function paths(routes: readonly HostRoute[]): string[] {
  let out: string[] = [];
  let visit = (list: readonly HostRoute[]) => {
    for (let route of list) {
      out.push(route.fullPath);
      visit(route.routes);
    }
  };
  visit(routes);
  return out;
}

function codes(warnings: readonly HostRouteWarning[]) {
  return warnings.map((w) => ({
    code: w.code,
    path: w.path,
    dropped: w.dropped,
  }));
}

const tests: SharedTests<unknown> = Object.freeze({
  'validateHostRoutes: the fixed routing map is what it was': async (
    assert,
  ) => {
    let { routes, warnings } = validate([
      { path: '/rel', instance: instance('white-paper') },
      { path: '/foreign', instance: { id: 'http://other.test/x' } },
      { path: '/trailing/', instance: instance('white-paper') },
      { path: '/tos', redirectTo: '/terms' },
      {
        path: '/blog',
        redirectTo: 'https://blog.example.com/',
        statusCode: 301,
      },
      { path: '/bad-redirect', redirectTo: 'javascript:alert(1)' },
      {
        path: '/ambiguous',
        redirectTo: '/elsewhere',
        instance: instance('white-paper'),
      },
      { path: '/self', redirectTo: '/self' },
      { path: '/ring-a', redirectTo: '/ring-b' },
      { path: '/ring-b', redirectTo: '/ring-a' },
      {
        path: '/salvaged',
        redirectTo: 'terms',
        instance: instance('white-paper'),
      },
      // A path the pattern parser rejects still routes as it always did.
      { path: '/über', instance: instance('white-paper') },
    ]);
    assert.deepEqual(hostRoutingMapFromRoutes(routes), [
      { path: '/rel', id: `${REALM}white-paper` },
      { path: '/trailing', id: `${REALM}white-paper` },
      { path: '/tos', redirectTo: '/terms', statusCode: 302 },
      {
        path: '/blog',
        redirectTo: 'https://blog.example.com/',
        statusCode: 301,
      },
      { path: '/ambiguous', redirectTo: '/elsewhere', statusCode: 302 },
      { path: '/salvaged', id: `${REALM}white-paper` },
      { path: '/über', id: `${REALM}white-paper` },
    ]);
    assert.deepEqual(
      codes(warnings).filter((w) => w.dropped),
      [
        { code: 'cross-realm-instance', path: '/foreign', dropped: true },
        {
          code: 'invalid-redirect-target',
          path: '/bad-redirect',
          dropped: true,
        },
        { code: 'redirect-cycle', path: '/self', dropped: true },
        { code: 'redirect-cycle', path: '/ring-a', dropped: true },
        { code: 'redirect-cycle', path: '/ring-b', dropped: true },
      ],
    );
    let uber = routes.find((r) => r.fullPath === '/über');
    assert.strictEqual(
      uber?.kind === 'fixed-card' ? uber.pattern : 'missing',
      undefined,
      'a legacy path that does not parse has no pattern',
    );
  },

  'validateHostRoutes: each route has exactly one form': async (assert) => {
    let { routes, warnings } = validate([
      { path: '/nothing' },
      { path: '/both', card: './Person/:id', instance: instance('home') },
      {
        path: '/people/:id',
        card: './Person/:id',
        type: type('Person'),
        match: { slug: ':id' },
      },
      { path: '/people/:id', card: './Person/:id' },
      // Blank strings, as an editor may leave them, are not a form.
      { path: '/home', instance: instance('home'), card: '', redirectTo: ' ' },
    ]);
    assert.deepEqual(paths(routes), ['/people/:id', '/home']);
    assert.deepEqual(codes(warnings), [
      { code: 'missing-form', path: '/nothing', dropped: true },
      { code: 'multiple-forms', path: '/both', dropped: true },
      { code: 'multiple-forms', path: '/people/:id', dropped: true },
    ]);
  },

  'validateHostRoutes: a card id template keeps its parsed patterns': async (
    assert,
  ) => {
    let { routes, warnings } = validate([
      {
        path: '/people/:person_id/',
        name: 'person',
        card: './Person/:person_id',
      },
    ]);
    assert.deepEqual(warnings, []);
    let route = routes[0]!;
    assert.strictEqual(route.kind, 'card-id');
    if (route.kind !== 'card-id') return;
    assert.strictEqual(route.path, '/people/:person_id');
    assert.strictEqual(route.name, 'person');
    assert.deepEqual(route.paramNames, ['person_id']);
    assert.deepEqual(route.pattern.segments, [
      { kind: 'literal', value: 'people' },
      { kind: 'param', name: 'person_id' },
    ]);
    assert.deepEqual(route.card.paramNames, ['person_id']);
    assert.strictEqual(route.parentLink, undefined);
    assert.strictEqual(route.statusCode, undefined);
  },

  'validateHostRoutes: a card pattern needs a :name from the path': async (
    assert,
  ) => {
    let { routes, warnings } = validate([
      { path: '/me', card: './Person/me' },
      { path: '/a/:id', card: './Person/:other' },
      { path: '/b/:id/:extra', card: './Person/:id' },
      { path: '/c/:id', card: 'Person/:id' },
      { path: '/d/:id', card: './Person/:id', statusCode: 301 },
    ]);
    assert.deepEqual(paths(routes), ['/d/:id']);
    assert.strictEqual(
      routes[0]!.kind === 'card-id' ? routes[0]!.statusCode : undefined,
      301,
      'a 301 card route is an alias',
    );
    assert.deepEqual(codes(warnings), [
      { code: 'card-pattern-without-param', path: '/me', dropped: true },
      { code: 'card-pattern-unknown-param', path: '/a/:id', dropped: true },
      {
        code: 'card-pattern-missing-param',
        path: '/b/:id/:extra',
        dropped: true,
      },
      { code: 'invalid-card-pattern', path: '/c/:id', dropped: true },
    ]);
  },

  'validateHostRoutes: a redirect target uses only names from its path': async (
    assert,
  ) => {
    let { routes, warnings } = validate([
      {
        path: '/u/:handle',
        redirectTo: '/people/:handle?from=u',
        statusCode: 301,
      },
      { path: '/x/:handle', redirectTo: 'https://example.com/p/:handle' },
      { path: '/v/:handle', redirectTo: '/people/:name' },
    ]);
    assert.deepEqual(paths(routes), ['/u/:handle', '/x/:handle']);
    let [u, x] = routes;
    if (u?.kind !== 'redirect' || x?.kind !== 'redirect') {
      assert.ok(false, 'expected redirects');
      return;
    }
    assert.strictEqual(u.statusCode, 301);
    assert.strictEqual(u.target?.origin, '');
    assert.deepEqual(u.target?.pattern.paramNames, ['handle']);
    assert.strictEqual(u.target?.suffix, '?from=u');
    assert.strictEqual(x.target?.origin, 'https://example.com');
    assert.deepEqual(
      hostRoutingMapFromRoutes(routes),
      [],
      'dynamic redirects are not in the fixed routing map',
    );
    assert.deepEqual(codes(warnings), [
      { code: 'redirect-unknown-param', path: '/v/:handle', dropped: true },
    ]);
  },

  'validateHostRoutes: a field match names a card type': async (assert) => {
    let { routes, warnings } = validate([
      fieldMatch(
        '/posts/:slug',
        'Post',
        { slug: ':slug' },
        {
          where: { eq: { published: true } },
        },
      ),
      fieldMatch('/a/:city', 'Address', { city: ':city' }),
      fieldMatch('/b/:slug', 'Missing', { slug: ':slug' }),
      { path: '/c/:slug', type: 'not-a-ref', match: { slug: ':slug' } },
    ]);
    assert.deepEqual(paths(routes), ['/posts/:slug']);
    let post = routes[0]!;
    if (post.kind !== 'field-match') {
      assert.ok(false, 'expected a field match');
      return;
    }
    assert.strictEqual(post.typeKey, `${MODULE}/Post`);
    assert.deepEqual(post.match, [{ field: 'slug', param: 'slug' }]);
    assert.deepEqual(post.where, { eq: { published: true } });
    assert.deepEqual(codes(warnings), [
      { code: 'not-card-type', path: '/a/:city', dropped: true },
      { code: 'not-card-type', path: '/b/:slug', dropped: true },
      { code: 'invalid-type', path: '/c/:slug', dropped: true },
    ]);
  },

  'validateHostRoutes: each :name is matched by exactly one field': async (
    assert,
  ) => {
    let { routes, warnings } = validate([
      fieldMatch('/ok/:author/:slug', 'Post', {
        slug: ':slug',
        'author.slug': ':author',
      }),
      fieldMatch('/a/:slug/:other', 'Post', { slug: ':slug' }),
      fieldMatch('/b/:slug', 'Post', { slug: ':slug', title: ':slug' }),
      fieldMatch('/c/:slug', 'Post', { slug: 'slug' }),
      fieldMatch('/d/:slug', 'Post', { title: ':slug' }),
      fieldMatch('/e/:slug', 'Post', { slug: ':missing' }),
    ]);
    assert.deepEqual(paths(routes), ['/ok/:author/:slug']);
    let route = routes[0]!;
    assert.deepEqual(
      route.kind === 'field-match' ? route.match : undefined,
      [
        { field: 'author.slug', param: 'author' },
        { field: 'slug', param: 'slug' },
      ],
      'match is in path order',
    );
    assert.deepEqual(codes(warnings), [
      { code: 'invalid-match', path: '/a/:slug/:other', dropped: true },
      { code: 'invalid-match', path: '/b/:slug', dropped: true },
      { code: 'invalid-match', path: '/c/:slug', dropped: true },
      { code: 'unknown-field', path: '/d/:slug', dropped: true },
      { code: 'invalid-match', path: '/e/:slug', dropped: true },
    ]);
  },

  'validateHostRoutes: where must be client-evaluable': async (assert) => {
    let { routes, warnings } = validate([
      fieldMatch(
        '/a/:slug',
        'Post',
        { slug: ':slug' },
        {
          where: { any: [{ eq: { tag: 'a' } }, { not: { eq: { tag: 'b' } } }] },
        },
      ),
      fieldMatch(
        '/b/:slug',
        'Post',
        { slug: ':slug' },
        {
          where: { matches: { title: 'hello' } },
        },
      ),
      fieldMatch(
        '/c/:slug',
        'Post',
        { slug: ':slug' },
        {
          where: { bogus: true },
        },
      ),
    ]);
    assert.deepEqual(paths(routes), ['/a/:slug']);
    assert.deepEqual(codes(warnings), [
      { code: 'invalid-where', path: '/b/:slug', dropped: true },
      { code: 'invalid-where', path: '/c/:slug', dropped: true },
    ]);
  },

  'validateHostRoutes: a child route infers its one link to its parent': async (
    assert,
  ) => {
    let { routes, warnings } = validate([
      fieldMatch(
        '/people/:person',
        'Person',
        { slug: ':person' },
        {
          routes: [fieldMatch('/posts/:post', 'Post', { slug: ':post' })],
        },
      ),
    ]);
    assert.deepEqual(warnings, []);
    let child = routes[0]!.routes[0]!;
    assert.strictEqual(child.fullPath, '/people/:person/posts/:post');
    assert.deepEqual(child.paramNames, ['person', 'post']);
    assert.deepEqual(
      child.kind === 'field-match' ? child.parentLink : undefined,
      { field: 'author', side: 'child', kind: 'linksTo', inferred: true },
    );
  },

  'validateHostRoutes: two links between the types need parent': async (
    assert,
  ) => {
    let { routes, warnings } = validate([
      fieldMatch(
        '/c/:category',
        'Category',
        { slug: ':category' },
        {
          routes: [
            fieldMatch('/:product', 'Product', { slug: ':product' }),
            fieldMatch(
              '/p/:product',
              'Product',
              { slug: ':product' },
              {
                parent: 'category',
              },
            ),
            fieldMatch(
              '/q/:product',
              'Product',
              { slug: ':product' },
              {
                parent: 'slug',
              },
            ),
          ],
        },
      ),
    ]);
    assert.deepEqual(paths(routes), [
      '/c/:category',
      '/c/:category/p/:product',
    ]);
    let named = routes[0]!.routes[0]!;
    assert.deepEqual(
      named.kind === 'field-match' ? named.parentLink : undefined,
      { field: 'category', side: 'child', kind: 'linksTo', inferred: false },
    );
    assert.deepEqual(codes(warnings), [
      {
        code: 'invalid-parent-link',
        path: '/c/:category/:product',
        dropped: true,
      },
      {
        code: 'invalid-parent-link',
        path: '/c/:category/q/:product',
        dropped: true,
      },
    ]);
    assert.true(
      warnings[0]!.message.includes('child.category') &&
        warnings[0]!.message.includes('parent.products'),
      `the warning names the candidates: ${warnings[0]!.message}`,
    );
  },

  'validateHostRoutes: a link on its own type is read by its kind': async (
    assert,
  ) => {
    let { routes, warnings } = validate([
      fieldMatch(
        '/:person',
        'Person',
        { slug: ':person' },
        {
          routes: [
            fieldMatch(
              '/friend-of/:a',
              'Person',
              { slug: ':a' },
              {
                parent: 'friendOf',
              },
            ),
            fieldMatch(
              '/friends/:b',
              'Person',
              { slug: ':b' },
              {
                parent: 'friends',
              },
            ),
            fieldMatch('/any/:c', 'Person', { slug: ':c' }),
          ],
        },
      ),
    ]);
    let [friendOf, friends] = routes[0]!.routes;
    assert.deepEqual(
      friendOf?.kind === 'field-match' ? friendOf.parentLink : undefined,
      { field: 'friendOf', side: 'child', kind: 'linksTo', inferred: false },
    );
    assert.deepEqual(
      friends?.kind === 'field-match' ? friends.parentLink : undefined,
      {
        field: 'friends',
        side: 'parent',
        kind: 'linksToMany',
        inferred: false,
      },
    );
    assert.deepEqual(
      codes(warnings).filter((w) => w.dropped),
      [{ code: 'invalid-parent-link', path: '/:person/any/:c', dropped: true }],
    );
  },

  'validateHostRoutes: a child with no link to its parent is dropped': async (
    assert,
  ) => {
    let { routes, warnings } = validate([
      fieldMatch(
        '/posts/:post',
        'Post',
        { slug: ':post' },
        {
          routes: [fieldMatch('/items/:item', 'Item', { slug: ':item' })],
        },
      ),
    ]);
    assert.deepEqual(paths(routes), ['/posts/:post']);
    assert.deepEqual(codes(warnings), [
      {
        code: 'invalid-parent-link',
        path: '/posts/:post/items/:item',
        dropped: true,
      },
    ]);
  },

  'validateHostRoutes: a card id template under a dynamic route': async (
    assert,
  ) => {
    let { routes, warnings } = validate([
      {
        path: '/c/:category',
        card: './Category/:category',
        routes: [
          // The id carries the nesting: no link needed.
          { path: '/:product', card: './c/:category/:product' },
          // Neither type is known, so the link must be named.
          { path: '/x/:product', card: './Product/:product' },
          {
            path: '/y/:product',
            card: './Product/:product',
            parent: 'category',
          },
        ],
      },
    ]);
    assert.deepEqual(paths(routes), [
      '/c/:category',
      '/c/:category/:product',
      '/c/:category/y/:product',
    ]);
    let [embedded, named] = routes[0]!.routes;
    assert.strictEqual(
      embedded?.kind === 'card-id' ? embedded.parentLink : 'missing',
      undefined,
    );
    assert.deepEqual(named?.kind === 'card-id' ? named.parentLink : undefined, {
      field: 'category',
      side: 'unverified',
      inferred: false,
    });
    assert.deepEqual(
      codes(warnings).filter((w) => w.dropped),
      [
        {
          code: 'invalid-parent-link',
          path: '/c/:category/x/:product',
          dropped: true,
        },
      ],
    );
  },

  'validateHostRoutes: a child of a fixed route needs no link': async (
    assert,
  ) => {
    let { routes, warnings } = validate([
      {
        path: '/blog',
        instance: instance('blog'),
        routes: [
          fieldMatch('/:slug', 'Post', { slug: ':slug' }),
          { path: '/about', instance: instance('about') },
        ],
      },
    ]);
    assert.deepEqual(warnings, []);
    assert.deepEqual(paths(routes), ['/blog', '/blog/:slug', '/blog/about']);
    let child = routes[0]!.routes[0]!;
    assert.strictEqual(
      child.kind === 'field-match' ? child.parentLink : 'missing',
      undefined,
    );
    assert.deepEqual(
      hostRoutingMapFromRoutes(routes),
      [{ path: '/blog', id: `${REALM}blog` }],
      'nested routes are not in the fixed routing map',
    );
  },

  'validateHostRoutes: a fixed route under a dynamic route is dropped': async (
    assert,
  ) => {
    let { routes, warnings } = validate([
      fieldMatch(
        '/p/:slug',
        'Post',
        { slug: ':slug' },
        {
          routes: [
            { path: '/about', instance: instance('about') },
            { path: '/old', redirectTo: '/p/:slug' },
          ],
        },
      ),
      {
        path: '/r',
        redirectTo: '/x',
        routes: [{ path: '/y', instance: instance('y') }],
      },
    ]);
    assert.deepEqual(paths(routes), ['/p/:slug', '/p/:slug/old', '/r']);
    assert.deepEqual(codes(warnings), [
      {
        code: 'fixed-route-with-params',
        path: '/p/:slug/about',
        dropped: true,
      },
      { code: 'redirect-with-children', path: '/r/y', dropped: true },
    ]);
  },

  'validateHostRoutes: a dropped route drops its children': async (assert) => {
    let { routes, warnings } = validate([
      fieldMatch(
        '/bad/:slug',
        'Missing',
        { slug: ':slug' },
        {
          routes: [
            fieldMatch(
              '/:post',
              'Post',
              { slug: ':post' },
              {
                routes: [{ path: '/deep/:x', card: './X/:x' }],
              },
            ),
          ],
        },
      ),
    ]);
    assert.deepEqual(routes, []);
    assert.deepEqual(codes(warnings), [
      { code: 'not-card-type', path: '/bad/:slug', dropped: true },
      { code: 'parent-dropped', path: '/bad/:slug/:post', dropped: true },
      {
        code: 'parent-dropped',
        path: '/bad/:slug/:post/deep/:x',
        dropped: true,
      },
    ]);
    assert.deepEqual(warnings[2]!.position, [0, 0, 0]);
  },

  'validateHostRoutes: route names are unique in the realm': async (assert) => {
    let { routes, warnings } = validate([
      { path: '/', name: 'home', instance: instance('home') },
      {
        path: '/blog',
        instance: instance('blog'),
        routes: [
          {
            path: '/:id',
            name: 'home',
            card: './Post/:id',
            routes: [{ path: '/x', redirectTo: '/' }],
          },
          { path: '/feed', name: 'feed', instance: instance('feed') },
        ],
      },
      { path: '/feed', name: 'feed2', instance: instance('feed') },
      // A top-level fixed route ignores a name that isn't a string; any
      // other route is dropped for it.
      { path: '/n/:id', name: 7, card: './N/:id' },
    ]);
    assert.deepEqual(paths(routes), ['/', '/blog', '/blog/feed', '/feed']);
    assert.deepEqual(codes(warnings), [
      { code: 'invalid-name', path: '/n/:id', dropped: true },
      { code: 'duplicate-name', path: '/blog/:id', dropped: true },
      { code: 'parent-dropped', path: '/blog/:id/x', dropped: true },
    ]);
  },

  'validateHostRoutes: two fixed routes cannot share a path': async (
    assert,
  ) => {
    let { routes, warnings } = validate([
      { path: '/pricing', instance: instance('a') },
      { path: '/pricing/', instance: instance('b') },
      { path: '/pricing', redirectTo: '/elsewhere' },
      {
        path: '/docs',
        instance: instance('docs'),
        routes: [{ path: '/intro', instance: instance('intro') }],
      },
      { path: '/docs/intro', instance: instance('intro2') },
      // Dynamic siblings may share a pattern.
      fieldMatch('/:slug', 'Post', { slug: ':slug' }),
      fieldMatch('/:slug', 'Person', { slug: ':slug' }),
    ]);
    assert.deepEqual(hostRoutingMapFromRoutes(routes), [
      { path: '/pricing', id: `${REALM}a` },
      { path: '/docs', id: `${REALM}docs` },
    ]);
    assert.deepEqual(paths(routes), [
      '/pricing',
      '/docs',
      '/docs/intro',
      '/:slug',
      '/:slug',
    ]);
    assert.deepEqual(codes(warnings), [
      { code: 'duplicate-path', path: '/pricing', dropped: true },
      { code: 'duplicate-path', path: '/pricing', dropped: true },
      { code: 'duplicate-path', path: '/docs/intro', dropped: true },
    ]);
  },

  'validateHostRoutes: at most 20 dynamic routes': async (assert) => {
    let rules: RawHostRoutingRule[] = [
      { path: '/', instance: instance('home') },
    ];
    for (let i = 0; i < 21; i++) {
      rules.push({ path: `/r${i}/:id`, card: `./R${i}/:id` });
    }
    rules.push({ path: '/about', instance: instance('about') });
    let { routes, warnings } = validate(rules);
    assert.strictEqual(routes.length, 22, '20 dynamic routes and 2 fixed');
    assert.deepEqual(codes(warnings), [
      { code: 'dynamic-route-limit', path: '/r20/:id', dropped: true },
    ]);
    let small = validate(rules.slice(0, 4), { maxDynamicRoutes: 2 });
    assert.deepEqual(paths(small.routes), ['/', '/r0/:id', '/r1/:id']);
  },

  'validateHostRoutes: a top-level fixed route keeps the path rules it had':
    async (assert) => {
      let { routes, warnings } = validate([
        // A segment that starts with `:` is literal text, as it always was.
        { path: '/talks/:2024', instance: instance('talks-2024') },
        { path: '/:about', instance: instance('about') },
        { path: '/old/:page', redirectTo: '/new' },
        // These routes never had names, so a name that isn't a string is
        // ignored rather than dropping the route.
        { path: '/named', instance: instance('named'), name: 42 },
        // A redirect whose target uses a :name is a dynamic redirect.
        { path: '/go/:slug', redirectTo: '/p/:slug' },
      ]);
      assert.deepEqual(hostRoutingMapFromRoutes(routes), [
        { path: '/talks/:2024', id: `${REALM}talks-2024` },
        { path: '/:about', id: `${REALM}about` },
        { path: '/old/:page', redirectTo: '/new', statusCode: 302 },
        { path: '/named', id: `${REALM}named` },
      ]);
      assert.deepEqual(codes(warnings), [
        { code: 'invalid-name', path: '/named', dropped: false },
      ]);
      let literal = routes[1]!;
      assert.deepEqual(
        [literal.paramNames, literal.kind === 'fixed-card' && literal.pattern],
        [[], undefined],
        'a literal path has no :names and no pattern',
      );
      let named = routes[3]!;
      assert.strictEqual(named.name, undefined);
      let dynamic = routes[4]!;
      assert.deepEqual(
        [dynamic.kind, dynamic.paramNames],
        ['redirect', ['slug']],
      );
    },

  'validateHostRoutes: a duplicate fixed route takes no part in a redirect cycle':
    async (assert) => {
      let { routes, warnings } = validate([
        { path: '/a', redirectTo: '/b' },
        { path: '/b', instance: instance('b') },
        { path: '/b', redirectTo: '/a' },
      ]);
      assert.deepEqual(hostRoutingMapFromRoutes(routes), [
        { path: '/a', redirectTo: '/b', statusCode: 302 },
        { path: '/b', id: `${REALM}b` },
      ]);
      assert.deepEqual(codes(warnings), [
        { code: 'duplicate-path', path: '/b', dropped: true },
      ]);
    },

  'validateHostRoutes: a named parent link known only on the parent type is unverified':
    async (assert) => {
      let { routes, warnings } = validate([
        fieldMatch(
          '/posts/:post',
          'Post',
          { slug: ':post' },
          {
            // Post has an author link, but the comment card may hold an
            // author link of its own.
            routes: [
              {
                path: '/:comment',
                card: './Comment/:comment',
                parent: 'author',
              },
            ],
          },
        ),
        {
          path: '/c/:category',
          card: './Category/:category',
          routes: [
            fieldMatch(
              '/:post',
              'Post',
              { slug: ':post' },
              { parent: 'author' },
            ),
          ],
        },
      ]);
      let comment = routes[0]!.routes[0]!;
      assert.deepEqual(
        comment.kind === 'card-id' ? comment.parentLink : undefined,
        { field: 'author', side: 'unverified', inferred: false },
      );
      let post = routes[1]!.routes[0]!;
      assert.deepEqual(
        post.kind === 'field-match' ? post.parentLink : undefined,
        { field: 'author', side: 'child', kind: 'linksTo', inferred: false },
        'a link field on the known child type is on the child',
      );
      assert.deepEqual(warnings, [], 'no warning that one card has no address');
    },

  'validateHostRoutes: warns when one card gets no address': async (assert) => {
    let { routes, warnings } = validate([
      fieldMatch(
        '/shelves/:shelf',
        'Shelf',
        { slug: ':shelf' },
        {
          routes: [fieldMatch('/:item', 'Item', { slug: ':item' })],
        },
      ),
    ]);
    assert.deepEqual(paths(routes), [
      '/shelves/:shelf',
      '/shelves/:shelf/:item',
    ]);
    assert.deepEqual(codes(warnings), [
      {
        code: 'no-address-from-one-card',
        path: '/shelves/:shelf/:item',
        dropped: false,
      },
    ]);

    let withOwnRoute = validate([
      fieldMatch(
        '/shelves/:shelf',
        'Shelf',
        { slug: ':shelf' },
        {
          routes: [fieldMatch('/:item', 'Item', { slug: ':item' })],
        },
      ),
      fieldMatch('/items/:item', 'Item', { slug: ':item' }),
    ]);
    assert.deepEqual(
      withOwnRoute.warnings,
      [],
      'no warning when the type has a route of its own',
    );

    let childHoldsLink = validate([
      fieldMatch(
        '/people/:person',
        'Person',
        { slug: ':person' },
        {
          routes: [fieldMatch('/posts/:post', 'Post', { slug: ':post' })],
        },
      ),
    ]);
    assert.deepEqual(
      childHoldsLink.warnings,
      [],
      'no warning when the child links to its parent',
    );
  },
  'validateHostRoutes: match takes primitive fields only': async (assert) => {
    let { routes, warnings } = validate([
      fieldMatch('/a/:author', 'Post', { 'author.slug': ':author' }),
      fieldMatch('/b/:author', 'Post', { author: ':author' }),
      fieldMatch('/c/:place', 'Post', { place: ':place' }),
      fieldMatch('/d/:city', 'Post', { 'place.city': ':city' }),
    ]);
    assert.deepEqual(paths(routes), ['/a/:author', '/d/:city']);
    assert.deepEqual(codes(warnings), [
      { code: 'invalid-match', path: '/b/:author', dropped: true },
      { code: 'invalid-match', path: '/c/:place', dropped: true },
    ]);
  },

  'validateHostRoutes: an unavailable type makes the validation incomplete':
    async (assert) => {
      let complete = validate([
        fieldMatch('/posts/:slug', 'Post', { slug: ':slug' }),
        fieldMatch('/missing/:slug', 'Missing', { slug: ':slug' }),
      ]);
      assert.true(
        complete.complete,
        'a type that does not exist is final: the route is dropped for good',
      );

      let {
        routes,
        warnings,
        complete: isComplete,
      } = validate([
        { path: '/', instance: instance('home') },
        fieldMatch('/later/:slug', 'Pending', { slug: ':slug' }),
        fieldMatch('/posts/:slug', 'Post', { slug: ':slug' }),
      ]);
      assert.false(isComplete, 'the validation is not final');
      assert.deepEqual(paths(routes), ['/', '/posts/:slug']);
      assert.deepEqual(codes(warnings), [
        { code: 'type-unavailable', path: '/later/:slug', dropped: true },
      ]);
      assert.deepEqual(hostRoutingMapFromRoutes(routes), [
        { path: '/', id: `${REALM}home` },
      ]);
    },
  'validateHostRoutes: a link to a type the parent descends from counts':
    async (assert) => {
      let { routes, warnings } = validate([
        fieldMatch(
          '/cities/:city',
          'City',
          { slug: ':city' },
          {
            routes: [fieldMatch('/:venue', 'Venue', { slug: ':venue' })],
          },
        ),
        fieldMatch(
          '/bare/:city',
          'BareCity',
          { slug: ':city' },
          {
            routes: [fieldMatch('/:venue', 'Venue', { slug: ':venue' })],
          },
        ),
      ]);
      let venue = routes[0]!.routes[0];
      assert.deepEqual(
        venue?.kind === 'field-match' ? venue.parentLink : undefined,
        { field: 'place', side: 'child', kind: 'linksTo', inferred: true },
        "the venue's link to Place connects it to a City",
      );
      assert.deepEqual(
        codes(warnings),
        [
          {
            code: 'invalid-parent-link',
            path: '/bare/:city/:venue',
            dropped: true,
          },
        ],
        'without the adoption chain, the link does not count',
      );
    },
});

export default tests;
