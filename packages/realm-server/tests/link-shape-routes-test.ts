import QUnit from 'qunit';
const { module, test } = QUnit;
import type { Test, SuperTest } from 'supertest';
import { basename } from 'path';
import {
  DURING_PRERENDER_HEADER,
  LinkShapePolicy,
  rri,
  SupportedMimeType,
  X_BOXEL_LINK_SHAPE_HEADER,
} from '@cardstack/runtime-common';
import type { LooseSingleCardDocument, Realm } from '@cardstack/runtime-common';
import {
  setupPermissionedRealmCached,
  testRealmURLFor,
} from './helpers/index.ts';

// What the link-shape policy does to the routes it decides, as opposed to what
// it decides — `link-shape-policy-test.ts` covers the ladder itself.
//
// The three things pinned here are the ones a shape change breaks quietly:
// the response validator has to describe the shape it was sent with, the
// card+json response cache must not serve one shape's body under the other's
// key, and prerendered output has to be untouched by any of it.
//
// The realm is built over a load reading this file sets directly. That is the
// only way to reach the degraded branch deterministically: generating enough
// concurrent searches to move a real reading would make the test a race, and
// the sustained reading is deliberately slow to move.

const realmURL = testRealmURLFor('link-shape/');

// The reading the fixture realm's policy sees. A test assigns it and the next
// read decides on it.
let load = 0;

// Dwell is off and the thresholds are tight so a test can step the ladder read
// by read. The production values are asserted where they belong — on the
// policy, not on a route.
function buildTestPolicy(): LinkShapePolicy {
  return new LinkShapePolicy({
    readLoad: () => load,
    limit: 30,
    multiRowEngage: 8,
    multiRowRelease: 4,
    allEngage: 12,
    allRelease: 6,
    minDwellMs: 0,
    // Far enough out that no heartbeat fires mid-test and lands in a log a
    // test is reading.
    heartbeatMs: 60 * 60 * 1000,
  });
}

function buildFileSystem(): Record<string, string | LooseSingleCardDocument> {
  let fs: Record<string, string | LooseSingleCardDocument> = {};

  fs['target.gts'] = `
    import { contains, field, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";

    export class Target extends CardDef {
      @field name = contains(StringField);
    }
  `;

  fs['consumer.gts'] = `
    import { field, linksTo, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";
    import { contains } from "@cardstack/base/card-api";
    import { Target } from "./target";

    export class Consumer extends CardDef {
      @field name = contains(StringField);
      @field directLink = linksTo(() => Target);
    }
  `;

  fs['direct-target.json'] = {
    data: {
      attributes: { name: 'DT' },
      meta: { adoptsFrom: { module: rri('./target'), name: 'Target' } },
    },
  } as LooseSingleCardDocument;

  fs['consumer-1.json'] = {
    data: {
      attributes: { name: 'C1' },
      relationships: { directLink: { links: { self: './direct-target' } } },
      meta: { adoptsFrom: { module: rri('./consumer'), name: 'Consumer' } },
    },
  } as LooseSingleCardDocument;

  return fs;
}

// The link targets a response side-loaded. A card+json body's `included` is
// exactly the closure, but a card+html entry document also carries the entry's
// own resources there — so counting the array would count those too, and would
// read a response that side-loaded nothing as one that side-loaded two things.
function linkTargetsIn(included: { id?: string }[] | undefined): number {
  return (included ?? []).filter((resource) =>
    (resource.id ?? '').endsWith('/direct-target'),
  ).length;
}

// A card read is single-row, so only the top rung degrades it. Two reads at a
// reading above both engage thresholds take the realm up both rungs, since the
// ladder moves one rung per consult.
async function driveToTopRung(request: SuperTest<Test>, cardPath: string) {
  load = 20;
  await request.get(cardPath).set('Accept', SupportedMimeType.CardJson);
  await request.get(cardPath).set('Accept', SupportedMimeType.CardJson);
}

module(basename(import.meta.filename), function () {
  module('the shape a live read is served', function (hooks) {
    let request: SuperTest<Test>;
    let cardPath: string;

    function onRealmSetup(args: {
      testRealm: Realm;
      request: SuperTest<Test>;
    }) {
      request = args.request;
      cardPath = `${new URL(args.testRealm.url).pathname}consumer-1`;
    }

    setupPermissionedRealmCached(hooks, {
      mode: 'before',
      realmURL,
      permissions: { '*': ['read'] },
      fileSystem: buildFileSystem(),
      linkShapePolicy: buildTestPolicy(),
      onRealmSetup,
    });

    // The realm — and so its policy, and so the realm's rung on the ladder —
    // is built once for the module, which is what makes these tests cheap.
    // Each test therefore starts by walking the ladder back down rather than
    // assuming where the last one left it. Two quiet reads are enough: the
    // ladder has three levels and moves one rung per read.
    hooks.beforeEach(async function () {
      load = 0;
      await request.get(cardPath).set('Accept', SupportedMimeType.CardJson);
      await request.get(cardPath).set('Accept', SupportedMimeType.CardJson);
    });

    test('a quiet fleet carries the closure and a saturated one does not', async function (assert) {
      let quiet = await request
        .get(cardPath)
        .set('Accept', SupportedMimeType.CardJson);
      assert.strictEqual(quiet.status, 200, `HTTP 200: ${quiet.text}`);
      assert.strictEqual(
        (quiet.body.included ?? []).length,
        1,
        'the link target is side-loaded',
      );

      await driveToTopRung(request, cardPath);
      let saturated = await request
        .get(cardPath)
        .set('Accept', SupportedMimeType.CardJson);
      assert.strictEqual(saturated.status, 200, `HTTP 200: ${saturated.text}`);
      assert.strictEqual(
        (saturated.body.included ?? []).length,
        0,
        'the same read under load side-loads nothing',
      );
      assert.ok(
        saturated.body.data.relationships?.directLink?.links?.self,
        'while still naming the target it declined to carry',
      );
    });

    test('the two shapes take different validators', async function (assert) {
      let quiet = await request
        .get(cardPath)
        .set('Accept', SupportedMimeType.CardJson);
      let quietEtag = quiet.headers.etag;
      assert.ok(quietEtag, 'the closure response carries a validator');

      await driveToTopRung(request, cardPath);
      let saturated = await request
        .get(cardPath)
        .set('Accept', SupportedMimeType.CardJson);
      let saturatedEtag = saturated.headers.etag;
      assert.ok(saturatedEtag, 'so does the degraded one');
      assert.notStrictEqual(
        quietEtag,
        saturatedEtag,
        'and they differ, because they describe different bytes at the same indexed_at',
      );
      assert.ok(
        saturatedEtag.includes('links-only'),
        `the degraded validator names its variant: ${saturatedEtag}`,
      );
    });

    // The failure this guards is silent in both directions: a client holding
    // the closure's validator would be 304'd back to a body it never had, and
    // one holding the degraded validator would be 304'd past a closure it now
    // wants.
    test('a validator from the other shape does not revalidate', async function (assert) {
      let quiet = await request
        .get(cardPath)
        .set('Accept', SupportedMimeType.CardJson);
      let quietEtag = quiet.headers.etag;

      let revalidatedQuiet = await request
        .get(cardPath)
        .set('Accept', SupportedMimeType.CardJson)
        .set('If-None-Match', quietEtag);
      assert.strictEqual(
        revalidatedQuiet.status,
        304,
        'the same shape still revalidates — the control for the assertion below',
      );

      await driveToTopRung(request, cardPath);
      let crossed = await request
        .get(cardPath)
        .set('Accept', SupportedMimeType.CardJson)
        .set('If-None-Match', quietEtag);
      assert.strictEqual(
        crossed.status,
        200,
        'a closure validator does not match a degraded response',
      );
      assert.strictEqual(
        (crossed.body.included ?? []).length,
        0,
        'and the body it returns instead is the degraded one',
      );
    });

    // The card+json response cache is keyed on the validator, so the previous
    // test's guarantee is what keeps the two shapes in separate entries. This
    // asserts the consequence directly: crossing back must not hand back the
    // shape that was cached under the other key.
    test('neither shape is served from the other cache entry', async function (assert) {
      let quiet = await request
        .get(cardPath)
        .set('Accept', SupportedMimeType.CardJson);
      let quietEtag = quiet.headers.etag;
      assert.strictEqual(
        (quiet.body.included ?? []).length,
        1,
        'closure first',
      );

      await driveToTopRung(request, cardPath);
      let degraded = await request
        .get(cardPath)
        .set('Accept', SupportedMimeType.CardJson);
      assert.strictEqual(
        (degraded.body.included ?? []).length,
        0,
        'then degraded, which populates an entry of its own',
      );

      // A card read is single-row, so it recovers its closure as soon as the
      // realm steps off the top rung.
      load = 0;
      let recovered = await request
        .get(cardPath)
        .set('Accept', SupportedMimeType.CardJson);
      assert.strictEqual(
        (recovered.body.included ?? []).length,
        1,
        'the closure comes back rather than the degraded body being retained under a shared key',
      );
      assert.strictEqual(
        recovered.headers.etag,
        quietEtag,
        'under the validator it had before, since the card itself never changed',
      );
    });

    test('a caller preference is honoured below the threshold', async function (assert) {
      let response = await request
        .get(cardPath)
        .set('Accept', SupportedMimeType.CardJson)
        .set(X_BOXEL_LINK_SHAPE_HEADER, 'links-only');
      assert.strictEqual(response.status, 200, `HTTP 200: ${response.text}`);
      assert.strictEqual(
        (response.body.included ?? []).length,
        0,
        'a caller that asked for less gets less even on a quiet fleet',
      );
      assert.ok(
        response.headers.etag.includes('links-only'),
        'and its validator describes the shape it was sent',
      );
    });

    test('an unrecognized preference reads as the closure', async function (assert) {
      let response = await request
        .get(cardPath)
        .set('Accept', SupportedMimeType.CardJson)
        .set(X_BOXEL_LINK_SHAPE_HEADER, 'whatever-you-think-best');
      assert.strictEqual(
        (response.body.included ?? []).length,
        1,
        'the closure is what a caller gets when it has said nothing meaningful',
      );
    });

    // Prerender is excluded by construction: `resolveLinksOnly` is gated on
    // the during-prerender signal, so the prerender cache cannot carry a
    // policy's effects past a change.
    test('a prerender read is byte-identical across a policy change', async function (assert) {
      let quiet = await request
        .get(`${cardPath}?fields=item`)
        .set('Accept', SupportedMimeType.CardHtml)
        .set(DURING_PRERENDER_HEADER, 'true');
      assert.strictEqual(quiet.status, 200, `HTTP 200: ${quiet.text}`);

      await driveToTopRung(request, cardPath);
      let saturated = await request
        .get(`${cardPath}?fields=item`)
        .set('Accept', SupportedMimeType.CardHtml)
        .set(DURING_PRERENDER_HEADER, 'true');
      assert.strictEqual(saturated.status, 200, `HTTP 200: ${saturated.text}`);

      assert.strictEqual(
        saturated.text,
        quiet.text,
        'the prerender path never reaches the policy',
      );
      assert.strictEqual(
        saturated.headers.etag,
        quiet.headers.etag,
        'so its validator is unmoved too',
      );
    });

    // A live card+html item is the leg the host's selective refresh takes.
    // Left undegraded it would put back exactly the closure a degraded search
    // declined to send.
    test('a live card+html item follows the policy', async function (assert) {
      let quiet = await request
        .get(`${cardPath}?fields=item`)
        .set('Accept', SupportedMimeType.CardHtml);
      assert.strictEqual(quiet.status, 200, `HTTP 200: ${quiet.text}`);
      assert.strictEqual(
        linkTargetsIn(JSON.parse(quiet.text).included),
        1,
        'the closure is carried on a quiet fleet',
      );

      await driveToTopRung(request, cardPath);
      let saturated = await request
        .get(`${cardPath}?fields=item`)
        .set('Accept', SupportedMimeType.CardHtml);
      assert.strictEqual(
        linkTargetsIn(JSON.parse(saturated.text).included),
        0,
        'and dropped under load',
      );
      assert.notStrictEqual(
        saturated.headers.etag,
        quiet.headers.etag,
        'with its own validator, as the card+json leg has',
      );
    });
  });
});
