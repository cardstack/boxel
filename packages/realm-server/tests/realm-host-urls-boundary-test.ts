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
import { HostURLTranslator } from '../lib/realm-host-urls-boundary.ts';
import { notifyHostURLsChanged } from '../lib/realm-host-urls.ts';

// The realm is served at two host URLs: its canonical one at the root of
// `canonical.localhost`, and another under a path prefix, which requests come
// in on unless a test says otherwise.
const CANONICAL_HOST = 'canonical.localhost';
const CANONICAL_HOST_URL = `http://${CANONICAL_HOST}/`;
const SPACE_HOST = 'space.localhost';
const SPACE_PREFIX = '/shop/';
const SPACE_HOST_URL = `http://${SPACE_HOST}${SPACE_PREFIX}`;

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
  });
});
