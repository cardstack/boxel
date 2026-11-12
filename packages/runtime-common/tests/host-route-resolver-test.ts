import {
  resolveHostRoute,
  type HostRouteCard,
  type HostRouteLoadRequest,
  type HostRouteResolution,
  type HostRouteSearchRequest,
} from '../host-route-resolver.ts';
import {
  validateHostRoutes,
  type HostRoute,
  type HostRouteTypeInfo,
} from '../host-routes.ts';
import type { RawHostRoutingRule } from '../realm.ts';
import type { ResolvedCodeRef } from '../code-ref.ts';
import type { Filter } from '../query.ts';
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

const contains = { type: 'contains' as const };
const linksTo = (name: string) => ({
  type: 'linksTo' as const,
  target: `${MODULE}/${name}`,
});
const linksToMany = (name: string) => ({
  type: 'linksToMany' as const,
  target: `${MODULE}/${name}`,
});

const TYPES: Record<string, HostRouteTypeInfo> = {
  Person: cardType('Person', { slug: contains }),
  Page: cardType('Page', { slug: contains }),
  Post: cardType('Post', {
    slug: contains,
    status: contains,
    author: linksTo('Person'),
  }),
  Category: cardType('Category', { slug: contains }),
  Product: cardType('Product', {
    slug: contains,
    category: linksTo('Category'),
  }),
  // Only the shelf holds the link.
  Shelf: cardType('Shelf', { slug: contains, items: linksToMany('Item') }),
  Item: cardType('Item', { slug: contains }),
};

function type(name: string): ResolvedCodeRef {
  return { module: MODULE, name } as ResolvedCodeRef;
}

function routesFor(rules: RawHostRoutingRule[]): readonly HostRoute[] {
  let { routes, warnings } = validateHostRoutes(rules, {
    realmURL: new URL(REALM),
    lookupType: (ref) => (ref.module === MODULE ? TYPES[ref.name] : undefined),
  });
  let dropped = warnings.filter((w) => w.dropped);
  if (dropped.length > 0) {
    throw new Error(`test routes were dropped: ${JSON.stringify(dropped)}`);
  }
  return routes;
}

function fieldMatch(
  path: string,
  typeName: string,
  match: Record<string, string>,
  extra: RawHostRoutingRule = {},
): RawHostRoutingRule {
  return { path, type: type(typeName), match, ...extra };
}

// A card in the fake realm. `id` is relative to the realm unless it is an
// absolute URL.
interface FakeCard {
  id: string;
  type?: string;
  fields?: Record<string, string>;
  links?: Record<string, string[]>;
  // A card the visitor can't read.
  private?: boolean;
}

function abs(id: string): string {
  return new URL(id, REALM).href;
}

// Answers `load` and `search` from a list of cards, as a visitor who can't
// read the private ones, and records each call.
class FakeRealm {
  loads: HostRouteLoadRequest[] = [];
  searches: HostRouteSearchRequest[] = [];
  failLoad = new Set<string>();
  failSearch = new Set<string>();
  private cards: FakeCard[];

  constructor(cards: FakeCard[]) {
    this.cards = cards.map((card) => ({
      ...card,
      id: abs(card.id),
      links: card.links
        ? Object.fromEntries(
            Object.entries(card.links).map(([f, ids]) => [f, ids.map(abs)]),
          )
        : undefined,
    }));
  }

  load = async (request: HostRouteLoadRequest) => {
    this.loads.push(request);
    if (this.failLoad.has(request.id)) {
      throw new Error(`load of ${request.id} refused`);
    }
    let card = this.cards.find((c) => c.id === request.id && !c.private);
    return card ? this.view(card, request.linkFields) : undefined;
  };

  search = async (request: HostRouteSearchRequest) => {
    this.searches.push(request);
    if (this.failSearch.has(request.type.name)) {
      throw new Error(`search for ${request.type.name} failed`);
    }
    return this.cards
      .filter(
        (c) =>
          !c.private &&
          c.type === request.type.name &&
          matches(c, request.filter),
      )
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((c) => this.view(c, request.linkFields));
  };

  private view(card: FakeCard, linkFields: readonly string[]): HostRouteCard {
    let links: Record<string, string[]> = {};
    for (let field of linkFields) {
      if (card.links?.[field]) {
        links[field] = card.links[field]!;
      }
    }
    return { id: card.id, links };
  }
}

// Enough of a filter evaluator for the filters the resolver builds.
function matches(card: FakeCard, filter: Filter): boolean {
  if ('every' in filter) {
    return filter.every.every((f) => matches(card, f));
  }
  if ('eq' in filter) {
    return Object.entries(filter.eq).every(
      ([field, value]) => card.fields?.[field] === value,
    );
  }
  throw new Error(`unsupported filter ${JSON.stringify(filter)}`);
}

async function resolve(
  rules: RawHostRoutingRule[],
  realm: FakeRealm,
  path: string,
): Promise<HostRouteResolution> {
  return resolveHostRoute({
    path,
    routes: routesFor(rules),
    realmURL: new URL(REALM),
    load: realm.load,
    search: realm.search,
  });
}

function cardIdOf(result: HostRouteResolution): string | undefined {
  return result.kind === 'card' || result.kind === 'alias'
    ? result.cardId
    : undefined;
}

function tried(result: HostRouteResolution) {
  return result.trace.map((step) => ({
    path: step.fullPath,
    outcome: step.outcome,
    ...(step.reason ? { reason: step.reason } : {}),
  }));
}

const tests: SharedTests<unknown> = Object.freeze({
  'resolveHostRoute: a card id template loads its card by id': async (
    assert,
  ) => {
    let realm = new FakeRealm([{ id: 'Person/writer-a' }]);
    let rules = [{ path: '/people/:person_id', card: './Person/:person_id' }];
    let result = await resolve(rules, realm, '/people/writer-a');
    assert.strictEqual(result.kind, 'card');
    assert.strictEqual(cardIdOf(result), abs('Person/writer-a'));
    assert.deepEqual(
      result.kind === 'card' ? result.params : undefined,
      { person_id: 'writer-a' },
      'returns the matched values',
    );
    assert.deepEqual(
      realm.loads.map((l) => l.id),
      [abs('Person/writer-a')],
      'loads the filled id once',
    );
    assert.strictEqual(realm.searches.length, 0, 'runs no search');
    assert.deepEqual(result.trace[0]?.lookup, {
      kind: 'load',
      id: abs('Person/writer-a'),
      found: true,
    });
  },

  'resolveHostRoute: a percent-encoded segment is decoded once': async (
    assert,
  ) => {
    let realm = new FakeRealm([
      { id: 'Person/wrïter' },
      { id: 'Post/a', type: 'Post', fields: { slug: 'hello world' } },
    ]);
    let rules = [
      { path: '/people/:person_id', card: './Person/:person_id' },
      fieldMatch('/posts/:slug', 'Post', { slug: ':slug' }),
    ];
    let person = await resolve(rules, realm, '/people/wr%C3%AFter');
    assert.strictEqual(
      cardIdOf(person),
      new URL('Person/wrïter', REALM).href,
      'the decoded value fills the card id',
    );
    let post = await resolve(rules, realm, '/posts/hello%20world');
    assert.strictEqual(cardIdOf(post), abs('Post/a'));
    assert.deepEqual(
      (realm.searches[0]?.filter as { every: Filter[] }).every[0],
      { eq: { slug: 'hello world' } },
      'the search compares the decoded value',
    );
  },

  'resolveHostRoute: a trailing slash is ignored and a malformed path matches nothing':
    async (assert) => {
      let realm = new FakeRealm([{ id: 'Person/writer-a' }]);
      let rules = [{ path: '/people/:person_id', card: './Person/:person_id' }];
      assert.strictEqual(
        cardIdOf(await resolve(rules, realm, '/people/writer-a/')),
        abs('Person/writer-a'),
        'one trailing slash is ignored',
      );
      for (let path of [
        '/people//writer-a',
        '/people/%E0%A4%A',
        'people/writer-a',
      ]) {
        let result = await resolve(rules, realm, path);
        assert.deepEqual(
          result.kind === 'nothing' ? result.reason : result.kind,
          'invalid-path',
          `${path} is not a request path`,
        );
      }
      let tooLong = await resolve(rules, realm, '/people/writer-a/extra');
      assert.deepEqual(
        tooLong.kind === 'nothing' ? tooLong.reason : tooLong.kind,
        'no-matching-route',
        'a route without children matches only the whole path',
      );
    },

  'resolveHostRoute: a field match searches with one eq per field and the where':
    async (assert) => {
      let realm = new FakeRealm([
        {
          id: 'Post/b',
          type: 'Post',
          fields: { slug: 'hello', status: 'published' },
        },
        {
          id: 'Post/a',
          type: 'Post',
          fields: { slug: 'hello', status: 'draft' },
        },
        {
          id: 'Post/c',
          type: 'Post',
          fields: { slug: 'hello', status: 'published' },
        },
      ]);
      let rules = [
        fieldMatch(
          '/posts/:slug',
          'Post',
          { slug: ':slug' },
          { where: { eq: { status: 'published' } } },
        ),
      ];
      let result = await resolve(rules, realm, '/posts/hello');
      assert.deepEqual(realm.searches[0]?.filter, {
        on: type('Post'),
        every: [{ eq: { slug: 'hello' } }, { eq: { status: 'published' } }],
      });
      assert.deepEqual(realm.searches[0]?.type, type('Post'));
      assert.strictEqual(realm.loads.length, 0, 'loads nothing by id');
      assert.strictEqual(
        cardIdOf(result),
        abs('Post/b'),
        'two published cards share the value: the first in id order wins',
      );
      assert.deepEqual(result.trace[0]?.lookup, {
        kind: 'search',
        type: type('Post'),
        filter: realm.searches[0]!.filter,
        resultCount: 2,
      });
    },

  'resolveHostRoute: literal segments go before :name segments': async (
    assert,
  ) => {
    let realm = new FakeRealm([
      { id: 'Game/LAMB' },
      { id: 'lamb-special' },
      { id: 'Post/1', type: 'Post', fields: { slug: 'edit' } },
    ]);
    let rules: RawHostRoutingRule[] = [
      { path: '/play/:code', card: './Game/:code' },
      { path: '/play/LAMB', instance: { id: abs('lamb-special') } },
      { path: '/:section/edit', card: './Section/:section' },
      fieldMatch('/posts/:slug', 'Post', { slug: ':slug' }),
    ];
    let lamb = await resolve(rules, realm, '/play/LAMB');
    assert.strictEqual(
      cardIdOf(lamb),
      abs('lamb-special'),
      'the fixed route wins over the earlier dynamic one',
    );
    assert.strictEqual(realm.loads.length, 0, 'a fixed route loads nothing');
    let other = await resolve(rules, realm, '/play/LAMB2');
    assert.strictEqual(cardIdOf(other), undefined);
    assert.deepEqual(tried(other), [
      { path: '/play/:code', outcome: 'miss', reason: 'not-found' },
    ]);
    let posts = await resolve(rules, realm, '/posts/edit');
    assert.strictEqual(
      cardIdOf(posts),
      abs('Post/1'),
      'a literal first segment goes before a :name first segment',
    );
    assert.deepEqual(tried(posts), [
      { path: '/posts/:slug', outcome: 'resolved' },
    ]);
  },

  'resolveHostRoute: a miss or an unreadable card falls through to the next sibling':
    async (assert) => {
      let realm = new FakeRealm([
        { id: 'Page/about', type: 'Page', fields: { slug: 'about' } },
        {
          id: 'Page/secret',
          type: 'Page',
          fields: { slug: 'secret' },
          private: true,
        },
        { id: 'Post/1', type: 'Post', fields: { slug: 'hello' } },
        { id: 'Post/2', type: 'Post', fields: { slug: 'secret' } },
        { id: 'Legacy/secret', private: true },
      ]);
      let rules = [
        fieldMatch('/:slug', 'Page', { slug: ':slug' }),
        { path: '/:id', card: './Legacy/:id' },
        fieldMatch('/:post', 'Post', { slug: ':post' }),
      ];
      let page = await resolve(rules, realm, '/about');
      assert.strictEqual(cardIdOf(page), abs('Page/about'));
      assert.deepEqual(tried(page), [{ path: '/:slug', outcome: 'resolved' }]);

      let post = await resolve(rules, realm, '/hello');
      assert.strictEqual(cardIdOf(post), abs('Post/1'));
      assert.deepEqual(tried(post), [
        { path: '/:slug', outcome: 'miss', reason: 'no-results' },
        { path: '/:id', outcome: 'miss', reason: 'not-found' },
        { path: '/:post', outcome: 'resolved' },
      ]);

      let secret = await resolve(rules, realm, '/secret');
      assert.strictEqual(
        cardIdOf(secret),
        abs('Post/2'),
        'cards the visitor cannot read count as misses',
      );

      let none = await resolve(rules, realm, '/nowhere');
      assert.deepEqual(
        none.kind === 'nothing' ? none.reason : none.kind,
        'every-route-missed',
      );
      assert.strictEqual(none.trace.length, 3, 'each sibling was tried');
    },

  'resolveHostRoute: a failed lookup is an error, not a miss': async (
    assert,
  ) => {
    let realm = new FakeRealm([
      { id: 'Post/1', type: 'Post', fields: { slug: 'hello' } },
    ]);
    let rules = [
      { path: '/:id', card: './Legacy/:id' },
      fieldMatch('/:post', 'Post', { slug: ':post' }),
    ];
    realm.failLoad.add(abs('Legacy/hello'));
    let result = await resolve(rules, realm, '/hello');
    assert.strictEqual(result.kind, 'error');
    assert.strictEqual(
      result.kind === 'error' ? (result.error as Error).message : undefined,
      `load of ${abs('Legacy/hello')} refused`,
      'carries what the lookup rejected with',
    );
    assert.deepEqual(
      result.kind === 'error' ? result.position : undefined,
      [0],
    );
    assert.strictEqual(
      realm.searches.length,
      0,
      'the next sibling is not tried',
    );
    assert.deepEqual(tried(result), [{ path: '/:id', outcome: 'error' }]);

    realm.failLoad.clear();
    realm.failSearch.add('Post');
    let searchFailed = await resolve(rules, realm, '/hello');
    assert.strictEqual(searchFailed.kind, 'error', 'a failed search too');
  },

  'resolveHostRoute: a child route resolves within its parent card (link on the child)':
    async (assert) => {
      let realm = new FakeRealm([
        { id: 'Category/shoes', type: 'Category', fields: { slug: 'shoes' } },
        { id: 'Category/hats', type: 'Category', fields: { slug: 'hats' } },
        {
          id: 'Product/1',
          type: 'Product',
          fields: { slug: 'classic' },
          links: { category: ['Category/hats'] },
        },
        {
          id: 'Product/2',
          type: 'Product',
          fields: { slug: 'classic' },
          links: { category: ['Category/shoes'] },
        },
        {
          id: 'Product/3',
          type: 'Product',
          fields: { slug: 'trail-runner' },
          links: { category: ['Category/shoes'] },
        },
      ]);
      let rules = [
        fieldMatch(
          '/c/:category',
          'Category',
          { slug: ':category' },
          {
            routes: [fieldMatch('/:product', 'Product', { slug: ':product' })],
          },
        ),
      ];
      let classic = await resolve(rules, realm, '/c/shoes/classic');
      assert.strictEqual(
        cardIdOf(classic),
        abs('Product/2'),
        'the value only has to be unique within the parent',
      );
      assert.deepEqual(
        realm.searches.map((s) => s.linkFields),
        [[], ['category']],
        'the child search asks for the link field on the child',
      );
      let hatsClassic = await resolve(rules, realm, '/c/hats/classic');
      assert.strictEqual(cardIdOf(hatsClassic), abs('Product/1'));

      let wrongPair = await resolve(rules, realm, '/c/hats/trail-runner');
      assert.strictEqual(
        wrongPair.kind,
        'nothing',
        'a pair that does not belong',
      );
      assert.deepEqual(tried(wrongPair), [
        { path: '/c/:category', outcome: 'resolved' },
        {
          path: '/c/:category/:product',
          outcome: 'miss',
          reason: 'not-in-parent',
        },
      ]);

      let category = await resolve(rules, realm, '/c/shoes');
      assert.strictEqual(
        cardIdOf(category),
        abs('Category/shoes'),
        'the parent route serves its own card',
      );
    },

  'resolveHostRoute: a child route resolves within its parent card (link on the parent)':
    async (assert) => {
      let realm = new FakeRealm([
        {
          id: 'Shelf/top',
          type: 'Shelf',
          fields: { slug: 'top' },
          links: { items: ['Item/a'] },
        },
        { id: 'Shelf/low', type: 'Shelf', fields: { slug: 'low' } },
        { id: 'Item/a', type: 'Item', fields: { slug: 'apple' } },
      ]);
      let rules = [
        fieldMatch(
          '/shelves/:shelf',
          'Shelf',
          { slug: ':shelf' },
          { routes: [fieldMatch('/:item', 'Item', { slug: ':item' })] },
        ),
      ];
      let item = await resolve(rules, realm, '/shelves/top/apple');
      assert.strictEqual(cardIdOf(item), abs('Item/a'));
      assert.deepEqual(
        realm.searches.map((s) => s.linkFields),
        [['items'], []],
        'the parent search asks for the link field on the parent',
      );
      let elsewhere = await resolve(rules, realm, '/shelves/low/apple');
      assert.strictEqual(elsewhere.kind, 'nothing');
    },

  'resolveHostRoute: a card id template under a dynamic route': async (
    assert,
  ) => {
    let realm = new FakeRealm([
      { id: 'Person/writer-a', type: 'Person', fields: { slug: 'writer-a' } },
      { id: 'Person/writer-b', type: 'Person', fields: { slug: 'writer-b' } },
      { id: 'Post/1', links: { author: ['Person/writer-a'] } },
      { id: 'writer-a/notes/n1' },
    ]);
    let rules = [
      fieldMatch(
        '/people/:person',
        'Person',
        { slug: ':person' },
        {
          routes: [
            { path: '/notes/:note', card: './:person/notes/:note' },
            { path: '/posts/:post', card: './Post/:post', parent: 'author' },
          ],
        },
      ),
    ];
    let note = await resolve(rules, realm, '/people/writer-a/notes/n1');
    assert.strictEqual(
      cardIdOf(note),
      abs('writer-a/notes/n1'),
      'an id that carries the nesting needs no link',
    );
    let post = await resolve(rules, realm, '/people/writer-a/posts/1');
    assert.strictEqual(cardIdOf(post), abs('Post/1'));
    let notTheirs = await resolve(rules, realm, '/people/writer-b/posts/1');
    assert.strictEqual(
      notTheirs.kind,
      'nothing',
      'a named link of unverified side is read on both cards',
    );
    assert.deepEqual(
      realm.loads.map((l) => l.linkFields),
      [[], ['author'], ['author']],
    );
    assert.deepEqual(
      realm.searches.map((s) => s.linkFields),
      [['author'], ['author'], ['author']],
      'a link of unverified side is asked for on the parent too',
    );
  },

  'resolveHostRoute: once a level resolves, a child miss is nothing': async (
    assert,
  ) => {
    let realm = new FakeRealm([
      { id: 'Category/shoes', type: 'Category', fields: { slug: 'shoes' } },
      { id: 'Other/shoes/x' },
    ]);
    let rules: RawHostRoutingRule[] = [
      fieldMatch(
        '/c/:category',
        'Category',
        { slug: ':category' },
        {
          routes: [fieldMatch('/:product', 'Product', { slug: ':product' })],
        },
      ),
      { path: '/c/:a/:b', card: './Other/:a/:b' },
    ];
    let result = await resolve(rules, realm, '/c/shoes/x');
    assert.strictEqual(result.kind, 'nothing');
    assert.deepEqual(
      result.kind === 'nothing' ? result.reason : undefined,
      'every-route-missed',
    );
    assert.strictEqual(
      realm.loads.length,
      0,
      'the later sibling at the parent level is not tried',
    );

    let unmatched = await resolve(rules, realm, '/c/hats/x');
    assert.strictEqual(
      cardIdOf(unmatched),
      undefined,
      'a parent that misses lets its sibling try',
    );
    assert.deepEqual(
      realm.loads.map((l) => l.id),
      [abs('Other/hats/x')],
    );
  },

  'resolveHostRoute: a child of a fixed route needs no link': async (
    assert,
  ) => {
    let realm = new FakeRealm([
      { id: 'Post/1', type: 'Post', fields: { slug: 'hello' } },
    ]);
    let rules: RawHostRoutingRule[] = [
      {
        path: '/blog',
        instance: { id: abs('blog-index') },
        routes: [fieldMatch('/:slug', 'Post', { slug: ':slug' })],
      },
    ];
    assert.strictEqual(
      cardIdOf(await resolve(rules, realm, '/blog')),
      abs('blog-index'),
    );
    assert.strictEqual(
      cardIdOf(await resolve(rules, realm, '/blog/hello')),
      abs('Post/1'),
    );
  },

  'resolveHostRoute: a redirect copies :name values without a lookup': async (
    assert,
  ) => {
    let realm = new FakeRealm([]);
    let rules: RawHostRoutingRule[] = [
      { path: '/u/:handle', redirectTo: '/people/:handle', statusCode: 301 },
      {
        path: '/ext/:slug',
        redirectTo: 'https://blog.example.com/p/:slug?ref=site#top',
      },
      { path: '/tos', redirectTo: '/terms' },
    ];
    let internal = await resolve(rules, realm, '/u/wr%C3%AFter%20x');
    assert.deepEqual(
      internal.kind === 'redirect'
        ? {
            location: internal.location,
            external: internal.external,
            statusCode: internal.statusCode,
          }
        : internal.kind,
      { location: '/people/wr%C3%AFter%20x', external: false, statusCode: 301 },
    );
    let external = await resolve(rules, realm, '/ext/a%2Fb');
    assert.deepEqual(
      external.kind === 'redirect'
        ? {
            location: external.location,
            external: external.external,
            statusCode: external.statusCode,
          }
        : external.kind,
      {
        location: 'https://blog.example.com/p/a%2Fb?ref=site#top',
        external: true,
        statusCode: 302,
      },
    );
    let fixed = await resolve(rules, realm, '/tos');
    assert.deepEqual(
      fixed.kind === 'redirect' ? fixed.location : fixed.kind,
      '/terms',
    );
    assert.strictEqual(realm.loads.length + realm.searches.length, 0);
    assert.deepEqual(tried(internal), [
      { path: '/u/:handle', outcome: 'redirect' },
    ]);
  },

  'resolveHostRoute: an alias route resolves its card and leaves the canonical address to the caller':
    async (assert) => {
      let realm = new FakeRealm([
        { id: 'Person/writer-a', type: 'Person', fields: { slug: 'writer-a' } },
      ]);
      let rules: RawHostRoutingRule[] = [
        fieldMatch('/people/:slug', 'Person', { slug: ':slug' }),
        { path: '/p/:id', card: './Person/:id', statusCode: 301 },
      ];
      let result = await resolve(rules, realm, '/p/writer-a');
      assert.deepEqual(
        result.kind === 'alias'
          ? {
              cardId: result.cardId,
              statusCode: result.statusCode,
              position: result.position,
            }
          : result.kind,
        { cardId: abs('Person/writer-a'), statusCode: 301, position: [1] },
      );
      let missing = await resolve(rules, realm, '/p/nobody');
      assert.strictEqual(missing.kind, 'nothing', 'an alias can miss too');
    },

  'resolveHostRoute: the result must be in the routing realm': async (
    assert,
  ) => {
    let realm = new FakeRealm([
      {
        id: 'http://other.test/Post/1',
        type: 'Post',
        fields: { slug: 'hello' },
      },
      { id: 'Post/2', type: 'Post', fields: { slug: 'hello' } },
      {
        id: 'http://other.test/Post/3',
        type: 'Post',
        fields: { slug: 'only-elsewhere' },
      },
    ]);
    let rules = [fieldMatch('/posts/:slug', 'Post', { slug: ':slug' })];
    assert.strictEqual(
      cardIdOf(await resolve(rules, realm, '/posts/hello')),
      abs('Post/2'),
      'a card outside the realm is skipped',
    );
    let elsewhere = await resolve(rules, realm, '/posts/only-elsewhere');
    assert.strictEqual(elsewhere.kind, 'nothing');
    assert.deepEqual(tried(elsewhere), [
      { path: '/posts/:slug', outcome: 'miss', reason: 'outside-realm' },
    ]);
  },
});

export default tests;
