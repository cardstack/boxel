import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { readFileSync } from 'fs';
import type { SuperTest, Test } from 'supertest';
import type { Realm } from '@cardstack/runtime-common';
import {
  param,
  query,
  rri,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import type { RealmHttpServer as Server } from '../server.ts';
import {
  closeServer,
  createJWT,
  setupPermissionedRealmCached,
  testRealmURLFor,
} from './helpers/index.ts';
import {
  HostURLTranslator,
  StoredHTMLBackMapper,
} from '../lib/realm-host-urls-boundary.ts';
import { notifyHostURLsChanged } from '../lib/realm-host-urls.ts';

// The realm is served at two host URLs: its canonical one at the root of
// `canonical.localhost`, and another under a path prefix, which requests come
// in on unless a test says otherwise.
const CANONICAL_HOST = 'canonical.localhost';
const CANONICAL_HOST_URL = `http://${CANONICAL_HOST}/`;
const SPACE_HOST = 'space.localhost';
const SPACE_PREFIX = '/shop/';
const SPACE_HOST_URL = `http://${SPACE_HOST}${SPACE_PREFIX}`;
// A URL the realm's stored HTML was rendered against that is no longer one
// of its host URLs, as a canonical host URL is while the realm's HTML is
// rendered again against a new one.
const OLD_HOST = 'old.localhost';
const OLD_HOST_URL = `http://${OLD_HOST}/`;

const personSource = `
  import { contains, field, CardDef, Component } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";

  export class Person extends CardDef {
    @field firstName = contains(StringField);
    @field website = contains(StringField);
    static isolated = class Isolated extends Component<typeof this> {
      <template>
        <a data-person-self href={{@model.id}}><@fields.firstName /></a>
      </template>
    };
    static fitted = class Fitted extends Component<typeof this> {
      <template>
        <a data-person-fitted href={{@model.id}}><@fields.firstName /></a>
      </template>
    };
    static head = class Head extends Component<typeof this> {
      <template>
        <title>{{@model.firstName}}</title>
        <link rel="canonical" href={{@model.id}} />
        <meta property="og:url" content={{@model.id}} />
      </template>
    };
  }
`;

function attr(html: string, tagPattern: RegExp, name: string) {
  let tag = html.match(tagPattern)?.[0];
  return tag?.match(new RegExp(`${name}="([^"]*)"`))?.[1];
}

function hostConfig(html: string): Record<string, any> {
  let content = html.match(
    /<meta name="@cardstack\/host\/config\/environment" content="([^"]*)"/,
  )?.[1];
  return JSON.parse(decodeURIComponent(content ?? '{}'));
}

module(basename(import.meta.filename), function () {
  module('HostURLTranslator', function () {
    let translator = new HostURLTranslator({
      hostURL: 'https://site.example.test/shop/',
      realmURL: 'https://realms.example.test/owner/store/',
      isCanonical: false,
      canonicalHostURL: 'https://store.example.test/',
    });

    test('translates the realm URL and the canonical host URL in one pass', function (assert) {
      assert.strictEqual(
        translator.outbound(
          'https://realms.example.test/owner/store/a https://store.example.test/b',
        ),
        'https://site.example.test/shop/a https://site.example.test/shop/b',
      );
      assert.strictEqual(
        translator.outbound(
          encodeURIComponent('https://realms.example.test/owner/store/a'),
        ),
        encodeURIComponent('https://site.example.test/shop/a'),
        'a URL-encoded URL too',
      );
    });

    test('translates the host URLs a request names to the realm URL', function (assert) {
      assert.strictEqual(
        translator.inbound(
          '{"href":"https://site.example.test/shop/a","ref":"https://store.example.test/b"}',
        ),
        '{"href":"https://realms.example.test/owner/store/a","ref":"https://realms.example.test/owner/store/b"}',
      );
    });

    test('names the canonical host URL in the canonical link and og:url only', function (assert) {
      let html = translator.outboundHTML(
        [
          '<link rel="canonical" href="https://realms.example.test/owner/store/a" />',
          '<meta property="og:url" content="https://realms.example.test/owner/store/a" />',
          '<meta property="og:title" content="https://realms.example.test/owner/store/a" />',
          '<a href="https://realms.example.test/owner/store/a">a</a>',
        ].join('\n'),
      );
      assert.strictEqual(
        html,
        [
          '<link rel="canonical" href="https://store.example.test/a" />',
          '<meta property="og:url" content="https://store.example.test/a" />',
          '<meta property="og:title" content="https://site.example.test/shop/a" />',
          '<a href="https://site.example.test/shop/a">a</a>',
        ].join('\n'),
      );
    });

    test('translates a path-only Location below the realm', function (assert) {
      assert.strictEqual(
        translator.outboundHeader('Location', '/owner/store/terms?x=1'),
        '/shop/terms?x=1',
      );
      assert.strictEqual(
        translator.outboundHeader('Location', '/elsewhere'),
        '/elsewhere',
      );
    });

    test('translates the realm URL without its trailing slash where it ends a URL', function (assert) {
      assert.strictEqual(
        translator.outboundHeader(
          'Location',
          'https://realms.example.test/owner/store',
        ),
        'https://site.example.test/shop',
        'an absolute Location naming the realm root',
      );
      assert.strictEqual(
        translator.outbound(
          '"https://realms.example.test/owner/store" https://realms.example.test/owner/store?x=1 https://store.example.test#top',
        ),
        '"https://site.example.test/shop" https://site.example.test/shop?x=1 https://site.example.test/shop#top',
      );
      assert.strictEqual(
        translator.outbound(
          'https://realms.example.test/owner/store-two/a https://realms.example.test/owner/storefront',
        ),
        'https://realms.example.test/owner/store-two/a https://realms.example.test/owner/storefront',
        'a URL the realm URL without its slash only begins is left as it is',
      );
      assert.strictEqual(
        translator.inbound('{"href":"https://site.example.test/shop"}'),
        '{"href":"https://realms.example.test/owner/store"}',
      );
    });

    test("a host config that can't be decoded is translated as text", function (assert) {
      let html = translator.outboundHTML(
        '<meta name="@cardstack/host/config/environment" content="%E0%A4%A https://realms.example.test/owner/store/a">',
      );
      assert.strictEqual(
        html,
        '<meta name="@cardstack/host/config/environment" content="%E0%A4%A https://site.example.test/shop/a">',
      );
    });

    test('a translated ETag is the realm ETag again in a conditional request', function (assert) {
      let etag = translator.outboundHeader('ETag', 'W/"abc"');
      assert.notStrictEqual(etag, 'W/"abc"', 'the ETag names the translation');
      assert.true(etag.startsWith('W/"abc'), 'a weak ETag stays weak');
      assert.strictEqual(
        translator.inboundConditional(`"x", ${etag}`),
        '"x.stale", W/"abc"',
        'a tag of this translation is the realm ETag; any other matches none',
      );
      assert.strictEqual(translator.inboundConditional('*'), '*');

      let other = new HostURLTranslator({
        hostURL: 'https://site.example.test/shop/',
        realmURL: 'https://realms.example.test/owner/store/',
        isCanonical: false,
        canonicalHostURL: 'https://other.example.test/',
      });
      assert.notStrictEqual(
        other.outboundETag('"abc"'),
        translator.outboundETag('"abc"'),
        'another canonical host URL gives another ETag',
      );
    });

    test('translates from a URL stored HTML was rendered against', function (assert) {
      let match = {
        hostURL: 'https://site.example.test/shop/',
        realmURL: 'https://realms.example.test/owner/store/',
        isCanonical: false,
        canonicalHostURL: 'https://store.example.test/',
      };
      let renderedAgainst = new HostURLTranslator({
        ...match,
        renderedAgainstURLs: ['https://old.example.test/'],
      });
      assert.strictEqual(
        renderedAgainst.outboundBody(
          [
            '<link rel="canonical" href="https://old.example.test/a" />',
            '<a href="https://old.example.test/a">a</a>',
          ].join('\n'),
          'text/html',
        ),
        [
          '<link rel="canonical" href="https://store.example.test/a" />',
          '<a href="https://site.example.test/shop/a">a</a>',
        ].join('\n'),
        'a page names the host URL, and the canonical host URL in its canonical link',
      );
      let doc = JSON.parse(
        renderedAgainst.outboundBody(
          JSON.stringify({
            data: {
              type: 'card',
              id: 'https://realms.example.test/owner/store/a',
              attributes: { website: 'https://old.example.test/' },
            },
            included: [
              {
                type: 'html',
                id: 'https://realms.example.test/owner/store/a#fitted',
                attributes: {
                  html: '<a href="https://old.example.test/a">a</a>',
                },
              },
            ],
          }),
          'application/vnd.card+json',
        ),
      );
      assert.strictEqual(
        doc.included[0].attributes.html,
        '<a href="https://site.example.test/shop/a">a</a>',
        'the markup of an html resource names the host URL',
      );
      assert.strictEqual(
        doc.data.attributes.website,
        'https://old.example.test/',
        "a card's data is not translated from it",
      );
      assert.strictEqual(doc.data.id, 'https://site.example.test/shop/a');
      assert.strictEqual(
        renderedAgainst.outbound('https://old.example.test/a'),
        'https://old.example.test/a',
        'nor is any other text',
      );
      assert.strictEqual(
        renderedAgainst.inbound('{"href":"https://old.example.test/a"}'),
        '{"href":"https://old.example.test/a"}',
        'a request is not translated from it',
      );
      assert.notStrictEqual(
        renderedAgainst.outboundETag('"abc"'),
        new HostURLTranslator(match).outboundETag('"abc"'),
        'the ETag changes with the URLs stored HTML was rendered against',
      );
    });

    test('translates the markup inside a +html envelope', function (assert) {
      let envelope = JSON.stringify({
        data: { id: 'https://realms.example.test/owner/store/a' },
        included: [
          {
            type: 'html',
            attributes: {
              html: '<link rel="canonical" href="https://realms.example.test/owner/store/a"><a href="https://realms.example.test/owner/store/a">a</a>',
            },
          },
        ],
      });
      let doc = JSON.parse(
        translator.outboundBody(envelope, 'application/vnd.card+html'),
      );
      assert.strictEqual(doc.data.id, 'https://site.example.test/shop/a');
      assert.strictEqual(
        doc.included[0].attributes.html,
        '<link rel="canonical" href="https://store.example.test/a"><a href="https://site.example.test/shop/a">a</a>',
      );
    });
  });

  module('StoredHTMLBackMapper', function () {
    let realmURL = 'https://realms.example.test/owner/store/';
    let mapper = new StoredHTMLBackMapper(
      new Map([[realmURL, ['https://store.example.test/']]]),
    );

    test('names the realm URL in stored HTML, except in the canonical link and og:url', function (assert) {
      let html = [
        '<link rel="canonical" href="https://store.example.test/a" />',
        '<meta property="og:url" content="https://store.example.test/a" />',
        '<meta property="og:image" content="https://store.example.test/i.png" />',
        '<a href="https://store.example.test/a">a</a>',
        '<a href="https://store.example.test">home</a>',
      ].join('\n');
      assert.strictEqual(
        mapper.html(html, `${realmURL}a`),
        [
          '<link rel="canonical" href="https://store.example.test/a" />',
          '<meta property="og:url" content="https://store.example.test/a" />',
          `<meta property="og:image" content="${realmURL}i.png" />`,
          `<a href="${realmURL}a">a</a>`,
          '<a href="https://realms.example.test/owner/store">home</a>',
        ].join('\n'),
      );
      assert.strictEqual(
        mapper.html(html, 'https://realms.example.test/owner/other/a'),
        html,
        "another realm's HTML is not mapped",
      );
    });

    test('finds the realm of its root with a query, and of a percent-encoded URL', function (assert) {
      let html = '<a href="https://store.example.test/a">a</a>';
      let mapped = `<a href="${realmURL}a">a</a>`;
      assert.true(
        mapper.mapsRealmOf('https://realms.example.test/owner/store'),
      );
      assert.strictEqual(
        mapper.html(
          html,
          'https://realms.example.test/owner/store?format=isolated',
        ),
        mapped,
        'the realm root without its slash, then a query',
      );
      let tildeRealmURL = 'https://realms.example.test/owner/~store/';
      let tildeMapper = new StoredHTMLBackMapper(
        new Map([[tildeRealmURL, ['https://store.example.test/']]]),
      );
      assert.strictEqual(
        tildeMapper.html(html, 'https://realms.example.test/owner/%7Estore/a'),
        `<a href="${tildeRealmURL}a">a</a>`,
        'a card URL that percent-encodes a character its realm URL does not',
      );
      assert.false(
        mapper.mapsRealmOf('https://realms.example.test/owner/store-two/a'),
        'a realm whose path only starts with the same text is another realm',
      );
    });

    test('maps only the markup of html resources in a JSON document', function (assert) {
      let doc = {
        data: [
          {
            type: 'entry',
            id: `${realmURL}a`,
            attributes: { website: 'https://store.example.test/' },
          },
        ],
        included: [
          {
            type: 'html',
            id: `${realmURL}a#fitted`,
            attributes: {
              html: '<a href="https://store.example.test/a">a</a>',
            },
          },
          {
            type: 'card',
            id: `${realmURL}a`,
            attributes: { website: 'https://store.example.test/' },
          },
        ],
      };
      let mapped = JSON.parse(
        mapper.body(
          JSON.stringify(doc),
          'application/vnd.card+json',
          `${realmURL}_search`,
        ),
      );
      assert.strictEqual(
        mapped.included[0].attributes.html,
        `<a href="${realmURL}a">a</a>`,
      );
      assert.strictEqual(
        mapped.included[1].attributes.website,
        'https://store.example.test/',
        "a card's own data is left as it is",
      );
      assert.strictEqual(
        mapped.data[0].attributes.website,
        'https://store.example.test/',
      );

      let unrelated = JSON.stringify({ data: { type: 'card', id: 'x' } });
      assert.strictEqual(
        mapper.body(unrelated, 'application/vnd.card+json', realmURL),
        unrelated,
        'a document that names no such URL is returned as it is',
      );
    });
  });

  module('requests and responses on a host URL', function (hooks) {
    let realmURL = testRealmURLFor('test/');
    let testRealm: Realm;
    let testRealmPath: string;
    let testRealmHttpServer: Server;
    let request: SuperTest<Test>;
    let dbAdapter: PgAdapter;

    hooks.afterEach(async function () {
      await closeServer(testRealmHttpServer);
    });

    setupPermissionedRealmCached(hooks, {
      realmURL,
      permissions: { '*': ['read'], writer: ['read', 'write'] },
      fileSystem: {
        'person.gts': personSource,
        'docs/page.html': `<a href="${realmURL.href}person-1">Ada</a> <a href="${CANONICAL_HOST_URL}about">About</a>\n`,
        'person-1.json': {
          data: {
            type: 'card',
            attributes: {
              firstName: 'Ada',
              website: `${CANONICAL_HOST_URL}about`,
            },
            meta: { adoptsFrom: { module: rri('./person'), name: 'Person' } },
          },
        },
        'person-2.json': {
          data: {
            type: 'card',
            attributes: {
              firstName: 'Grace',
              website: `${OLD_HOST_URL}about`,
            },
            meta: { adoptsFrom: { module: rri('./person'), name: 'Person' } },
          },
        },
        'realm.json': {
          data: {
            type: 'card',
            attributes: {
              cardInfo: { name: 'Host URL Realm' },
              hostRoutingRules: [
                { path: '/about' },
                { path: '/tos', redirectTo: '/terms' },
              ],
            },
            relationships: {
              'hostRoutingRules.0.instance': {
                links: { self: './person-1' },
              },
            },
            meta: {
              adoptsFrom: {
                module: rri('@cardstack/base/realm-config'),
                name: 'RealmConfig',
              },
            },
          },
        },
      },
      onRealmSetup(args) {
        testRealm = args.testRealm;
        testRealmPath = args.testRealmPath;
        testRealmHttpServer = args.testRealmHttpServer;
        request = args.request;
        dbAdapter = args.dbAdapter;
      },
    });

    hooks.beforeEach(async function () {
      let rows = (await query(dbAdapter, [
        `SELECT id FROM realm_registry WHERE url =`,
        param(realmURL.href),
      ])) as { id: string }[];
      let realmId = rows[0]?.id;
      if (!realmId) {
        rows = (await query(dbAdapter, [
          `INSERT INTO realm_registry (url, kind, disk_id, owner_username) VALUES (`,
          param(realmURL.href),
          `, 'source', `,
          param(`test/${realmURL.href}`),
          `, 'test-owner') RETURNING id`,
        ])) as { id: string }[];
        realmId = rows[0].id;
      }
      for (let [host, pathPrefix, isCanonical] of [
        [CANONICAL_HOST, '/', true],
        [SPACE_HOST, SPACE_PREFIX, false],
      ] as const) {
        await query(dbAdapter, [
          `INSERT INTO realm_host_urls (realm_id, kind, host, path_prefix, is_canonical, created_by) VALUES (`,
          param(realmId),
          `, 'site-name', `,
          param(host),
          `, `,
          param(pathPrefix),
          `, `,
          param(isCanonical),
          `, '@test-owner:localhost')`,
        ]);
      }
    });

    function get(path: string, accept: string, host = SPACE_HOST) {
      return request.get(path).set('Host', host).set('Accept', accept);
    }

    test('a JSON:API document and its realm header name the host URL', async function (assert) {
      let response = await get(
        `${SPACE_PREFIX}person-1`,
        SupportedMimeType.CardJson,
      );

      assert.strictEqual(response.status, 200, response.text);
      let doc = JSON.parse(response.text);
      assert.strictEqual(doc.data.id, `${SPACE_HOST_URL}person-1`);
      assert.strictEqual(
        doc.data.attributes.website,
        `${SPACE_HOST_URL}about`,
        'the canonical host URL is translated as well as the realm URL',
      );
      assert.strictEqual(response.headers['x-boxel-realm-url'], SPACE_HOST_URL);
      assert.false(
        response.text.includes(realmURL.href),
        'the realm URL appears nowhere in the document',
      );
    });

    test('a page names the host URL, and the canonical host URL in its canonical link and og:url', async function (assert) {
      let response = await get(`${SPACE_PREFIX}person-1`, 'text/html');

      assert.strictEqual(response.status, 200, response.text.slice(0, 300));
      let html = response.text;
      assert.strictEqual(
        attr(html, /<a [^>]*data-person-self[^>]*>/, 'href'),
        `${SPACE_HOST_URL}person-1`,
        'a link in the page names the host URL',
      );
      assert.strictEqual(
        attr(html, /<link [^>]*rel="canonical"[^>]*>/, 'href'),
        `${CANONICAL_HOST_URL}person-1`,
      );
      assert.strictEqual(
        attr(html, /<meta [^>]*property="og:url"[^>]*>/, 'content'),
        `${CANONICAL_HOST_URL}person-1`,
      );
      assert.false(html.includes(realmURL.href), 'no realm URL');
      assert.false(
        html.includes(encodeURIComponent(realmURL.href)),
        'no URL-encoded realm URL',
      );
    });

    test('the injected config routes by the host URL', async function (assert) {
      let response = await get(`${SPACE_PREFIX}about`, 'text/html');

      assert.strictEqual(response.status, 200, response.text.slice(0, 300));
      let routingMap = hostConfig(response.text).hostRoutingMap;
      assert.deepEqual(
        routingMap.find((rule: { path: string }) =>
          rule.path.endsWith('about'),
        ),
        { path: `${SPACE_PREFIX}about`, id: `${SPACE_HOST_URL}person-1` },
      );
      let redirect = routingMap.find((rule: { path: string }) =>
        rule.path.endsWith('tos'),
      );
      assert.strictEqual(redirect?.path, `${SPACE_PREFIX}tos`);
      assert.strictEqual(redirect?.redirectTo, `${SPACE_PREFIX}terms`);
    });

    test('a redirect names the host URL in its Location', async function (assert) {
      let response = await get(`${SPACE_PREFIX}tos`, 'text/html');

      assert.strictEqual(response.status, 302);
      assert.strictEqual(response.headers.location, `${SPACE_HOST_URL}terms`);
    });

    test('a request on the canonical host URL is answered in its terms', async function (assert) {
      let response = await get(
        '/person-1',
        SupportedMimeType.CardJson,
        CANONICAL_HOST,
      );

      assert.strictEqual(response.status, 200, response.text);
      let doc = JSON.parse(response.text);
      assert.strictEqual(doc.data.id, `${CANONICAL_HOST_URL}person-1`);
      assert.strictEqual(
        doc.data.attributes.website,
        `${CANONICAL_HOST_URL}about`,
      );
    });

    test("a card's source is served as the realm stores it", async function (assert) {
      let response = await get(
        `${SPACE_PREFIX}person-1.json`,
        SupportedMimeType.CardSource,
      );

      assert.strictEqual(response.status, 200, response.text);
      assert.strictEqual(
        response.text,
        readFileSync(join(testRealmPath, 'person-1.json'), 'utf8'),
      );
    });

    test("a plain read of a file serves the file's stored bytes", async function (assert) {
      for (let path of ['docs/page.html', 'person-1.json']) {
        let response = await get(`${SPACE_PREFIX}${path}`, '*/*');

        assert.strictEqual(response.status, 200, `${path}: ${response.text}`);
        assert.strictEqual(
          response.text,
          readFileSync(join(testRealmPath, path), 'utf8'),
          `${path} is served as the realm stores it`,
        );
      }
    });

    test('a range of a file is a range of the same bytes the full read serves', async function (assert) {
      let full = await get(`${SPACE_PREFIX}docs/page.html`, '*/*');
      assert.strictEqual(full.status, 200, full.text);
      assert.ok(full.headers.etag, 'the full read has an ETag');

      let range = await get(`${SPACE_PREFIX}docs/page.html`, '*/*')
        .set('Range', 'bytes=10-29')
        .set('If-Range', full.headers.etag);
      assert.strictEqual(range.status, 206, range.text);
      assert.strictEqual(range.text, full.text.slice(10, 30));
    });

    test('a HEAD gives no length other than the one its GET returns', async function (assert) {
      let getResponse = await get(
        `${SPACE_PREFIX}person-1`,
        SupportedMimeType.CardJson,
      );
      let headResponse = await request
        .head(`${SPACE_PREFIX}person-1`)
        .set('Host', SPACE_HOST)
        .set('Accept', SupportedMimeType.CardJson);

      assert.strictEqual(getResponse.status, 200, getResponse.text);
      assert.strictEqual(headResponse.status, 200);
      let length = headResponse.headers['content-length'];
      if (length !== undefined) {
        assert.strictEqual(
          Number(length),
          Buffer.byteLength(getResponse.text),
          'the HEAD gives the length of the translated body',
        );
      } else {
        assert.ok(true, 'the HEAD gives no length');
      }
    });

    test('an error answering a card-source request names the host URL', async function (assert) {
      let response = await get(
        `${SPACE_PREFIX}missing.json`,
        SupportedMimeType.CardSource,
      );

      assert.strictEqual(response.status, 404, response.text);
      assert.true(
        response.text.includes(`${SPACE_HOST_URL}missing.json`),
        response.text,
      );
      assert.false(response.text.includes(realmURL.href), 'no realm URL');
    });

    test("a head rendering's canonical link and og:url name the canonical host URL", async function (assert) {
      let response = await get(
        `${SPACE_PREFIX}person-1?format=head`,
        SupportedMimeType.CardHtml,
      );

      assert.strictEqual(response.status, 200, response.text);
      let doc = JSON.parse(response.text);
      assert.strictEqual(doc.data.id, `${SPACE_HOST_URL}person-1`);
      let html: string = doc.included.find(
        (resource: { type: string }) => resource.type === 'html',
      ).attributes.html;
      assert.strictEqual(
        attr(html, /<link [^>]*rel="canonical"[^>]*>/, 'href'),
        `${CANONICAL_HOST_URL}person-1`,
      );
      assert.strictEqual(
        attr(html, /<meta [^>]*property="og:url"[^>]*>/, 'content'),
        `${CANONICAL_HOST_URL}person-1`,
      );
      assert.false(response.text.includes(realmURL.href), 'no realm URL');
    });

    test('an ETag on a host URL is revalidated there, and changes with the canonical host URL', async function (assert) {
      let realmResponse = await request
        .get(`${realmURL.pathname}person-1`)
        .set('Accept', SupportedMimeType.CardJson);
      let realmETag = realmResponse.headers.etag;
      let first = await get(
        `${SPACE_PREFIX}person-1`,
        SupportedMimeType.CardJson,
      );
      let etag = first.headers.etag;
      assert.ok(realmETag, 'the realm answers with an ETag');
      assert.ok(etag, 'the host URL answers with an ETag');
      assert.notStrictEqual(etag, realmETag, 'the two ETags differ');

      let revalidated = await get(
        `${SPACE_PREFIX}person-1`,
        SupportedMimeType.CardJson,
      ).set('If-None-Match', etag);
      assert.strictEqual(revalidated.status, 304, 'its own ETag revalidates');
      assert.strictEqual(revalidated.headers.etag, etag);

      let withRealmETag = await get(
        `${SPACE_PREFIX}person-1`,
        SupportedMimeType.CardJson,
      ).set('If-None-Match', realmETag);
      assert.strictEqual(
        withRealmETag.status,
        200,
        "the realm's own ETag does not revalidate a translation",
      );

      await query(dbAdapter, [
        `UPDATE realm_host_urls SET is_canonical = false WHERE host =`,
        param(CANONICAL_HOST),
      ]);
      await query(dbAdapter, [
        `UPDATE realm_host_urls SET is_canonical = true WHERE host =`,
        param(SPACE_HOST),
      ]);
      await notifyHostURLsChanged(dbAdapter, CANONICAL_HOST);
      await notifyHostURLsChanged(dbAdapter, SPACE_HOST);

      let after = await get(
        `${SPACE_PREFIX}person-1`,
        SupportedMimeType.CardJson,
      ).set('If-None-Match', etag);
      for (let attempt = 0; attempt < 50 && after.status === 304; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        after = await get(
          `${SPACE_PREFIX}person-1`,
          SupportedMimeType.CardJson,
        ).set('If-None-Match', etag);
      }
      assert.strictEqual(
        after.status,
        200,
        'a validator from before the canonical host URL changed does not revalidate',
      );
      assert.notStrictEqual(after.headers.etag, etag);
    });

    test('an operations request naming host URLs reaches the realm in its own URLs', async function (assert) {
      let response = await request
        .post(`${SPACE_PREFIX}_operations`)
        .set('Host', SPACE_HOST)
        .set('Accept', SupportedMimeType.BoxelOperations)
        .set('Content-Type', SupportedMimeType.BoxelOperations)
        .set(
          'Authorization',
          `Bearer ${createJWT(testRealm, 'writer', ['read', 'write'])}`,
        )
        .send(
          JSON.stringify({
            'boxel:operations': [
              {
                op: 'invoke',
                'boxel:name': 'update',
                href: `${SPACE_HOST_URL}person-1`,
                data: {
                  type: 'card',
                  attributes: {
                    firstName: 'Grace',
                    website: `${SPACE_HOST_URL}contact`,
                  },
                  meta: {
                    adoptsFrom: {
                      module: `${SPACE_HOST_URL}person`,
                      name: 'Person',
                    },
                  },
                },
              },
            ],
          }),
        );

      assert.strictEqual(response.status, 200, response.text);
      let stored = readFileSync(join(testRealmPath, 'person-1.json'), 'utf8');
      let doc = JSON.parse(stored);
      assert.strictEqual(doc.data.attributes.firstName, 'Grace');
      assert.strictEqual(
        doc.data.attributes.website,
        `${realmURL.href}contact`,
        'a host URL in the body is stored as the realm URL',
      );
      assert.false(stored.includes(SPACE_HOST), 'no host URL is stored');
    });

    // Makes the realm's stored HTML read as if it was rendered against `url`:
    // records `url` on every row, and, unless `html` is false, names `url` in
    // the HTML wherever it names the realm's URL.
    async function renderAgainst(url: string, { html = true } = {}) {
      let replace = (column: string) => [
        `, ${column} = replace(${column},`,
        param(realmURL.href),
        `,`,
        param(url),
        `)`,
      ];
      // Fitted HTML is keyed by the card type's URL, which names the realm's
      // URL and stays as it is. Only the HTML in each value changes.
      let replaceValues = (column: string) => [
        `, ${column} = (SELECT jsonb_object_agg(key, replace(value,`,
        param(realmURL.href),
        `,`,
        param(url),
        `)) FROM jsonb_each_text(${column}))`,
      ];
      await query(dbAdapter, [
        `UPDATE prerendered_html SET rendered_against_url =`,
        param(url),
        ...(html
          ? [
              ...replace('isolated_html'),
              ...replace('head_html'),
              ...replaceValues('fitted_html'),
            ]
          : []),
        `WHERE realm_url =`,
        param(realmURL.href),
      ]);
    }

    function realmGet(path: string, accept: string) {
      return request.get(`${realmURL.pathname}${path}`).set('Accept', accept);
    }

    function htmlResource(text: string, id?: string): string {
      let doc = JSON.parse(text);
      return doc.included.find(
        (resource: { type: string; id: string }) =>
          resource.type === 'html' && (!id || resource.id.startsWith(id)),
      ).attributes.html;
    }

    test('a page on a host URL is translated from a URL its HTML was rendered against', async function (assert) {
      await renderAgainst(OLD_HOST_URL);

      let response = await get(`${SPACE_PREFIX}person-1`, 'text/html');

      assert.strictEqual(response.status, 200, response.text.slice(0, 300));
      let html = response.text;
      assert.strictEqual(
        attr(html, /<a [^>]*data-person-self[^>]*>/, 'href'),
        `${SPACE_HOST_URL}person-1`,
        'a link in the page names the host URL',
      );
      assert.strictEqual(
        attr(html, /<link [^>]*rel="canonical"[^>]*>/, 'href'),
        `${CANONICAL_HOST_URL}person-1`,
      );
      assert.strictEqual(
        attr(html, /<meta [^>]*property="og:url"[^>]*>/, 'content'),
        `${CANONICAL_HOST_URL}person-1`,
      );
      assert.false(html.includes(OLD_HOST), 'the page names no such URL');

      let head = await get(
        `${SPACE_PREFIX}person-1?format=head`,
        SupportedMimeType.CardHtml,
      );
      assert.strictEqual(head.status, 200, head.text);
      assert.false(head.text.includes(OLD_HOST), 'nor does a +html read');
    });

    test("a card's data on a host URL is not translated from a URL its HTML was rendered against", async function (assert) {
      await renderAgainst(OLD_HOST_URL);

      let card = await get(
        `${SPACE_PREFIX}person-2`,
        SupportedMimeType.CardJson,
      );
      assert.strictEqual(card.status, 200, card.text);
      let doc = JSON.parse(card.text);
      assert.strictEqual(doc.data.id, `${SPACE_HOST_URL}person-2`);
      assert.strictEqual(
        doc.data.attributes.website,
        `${OLD_HOST_URL}about`,
        'the attribute is served as the realm holds it',
      );

      let rendered = await get(
        `${SPACE_PREFIX}person-2?format=isolated&fields=html,item`,
        SupportedMimeType.CardHtml,
      );
      assert.strictEqual(rendered.status, 200, rendered.text);
      let envelope = JSON.parse(rendered.text);
      let html = envelope.included.find(
        (resource: { type: string }) => resource.type === 'html',
      ).attributes.html;
      assert.strictEqual(
        attr(html, /<a [^>]*data-person-self[^>]*>/, 'href'),
        `${SPACE_HOST_URL}person-2`,
        'the stored HTML names the host URL',
      );
      let item = envelope.included.find(
        (resource: { type: string }) => resource.type === 'card',
      );
      assert.strictEqual(
        item?.attributes.website,
        `${OLD_HOST_URL}about`,
        "the card's data in the same document is served as the realm holds it",
      );
    });

    test('an ETag on a host URL changes when the URL stored HTML was rendered against changes', async function (assert) {
      let path = `${SPACE_PREFIX}person-1?format=isolated`;
      let first = await get(path, SupportedMimeType.CardHtml);
      let etag = first.headers.etag;
      assert.strictEqual(first.status, 200, first.text);
      assert.ok(etag, 'the host URL answers with an ETag');

      await renderAgainst(OLD_HOST_URL, { html: false });
      await notifyHostURLsChanged(dbAdapter, OLD_HOST);

      let after = await get(path, SupportedMimeType.CardHtml).set(
        'If-None-Match',
        etag,
      );
      for (let attempt = 0; attempt < 50 && after.status === 304; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        after = await get(path, SupportedMimeType.CardHtml).set(
          'If-None-Match',
          etag,
        );
      }
      assert.strictEqual(
        after.status,
        200,
        'a validator from before the URL changed does not revalidate',
      );
      assert.notStrictEqual(after.headers.etag, etag);
    });

    test('stored HTML on the realm URL names the realm URL, except in its canonical link and og:url', async function (assert) {
      await renderAgainst(CANONICAL_HOST_URL);

      let isolated = await realmGet(
        'person-1?format=isolated',
        SupportedMimeType.CardHtml,
      );
      assert.strictEqual(isolated.status, 200, isolated.text);
      assert.strictEqual(
        attr(
          htmlResource(isolated.text),
          /<a [^>]*data-person-self[^>]*>/,
          'href',
        ),
        `${realmURL.href}person-1`,
        'a +html read links into the realm',
      );

      let head = await realmGet(
        'person-1?format=head',
        SupportedMimeType.CardHtml,
      );
      assert.strictEqual(head.status, 200, head.text);
      let headHTML = htmlResource(head.text);
      assert.strictEqual(
        attr(headHTML, /<link [^>]*rel="canonical"[^>]*>/, 'href'),
        `${CANONICAL_HOST_URL}person-1`,
      );
      assert.strictEqual(
        attr(headHTML, /<meta [^>]*property="og:url"[^>]*>/, 'content'),
        `${CANONICAL_HOST_URL}person-1`,
      );

      let page = await realmGet('person-1', 'text/html');
      assert.strictEqual(page.status, 200, page.text.slice(0, 300));
      assert.strictEqual(
        attr(page.text, /<a [^>]*data-person-self[^>]*>/, 'href'),
        `${realmURL.href}person-1`,
        'a page links into the realm',
      );
      assert.strictEqual(
        attr(page.text, /<link [^>]*rel="canonical"[^>]*>/, 'href'),
        `${CANONICAL_HOST_URL}person-1`,
      );
    });

    test('a search on the realm URL maps only its stored HTML', async function (assert) {
      await renderAgainst(CANONICAL_HOST_URL);

      let response = await request
        .post(`${realmURL.pathname}_search`)
        .set('Accept', SupportedMimeType.CardJson)
        .set('X-HTTP-Method-Override', 'QUERY')
        .send({
          filter: {
            'item.on': { module: `${realmURL.href}person`, name: 'Person' },
          },
          fields: { entry: ['html', 'item'] },
        });

      assert.strictEqual(response.status, 200, response.text);
      assert.strictEqual(
        attr(
          htmlResource(response.text, `${realmURL.href}person-1`),
          /<a [^>]*data-person-fitted[^>]*>/,
          'href',
        ),
        `${realmURL.href}person-1`,
        'a rendering links into the realm',
      );
      let item = JSON.parse(response.text).included.find(
        (resource: { type: string; id: string }) =>
          resource.type === 'card' &&
          resource.id === `${realmURL.href}person-1`,
      );
      assert.strictEqual(
        item?.attributes.website,
        `${CANONICAL_HOST_URL}about`,
        "a card's data is served as the realm holds it",
      );
    });

    test('a federated search maps only the stored HTML of the realms it searches', async function (assert) {
      await renderAgainst(CANONICAL_HOST_URL);

      let response = await request
        .post('/_federated-search')
        .set('Accept', SupportedMimeType.CardJson)
        .set('Content-Type', 'application/json')
        .set('X-HTTP-Method-Override', 'QUERY')
        .send({
          filter: {
            'item.on': { module: `${realmURL.href}person`, name: 'Person' },
          },
          fields: { entry: ['html', 'item'] },
          realms: [realmURL.href],
        });

      assert.strictEqual(response.status, 200, response.text);
      assert.strictEqual(
        attr(
          htmlResource(response.text, `${realmURL.href}person-1`),
          /<a [^>]*data-person-fitted[^>]*>/,
          'href',
        ),
        `${realmURL.href}person-1`,
        'a rendering links into the realm',
      );
      let item = JSON.parse(response.text).included.find(
        (resource: { type: string; id: string }) =>
          resource.type === 'card' &&
          resource.id === `${realmURL.href}person-1`,
      );
      assert.strictEqual(
        item?.attributes.website,
        `${CANONICAL_HOST_URL}about`,
        "a card's data is served as the realm holds it",
      );
    });

    test("a file's stored bytes on the realm URL are not mapped", async function (assert) {
      await renderAgainst(CANONICAL_HOST_URL);

      let source = await realmGet(
        'person-1.json',
        SupportedMimeType.CardSource,
      );
      assert.strictEqual(source.status, 200, source.text);
      assert.strictEqual(
        source.text,
        readFileSync(join(testRealmPath, 'person-1.json'), 'utf8'),
        "a card's source is served as the realm stores it",
      );

      let file = await realmGet('docs/page.html', '*/*');
      assert.strictEqual(file.status, 200, file.text);
      assert.strictEqual(
        file.text,
        readFileSync(join(testRealmPath, 'docs/page.html'), 'utf8'),
        'an HTML file is served as the realm stores it',
      );
    });
  });
});
