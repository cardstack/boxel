import {
  dynamicRouteQuery,
  matchDynamicRoute,
  readDynamicRoutes,
} from '../dynamic-routes.ts';
import type { SharedTests } from '../helpers/index.ts';

const POST =
  '{module: "https://realm.example/blog/blog-post", name: "BlogPost"}';
const REALM = 'https://realm.example/blog/';
const SPEC_EXAMPLE = {
  path: '/posts/:slug',
  query: `{filter: {on: ${POST}, eq: {slug: (.route.slug | ascii_downcase)}}, sort: [{by: "publishedAt", on: ${POST}, direction: "desc"}]}`,
};

const tests: SharedTests<unknown> = Object.freeze({
  'readDynamicRoutes: reads :name rules in order and leaves exact rules alone':
    async (assert) => {
      let { routes, problems } = readDynamicRoutes([
        {
          path: '/about',
          instance: { id: 'https://realm.example/blog/About' },
        },
        SPEC_EXAMPLE,
        { path: '/tags/:tag/', query: '{filter: {eq: {tag: .route.tag}}}' },
      ]);
      assert.deepEqual(problems, []);
      assert.deepEqual(
        routes.map((route) => route.path),
        ['/posts/:slug', '/tags/:tag'],
      );
    },

  'readDynamicRoutes: refuses a bad pattern, a missing query, a card target and an unsafe query':
    async (assert) => {
      let { routes, problems } = readDynamicRoutes([
        { path: '/a/:x/:x', query: '{}' },
        { path: '/c/:y' },
        { path: '/d/:y', query: '{}', instance: { id: 'https://x/y' } },
        { path: '/e/:y', query: '{filter: {eq: {t: (.route.y | test("z"))}}}' },
        { path: '/f/:y', query: '{filter: {eq: {t: $ENV.HOME}}}' },
      ]);
      assert.deepEqual(routes, []);
      assert.strictEqual(problems.length, 5, problems.join('\n'));
      assert.deepEqual(
        readDynamicRoutes([{ path: '/b/x:y', query: '{}' }]).routes,
        [],
        'a ":" inside a segment is no dynamic rule; exact-rule validation refuses it',
      );
    },

  'matchDynamicRoute: one whole, non-empty segment per name, percent-decoded':
    async (assert) => {
      let [route] = readDynamicRoutes([SPEC_EXAMPLE]).routes;
      assert.deepEqual(matchDynamicRoute(route, '/posts/Hello%20World'), {
        slug: 'Hello World',
      });
      assert.strictEqual(matchDynamicRoute(route, '/posts/a/b'), undefined);
      assert.strictEqual(matchDynamicRoute(route, '/posts'), undefined);
      assert.strictEqual(matchDynamicRoute(route, '/post/a'), undefined);
      assert.strictEqual(matchDynamicRoute(route, '/posts/%E0'), undefined);
    },

  'dynamicRouteQuery: the spec example makes a query for one card, in no realm the author chose':
    async (assert) => {
      let [route] = readDynamicRoutes([
        {
          path: SPEC_EXAMPLE.path,
          query: SPEC_EXAMPLE.query.replace(
            /}$/,
            ', realm: "https://elsewhere.example/", realms: ["https://elsewhere.example/"]}',
          ),
        },
      ]).routes;
      let query = dynamicRouteQuery(route, { slug: 'Hello-World' }, REALM);
      assert.deepEqual(query, {
        filter: {
          on: {
            module: 'https://realm.example/blog/blog-post',
            name: 'BlogPost',
          },
          eq: { slug: 'hello-world' },
        },
        sort: [
          {
            by: 'publishedAt',
            on: {
              module: 'https://realm.example/blog/blog-post',
              name: 'BlogPost',
            },
            direction: 'desc',
          },
        ],
        page: { number: 0, size: 1 },
      } as any);
    },

  'dynamicRouteQuery: a relative module resolves against the realm the rule is in':
    async (assert) => {
      let [route] = readDynamicRoutes([
        {
          path: '/pages/:title',
          query:
            '{filter: {on: {module: "./long-page", name: "LongPage"}, eq: {title: .route.title}}}',
        },
      ]).routes;
      let query = dynamicRouteQuery(
        route,
        { title: 'Home' },
        'https://realm.example/sites/owner/demo/',
      ) as any;
      assert.strictEqual(
        query.filter.on.module,
        'https://realm.example/sites/owner/demo/long-page',
      );
    },

  'dynamicRouteQuery: output that is not a query is no match': async (
    assert,
  ) => {
    let { routes } = readDynamicRoutes([
      { path: '/a/:x', query: '.route.x' },
      { path: '/b/:x', query: '{filter: "nope"}' },
    ]);
    assert.strictEqual(
      dynamicRouteQuery(routes[0], { x: 'y' }, REALM),
      undefined,
    );
    assert.strictEqual(
      dynamicRouteQuery(routes[1], { x: 'y' }, REALM),
      undefined,
    );
  },
});

export default tests;
