import QUnit from 'qunit';
const { module, test } = QUnit;
import type { Test, SuperTest } from 'supertest';
import { basename } from 'path';
import {
  LinkShapePolicy,
  rri,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import type { LooseSingleCardDocument, Realm } from '@cardstack/runtime-common';
import {
  setupPermissionedRealmCached,
  testRealmURLFor,
} from './helpers/index.ts';

// How much of a card's link graph a live response carries. A realm answers a
// card read and a search either by assembling the card's whole transitive link
// closure into `included[]`, or by naming each relationship's targets and
// leaving the consumer to fetch the cards it displays. The two modules below
// pin each shape on the routes themselves, so which one live traffic gets is
// visible in a diff rather than in a latency chart.
//
// Which shape a deployed realm serves is chosen per read by the link-shape
// policy, from the load the process is under. These are the controls for that:
// the first module is what the policy's undegraded branch has to keep
// producing, so a route that drops its closure for some unrelated reason fails
// here rather than showing up as a quiet change in response size. The policy's
// own behaviour — the thresholds, the hysteresis, the caller preference and
// what a degraded response's validator looks like — is exercised in
// `link-shape-policy-test.ts` and `link-shape-routes-test.ts`.

const realmURL = testRealmURLFor('test/');

function buildFileSystem(): Record<string, string | LooseSingleCardDocument> {
  let fs: Record<string, string | LooseSingleCardDocument> = {};

  fs['target.gts'] = `
    import { contains, field, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";

    export class Target extends CardDef {
      @field name = contains(StringField);
      // The field the query-backed linksToMany below filters on.
      @field cardTitle = contains(StringField);
    }
  `;

  fs['consumer.gts'] = `
    import { contains, field, linksTo, linksToMany, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";
    import { Target } from "./target";

    export class Consumer extends CardDef {
      @field name = contains(StringField);
      @field directLink = linksTo(() => Target);
      @field queryLinks = linksToMany(() => Target, {
        query: {
          filter: {
            eq: { cardTitle: 'query-match' },
          },
          page: { size: 10, number: 0 },
        },
      });
    }
  `;

  for (let i = 0; i < 3; i++) {
    fs[`query-target-${i}.json`] = {
      data: {
        attributes: { name: `QT${i}`, cardTitle: 'query-match' },
        meta: {
          adoptsFrom: { module: rri('./target'), name: 'Target' },
        },
      },
    } as LooseSingleCardDocument;
  }

  fs['direct-target.json'] = {
    data: {
      attributes: { name: 'DT', cardTitle: 'direct' },
      meta: {
        adoptsFrom: { module: rri('./target'), name: 'Target' },
      },
    },
  } as LooseSingleCardDocument;

  fs['consumer-1.json'] = {
    data: {
      attributes: { name: 'C1' },
      relationships: {
        directLink: { links: { self: './direct-target' } },
      },
      meta: {
        adoptsFrom: { module: rri('./consumer'), name: 'Consumer' },
      },
    },
  } as LooseSingleCardDocument;

  return fs;
}

// A card+html body is not served as JSON, so supertest leaves it unparsed —
// read it off the raw text rather than `response.body`, which would otherwise
// present as a response that side-loaded nothing.
function entryBody(response: { text: string }): {
  included?: { id?: string }[];
} {
  return JSON.parse(response.text);
}

// The ids a response side-loaded, split into the two link kinds the consumer
// card reaches: its static `linksTo` target and its query-backed matches.
function sideLoaded(included: { id?: string }[] | undefined) {
  let ids = (included ?? []).map((r) => r.id ?? '');
  return {
    staticTargets: ids.filter((id) => id.endsWith('/direct-target')).length,
    queryTargets: ids.filter((id) => id.includes('/query-target-')).length,
  };
}

module(basename(import.meta.filename), function () {
  module('a live read side-loads the link closure', function (hooks) {
    let request: SuperTest<Test>;
    let realmHref: string;
    let searchPath: string;

    function onRealmSetup(args: {
      testRealm: Realm;
      request: SuperTest<Test>;
    }) {
      request = args.request;
      realmHref = new URL(args.testRealm.url).href;
      searchPath = `${new URL(args.testRealm.url).pathname.replace(/\/$/, '')}/_search`;
    }

    setupPermissionedRealmCached(hooks, {
      mode: 'before',
      realmURL,
      permissions: { '*': ['read'] },
      fileSystem: buildFileSystem(),
      onRealmSetup,
    });

    test('a card read carries both link kinds', async function (assert) {
      let response = await request
        .get(`${new URL(realmHref).pathname}consumer-1`)
        .set('Accept', SupportedMimeType.CardJson);
      assert.strictEqual(response.status, 200, `HTTP 200: ${response.text}`);
      let { staticTargets, queryTargets } = sideLoaded(response.body.included);
      assert.strictEqual(staticTargets, 1, 'the static link target is carried');
      assert.strictEqual(
        queryTargets,
        3,
        'the query-backed matches are carried',
      );
    });

    test('a card+html item carries both link kinds', async function (assert) {
      let response = await request
        .get(`${new URL(realmHref).pathname}consumer-1?fields=item`)
        .set('Accept', SupportedMimeType.CardHtml);
      assert.strictEqual(response.status, 200, `HTTP 200: ${response.text}`);
      let { staticTargets, queryTargets } = sideLoaded(
        entryBody(response).included,
      );
      assert.strictEqual(staticTargets, 1, 'the static link target is carried');
      assert.strictEqual(
        queryTargets,
        3,
        'the query-backed matches are carried',
      );
    });

    test('a search carries both link kinds', async function (assert) {
      let response = await request
        .post(searchPath)
        .set('Accept', SupportedMimeType.CardJson)
        .set('X-HTTP-Method-Override', 'QUERY')
        .send({
          filter: {
            'item.on': { module: `${realmHref}consumer`, name: 'Consumer' },
          },
          // The item leg: the branch that serializes each matched card, and so
          // the only one whose links there is anything to side-load.
          fields: { entry: ['item'] },
        });
      assert.strictEqual(response.status, 200, `HTTP 200: ${response.text}`);
      let { staticTargets, queryTargets } = sideLoaded(response.body.included);
      assert.strictEqual(staticTargets, 1, 'the static link target is carried');
      assert.strictEqual(
        queryTargets,
        3,
        'the query-backed matches are carried',
      );
    });
  });

  module('a live read whose realm is held at links-only', function (hooks) {
    let request: SuperTest<Test>;
    let realmHref: string;
    let searchPath: string;

    function onRealmSetup(args: {
      testRealm: Realm;
      request: SuperTest<Test>;
    }) {
      request = args.request;
      realmHref = new URL(args.testRealm.url).href;
      searchPath = `${new URL(args.testRealm.url).pathname.replace(/\/$/, '')}/_search`;
    }

    setupPermissionedRealmCached(hooks, {
      mode: 'before',
      realmURL,
      permissions: { '*': ['read'] },
      fileSystem: buildFileSystem(),
      linkShapePolicy: LinkShapePolicy.pinned('links-only'),
      onRealmSetup,
    });

    test('a card read names its targets and carries neither link kind', async function (assert) {
      let response = await request
        .get(`${new URL(realmHref).pathname}consumer-1`)
        .set('Accept', SupportedMimeType.CardJson);
      assert.strictEqual(response.status, 200, `HTTP 200: ${response.text}`);
      assert.strictEqual(
        (response.body.included ?? []).length,
        0,
        'nothing is side-loaded',
      );

      let relationships = response.body.data.relationships as Record<
        string,
        {
          links?: { self?: string; search?: string };
          data?: Array<{ id: string }>;
        }
      >;
      assert.ok(
        relationships.directLink?.links?.self,
        'the static link still names its target',
      );
      assert.strictEqual(
        relationships.queryLinks?.data?.length,
        3,
        'the query-backed field still names all three matches',
      );
    });

    test('a card+html item arrives without its linked cards', async function (assert) {
      // The leg a selective refresh takes. Left out, it would put back the
      // closure the search below just declined to send.
      let response = await request
        .get(`${new URL(realmHref).pathname}consumer-1?fields=item`)
        .set('Accept', SupportedMimeType.CardHtml);
      assert.strictEqual(response.status, 200, `HTTP 200: ${response.text}`);
      let { staticTargets, queryTargets } = sideLoaded(
        entryBody(response).included,
      );
      assert.strictEqual(staticTargets, 0, 'no static link target carried');
      assert.strictEqual(queryTargets, 0, 'no query-backed matches carried');
    });

    test('a search returns its results without their linked cards', async function (assert) {
      let response = await request
        .post(searchPath)
        .set('Accept', SupportedMimeType.CardJson)
        .set('X-HTTP-Method-Override', 'QUERY')
        .send({
          filter: {
            'item.on': { module: `${realmHref}consumer`, name: 'Consumer' },
          },
          // The item leg: the branch that serializes each matched card, and so
          // the only one whose links there is anything to side-load.
          fields: { entry: ['item'] },
        });
      assert.strictEqual(response.status, 200, `HTTP 200: ${response.text}`);
      let { staticTargets, queryTargets } = sideLoaded(response.body.included);
      assert.strictEqual(staticTargets, 0, 'no static link target carried');
      assert.strictEqual(queryTargets, 0, 'no query-backed matches carried');

      // The result itself still arrives: a search leaves out the cards its
      // results link to, not the cards it matched.
      let itemIds = (response.body.included ?? [])
        .map((r: { id?: string }) => r.id ?? '')
        .filter((id: string) => id.endsWith('/consumer-1'));
      assert.strictEqual(itemIds.length, 1, 'the matched card is returned');
    });
  });
});
