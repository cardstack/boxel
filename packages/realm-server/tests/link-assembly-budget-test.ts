import QUnit from 'qunit';
const { module, test } = QUnit;
import type { Test, SuperTest } from 'supertest';
import { basename } from 'path';
import {
  rri,
  SupportedMimeType,
  setSearchBoundsForTests,
  resetSearchBoundsForTests,
} from '@cardstack/runtime-common';
import type {
  DBAdapter,
  LooseSingleCardDocument,
  Realm,
} from '@cardstack/runtime-common';
import {
  setupPermissionedRealmCached,
  testRealmURLFor,
} from './helpers/index.ts';

// How much of a card's link graph one response may assemble. The walk that
// builds `included[]` terminates on its own once it has visited everything
// reachable, so what bounds its cost is not how far it travels but how much it
// brings back — a card with dozens of relationships is dozens of resources one
// hop out, and hundreds two hops out, at any depth limit.
//
// The fixture is a fan: one consumer linking to TARGET_COUNT targets, each of
// which links on to its own child. So the full closure is 2 × TARGET_COUNT and
// one hop is TARGET_COUNT, which lets a budget set between them clip mid-walk
// rather than at a layer boundary.

const realmURL = testRealmURLFor('test/');
const TARGET_COUNT = 8;
const FULL_CLOSURE = TARGET_COUNT * 2;

let testDbAdapter: DBAdapter;

function buildFileSystem(): Record<string, string | LooseSingleCardDocument> {
  let fs: Record<string, string | LooseSingleCardDocument> = {};

  fs['target.gts'] = `
    import { contains, field, linksTo, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";

    export class Target extends CardDef {
      @field name = contains(StringField);
      @field tag = contains(StringField);
      @field child = linksTo(() => Target);
    }
  `;

  // A card whose members are found by running a query rather than by following
  // a stored link. Its targets are written into `included[]` by the same walk,
  // so the budget reaches them too — and running out part-way through one field
  // is the case where a partially-carried field has to stay coherent.
  fs['query-consumer.gts'] = `
    import { contains, field, linksToMany, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";
    import { Target } from "./target";

    export class QueryConsumer extends CardDef {
      @field name = contains(StringField);
      @field matches = linksToMany(() => Target, {
        query: {
          filter: { eq: { tag: 'query-match' } },
          page: { size: 50, number: 0 },
        },
      });
    }
  `;

  let consumerFields = Array.from(
    { length: TARGET_COUNT },
    (_, i) => `      @field link${i} = linksTo(() => Target);`,
  ).join('\n');
  fs['consumer.gts'] = `
    import { contains, field, linksTo, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";
    import { Target } from "./target";

    export class Consumer extends CardDef {
      @field name = contains(StringField);
${consumerFields}
    }
  `;

  for (let i = 0; i < TARGET_COUNT; i++) {
    fs[`child-${i}.json`] = {
      data: {
        attributes: { name: `Child ${i}` },
        meta: { adoptsFrom: { module: rri('./target'), name: 'Target' } },
      },
    } as LooseSingleCardDocument;
    fs[`target-${i}.json`] = {
      data: {
        attributes: { name: `Target ${i}`, tag: 'query-match' },
        relationships: { child: { links: { self: `./child-${i}` } } },
        meta: { adoptsFrom: { module: rri('./target'), name: 'Target' } },
      },
    } as LooseSingleCardDocument;
  }

  let relationships: Record<string, { links: { self: string } }> = {};
  for (let i = 0; i < TARGET_COUNT; i++) {
    relationships[`link${i}`] = { links: { self: `./target-${i}` } };
  }
  fs['probe.gts'] = `
    import { contains, field, linksTo, CardDef } from "@cardstack/base/card-api";
    import StringField from "@cardstack/base/string";
    import { Target } from "./target";

    export class ProbeConsumer extends CardDef {
      @field name = contains(StringField);
${consumerFields}
    }
  `;

  fs['consumer-1.json'] = {
    data: {
      attributes: { name: 'C1' },
      relationships,
      meta: { adoptsFrom: { module: rri('./consumer'), name: 'Consumer' } },
    },
  } as LooseSingleCardDocument;

  // A second consumer over the same targets. Its closure overlaps the first's
  // entirely, which is what makes it the fixture for "a card reached twice is
  // paid for once".
  fs['consumer-2.json'] = {
    data: {
      attributes: { name: 'C2' },
      relationships,
      meta: { adoptsFrom: { module: rri('./consumer'), name: 'Consumer' } },
    },
  } as LooseSingleCardDocument;

  // A second fan root over the same targets, read by the SQL probe alone. The
  // realm's card+json response cache is keyed on the validator, and the budget
  // is part of that validator — so a probe sharing a root with another test
  // would be answered from that test's cache entry and observe no SQL at all.
  //
  // Its own type, not another `Consumer`: the search tests below count the rows
  // a `Consumer` query returns, and a third instance would move those counts
  // while saying nothing about the bound.
  fs['probe-consumer.json'] = {
    data: {
      attributes: { name: 'PROBE' },
      relationships,
      meta: {
        adoptsFrom: { module: rri('./probe'), name: 'ProbeConsumer' },
      },
    },
  } as LooseSingleCardDocument;

  fs['query-consumer-1.json'] = {
    data: {
      attributes: { name: 'QC1' },
      meta: {
        adoptsFrom: { module: rri('./query-consumer'), name: 'QueryConsumer' },
      },
    },
  } as LooseSingleCardDocument;

  return fs;
}

// A card+html body is not served as JSON, so supertest leaves it unparsed.
function entryBody(response: { text: string }): {
  included?: { id?: string }[];
  meta?: { linkClosureTruncated?: boolean };
} {
  return JSON.parse(response.text);
}

// The side-loaded link resources, which on this fixture are every included
// resource whose id names a target or a child.
function linkResourceIds(included: { id?: string }[] | undefined): string[] {
  return (included ?? [])
    .map((r) => r.id ?? '')
    .filter((id) => /\/(target|child)-\d+$/.test(id));
}

module(basename(import.meta.filename), function () {
  module('the assembled-resource budget', function (hooks) {
    let request: SuperTest<Test>;
    let realmHref: string;
    let searchPath: string;
    let realm: Realm;

    function onRealmSetup(args: {
      testRealm: Realm;
      request: SuperTest<Test>;
      dbAdapter: DBAdapter;
    }) {
      request = args.request;
      realm = args.testRealm;
      testDbAdapter = args.dbAdapter;
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

    hooks.afterEach(function () {
      resetSearchBoundsForTests();
    });

    function cardPath(name: string) {
      return `${new URL(realmHref).pathname}${name}`;
    }

    test('a closure that fits arrives whole and the document claims nothing', async function (assert) {
      setSearchBoundsForTests({ maxAssembledLinkResources: FULL_CLOSURE });
      let response = await request
        .get(cardPath('consumer-1'))
        .set('Accept', SupportedMimeType.CardJson);

      assert.strictEqual(response.status, 200, `HTTP 200: ${response.text}`);
      assert.strictEqual(
        linkResourceIds(response.body.included).length,
        FULL_CLOSURE,
        'both hops of the closure are carried',
      );
      assert.notOk(
        response.body.meta?.linkClosureTruncated,
        'a whole closure is not reported truncated',
      );
    });

    test('a closure past the budget is clipped to it, and the document says so', async function (assert) {
      let budget = TARGET_COUNT + 3;
      setSearchBoundsForTests({ maxAssembledLinkResources: budget });
      let response = await request
        .get(cardPath('consumer-1'))
        .set('Accept', SupportedMimeType.CardJson);

      assert.strictEqual(response.status, 200, `HTTP 200: ${response.text}`);
      let ids = linkResourceIds(response.body.included);
      assert.strictEqual(
        ids.length,
        budget,
        `included carries exactly the ${budget} resources the budget allowed`,
      );
      assert.true(
        response.body.meta?.linkClosureTruncated,
        'the document reports the closure it carries is partial',
      );
      // The clip lands mid-walk: the first hop fits and the second does not, so
      // a caller receives every target and only some of their children. The
      // budget is spent per resource, so where it runs out is where it stops —
      // it does not round to a whole layer in either direction.
      assert.strictEqual(
        ids.filter((id) => id.includes('/target-')).length,
        TARGET_COUNT,
        'the first hop is complete',
      );
      assert.strictEqual(
        ids.filter((id) => id.includes('/child-')).length,
        3,
        'the second hop carries only what was left of the budget',
      );
    });

    test('a clipped link still names its target, so a consumer can fetch it', async function (assert) {
      setSearchBoundsForTests({ maxAssembledLinkResources: 2 });
      let response = await request
        .get(cardPath('target-0'))
        .set('Accept', SupportedMimeType.CardJson);
      assert.strictEqual(response.status, 200, `HTTP 200: ${response.text}`);
      assert.strictEqual(
        linkResourceIds(response.body.included).length,
        1,
        'the one link this card has fits',
      );

      // Now with no room at all: the relationship must survive as a named but
      // uncarried target — the shape a consumer reads as "not loaded yet" —
      // rather than being dropped, which would silently lose the edge.
      setSearchBoundsForTests({ maxAssembledLinkResources: 1 });
      let clipped = await request
        .get(cardPath('consumer-1'))
        .set('Accept', SupportedMimeType.CardJson);
      assert.strictEqual(clipped.status, 200, `HTTP 200: ${clipped.text}`);
      assert.strictEqual(
        linkResourceIds(clipped.body.included).length,
        1,
        'one resource fits',
      );
      let relationships = clipped.body.data.relationships as Record<
        string,
        { links?: { self?: string } }
      >;
      for (let i = 0; i < TARGET_COUNT; i++) {
        assert.ok(
          relationships[`link${i}`]?.links?.self,
          `link${i} still names its target`,
        );
      }
    });

    test('the budget bounds what is read, not only what is returned', async function (assert) {
      // The assertion the response body cannot make. A walk that read the whole
      // closure and then returned the first few resources would produce a
      // byte-identical body to one that never read the rest, so only the emitted
      // SQL says which happened — and reading less is the point of a bound whose
      // justification is event-loop cost.
      //
      // Counted as distinct resources rather than as bind slots: the batched
      // lookup matches on either column (`i.url IN (…) OR i.file_alias IN (…)`),
      // so every resource it asks for contributes more than one bind.
      //
      // Reads `probe-consumer`, and at budgets no other test uses, because the
      // response cache is keyed on a validator the budget is folded into: a
      // (root, budget) pair some earlier test already read would be served from
      // its entry, and the probe would see no SQL whether or not the bound
      // works.
      async function resourcesRead(budget: number): Promise<number> {
        setSearchBoundsForTests({ maxAssembledLinkResources: budget });
        let originalExecute = testDbAdapter.execute.bind(testDbAdapter);
        let dbExecute = testDbAdapter as {
          execute: typeof testDbAdapter.execute;
        };
        let asked = new Set<string>();
        try {
          dbExecute.execute = async (sql, opts) => {
            let normalized = sql.replace(/\s+/g, ' ');
            if (
              /FROM boxel_index\b/.test(normalized) &&
              /\bi\.url\s+IN\s*\(/.test(normalized)
            ) {
              for (let bound of opts?.bind ?? []) {
                if (
                  typeof bound === 'string' &&
                  /\/(target|child)-\d+/.test(bound)
                ) {
                  asked.add(bound.replace(/\.json$/, ''));
                }
              }
            }
            return originalExecute(sql, opts);
          };
          let response = await request
            .get(cardPath('probe-consumer'))
            .set('Accept', SupportedMimeType.CardJson);
          assert.strictEqual(
            response.status,
            200,
            `HTTP 200: ${response.text}`,
          );
        } finally {
          dbExecute.execute = originalExecute;
        }
        return asked.size;
      }

      // The positive control. Without it the bounded arm's low count would be
      // equally consistent with a counter that never matched a query at all.
      assert.strictEqual(
        await resourcesRead(FULL_CLOSURE + 1),
        FULL_CLOSURE,
        'a budget that fits reads every resource the graph holds',
      );
      assert.strictEqual(
        await resourcesRead(6),
        6,
        `and a budget of 6 reads six, rather than reading all ${FULL_CLOSURE} and returning six`,
      );
    });

    test('a card reached by two paths spends one slot, not two', async function (assert) {
      // Both consumers link to all TARGET_COUNT targets. Charging per edge
      // rather than per resource would spend 2 × TARGET_COUNT on the first hop
      // and clip a search that comfortably fits.
      setSearchBoundsForTests({ maxAssembledLinkResources: FULL_CLOSURE });
      let response = await request
        .post(searchPath)
        .set('Accept', SupportedMimeType.CardJson)
        .set('X-HTTP-Method-Override', 'QUERY')
        .send({
          filter: {
            'item.on': { module: `${realmHref}consumer`, name: 'Consumer' },
          },
          fields: { entry: ['item'] },
        });

      assert.strictEqual(response.status, 200, `HTTP 200: ${response.text}`);
      let ids = linkResourceIds(response.body.included);
      assert.strictEqual(
        ids.length,
        FULL_CLOSURE,
        'two consumers over one shared closure assemble it once',
      );
      assert.strictEqual(
        new Set(ids).size,
        FULL_CLOSURE,
        'and carry no resource twice',
      );
      assert.notOk(
        response.body.meta?.linkClosureTruncated,
        'so the search is not reported truncated',
      );
    });

    test('a search reports a clipped closure on the document, not on a row', async function (assert) {
      // One assembly serves the whole page, so no single row is the one that
      // ran out — the report belongs where the page is described.
      setSearchBoundsForTests({ maxAssembledLinkResources: 4 });
      let response = await request
        .post(searchPath)
        .set('Accept', SupportedMimeType.CardJson)
        .set('X-HTTP-Method-Override', 'QUERY')
        .send({
          filter: {
            'item.on': { module: `${realmHref}consumer`, name: 'Consumer' },
          },
          fields: { entry: ['item'] },
        });

      assert.strictEqual(response.status, 200, `HTTP 200: ${response.text}`);
      assert.strictEqual(
        linkResourceIds(response.body.included).length,
        4,
        'the page assembles the budget and no more',
      );
      assert.true(
        response.body.meta.linkClosureTruncated,
        'the document reports the page carries a partial closure',
      );
      assert.strictEqual(
        response.body.data.length,
        2,
        'both matched rows are still returned — the bound clips links, not results',
      );
    });

    test('a card+html item leg is bounded and reports it', async function (assert) {
      setSearchBoundsForTests({ maxAssembledLinkResources: 3 });
      let response = await request
        .get(`${cardPath('consumer-1')}?fields=item`)
        .set('Accept', SupportedMimeType.CardHtml);

      assert.strictEqual(response.status, 200, `HTTP 200: ${response.text}`);
      let body = entryBody(response);
      assert.strictEqual(
        linkResourceIds(body.included).length,
        3,
        'the item leg assembles the budget and no more',
      );
      assert.true(
        body.meta?.linkClosureTruncated,
        'and the document reports it',
      );
    });

    test('a render reads its whole closure — the budget is for live traffic', async function (assert) {
      // What a prerender assembles is rendered into HTML that is cached and
      // served long after this request, and the cached copy carries no way to
      // say it was short. So the exemption is not an optimization: a clipped
      // render would be a wrong answer with no way to notice.
      setSearchBoundsForTests({ maxAssembledLinkResources: 2 });

      let live = await request
        .get(cardPath('consumer-1'))
        .set('Accept', SupportedMimeType.CardJson);
      assert.strictEqual(
        linkResourceIds(live.body.included).length,
        2,
        'the live read is bounded',
      );

      let duringPrerender = await request
        .get(cardPath('consumer-1'))
        .set('Accept', SupportedMimeType.CardJson)
        .set('x-boxel-during-prerender', '1');
      assert.strictEqual(
        duringPrerender.status,
        200,
        `HTTP 200: ${duringPrerender.text}`,
      );
      assert.strictEqual(
        linkResourceIds(duringPrerender.body.included).length,
        FULL_CLOSURE,
        'the render carries the whole closure at the same budget',
      );
      assert.notOk(
        duringPrerender.body.meta?.linkClosureTruncated,
        'and reports nothing, having been clipped by nothing',
      );
    });

    test('retuning the budget rotates the validator', async function (assert) {
      // Changing the ceiling changes which cards come back clipped and what a
      // clipped one contains, while `indexed_at` and the realm-info hash stand
      // still. Without the budget in the validator, every client holding one
      // would be 304'd to the shape it cached across the change.
      setSearchBoundsForTests({ maxAssembledLinkResources: FULL_CLOSURE });
      let whole = await request
        .get(cardPath('consumer-1'))
        .set('Accept', SupportedMimeType.CardJson);
      let wholeEtag = whole.headers['etag'];
      assert.ok(wholeEtag, 'the card+json read emits a validator');

      setSearchBoundsForTests({ maxAssembledLinkResources: 2 });
      let clipped = await request
        .get(cardPath('consumer-1'))
        .set('Accept', SupportedMimeType.CardJson);
      assert.notStrictEqual(
        clipped.headers['etag'],
        wholeEtag,
        'a different budget is a different validator',
      );

      // And the validator minted under the first budget does not match, so a
      // client holding it is sent the shape the second budget produces rather
      // than being told the copy it has is fresh.
      let conditional = await request
        .get(cardPath('consumer-1'))
        .set('Accept', SupportedMimeType.CardJson)
        .set('If-None-Match', wholeEtag);
      assert.strictEqual(
        conditional.status,
        200,
        'the stale validator is not honoured',
      );
      assert.strictEqual(
        linkResourceIds(conditional.body.included).length,
        2,
        'and the client receives the shape the new budget produces',
      );
    });

    test('a query-backed field clipped part-way through stays coherent', async function (assert) {
      // The members of a query-backed field are written as `matches.N`
      // relationships by the same pass that assembles the closure, so the budget
      // can run out in the middle of one. What must survive is the answer a
      // consumer cannot cheaply recompute: which cards the field names. The
      // cards themselves it can fetch.
      setSearchBoundsForTests({ maxAssembledLinkResources: 3 });
      let response = await request
        .get(cardPath('query-consumer-1'))
        .set('Accept', SupportedMimeType.CardJson);

      assert.strictEqual(response.status, 200, `HTTP 200: ${response.text}`);
      let relationships = response.body.data.relationships as Record<
        string,
        {
          links?: { self?: string; search?: string };
          data?: { id: string }[] | { id: string };
        }
      >;
      let umbrella = relationships.matches;
      assert.strictEqual(
        Array.isArray(umbrella?.data) ? umbrella.data.length : -1,
        TARGET_COUNT,
        'the field still names every match, including the ones not carried',
      );
      assert.ok(umbrella?.links?.search, 'and still carries its query link');

      let carried = linkResourceIds(response.body.included);
      assert.strictEqual(carried.length, 3, 'only the budget is carried');
      assert.true(
        response.body.meta?.linkClosureTruncated,
        'and the document reports the rest is missing',
      );

      // Every member the response did not carry is still reachable: its own
      // `matches.N` entry names it, which is what sends a consumer to fetch it
      // rather than reading the field as short.
      let named = new Set<string>();
      for (let [key, rel] of Object.entries(relationships)) {
        if (!key.startsWith('matches.')) {
          continue;
        }
        if (rel.links?.self) {
          named.add(rel.links.self.replace(/^\.\//, ''));
        }
      }
      assert.strictEqual(
        named.size,
        TARGET_COUNT,
        'every member names its target, carried or not',
      );
    });

    test('the realm serves the bound without a caller opting in', async function (assert) {
      // The engine holds every assembly to the budget and takes an exemption
      // rather than an opt-in, so a route added later is bounded by default.
      // Asserted through the engine directly, since a future route would not
      // be reachable through the ones above.
      setSearchBoundsForTests({ maxAssembledLinkResources: 5 });
      let result = await realm.realmIndexQueryEngine.cardDocument(
        new URL(`${realmHref}consumer-1`),
        { loadLinks: true },
      );
      let doc = result?.type === 'doc' ? result.doc : undefined;
      assert.ok(doc, 'the card assembled');
      assert.strictEqual(
        linkResourceIds(doc?.included).length,
        5,
        'an opts object that says nothing about the budget is still bounded',
      );
      assert.true(
        doc?.meta?.linkClosureTruncated,
        'and the assembly reports the clip',
      );
    });
  });
});
