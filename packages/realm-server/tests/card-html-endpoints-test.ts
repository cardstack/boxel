import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { Test, SuperTest } from 'supertest';
import {
  DEFAULT_HTML_QUERY,
  fieldsetFromParam,
  rri,
  type HtmlResource,
  type Realm,
} from '@cardstack/runtime-common';
import {
  setupPermissionedRealmCached,
  withRealmPath,
  type RealmRequest,
} from './helpers/index.ts';

// The single-instance card+html / file-meta+html GET (the single-instance
// counterpart to `_search`): one `entry` sourced by URL, carrying the selected
// rendering (`html`) + the `item` serialization, guarded by a composite ETag
// that encodes both the index-data generation and the rendering's
// generation-or-absence.
module(basename(import.meta.filename), function () {
  module('Realm-specific Endpoints | card+html GET', function (hooks) {
    let realmURL = new URL('http://127.0.0.1:4444/test/');
    let testRealm: Realm;
    let realmHref: string;
    let request: RealmRequest;

    function onRealmSetup(args: {
      testRealm: Realm;
      request: SuperTest<Test>;
    }) {
      testRealm = args.testRealm;
      realmHref = new URL(testRealm.url).href;
      request = withRealmPath(args.request, realmURL);
    }

    setupPermissionedRealmCached(hooks, {
      realmURL,
      permissions: { '*': ['read'] },
      fileSystem: {
        'person.gts': `
          import { contains, field, CardDef, Component } from "@cardstack/base/card-api";
          import StringField from "@cardstack/base/string";

          export class Person extends CardDef {
            @field firstName = contains(StringField);
            static embedded = class Embedded extends Component<typeof this> {
              <template>
                Embedded Card Person: <@fields.firstName/>
              </template>
            }
            static fitted = class Fitted extends Component<typeof this> {
              <template>
                Fitted Card Person: <@fields.firstName/>

                <style scoped>
                  .border { border: 1px solid red; }
                </style>
              </template>
            }
          }
        `,
        'john.json': {
          data: {
            attributes: { firstName: 'John' },
            meta: {
              adoptsFrom: { module: rri('./person'), name: 'Person' },
            },
          },
        },
        'hello.md': '# Hello from FileDef content',
      },
      onRealmSetup,
    });

    function cardHtml(path: string) {
      return request.get(path).set('Accept', 'application/vnd.card+html');
    }
    function fileMetaHtml(path: string) {
      return request
        .get(path)
        .set('Accept', 'application/vnd.card.file-meta+html');
    }
    function htmlResourceIn(body: any, id: string): HtmlResource | undefined {
      return body.included?.find(
        (resource: any) => resource.type === 'html' && resource.id === id,
      );
    }
    // The response is a JSON:API document served under the negotiated
    // `+html` media type, so superagent (which only auto-parses `+json`)
    // leaves `response.body` empty — parse the raw text ourselves.
    function bodyOf(response: { text: string }): any {
      return JSON.parse(response.text);
    }

    // ---- engine: searchEntry (the reshaped single-instance projection) ----

    test('searchEntry returns one entry unwrapped to a single-resource document', async function (assert) {
      let doc = await testRealm.realmIndexQueryEngine.searchEntry(
        new URL(`${realmHref}john.json`),
        {
          htmlQuery: DEFAULT_HTML_QUERY,
          fieldset: fieldsetFromParam(undefined),
          kind: 'instance',
        },
      );
      assert.ok(doc, 'the entry resolves');
      assert.false(Array.isArray(doc!.data), 'data is a single resource');
      assert.strictEqual(doc!.data.id, `${realmHref}john`);
      assert.strictEqual(
        typeof doc!.data.meta?.generation,
        'number',
        'the entry carries its index-data generation',
      );
      assert.strictEqual(
        doc!.data.relationships.html?.data.length,
        1,
        'the default fitted rendering is linked',
      );
    });

    test('searchEntry returns undefined for a URL with no index row', async function (assert) {
      let doc = await testRealm.realmIndexQueryEngine.searchEntry(
        new URL(`${realmHref}does-not-exist.json`),
        {
          htmlQuery: DEFAULT_HTML_QUERY,
          fieldset: fieldsetFromParam(undefined),
          kind: 'instance',
        },
      );
      assert.strictEqual(doc, undefined);
    });

    // ---- HTTP: the content-negotiated GET ----

    test('serves one entry with its fitted rendering + a composite ETag', async function (assert) {
      let response = await cardHtml('/john');
      assert.strictEqual(response.status, 200, `HTTP 200: ${response.text}`);
      assert.strictEqual(
        (response.get('content-type') ?? '').split(';')[0],
        'application/vnd.card+html',
      );
      let { data, included } = bodyOf(response);
      assert.strictEqual(
        data.id,
        `${realmHref}john`,
        'entry id is the card URL',
      );
      assert.strictEqual(data.type, 'entry');
      assert.strictEqual(
        data.relationships.html.data.length,
        1,
        'the fitted rendering is linked',
      );
      let html = htmlResourceIn(
        bodyOf(response),
        data.relationships.html.data[0].id,
      );
      assert.ok(html, 'the html rendering rides in included');
      assert.true(
        (html!.attributes.html ?? '')
          .replace(/\s+/g, ' ')
          .includes('Fitted Card Person: John'),
        'the fitted markup is the requested rendering',
      );
      assert.ok(
        included.some((r: any) => r.type === 'css'),
        'the rendering ships its scoped css',
      );
      assert.ok(
        included.some((r: any) => r.type === 'icon'),
        'the card-type icon rides in included',
      );

      // The composite ETag: <indexGeneration>:<htmlGeneration>. Both channels
      // are fresh in a from-scratch index, so both are present (never `none`).
      let etag = response.get('etag') ?? '';
      assert.true(
        /^"\d+:\d+"$/.test(etag),
        `ETag encodes both generations, got ${etag}`,
      );
      assert.strictEqual(
        etag,
        `"${data.meta.generation}:${html!.meta!.generation}"`,
        'the ETag pairs the entry generation with its rendering generation',
      );
    });

    test('If-None-Match matching the composite state → 304', async function (assert) {
      let first = await cardHtml('/john');
      let etag = first.get('etag') ?? '';
      assert.true(Boolean(etag), 'a validator is emitted');

      let revalidated = await cardHtml('/john').set('If-None-Match', etag);
      assert.strictEqual(
        revalidated.status,
        304,
        '304 on a matching validator',
      );
      assert.strictEqual(
        revalidated.get('etag'),
        etag,
        'the 304 echoes the validator',
      );

      let stale = await cardHtml('/john').set('If-None-Match', '"0:0"');
      assert.strictEqual(
        stale.status,
        200,
        'a non-matching validator falls through to a fresh 200',
      );
    });

    test('?format= selects the rendering', async function (assert) {
      let response = await cardHtml('/john?format=embedded');
      assert.strictEqual(response.status, 200);
      let { data } = bodyOf(response);
      let html = htmlResourceIn(
        bodyOf(response),
        data.relationships.html.data[0].id,
      );
      assert.strictEqual(html!.attributes.format, 'embedded');
      assert.true(
        (html!.attributes.html ?? '')
          .replace(/\s+/g, ' ')
          .includes('Embedded Card Person: John'),
        'the embedded markup is served',
      );
    });

    test('?fields=item serves the item alone with a rendering-less ETag', async function (assert) {
      let response = await cardHtml('/john?fields=item');
      assert.strictEqual(response.status, 200);
      let { data, included } = bodyOf(response);
      assert.strictEqual(
        data.relationships.html,
        undefined,
        'no html branch when only item is requested',
      );
      assert.deepEqual(data.relationships.item, {
        data: { type: 'card', id: `${realmHref}john` },
      });
      assert.ok(
        included.some(
          (r: any) => r.type === 'card' && r.id === `${realmHref}john`,
        ),
        'the card item rides in included',
      );
      // An item carries `meta.realmInfo` (which can change without a reindex),
      // so an item-bearing response folds the realm-info hash in as a third
      // segment on top of the `<index>:none` composite.
      let etag = response.get('etag') ?? '';
      assert.true(
        /^"\d+:none:[^:"]+"$/.test(etag),
        `an item response has no rendering channel + a realm-info segment, got ${etag}`,
      );
    });

    test('?fields=html,item pins both branches', async function (assert) {
      let response = await cardHtml('/john?fields=html,item');
      assert.strictEqual(response.status, 200);
      let { data } = bodyOf(response);
      assert.strictEqual(data.relationships.html.data.length, 1);
      assert.deepEqual(data.relationships.item, {
        data: { type: 'card', id: `${realmHref}john` },
      });
    });

    test('an invalid ?format= is a 400 invalid-render, not a 500', async function (assert) {
      let response = await cardHtml('/john?format=nonsense');
      assert.strictEqual(response.status, 400);
      assert.ok(
        String(response.body?.errors?.[0] ?? response.text).length > 0,
        'the response carries an error message',
      );
    });

    test('a URL with no index row → 404', async function (assert) {
      let response = await cardHtml('/does-not-exist');
      assert.strictEqual(response.status, 404);
    });

    test('the file counterpart serves a file entry by URL', async function (assert) {
      let response = await fileMetaHtml('/hello.md');
      assert.strictEqual(response.status, 200, `HTTP 200: ${response.text}`);
      assert.strictEqual(
        (response.get('content-type') ?? '').split(';')[0],
        'application/vnd.card.file-meta+html',
      );
      let { data } = bodyOf(response);
      assert.strictEqual(
        data.id,
        `${realmHref}hello.md`,
        'entry id is the file URL',
      );
      assert.strictEqual(data.type, 'entry');
      // A file renders natively; whichever branch it resolves, the ETag pairs
      // the two channels (a rendering → `<gen>:<gen>`, else `<gen>:none`), plus
      // a realm-info segment when it falls back to its item.
      let etag = response.get('etag') ?? '';
      assert.true(
        /^"\d+:(\d+|none)(:[^:"]+)?"$/.test(etag),
        `the file entry carries a composite ETag, got ${etag}`,
      );
    });
  });
});
