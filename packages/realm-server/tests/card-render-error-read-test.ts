import QUnit from 'qunit';
const { module, test } = QUnit;
import type { Test, SuperTest } from 'supertest';
import { basename } from 'path';
import { rri, SupportedMimeType } from '@cardstack/runtime-common';
import type {
  LooseSingleCardDocument,
  Realm,
  SerializedError,
} from '@cardstack/runtime-common';
import type { PgAdapter } from '@cardstack/postgres';
import {
  setupPermissionedRealmCached,
  testRealmURLFor,
} from './helpers/index.ts';

// A card has two index channels: the index visit, which reads the card's data
// onto `boxel_index`, and the render, which writes its prerendered output onto
// `prerendered_html`. A render can fail on its own — a render that runs past
// its budget is the usual case — while the index visit that read the card
// succeeded. Such a card's data is intact, so a read of its data serves it and
// reports the render failure beside it, and a card linking to it still
// side-loads it. Readers of the prerendered output (the markdown GET here)
// still treat the card as errored.

const realmURL = testRealmURLFor('test/');

function buildFileSystem(): Record<string, string | LooseSingleCardDocument> {
  return {
    'pet.gts': `
      import { contains, field, CardDef } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";

      export class Pet extends CardDef {
        @field name = contains(StringField);
      }
    `,
    'owner.gts': `
      import { contains, field, linksTo, CardDef } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";
      import { Pet } from "./pet";

      export class Owner extends CardDef {
        @field name = contains(StringField);
        @field pet = linksTo(() => Pet);
      }
    `,
    'mango.json': {
      data: {
        attributes: { name: 'Mango' },
        meta: { adoptsFrom: { module: rri('./pet'), name: 'Pet' } },
      },
    } as LooseSingleCardDocument,
    'pet-owner.json': {
      data: {
        attributes: { name: 'Pet Owner' },
        relationships: { pet: { links: { self: './mango' } } },
        meta: { adoptsFrom: { module: rri('./owner'), name: 'Owner' } },
      },
    } as LooseSingleCardDocument,
  };
}

const renderError: SerializedError = {
  status: 500,
  title: 'Render timeout',
  message: 'the prerender manager aborted the render after 120000 ms',
  additionalErrors: null,
  // What the prerender pipeline keeps on a failed render for its own use: the
  // retry lane's marker and run length, the failing render's dependencies and
  // its timing diagnostics. None of it is the card reader's business.
  visitRequestFailure: true,
  consecutiveVisitFailures: 1,
  deps: ['http://example.test/some-dependency'],
  diagnostics: { renderStage: 'awaiting-render' },
};

module(basename(import.meta.filename), function () {
  module('a card whose render failed', function (hooks) {
    let request: SuperTest<Test>;
    let dbAdapter: PgAdapter;
    let realmHref: string;

    setupPermissionedRealmCached(hooks, {
      realmURL,
      permissions: { '*': ['read'] },
      fileSystem: buildFileSystem(),
      onRealmSetup(args: {
        testRealm: Realm;
        request: SuperTest<Test>;
        dbAdapter: PgAdapter;
      }) {
        request = args.request;
        dbAdapter = args.dbAdapter;
        realmHref = new URL(args.testRealm.url).href;
      },
    });

    // Records a render error on the card's instance rendering at the
    // rendering's own generation, which is what a failed render of the
    // card's current index row leaves behind. The last-known-good HTML stays
    // on the row, as it does for a real failure.
    async function failRender(name: string) {
      await dbAdapter.execute(
        `UPDATE prerendered_html SET error_doc = $1::jsonb
         WHERE url = $2 AND type = 'instance'`,
        { bind: [JSON.stringify(renderError), `${realmHref}${name}.json`] },
      );
    }

    async function recoverRender(name: string) {
      await dbAdapter.execute(
        `UPDATE prerendered_html SET error_doc = NULL
         WHERE url = $1 AND type = 'instance'`,
        { bind: [`${realmHref}${name}.json`] },
      );
    }

    function path(name: string) {
      return `${new URL(realmHref).pathname}${name}`;
    }

    test('answers its card+json GET with its data and reports the render error', async function (assert) {
      await failRender('mango');

      let response = await request
        .get(path('mango'))
        .set('Accept', SupportedMimeType.CardJson);

      assert.strictEqual(response.status, 200, `HTTP 200: ${response.text}`);
      assert.strictEqual(
        response.body.data.attributes.name,
        'Mango',
        'the card data the index visit read is served',
      );
      assert.deepEqual(
        response.body.meta?.renderError,
        {
          status: renderError.status,
          title: renderError.title,
          message: renderError.message,
        },
        'the render error is reported on the document meta, without the pipeline bookkeeping',
      );
      assert.strictEqual(
        response.body.data.meta.renderError,
        undefined,
        'the render error is not on the resource, which a client echoes back in a write',
      );
    });

    test('a healthy card reports no render error', async function (assert) {
      let response = await request
        .get(path('mango'))
        .set('Accept', SupportedMimeType.CardJson);

      assert.strictEqual(response.status, 200, 'HTTP 200');
      assert.strictEqual(
        response.body.meta?.renderError,
        undefined,
        'no render error is reported',
      );
    });

    test('its validator moves when the render fails and again when it recovers', async function (assert) {
      let healthy = await request
        .get(path('mango'))
        .set('Accept', SupportedMimeType.CardJson);
      let healthyEtag = healthy.get('etag');
      assert.ok(healthyEtag, 'the healthy card carries a validator');

      await failRender('mango');
      let failed = await request
        .get(path('mango'))
        .set('Accept', SupportedMimeType.CardJson)
        .set('If-None-Match', healthyEtag!);
      assert.strictEqual(
        failed.status,
        200,
        'a validator issued before the failure does not 304 past it',
      );
      assert.ok(
        failed.body.meta?.renderError,
        'the body carries the render error',
      );
      let failedEtag = failed.get('etag');
      assert.ok(failedEtag, 'the response carries a validator');
      assert.notStrictEqual(
        failedEtag,
        healthyEtag,
        'the validator differs from the healthy one',
      );

      let head = await request
        .head(path('mango'))
        .set('Accept', SupportedMimeType.CardJson);
      assert.strictEqual(
        head.get('etag'),
        failedEtag,
        'a HEAD reports the validator the GET sends',
      );

      await recoverRender('mango');
      let recovered = await request
        .get(path('mango'))
        .set('Accept', SupportedMimeType.CardJson)
        .set('If-None-Match', failedEtag!);
      assert.strictEqual(
        recovered.status,
        200,
        'a validator issued during the failure does not 304 past the recovery',
      );
      assert.strictEqual(
        recovered.body.meta?.renderError,
        undefined,
        'the recovered card reports no render error',
      );
      assert.strictEqual(
        recovered.get('etag'),
        healthyEtag,
        'the recovered card carries the healthy validator again',
      );
    });

    test('a retry that fails the same way keeps its validator', async function (assert) {
      await failRender('mango');
      let first = await request
        .get(path('mango'))
        .set('Accept', SupportedMimeType.CardJson);
      let etag = first.get('etag');
      assert.ok(etag, 'the response carries a validator');

      // A retry of a failing render rewrites the row's bookkeeping, not the
      // failure it reports.
      await dbAdapter.execute(
        `UPDATE prerendered_html
         SET error_doc = jsonb_set(error_doc, '{consecutiveVisitFailures}', '2')
         WHERE url = $1 AND type = 'instance'`,
        { bind: [`${realmHref}mango.json`] },
      );
      let retried = await request
        .get(path('mango'))
        .set('Accept', SupportedMimeType.CardJson)
        .set('If-None-Match', etag!);
      assert.strictEqual(
        retried.status,
        304,
        'the validator still describes the response',
      );
    });

    test('a card linking to it still side-loads it', async function (assert) {
      await failRender('mango');

      let response = await request
        .get(path('pet-owner'))
        .set('Accept', SupportedMimeType.CardJson);

      assert.strictEqual(response.status, 200, `HTTP 200: ${response.text}`);
      let included = (response.body.included ?? []) as {
        id: string;
        attributes?: { name?: string };
      }[];
      let mango = included.find((resource) => resource.id.endsWith('/mango'));
      assert.ok(mango, 'the linked card is side-loaded');
      assert.strictEqual(
        mango?.attributes?.name,
        'Mango',
        'with the data its index visit read',
      );
      assert.strictEqual(
        response.body.meta?.renderError,
        undefined,
        "a linked card's render error is not reported as the linking card's",
      );
    });

    test('its markdown, which is prerendered output, is unavailable', async function (assert) {
      await failRender('mango');

      let response = await request
        .get(path('mango'))
        .set('Accept', SupportedMimeType.Markdown);

      assert.strictEqual(response.status, 406, 'HTTP 406');
      assert.true(
        response.text.includes('has a rendering error'),
        `the refusal names the render failure: ${response.text}`,
      );
    });

    test('a render error older than the index row does not count', async function (assert) {
      await failRender('mango');
      // A render error recorded at a generation older than the row's index
      // pass predates the card's current data, so it no longer describes it.
      await dbAdapter.execute(
        `UPDATE prerendered_html SET generation = generation - 1
         WHERE url = $1 AND type = 'instance'`,
        { bind: [`${realmHref}mango.json`] },
      );

      let response = await request
        .get(path('mango'))
        .set('Accept', SupportedMimeType.CardJson);

      assert.strictEqual(response.status, 200, 'HTTP 200');
      assert.strictEqual(
        response.body.meta?.renderError,
        undefined,
        'no render error is reported',
      );
    });
  });
});
